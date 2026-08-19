"use client";

import { useEffect, useRef, useState } from "react";
import type { Award, DbHandle, Facade } from "@/lib/db";
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
  /** Load a reelStop into the reelStrip viewer. */
  onSlot: (reelStops: number[]) => void;
  /** Whether a reelStrip .xml is loaded (enables the "slot" button). */
  reelStripLoaded: boolean;
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
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<DbHandle | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "opening" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);

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

  async function handleFile(file: File) {
    setError(null);
    setSections(null);
    setStatus("opening");
    setFileName(`${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB)`);
    try {
      const db = await import("@/lib/db");
      if (handleRef.current) await db.closeDatabase(handleRef.current);
      const h = await db.openDatabase(file);
      handleRef.current = h;
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

  async function find() {
    if (!handleRef.current || (facadeId == null && !searchAll)) return;
    setSearching(true);
    setError(null);
    setSections(null);
    setOpenSections(new Set());
    try {
      const db = await import("@/lib/db");
      const pat = parsePattern(pattern);
      const active = patternIsActive(pat);

      // Which bet lines to search: just the selected one, or every facade that
      // has a matching award (the ✓-flagged set) when "search all" is on.
      const targets: Facade[] = searchAll
        ? facades.filter((f) => facadesWithResults.has(f.facadeId))
        : facades.filter((f) => f.facadeId === facadeId);

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
            const reelStops = active
              ? await db.findMatchingReelStops(handleRef.current, award, pat)
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

            <button
              type="button"
              className="btn"
              onClick={find}
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
