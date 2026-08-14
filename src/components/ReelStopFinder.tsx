"use client";

import { useEffect, useRef, useState } from "react";
import type { Award, DbHandle, Facade } from "@/lib/db";

interface Props {
  /** Amount to search Award.Amount for — the tool's current total payout. */
  totalPayout: number;
  /** Push a chosen reelStop candidate into the main generated gaffe output. */
  onApply: (reelStops: number[]) => void;
}

interface AwardResult {
  award: Award;
  facadeKey: string;
  reelStops: number[][];
}

/**
 * Parse a positional search string into one constraint per reel position.
 * Each comma-separated token: empty (or non-numeric) → null = wildcard, else
 * the number the stop must equal. E.g. ",,,,,,,,2" → [null×8, 2] (9th = 2).
 */
function parsePattern(s: string): (number | null)[] {
  if (s.trim() === "") return [];
  return s.split(",").map((tok) => {
    const t = tok.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  });
}

/**
 * True when `rs` satisfies `pattern`: at every index where the pattern has a
 * number, rs must equal it; null entries (and positions beyond the pattern's
 * length) are unconstrained. An empty/all-null pattern matches everything.
 */
function matchesPattern(rs: number[], pattern: (number | null)[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i];
    if (want == null) continue;
    if (rs[i] !== want) return false;
  }
  return true;
}

/**
 * reelStops finder: upload the outcomes .db, pick a facade, and look up awards
 * whose Amount equals the total payout — showing their reelStops as candidates.
 * The DB layer (wa-sqlite) is imported lazily so it stays out of the initial
 * bundle and only runs in the browser.
 */
export default function ReelStopFinder({ totalPayout, onApply }: Props) {
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
  const [results, setResults] = useState<AwardResult[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  // Positional filter (Update 3). Narrows shown candidates live; also honored
  // by find() to pull DB matches beyond the per-award display cap.
  const [pattern, setPattern] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const parsedPattern = parsePattern(pattern);
  const filterActive = parsedPattern.some((v) => v != null);

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
    setResults(null);
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
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : "Failed to open the database.");
    }
  }

  async function find() {
    if (!handleRef.current || (facadeId == null && !searchAll)) return;
    setSearching(true);
    setError(null);
    setResults(null);
    setExpanded(new Set());
    try {
      const db = await import("@/lib/db");
      const pat = parsePattern(pattern);
      const active = pat.some((v) => v != null);

      // Which bet lines to search: just the selected one, or every facade that
      // has a matching award (the ✓-flagged set) when "search all" is on.
      const targets: Facade[] = searchAll
        ? facades.filter((f) => facadesWithResults.has(f.facadeId))
        : facades.filter((f) => f.facadeId === facadeId);

      const out: AwardResult[] = [];
      for (const facade of targets) {
        const awards = await db.findAwardsByAmount(
          handleRef.current,
          facade.facadeId,
          totalPayout
        );
        for (const award of awards) {
          // With a pattern, scan the award's range for all matches; otherwise
          // just grab the first few candidates as before.
          const reelStops = active
            ? await db.findMatchingReelStops(handleRef.current, award, pat)
            : await db.getReelStops(handleRef.current, award, 8);
          out.push({ award, facadeKey: facade.facadeKey, reelStops });
        }
      }
      setResults(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed.");
    } finally {
      setSearching(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* ignore */
    }
  }

  function apply(rs: number[], text: string) {
    onApply(rs);
    setApplied(text);
    setTimeout(() => setApplied(null), 1200);
  }

  function toggle(awardId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(awardId)) next.delete(awardId);
      else next.add(awardId);
      return next;
    });
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
              Search all bet lines with results (
              {facadesWithResults.size}) — not just the selected one
            </span>
          </label>

          {results && results.length === 0 && (
            <p className="muted small">
              No award with Amount = {totalPayout.toLocaleString()}
              {searchAll ? " in any facade." : " in this facade."}
            </p>
          )}

          {results && results.length > 0 && (
            <div className="award-results">
              {results.map(({ award, facadeKey, reelStops }) => {
                const shown = filterActive
                  ? reelStops.filter((rs) => matchesPattern(rs, parsedPattern))
                  : reelStops;
                const isEmpty = shown.length === 0;
                const open = filterActive
                  ? !isEmpty
                  : expanded.has(award.awardId);
                return (
                  <div
                    key={`${facadeKey}:${award.awardId}`}
                    className={"award-card" + (isEmpty ? " empty" : "")}
                  >
                    <button
                      type="button"
                      className="award-head"
                      onClick={() => !isEmpty && toggle(award.awardId)}
                      disabled={isEmpty || filterActive}
                      aria-expanded={open}
                    >
                      <span className="award-head-main">
                        <span className="award-caret">
                          {isEmpty ? "·" : open ? "▾" : "▸"}
                        </span>
                        <span className="award-title">
                          Award #{award.awardId}
                        </span>
                        <span
                          className={
                            "award-badge" + (isEmpty ? " award-badge-empty" : "")
                          }
                        >
                          {isEmpty
                            ? "no results"
                            : `${shown.length} result${
                                shown.length === 1 ? "" : "s"
                              }`}
                        </span>
                      </span>
                      <span className="muted small">
                        {searchAll ? `${facadeKey} · ` : ""}tier {award.tier} ·
                        flags {award.flags} · start {award.startState ?? "—"} ·{" "}
                        {award.totalCount} presentations
                      </span>
                    </button>

                    {open && !isEmpty && (
                      <div className="reelstop-list">
                        {shown.map((rs, i) => {
                          const text = `[${rs.join(",")}]`;
                          return (
                            <div key={i} className="reelstop">
                              <span className="reelstop-vals">{text}</span>
                              <button
                                type="button"
                                className="reelstop-btn reelstop-apply"
                                onClick={() => apply(rs, text)}
                                title="Use in gaffe result"
                              >
                                {applied === text ? "✓" : "+"}
                              </button>
                              <button
                                type="button"
                                className="reelstop-btn"
                                onClick={() => copy(text)}
                                title="Copy reelStops"
                              >
                                {copied === text ? "✓" : "copy"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
