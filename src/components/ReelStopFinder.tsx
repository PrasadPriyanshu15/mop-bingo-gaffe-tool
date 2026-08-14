"use client";

import { useRef, useState } from "react";
import type { Award, DbHandle, Facade } from "@/lib/db";

interface Props {
  /** Amount to search Award.Amount for — the tool's current total payout. */
  totalPayout: number;
}

interface AwardResult {
  award: Award;
  reelStops: number[][];
}

/**
 * reelStops finder: upload the outcomes .db, pick a facade, and look up awards
 * whose Amount equals the total payout — showing their reelStops as candidates.
 * The DB layer (wa-sqlite) is imported lazily so it stays out of the initial
 * bundle and only runs in the browser.
 */
export default function ReelStopFinder({ totalPayout }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<DbHandle | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "opening" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);

  const [facades, setFacades] = useState<Facade[]>([]);
  const [facadeId, setFacadeId] = useState<number | null>(null);

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AwardResult[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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
    if (!handleRef.current || facadeId == null) return;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const db = await import("@/lib/db");
      const awards = await db.findAwardsByAmount(
        handleRef.current,
        facadeId,
        totalPayout
      );
      const out: AwardResult[] = [];
      for (const award of awards) {
        const reelStops = await db.getReelStops(handleRef.current, award, 8);
        out.push({ award, reelStops });
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
              <span className="db-label">Facade</span>
              <select
                className="select"
                value={facadeId ?? ""}
                onChange={(e) => setFacadeId(Number(e.target.value))}
              >
                {facades.map((f) => (
                  <option key={f.facadeId} value={f.facadeId}>
                    {f.facadeKey}
                  </option>
                ))}
              </select>
            </label>

            <div className="db-field">
              <span className="db-label">Search amount (total payout)</span>
              <div className="db-amount">{totalPayout.toLocaleString()}</div>
            </div>

            <button
              type="button"
              className="btn"
              onClick={find}
              disabled={searching}
            >
              {searching ? "Searching…" : "Find reelStops"}
            </button>
          </div>

          {results && results.length === 0 && (
            <p className="muted small">
              No award with Amount = {totalPayout.toLocaleString()} in this facade.
            </p>
          )}

          {results && results.length > 0 && (
            <div className="award-results">
              {results.map(({ award, reelStops }) => (
                <div key={award.awardId} className="award-card">
                  <div className="award-head">
                    <span className="award-title">
                      Award #{award.awardId}
                    </span>
                    <span className="muted small">
                      tier {award.tier} · flags {award.flags} · start{" "}
                      {award.startState ?? "—"} · {award.totalCount} presentations
                    </span>
                  </div>
                  <div className="reelstop-list">
                    {reelStops.map((rs, i) => {
                      const text = `[${rs.join(",")}]`;
                      return (
                        <button
                          key={i}
                          type="button"
                          className="reelstop"
                          onClick={() => copy(text)}
                          title="Copy reelStops"
                        >
                          <span className="reelstop-vals">{text}</span>
                          <span className="reelstop-copy">
                            {copied === text ? "✓" : "copy"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
