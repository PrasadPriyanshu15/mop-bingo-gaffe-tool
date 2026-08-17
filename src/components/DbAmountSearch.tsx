"use client";

import { useState } from "react";
import type { DbHandle, Facade } from "@/lib/db";
import { parsePattern, patternIsActive } from "@/lib/reelstop";
import AwardResults, { type AwardResult } from "./AwardResults";

interface Props {
  handle: DbHandle;
  facades: Facade[];
  /** Push a chosen reelStop candidate into the main generated gaffe output. */
  onApply: (reelStops: number[]) => void;
}

/**
 * Free-form DB lookup: search any custom Amount across the whole database (one
 * facade or all), with the same positional reelStop filter. Independent of the
 * tool's computed total payout. Collapsible; only shown once a .db is loaded.
 */
export default function DbAmountSearch({ handle, facades, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [facadeSel, setFacadeSel] = useState<string>("all");
  const [amount, setAmount] = useState("");
  const [pattern, setPattern] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AwardResult[] | null>(null);

  async function find() {
    const amt = Number(amount.trim());
    if (amount.trim() === "" || Number.isNaN(amt)) {
      setError("Enter a numeric amount to search.");
      return;
    }
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const db = await import("@/lib/db");
      const pat = parsePattern(pattern);
      const active = patternIsActive(pat);
      const targets =
        facadeSel === "all"
          ? facades
          : facades.filter((f) => String(f.facadeId) === facadeSel);

      const out: AwardResult[] = [];
      for (const facade of targets) {
        const awards = await db.findAwardsByAmount(handle, facade.facadeId, amt);
        for (const award of awards) {
          const reelStops = active
            ? await db.findMatchingReelStops(handle, award, pat)
            : await db.getReelStops(handle, award, 8);
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

  return (
    <div className="panel">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{open ? "▾" : "▸"} DB amount search</span>
        <span className="muted small">any amount</span>
      </button>

      {open && (
        <div className="amount-search">
          <label className="db-field">
            <span className="db-label">Facade (bet line)</span>
            <select
              className="select"
              value={facadeSel}
              onChange={(e) => setFacadeSel(e.target.value)}
            >
              <option value="all">All bet lines</option>
              {facades.map((f) => (
                <option key={f.facadeId} value={String(f.facadeId)}>
                  {f.facadeKey}
                </option>
              ))}
            </select>
          </label>

          <label className="db-field">
            <span className="db-label">Amount</span>
            <input
              className="select"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500"
              onKeyDown={(e) => {
                if (e.key === "Enter") void find();
              }}
            />
          </label>

          <label className="db-field">
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
            {searching ? "Searching…" : "Search DB"}
          </button>

          {error && <p className="error">{error}</p>}

          {results && (
            <AwardResults
              results={results}
              pattern={pattern}
              showFacade={facadeSel === "all"}
              onApply={onApply}
              emptyText={`No award with Amount = ${Number(
                amount
              ).toLocaleString()} found.`}
            />
          )}
        </div>
      )}
    </div>
  );
}
