"use client";

import { useRef, useState } from "react";
import type { DbHandle, Facade } from "@/lib/db";
import type { Paytable59 } from "@/lib/types";
import { parsePattern, patternIsActive } from "@/lib/reelstop";
import AwardResults, { type AwardResult } from "./AwardResults";

interface Props {
  handle: DbHandle;
  facades: Facade[];
  /** Parsed paytable XML — used to find which patterns pay a given amount. */
  data: Paytable59 | null;
  /** Push a chosen reelStop candidate into the main generated gaffe output. */
  onApply: (reelStops: number[]) => void;
  /** Prefill section 4 by selecting this pattern/ballQty at this bet line. */
  onCreatePattern: (
    facadeKey: string,
    patternId: number,
    ballQty: number
  ) => void;
}

/** A single pattern payout that equals the searched amount. */
interface PatternMatch {
  facadeKey: string;
  patternId: number;
  patternName: string;
  ballQty: number;
  payout: number;
}

/** What the Amount field resolves to. */
type AmountInput =
  | { kind: "none" }
  | { kind: "single"; v: number }
  | { kind: "range"; lo: number; hi: number }
  | { kind: "invalid" };

function parseAmountInput(s: string): AmountInput {
  const t = s.trim();
  if (t === "") return { kind: "none" };
  const m = t.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    let lo = Number(m[1]);
    let hi = Number(m[2]);
    if (lo > hi) [lo, hi] = [hi, lo];
    return { kind: "range", lo, hi };
  }
  const n = Number(t);
  if (Number.isNaN(n)) return { kind: "invalid" };
  return { kind: "single", v: n };
}

/** One amount with the awards whose reelStops matched the filter. */
interface AmountGroup {
  amount: number;
  awards: AwardResult[];
}

type View =
  | { mode: "awards"; awards: AwardResult[]; amount: number }
  | { mode: "amountList"; amounts: number[]; lo: number; hi: number }
  | { mode: "groups"; groups: AmountGroup[]; ranged: boolean };

/**
 * Free-form DB lookup, independent of the tool's computed payout:
 *  • single amount (e.g. 500) — award cards, with optional positional filter;
 *  • range (e.g. 500-1000) — the amounts that exist in that range;
 *  • range + filter — only the in-range amounts that have a matching reelStop,
 *    each with its matches;
 *  • filter only (no amount) — every amount in the DB with a matching reelStop.
 * Collapsible; only shown once a .db is loaded.
 */
export default function DbAmountSearch({
  handle,
  facades,
  data,
  onApply,
  onCreatePattern,
}: Props) {
  const [open, setOpen] = useState(false);
  const [facadeSel, setFacadeSel] = useState<string>("all");
  const [amount, setAmount] = useState("");
  const [pattern, setPattern] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [openAmounts, setOpenAmounts] = useState<Set<number>>(new Set());
  // Patterns whose payout equals the entered amount (from "see patterns").
  const [patternMatches, setPatternMatches] = useState<
    { amount: number; matches: PatternMatch[] } | null
  >(null);

  // Increments on every new search / cancel; a running loop bails out as soon
  // as it sees its id is stale, so long scans can be interrupted.
  const runIdRef = useRef(0);

  const showFacade = facadeSel === "all";

  async function runSearch(amountStr: string, patternStr: string) {
    const amt = parseAmountInput(amountStr);
    const pat = parsePattern(patternStr);
    const active = patternIsActive(pat);

    if (amt.kind === "invalid") {
      setError("Enter a valid amount or range, e.g. 500 or 500-1000.");
      return;
    }
    if (amt.kind === "none" && !active) {
      setError("Enter an amount, a range (500-1000), or a reelStop filter.");
      return;
    }

    const myId = ++runIdRef.current;
    const stale = () => runIdRef.current !== myId;

    setSearching(true);
    setError(null);
    setView(null);
    setProgress(null);
    setOpenAmounts(new Set());
    setPatternMatches(null);

    try {
      const db = await import("@/lib/db");
      const targets = showFacade
        ? facades
        : facades.filter((f) => String(f.facadeId) === facadeSel);
      const facadeIdParam = showFacade ? null : Number(facadeSel);

      // Single amount → award cards (unchanged behavior).
      if (amt.kind === "single") {
        const awards: AwardResult[] = [];
        for (const facade of targets) {
          const found = await db.findAwardsByAmount(handle, facade.facadeId, amt.v);
          if (stale()) return;
          for (const award of found) {
            const reelStops = active
              ? await db.findMatchingReelStops(handle, award, pat)
              : await db.getReelStops(handle, award, 8);
            if (stale()) return;
            awards.push({ award, facadeKey: facade.facadeKey, reelStops });
          }
        }
        setView({ mode: "awards", awards, amount: amt.v });
        return;
      }

      // Range, no filter → just the amounts present in that range.
      if (amt.kind === "range" && !active) {
        const amounts = await db.listAmounts(
          handle,
          facadeIdParam,
          amt.lo,
          amt.hi
        );
        if (stale()) return;
        setView({ mode: "amountList", amounts, lo: amt.lo, hi: amt.hi });
        return;
      }

      // Filter present (range+filter, or filter-only) → for each candidate
      // amount, keep the awards whose reelStops match, scanning per amount.
      const lo = amt.kind === "range" ? amt.lo : null;
      const hi = amt.kind === "range" ? amt.hi : null;
      const amounts = await db.listAmounts(handle, facadeIdParam, lo, hi);
      if (stale()) return;
      setProgress({ done: 0, total: amounts.length });

      const groups: AmountGroup[] = [];
      for (let i = 0; i < amounts.length; i++) {
        const a = amounts[i];
        const matched: AwardResult[] = [];
        for (const facade of targets) {
          const found = await db.findAwardsByAmount(handle, facade.facadeId, a);
          if (stale()) return;
          for (const award of found) {
            const rs = await db.findMatchingReelStops(handle, award, pat);
            if (stale()) return;
            if (rs.length > 0) {
              matched.push({ award, facadeKey: facade.facadeKey, reelStops: rs });
            }
          }
        }
        if (matched.length > 0) groups.push({ amount: a, awards: matched });
        setProgress({ done: i + 1, total: amounts.length });
      }
      setView({ mode: "groups", groups, ranged: amt.kind === "range" });
    } catch (e) {
      if (!stale()) setError(e instanceof Error ? e.message : "Query failed.");
    } finally {
      if (!stale()) {
        setSearching(false);
        setProgress(null);
      }
    }
  }

  function cancel() {
    runIdRef.current++;
    setSearching(false);
    setProgress(null);
  }

  const amtParsed = parseAmountInput(amount);
  const canSeePatterns = amtParsed.kind === "single" && !!data;

  /** List single patterns whose payout equals the entered amount. */
  function seePatterns() {
    if (amtParsed.kind !== "single") {
      setError("Enter a single amount to see patterns.");
      return;
    }
    if (!data) {
      setError("Load the paytable XML first to see patterns.");
      return;
    }
    setError(null);
    const target = amtParsed.v;
    // A specific bet line → just that paytable; "all" → every bet level.
    const selKey = facades.find(
      (f) => String(f.facadeId) === facadeSel
    )?.facadeKey;
    const tables = showFacade
      ? data.paytables
      : data.paytables.filter((p) => p.facadeKey === selKey);

    const matches: PatternMatch[] = [];
    for (const pt of tables) {
      for (const e of pt.entries) {
        if (e.payout === target) {
          matches.push({
            facadeKey: pt.facadeKey,
            patternId: e.patternId,
            patternName:
              data.patterns.find((p) => p.id === e.patternId)?.name ??
              `#${e.patternId}`,
            ballQty: e.ballQty,
            payout: e.payout,
          });
        }
      }
    }
    matches.sort((a, b) => a.ballQty - b.ballQty);
    setPatternMatches({ amount: target, matches });
  }

  function toggleAmount(a: number) {
    setOpenAmounts((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
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
        <span className="muted small">amount · range · filter</span>
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
            <span className="db-label">Amount or range</span>
            <input
              className="select"
              type="text"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setPatternMatches(null);
              }}
              placeholder="e.g. 500 or 500-1000"
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch(amount, pattern);
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
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch(amount, pattern);
              }}
            />
          </label>

          <p className="muted small">
            Leave the amount blank and type a filter to find every amount that
            has it (slower — pair with a range to narrow the scan).
          </p>

          <div className="amount-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void runSearch(amount, pattern)}
              disabled={searching}
            >
              {searching ? "Searching…" : "Search DB"}
            </button>
            <button
              type="button"
              className="btn btn-alt"
              onClick={seePatterns}
              disabled={!canSeePatterns || searching}
              title={
                canSeePatterns
                  ? "Find single patterns that pay this amount"
                  : "Enter a single amount (and load the paytable XML)"
              }
            >
              see patterns
            </button>
            {searching && (
              <button type="button" className="btn btn-small" onClick={cancel}>
                Cancel
              </button>
            )}
          </div>

          {patternMatches &&
            (patternMatches.matches.length === 0 ? (
              <p className="muted small">
                No single pattern pays exactly{" "}
                {patternMatches.amount.toLocaleString()}
                {showFacade ? "." : " at this bet line."}
              </p>
            ) : (
              <div className="pattern-matches">
                <div className="pattern-matches-head">
                  {patternMatches.matches.length} pattern
                  {patternMatches.matches.length === 1 ? "" : "s"} pay{" "}
                  {patternMatches.amount.toLocaleString()}
                </div>
                {patternMatches.matches.map((m, i) => (
                  <div key={i} className="pattern-match">
                    <div className="pattern-match-info">
                      <span className="pattern-match-name">
                        {m.patternName}{" "}
                        <span className="pattern-id">#{m.patternId}</span>
                      </span>
                      <span className="pattern-match-meta">
                        {showFacade ? `${m.facadeKey} · ` : ""}
                        {m.ballQty} balls · {m.payout.toLocaleString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() =>
                        onCreatePattern(m.facadeKey, m.patternId, m.ballQty)
                      }
                      title="Select this pattern in section 4 (fills payout, ballCalls & result)"
                    >
                      create pattern
                    </button>
                  </div>
                ))}
              </div>
            ))}

          {progress && (
            <p className="muted small">
              Scanned {progress.done} / {progress.total} amounts…
            </p>
          )}

          {error && <p className="error">{error}</p>}

          {view?.mode === "awards" && (
            <AwardResults
              results={view.awards}
              pattern={pattern}
              showFacade={showFacade}
              onApply={onApply}
              emptyText={`No award with Amount = ${view.amount.toLocaleString()} found.`}
            />
          )}

          {view?.mode === "amountList" &&
            (view.amounts.length === 0 ? (
              <p className="muted small">
                No amounts between {view.lo.toLocaleString()} and{" "}
                {view.hi.toLocaleString()}.
              </p>
            ) : (
              <>
                <p className="muted small">
                  {view.amounts.length} amount
                  {view.amounts.length === 1 ? "" : "s"} in{" "}
                  {view.lo.toLocaleString()}–{view.hi.toLocaleString()} (click to
                  open):
                </p>
                <div className="amount-list">
                  {view.amounts.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="amount-chip"
                      onClick={() => {
                        setAmount(String(a));
                        void runSearch(String(a), pattern);
                      }}
                    >
                      {a.toLocaleString()}
                    </button>
                  ))}
                </div>
              </>
            ))}

          {view?.mode === "groups" &&
            (view.groups.length === 0 ? (
              <p className="muted small">
                No amounts {view.ranged ? "in that range " : ""}have a reelStop
                matching this filter.
              </p>
            ) : (
              <div className="win-sections">
                {view.groups.map((g) => {
                  const isOpen = openAmounts.has(g.amount);
                  return (
                    <section key={g.amount} className="win-section">
                      <button
                        type="button"
                        className="win-section-head"
                        aria-expanded={isOpen}
                        onClick={() => toggleAmount(g.amount)}
                      >
                        <span className="win-section-caret">
                          {isOpen ? "▾" : "▸"}
                        </span>
                        <span className="win-section-label">
                          Amount {g.amount.toLocaleString()}
                        </span>
                        <span className="award-badge">
                          {g.awards.length} award
                          {g.awards.length === 1 ? "" : "s"}
                        </span>
                      </button>
                      {isOpen && (
                        <AwardResults
                          results={g.awards}
                          pattern={pattern}
                          showFacade={showFacade}
                          onApply={onApply}
                          emptyText="No matching reelStops."
                        />
                      )}
                    </section>
                  );
                })}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
