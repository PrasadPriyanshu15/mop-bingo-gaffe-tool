"use client";

import { useEffect, useRef, useState } from "react";
import type { DbHandle, DbType, Facade, RngLenFilter } from "@/lib/db";
import { parsePattern, patternIsActive } from "@/lib/reelstop";
import AwardResults, { type AwardResult } from "./AwardResults";

export interface Win {
  key: string;
  label: string;
  payout: number;
}

interface Props {
  /** Amount to search Award.Amount for — the tool's current total payout. */
  totalPayout: number;
  /** The individual selected wins (one per ticked payout row). */
  wins: Win[];
  /** Push a chosen reelStop candidate into the main generated gaffe output. */
  onApply: (reelStops: number[]) => void;
  /** Report the opened DB handle upward so other panels can query it. */
  onDbReady: (handle: DbHandle | null, facades: Facade[]) => void;
  /** Load a reelStop into the reelStrip viewer. `presentationId` (HPP / Type 2)
   *  lets FREE GAME auto-load that presentation's segment-2+ RNG. */
  onSlot: (reelStops: number[], presentationId?: number) => void;
  /** Whether a reelStrip .xml is loaded (enables the "slot" button). */
  reelStripLoaded: boolean;
  /** Bet line (facadeKey) a "create pattern" click wants pre-selected here. */
  autoFindFacadeKey?: string | null;
  /** DB facadeId selected in the amount search — preferred over facadeKey, since
   *  DB facade keys need not match the XML paytable keys (Type 2 / HPP). */
  autoFindFacadeId?: number | null;
  /** reelStop positional filter to mirror from the DB amount search. */
  autoFindPattern?: string;
  /** RNG-length bound (HPP) to mirror from the DB amount search. */
  autoFindMaxRng?: string;
  /** Changes each time an auto-find is requested; triggers the lookup. */
  autoFindToken?: number;
}

/** One amount searched, with its matching awards (across the target facades). */
interface WinSection {
  key: string;
  label: string;
  amount: number;
  awards: AwardResult[];
}

/**
 * reelStops finder: upload the outcomes .db, pick a facade, and look up awards
 * whose Amount equals the total payout — showing their reelStops as candidates.
 * The DB layer (wa-sqlite) is imported lazily so it stays out of the initial
 * bundle and only runs in the browser.
 */
export default function ReelStopFinder({
  totalPayout,
  wins,
  onApply,
  onDbReady,
  onSlot,
  reelStripLoaded,
  autoFindFacadeKey,
  autoFindFacadeId,
  autoFindPattern,
  autoFindMaxRng,
  autoFindToken,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<DbHandle | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "opening" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  // Which schema the file to upload uses (applies to the next file chosen):
  // type1 = RngValues on Presentation; type2 = RngValues in the Segment table.
  const [dbType, setDbType] = useState<DbType>("type1");
  // The schema of the currently-open DB (independent of the picker above, which
  // only affects the next upload). Gates the RNG-length filter, which is Type-2 only.
  const [openedType, setOpenedType] = useState<DbType | null>(null);

  const [facades, setFacades] = useState<Facade[]>([]);
  const [facadeId, setFacadeId] = useState<number | null>(null);
  // FacadeIds that have at least one award for the current total payout — used
  // to flag bet lines with results (✓) in the picker.
  const [facadesWithResults, setFacadesWithResults] = useState<Set<number>>(
    new Set()
  );

  const [searching, setSearching] = useState(false);
  const [searchAll, setSearchAll] = useState(false);
  // "total" = search the summed payout (default); "each" = search every
  // selected win's payout on its own, in its own section.
  const [mode, setMode] = useState<"total" | "each">("total");
  const [sections, setSections] = useState<WinSection[] | null>(null);
  // Which per-win sections are expanded (Each win mode). Collapsed by default
  // so only the payout headers show until one is opened.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  // Positional filter (Update 3). Narrows shown candidates live; also honored
  // by find() to pull DB matches beyond the per-award display cap.
  const [pattern, setPattern] = useState("");
  // HPP (Type 2) only: bound the reconstructed RNG length. Blank = no bound; a
  // single "300" keeps candidates with <= 300 RNG values, a range "100-300" keeps
  // 100..300. Mirrors the DB amount search field of the same name.
  const [maxRng, setMaxRng] = useState("");

  const multiWin = wins.length > 1;
  const eachMode = mode === "each" && multiWin;

  // Flag which facades have any award for this amount, so the picker can mark
  // them. Cheap indexed query; re-runs when the payout changes.
  useEffect(() => {
    if (status !== "ready" || !handleRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await import("@/lib/db");
        const ids = await db.findFacadesWithAmount(
          handleRef.current!,
          totalPayout
        );
        if (!cancelled) setFacadesWithResults(new Set(ids));
      } catch {
        if (!cancelled) setFacadesWithResults(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, totalPayout]);

  // Auto-find: when a "create pattern" click bumps autoFindToken, point this
  // panel at the same bet line and run the lookup. The effect runs after the
  // parent re-render that changed the token, so `totalPayout` here is already
  // the freshly-computed amount. Guarded to the initial token (0) doing nothing.
  const lastAutoToken = useRef(autoFindToken ?? 0);
  useEffect(() => {
    const token = autoFindToken ?? 0;
    if (token === lastAutoToken.current) return;
    lastAutoToken.current = token;
    if (status !== "ready" || !handleRef.current) return;
    // Prefer the DB facadeId chosen in the amount search (exact for every DB
    // type); fall back to matching the XML paytable key when no bet line was
    // singled out there (facadeSel = "all", typical for Type 1).
    const targetId =
      autoFindFacadeId != null &&
      facades.some((f) => f.facadeId === autoFindFacadeId)
        ? autoFindFacadeId
        : facades.find((f) => f.facadeKey === autoFindFacadeKey)?.facadeId ??
          null;
    if (targetId == null) return;
    const pat = autoFindPattern ?? "";
    const rng = autoFindMaxRng ?? "";
    setFacadeId(targetId);
    setSearchAll(false);
    setPattern(pat); // mirror the DB amount search's filters into this panel
    setMaxRng(rng);
    void find({ facadeId: targetId, pattern: pat, maxRng: rng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFindToken]);

  async function handleFile(file: File) {
    setError(null);
    setSections(null);
    setStatus("opening");
    setFileName(
      `${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB · ${
        dbType === "type2" ? "Type 2" : "Type 1"
      })`
    );
    try {
      const db = await import("@/lib/db");
      if (handleRef.current) await db.closeDatabase(handleRef.current);
      const h = await db.openDatabase(file, dbType);
      handleRef.current = h;
      // Use the schema the DB actually opened as, not the picker choice: a file
      // marked Type 2 (HPP) with no Segment table falls back to Type 1 reads.
      setOpenedType(h.type);
      if (h.type !== dbType) {
        setFileName(
          `${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB · ${
            h.type === "type2" ? "Type 2" : "Type 1"
          }, no Segment table)`
        );
      }
      const list = await db.listFacades(h);
      setFacades(list);
      setFacadeId(list[0]?.facadeId ?? null);
      setStatus("ready");
      onDbReady(h, list);
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : "Failed to open the database.");
      onDbReady(null, []);
    }
  }

  // Parse the RNG-length field (Type 2 only), mirroring the DB amount search:
  // blank = no bound, "300" = <= 300, "100-300" = 100..300.
  function parseMaxRng(str: string): {
    filter: RngLenFilter | null;
    error: boolean;
  } {
    if (openedType !== "type2") return { filter: null, error: false };
    const t = str.trim();
    if (t === "") return { filter: null, error: false };
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let lo = Number(m[1]);
      let hi = Number(m[2]);
      if (lo > hi) [lo, hi] = [hi, lo];
      if (lo <= 0 || hi <= 0) return { filter: null, error: true };
      return { filter: { min: lo, max: hi }, error: false };
    }
    const n = Number(t);
    if (!Number.isInteger(n) || n <= 0) return { filter: null, error: true };
    return { filter: { min: null, max: n }, error: false };
  }

  async function find(opts?: {
    facadeId?: number;
    pattern?: string;
    maxRng?: string;
  }) {
    // An override (from an auto-find) targets exactly that bet line, ignoring the
    // "search all" toggle so the found reelStops match the DB search's bet line.
    const auto = opts?.facadeId !== undefined;
    const fid = auto ? opts!.facadeId! : facadeId;
    const useAll = searchAll && !auto;
    if (!handleRef.current || (fid == null && !useAll)) return;

    const pat = parsePattern(opts?.pattern ?? pattern);
    const active = patternIsActive(pat);
    const { filter: rngLen, error: rngErr } = parseMaxRng(opts?.maxRng ?? maxRng);
    if (rngErr) {
      setError(
        "RNG length must be a positive number or range like 100-300."
      );
      return;
    }
    const constrained = active || rngLen != null;

    setSearching(true);
    setError(null);
    setSections(null);
    setOpenSections(new Set());
    try {
      const db = await import("@/lib/db");

      // Which bet lines to search: just the selected one, or every facade that
      // has a matching award (the ✓-flagged set) when "search all" is on.
      const targets: Facade[] = useAll
        ? facades.filter((f) => facadesWithResults.has(f.facadeId))
        : facades.filter((f) => f.facadeId === fid);

      // Which amounts to search: the summed total, or each selected win.
      const amounts: { key: string; label: string; amount: number }[] = eachMode
        ? wins.map((w) => ({ key: w.key, label: w.label, amount: w.payout }))
        : [
            {
              key: "total",
              label: `Total (${totalPayout.toLocaleString()})`,
              amount: totalPayout,
            },
          ];

      const out: WinSection[] = [];
      for (const a of amounts) {
        const awards: AwardResult[] = [];
        for (const facade of targets) {
          const found = await db.findAwardsByAmount(
            handleRef.current,
            facade.facadeId,
            a.amount
          );
          for (const award of found) {
            const reelStops = constrained
              ? await db.findMatchingReelStops(
                  handleRef.current,
                  award,
                  pat,
                  2000,
                  rngLen
                )
              : await db.getReelStops(handleRef.current, award, 8);
            awards.push({ award, facadeKey: facade.facadeKey, reelStops });
          }
        }
        out.push({ ...a, awards });
      }
      setSections(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-title">5 · reelStops (from DB)</div>

      <div className="db-type-row">
        <span className="db-label">DB structure</span>
        <div className="seg">
          <button
            type="button"
            className={"seg-btn" + (dbType === "type1" ? " on" : "")}
            onClick={() => setDbType("type1")}
            disabled={status === "opening"}
            title="RngValues stored directly on the Presentation table (e.g. HFNG_10k.db)"
          >
            APP Game
          </button>
          <button
            type="button"
            className={"seg-btn" + (dbType === "type2" ? " on" : "")}
            onClick={() => setDbType("type2")}
            disabled={status === "opening"}
            title="RngValues stored in the Segment table, concatenated per presentation (e.g. MMMP.db)"
          >
            HPP Game
          </button>
        </div>
        <span className="muted small">applies to the file you upload next</span>
      </div>

      <div className="upload-row">
        <button
          type="button"
          className="btn"
          onClick={() => inputRef.current?.click()}
          disabled={status === "opening"}
        >
          {status === "opening" ? "Opening…" : "Choose .db file…"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".db,.sqlite,.sqlite3,application/octet-stream"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        {fileName && <span className="loaded-name">{fileName}</span>}
      </div>

      {error && <p className="error">{error}</p>}

      {status === "ready" && (
        <>
          <div className="db-controls">
            <label className="db-field">
              <span className="db-label">Facade (bet line)</span>
              <select
                className="select"
                value={facadeId ?? ""}
                disabled={searchAll}
                onChange={(e) => setFacadeId(Number(e.target.value))}
              >
                {facades.map((f) => (
                  <option key={f.facadeId} value={f.facadeId}>
                    {(facadesWithResults.has(f.facadeId) ? "✅ " : "　") +
                      f.facadeKey}
                  </option>
                ))}
              </select>
            </label>

            <div className="db-field">
              <span className="db-label">Search amount (total payout)</span>
              <div className="db-amount">{totalPayout.toLocaleString()}</div>
            </div>

            {multiWin && (
              <div className="db-field">
                <span className="db-label">Look up</span>
                <div className="seg">
                  <button
                    type="button"
                    className={"seg-btn" + (mode === "total" ? " on" : "")}
                    onClick={() => setMode("total")}
                  >
                    Total win
                  </button>
                  <button
                    type="button"
                    className={"seg-btn" + (mode === "each" ? " on" : "")}
                    onClick={() => setMode("each")}
                  >
                    Each win
                  </button>
                </div>
              </div>
            )}

            <label className="db-field db-field-grow">
              <span className="db-label">
                reelStop filter (per position, blank = any)
              </span>
              <input
                className="select db-search"
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g. ,,,,,,,,2"
              />
            </label>

            {openedType === "type2" && (
              <label className="db-field">
                <span className="db-label">RNG length (blank = any)</span>
                <input
                  className="select db-search"
                  type="text"
                  value={maxRng}
                  onChange={(e) => setMaxRng(e.target.value)}
                  placeholder="e.g. 300 or 100-300"
                />
              </label>
            )}

            <button
              type="button"
              className="btn"
              onClick={() => find()}
              disabled={searching}
            >
              {searching ? "Searching…" : "Find reelStops"}
            </button>
          </div>

          <label className="db-check">
            <input
              type="checkbox"
              checked={searchAll}
              onChange={(e) => setSearchAll(e.target.checked)}
            />
            <span>
              Search all bet lines with results ({facadesWithResults.size}) — not
              just the selected one
            </span>
          </label>

          {sections &&
            (eachMode ? (
              <div className="win-sections">
                {sections.map((sec) => {
                  const open = openSections.has(sec.key);
                  return (
                    <section key={sec.key} className="win-section">
                      <button
                        type="button"
                        className="win-section-head"
                        aria-expanded={open}
                        onClick={() =>
                          setOpenSections((prev) => {
                            const next = new Set(prev);
                            if (next.has(sec.key)) next.delete(sec.key);
                            else next.add(sec.key);
                            return next;
                          })
                        }
                      >
                        <span className="win-section-caret">
                          {open ? "▾" : "▸"}
                        </span>
                        <span className="win-section-label">{sec.label}</span>
                        <span className="award-badge">
                          {sec.awards.length} award
                          {sec.awards.length === 1 ? "" : "s"}
                        </span>
                      </button>
                      {open && (
                        <AwardResults
                          results={sec.awards}
                          pattern={pattern}
                          showFacade={searchAll}
                          onApply={onApply}
                          onSlot={onSlot}
                          reelStripLoaded={reelStripLoaded}
                          emptyText={`No award with Amount = ${sec.amount.toLocaleString()}${
                            searchAll ? " in any facade." : " in this facade."
                          }`}
                        />
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <AwardResults
                results={sections[0]?.awards ?? []}
                pattern={pattern}
                showFacade={searchAll}
                onApply={onApply}
                onSlot={onSlot}
                reelStripLoaded={reelStripLoaded}
                emptyText={`No award with Amount = ${totalPayout.toLocaleString()}${
                  searchAll ? " in any facade." : " in this facade."
                }`}
              />
            ))}
        </>
      )}
    </div>
  );
}
