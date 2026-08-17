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
  fitPaytableKey: string;
}

export interface Award {
  awardId: number;
  facadeId: number;
  tier: number;
  amount: number;
  flags: string;
  startState: string | null;
  totalCount: number;
  sequenceStart: number;
}

export interface DbHandle {
  sqlite3: any;
  db: number;
  vfs: any;
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
export async function openDatabase(file: File): Promise<DbHandle> {
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
  return { sqlite3, db, vfs };
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
    "SELECT FacadeId, FacadeKey, FitPaytableKey FROM Facade ORDER BY FacadeId",
    []
  );
  return rows.map((r: any[]) => ({
    facadeId: Number(r[0]),
    facadeKey: String(r[1]),
    fitPaytableKey: String(r[2]),
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

export async function findAwardsByAmount(
  h: DbHandle,
  facadeId: number,
  amount: number
): Promise<Award[]> {
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
 * read — no scan of the 5M-row table.
 */
export async function getReelStops(
  h: DbHandle,
  award: Award,
  limit = 8
): Promise<number[][]> {
  const hi = award.sequenceStart + award.totalCount - 1;
  const { rows } = await h.sqlite3.execWithParams(
    h.db,
    "SELECT RngValues FROM Presentation WHERE PresentationId BETWEEN ? AND ? LIMIT ?",
    [award.sequenceStart, hi, limit]
  );
  return rows.map((r: any[]) => parseRng(r[0]));
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
): Promise<number[][]> {
  const hi = award.sequenceStart + award.totalCount - 1;
  const { rows } = await h.sqlite3.execWithParams(
    h.db,
    "SELECT RngValues FROM Presentation WHERE PresentationId BETWEEN ? AND ? LIMIT ?",
    [award.sequenceStart, hi, scanCap]
  );
  const matches: number[][] = [];
  for (const r of rows as any[][]) {
    const rs = parseRng(r[0]);
    if (matchesPattern(rs, pattern)) matches.push(rs);
  }
  return matches;
}
