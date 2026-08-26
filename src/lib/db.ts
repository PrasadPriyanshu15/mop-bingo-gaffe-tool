// Client-only SQLite access for the outcomes database (HFNG_10k.db, ~182 MB).
//
// The file is read on demand (never fully loaded) through a read-only VFS backed
// by the uploaded File: SQLite's page reads become File.slice() byte-range reads,
// so indexed queries touch only a few KB–MB. Uses wa-sqlite (asyncify build),
// which needs no SharedArrayBuffer — safe for GitHub Pages static hosting.

import * as SQLite from "wa-sqlite";
import { Base } from "wa-sqlite/src/VFS.js";
import { matchesPattern } from "./reelstop";

const {
  SQLITE_OK,
  SQLITE_IOERR_SHORT_READ,
  SQLITE_NOTFOUND,
  SQLITE_OPEN_READONLY,
} = SQLite;

export interface Facade {
  facadeId: number;
  facadeKey: string;
}

export interface Award {
  awardId: number;
  facadeId: number;
  tier: number;
  amount: number;
  flags: string;
  /** Present only in Type 1 databases (Type 2's Award table has no StartState). */
  startState?: string | null;
  totalCount: number;
  sequenceStart: number;
}

/**
 * One reelStop candidate. Type 1 has just the RNG values; Type 2 additionally
 * carries the PresentationId it was reconstructed from (from concatenated
 * Segment rows) so the UI can show it.
 */
export interface ReelStopCandidate {
  values: number[];
  presentationId?: number;
}

/**
 * Which outcomes-DB schema the uploaded file uses.
 *  • "type1": RngValues live directly on the Presentation table (e.g. HFNG_10k).
 *  • "type2": Presentation only maps to an Award; RngValues live in the Segment
 *    table, one presentation's RNG split across SegmentIndex 1,2,… rows that are
 *    concatenated (e.g. MMMP.db).
 */
export type DbType = "type1" | "type2";

export interface DbHandle {
  sqlite3: any;
  db: number;
  vfs: any;
  type: DbType;
}

/** Read-only VFS that serves a single uploaded File via byte-range reads. */
class FileVFS extends (Base as any) {
  name = "uploaded-file";
  private file: File;

  constructor(file: File) {
    super();
    this.file = file;
  }

  xOpen(_name: string, fileId: number, _flags: number, pOutFlags: DataView) {
    return this.handleAsync(async () => {
      pOutFlags.setInt32(0, SQLITE_OPEN_READONLY, true);
      return SQLITE_OK;
    });
  }

  xClose(_fileId: number) {
    return this.handleAsync(async () => SQLITE_OK);
  }

  xRead(_fileId: number, pData: Uint8Array, iOffset: number) {
    return this.handleAsync(async () => {
      const size = this.file.size;
      const bgn = Math.min(iOffset, size);
      const end = Math.min(iOffset + pData.byteLength, size);
      const nBytes = end - bgn;
      if (nBytes > 0) {
        const buf = await this.file.slice(bgn, end).arrayBuffer();
        pData.set(new Uint8Array(buf), 0);
      }
      if (nBytes < pData.byteLength) {
        pData.fill(0, nBytes);
        return SQLITE_IOERR_SHORT_READ;
      }
      return SQLITE_OK;
    });
  }

  xFileSize(_fileId: number, pSize64: DataView) {
    return this.handleAsync(async () => {
      pSize64.setBigInt64(0, BigInt(this.file.size), true);
      return SQLITE_OK;
    });
  }

  xAccess(name: string, _flags: number, pResOut: DataView) {
    return this.handleAsync(async () => {
      // The main db "exists"; sidecar journal/wal files do not.
      const exists = /-(wal|journal)$/.test(name) ? 0 : 1;
      pResOut.setInt32(0, exists, true);
      return SQLITE_OK;
    });
  }

  xFileControl(_fileId: number, _op: number, _pArg: DataView) {
    return SQLITE_NOTFOUND;
  }
}

// Native dynamic import that webpack won't try to bundle (the emscripten module
// is served from /public and located at runtime).
const nativeImport: (url: string) => Promise<any> = new Function(
  "u",
  "return import(u)"
) as any;

function assetBase(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}

/** Initialise wa-sqlite over the uploaded file and open it read-only. */
export async function openDatabase(
  file: File,
  type: DbType = "type1"
): Promise<DbHandle> {
  const base = assetBase();
  const { default: SQLiteESMFactory } = await nativeImport(
    `${base}/wa-sqlite/wa-sqlite-async.js`
  );
  const module = await SQLiteESMFactory({
    locateFile: () => `${base}/wa-sqlite/wa-sqlite-async.wasm`,
  });
  const sqlite3 = SQLite.Factory(module);

  const vfs = new FileVFS(file);
  sqlite3.vfs_register(vfs, false);

  const db = await sqlite3.open_v2("main.db", SQLITE_OPEN_READONLY, vfs.name);
  await sqlite3.exec(db, "PRAGMA query_only=1;");
  return { sqlite3, db, vfs, type };
}

export async function closeDatabase(h: DbHandle): Promise<void> {
  try {
    await h.sqlite3.close(h.db);
  } catch {
    /* ignore */
  }
}

export async function listFacades(h: DbHandle): Promise<Facade[]> {
  const { rows } = await h.sqlite3.execWithParams(
    h.db,
    // Only FacadeKey is present in every DB variant; FitPaytableKey is absent in
    // some, so it is not selected here (nothing consumes it anyway).
    "SELECT FacadeId, FacadeKey FROM Facade ORDER BY FacadeId",
    []
  );
  return rows.map((r: any[]) => ({
    facadeId: Number(r[0]),
    facadeKey: String(r[1]),
  }));
}

/**
 * FacadeIds that have at least one Award for `amount`. One indexed query over
 * all facades — used to flag which bet lines have results in the picker.
 */
export async function findFacadesWithAmount(
  h: DbHandle,
  amount: number
): Promise<number[]> {
  const { rows } = await h.sqlite3.execWithParams(
    h.db,
    "SELECT DISTINCT FacadeId FROM Award WHERE Amount=? ORDER BY FacadeId",
    [amount]
  );
  return rows.map((r: any[]) => Number(r[0]));
}

/**
 * FacadeIds that have at least one Award whose amount falls in [lo, hi]. Used to
 * gate the pattern search to bet lines where a searched range actually occurs.
 */
export async function findFacadesWithAmountInRange(
  h: DbHandle,
  lo: number,
  hi: number
): Promise<number[]> {
  const { rows } = await h.sqlite3.execWithParams(
    h.db,
    "SELECT DISTINCT FacadeId FROM Award WHERE Amount>=? AND Amount<=? ORDER BY FacadeId",
    [lo, hi]
  );
  return rows.map((r: any[]) => Number(r[0]));
}

/**
 * Distinct award amounts, optionally scoped to a facade and/or an inclusive
 * [lo, hi] amount range. Used by the custom search to list which amounts exist
 * (e.g. everything in 500–1000) before drilling in.
 */
export async function listAmounts(
  h: DbHandle,
  facadeId: number | null,
  lo: number | null,
  hi: number | null
): Promise<number[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (facadeId != null) {
    where.push("FacadeId=?");
    params.push(facadeId);
  }
  if (lo != null) {
    where.push("Amount>=?");
    params.push(lo);
  }
  if (hi != null) {
    where.push("Amount<=?");
    params.push(hi);
  }
  const sql =
    "SELECT DISTINCT Amount FROM Award" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY Amount";
  const { rows } = await h.sqlite3.execWithParams(h.db, sql, params);
  return rows.map((r: any[]) => Number(r[0]));
}

/**
 * Smallest and largest Award.Amount for one bet line, optionally restricted to
 * awards that have at least one reelStop matching a positional pattern.
 *
 * • No pattern → a single MIN/MAX aggregate over the facade's awards.
 * • Pattern → positional matching can't be expressed in SQL (RngValues is a
 *   variable-width comma string — see findMatchingReelStops), so walk the
 *   facade's distinct amounts inward from both ends: the lowest amount with a
 *   matching award is the min, the highest is the max. Each end stops at its
 *   first hit, keeping the scan bounded.
 *
 * Returns null when no qualifying award exists.
 */
export async function findMinMaxAmount(
  h: DbHandle,
  facadeId: number,
  pattern: (number | null)[] | null
): Promise<{ min: number; max: number } | null> {
  const active = pattern != null && pattern.some((v) => v != null);
  if (!active) {
    const { rows } = await h.sqlite3.execWithParams(
      h.db,
      "SELECT MIN(Amount), MAX(Amount) FROM Award WHERE FacadeId=?",
      [facadeId]
    );
    const r = rows[0];
    if (!r || r[0] == null || r[1] == null) return null;
    return { min: Number(r[0]), max: Number(r[1]) };
  }

  const amounts = await listAmounts(h, facadeId, null, null);
  let min: number | null = null;
  for (let i = 0; i < amounts.length; i++) {
    if (await awardMatchesPattern(h, facadeId, amounts[i], pattern!)) {
      min = amounts[i];
      break;
    }
  }
  if (min == null) return null; // nothing matched at all
  let max = min;
  for (let i = amounts.length - 1; i >= 0 && amounts[i] > min; i--) {
    if (await awardMatchesPattern(h, facadeId, amounts[i], pattern!)) {
      max = amounts[i];
      break;
    }
  }
  return { min, max };
}

/**
 * True when some award for (facadeId, amount) has at least one reelStop matching
 * the positional pattern. Shared by findMinMaxAmount and listAmountsMatchingPattern.
 */
async function awardMatchesPattern(
  h: DbHandle,
  facadeId: number,
  amount: number,
  pattern: (number | null)[]
): Promise<boolean> {
  const awards = await findAwardsByAmount(h, facadeId, amount);
  for (const award of awards) {
    const rs = await findMatchingReelStops(h, award, pattern);
    if (rs.length > 0) return true;
  }
  return false;
}

/**
 * Distinct amounts for one bet line within [lo, hi], optionally restricted to
 * amounts that have at least one award whose reelStop matches a positional
 * pattern. When the pattern is null/all-wildcard this is just listAmounts.
 */
export async function listAmountsMatchingPattern(
  h: DbHandle,
  facadeId: number,
  lo: number | null,
  hi: number | null,
  pattern: (number | null)[] | null
): Promise<number[]> {
  const amounts = await listAmounts(h, facadeId, lo, hi);
  const active = pattern != null && pattern.some((v) => v != null);
  if (!active) return amounts;
  const out: number[] = [];
  for (const amount of amounts) {
    if (await awardMatchesPattern(h, facadeId, amount, pattern!)) {
      out.push(amount);
    }
  }
  return out;
}

export async function findAwardsByAmount(
  h: DbHandle,
  facadeId: number,
  amount: number
): Promise<Award[]> {
  // Type 2's Award table has no StartState column, so select it only for Type 1.
  if (h.type === "type2") {
    const { rows } = await h.sqlite3.execWithParams(
      h.db,
      "SELECT AwardId,FacadeId,Tier,Amount,Flags,TotalCount,SequenceStart " +
        "FROM Award WHERE FacadeId=? AND Amount=? ORDER BY AwardId",
      [facadeId, amount]
    );
    return rows.map((r: any[]) => ({
      awardId: Number(r[0]),
      facadeId: Number(r[1]),
      tier: Number(r[2]),
      amount: Number(r[3]),
      flags: String(r[4]),
      totalCount: Number(r[5]),
      sequenceStart: Number(r[6]),
    }));
  }
  const { rows } = await h.sqlite3.execWithParams(
    h.db,
    "SELECT AwardId,FacadeId,Tier,Amount,Flags,StartState,TotalCount,SequenceStart " +
      "FROM Award WHERE FacadeId=? AND Amount=? ORDER BY AwardId",
    [facadeId, amount]
  );
  return rows.map((r: any[]) => ({
    awardId: Number(r[0]),
    facadeId: Number(r[1]),
    tier: Number(r[2]),
    amount: Number(r[3]),
    flags: String(r[4]),
    startState: r[5] == null ? null : String(r[5]),
    totalCount: Number(r[6]),
    sequenceStart: Number(r[7]),
  }));
}

/** Parse a RngValues string like "36,28,14,4,31,0,0," into reel stops. */
function parseRng(value: unknown): number[] {
  return String(value ?? "")
    .split(",")
    .filter((s) => s !== "")
    .map((s) => Number(s));
}

/**
 * ReelStop candidates for an award. Each award owns a contiguous PresentationId
 * range [SequenceStart, SequenceStart+TotalCount-1], so this is a fast PK-range
 * read — no scan of the 5M-row table. Type 2 reconstructs each presentation's
 * RNG from the Segment table instead (see getSegmentReelStops).
 */
export async function getReelStops(
  h: DbHandle,
  award: Award,
  limit = 8
): Promise<ReelStopCandidate[]> {
  if (h.type === "type2") return getSegmentReelStops(h, award, limit, null);
  const hi = award.sequenceStart + award.totalCount - 1;
  const { rows } = await h.sqlite3.execWithParams(
    h.db,
    "SELECT RngValues FROM Presentation WHERE PresentationId BETWEEN ? AND ? LIMIT ?",
    [award.sequenceStart, hi, limit]
  );
  return rows.map((r: any[]) => ({ values: parseRng(r[0]) }));
}

/**
 * ReelStop candidates for an award that match a positional pattern. `pattern`
 * is one constraint per reel position: a number the stop must equal, or null =
 * wildcard (any value). Scans the award's PresentationId range up to `scanCap`
 * rows and filters by the pattern in JS — RngValues is a comma string of
 * variable-width numbers, so a positional match is unreliable in SQL. The cap
 * bounds work since award ranges can be large.
 */
export async function findMatchingReelStops(
  h: DbHandle,
  award: Award,
  pattern: (number | null)[],
  scanCap = 2000
): Promise<ReelStopCandidate[]> {
  if (h.type === "type2") return getSegmentReelStops(h, award, scanCap, pattern);
  const hi = award.sequenceStart + award.totalCount - 1;
  const { rows } = await h.sqlite3.execWithParams(
    h.db,
    "SELECT RngValues FROM Presentation WHERE PresentationId BETWEEN ? AND ? LIMIT ?",
    [award.sequenceStart, hi, scanCap]
  );
  const matches: ReelStopCandidate[] = [];
  for (const r of rows as any[][]) {
    const values = parseRng(r[0]);
    if (matchesPattern(values, pattern)) matches.push({ values });
  }
  return matches;
}

/**
 * Type 2 reelStop candidates. An award's presentations are the contiguous
 * PresentationId range [SequenceStart, SequenceStart+TotalCount-1]; each
 * presentation's RngValues live in the Segment table, possibly split across
 * SegmentIndex 1,2,… rows. This reads the first `maxPresentations` presentations
 * of that range in one indexed Segment scan, groups by presentation, and
 * concatenates each group's RngValues in SegmentIndex order to reconstruct the
 * full RNG. When `pattern` is set, only concatenated candidates matching it are
 * kept.
 */
async function getSegmentReelStops(
  h: DbHandle,
  award: Award,
  maxPresentations: number,
  pattern: (number | null)[] | null
): Promise<ReelStopCandidate[]> {
  const start = award.sequenceStart;
  const rangeHi = start + award.totalCount - 1;
  // Bound the scan to the first N presentations (each has few segments), so the
  // display cap / scanCap translates into a small PresentationId sub-range.
  const hi = Math.min(rangeHi, start + maxPresentations - 1);
  const { rows } = await h.sqlite3.execWithParams(
    h.db,
    "SELECT PresentationId,SegmentIndex,RngValues FROM Segment " +
      "WHERE PresentationId BETWEEN ? AND ? ORDER BY PresentationId,SegmentIndex",
    [start, hi]
  );
  // Group segments per presentation, preserving SegmentIndex order (the query
  // sorts by it), then concatenate each group's comma-separated RngValues.
  const byPid = new Map<number, string[]>();
  const order: number[] = [];
  for (const r of rows as any[][]) {
    const pid = Number(r[0]);
    let arr = byPid.get(pid);
    if (!arr) {
      arr = [];
      byPid.set(pid, arr);
      order.push(pid);
    }
    arr.push(String(r[2] ?? ""));
  }
  const out: ReelStopCandidate[] = [];
  for (const pid of order) {
    const values = parseRng(byPid.get(pid)!.join(","));
    if (pattern && !matchesPattern(values, pattern)) continue;
    out.push({ values, presentationId: pid });
  }
  return out;
}
