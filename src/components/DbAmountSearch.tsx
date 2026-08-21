"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { DbHandle, Facade } from "@/lib/db";
import type { MatchingPattern, Pattern, Paytable59 } from "@/lib/types";
import { parsePattern, patternIsActive } from "@/lib/reelstop";
import { patternContains, cardBallCallBase } from "@/lib/patterns";
import { buildBallCalls, patternDaubNumbers } from "@/lib/gaffe";
import { evaluateInGame, type PatternWin } from "@/lib/evaluate";
import AwardResults, { type AwardResult } from "./AwardResults";

/**
 * True AllPatternsPaid payout for a set of chosen pattern thresholds at one bet
 * line, on the current card. Mirrors what the main tool computes for the built
 * gaffe, so a match/combo can be flagged when its real in-game total differs
 * from the naive suffix-sum the search matched on (extra patterns completed by
 * the combined daubs also win).
 */
function inGameFor(
  selections: { patternId: number; ballQty: number }[],
  entries: MatchingPattern[],
  patterns: Pattern[],
  patternById: Map<number, Pattern>,
  bingoCard: number[][]
): { total: number; extras: PatternWin[] } {
  const qByValue = new Map<number, number>();
  for (const s of selections) {
    const p = patternById.get(s.patternId);
    if (!p) continue;
    for (const n of patternDaubNumbers(p, bingoCard)) {
      qByValue.set(n, Math.min(qByValue.get(n) ?? Infinity, s.ballQty));
    }
  }
  const daubs = [...qByValue].map(([value, q]) => ({ value, q }));
  const calls = buildBallCalls(cardBallCallBase(bingoCard), daubs).calls;
  const entriesByPattern = new Map<number, MatchingPattern[]>();
  for (const e of entries) {
    const arr = entriesByPattern.get(e.patternId);
    if (arr) arr.push(e);
    else entriesByPattern.set(e.patternId, [e]);
  }
  const res = evaluateInGame(
    calls,
    bingoCard,
    patterns,
    entriesByPattern,
    new Set(selections.map((s) => s.patternId))
  );
  return { total: res.total, extras: res.extras };
}

/** Tooltip listing the incidental in-game wins for a match/combo. */
function extrasTitle(extras: PatternWin[]): string {
  return (
    "Also won in-game (AllPatternsPaid):\n" +
    extras
      .map(
        (e) =>
          `${e.patternName} #${e.patternId} · ${e.completionBall} balls · ${e.payout.toLocaleString()}`
      )
      .join("\n")
  );
}

export interface DbAmountSearchHandle {
  /** Open the panel, set the reelStop filter, and run the search. */
  runWithFilter: (filter: string) => void;
}

interface Props {
  handle: DbHandle;
  facades: Facade[];
  /** Parsed paytable XML — used to find which patterns pay a given amount. */
  data: Paytable59 | null;
  /** Current bingo card — used to compute each match's true in-game payout. */
  bingoCard: number[][];
  /** Push a chosen reelStop candidate into the main generated gaffe output. */
  onApply: (reelStops: number[]) => void;
  /** Prefill section 4 by selecting this pattern/ballQty at this bet line. */
  onCreatePattern: (
    facadeKey: string,
    patternId: number,
    ballQty: number
  ) => void;
  /** Prefill section 4 with a whole combination: several patterns/ballQtys at
   *  one bet line whose payouts sum to a searched amount. */
  onCreatePatterns: (
    facadeKey: string,
    selections: { patternId: number; ballQty: number }[]
  ) => void;
  /** Load a reelStop into the reelStrip viewer. */
  onSlot: (reelStops: number[]) => void;
  /** Whether a reelStrip .xml is loaded (enables the "slot" button). */
  reelStripLoaded: boolean;
}

/** A pattern threshold whose cumulative total equals the searched amount. */
interface PatternMatch {
  facadeKey: string;
  patternId: number;
  patternName: string;
  /** The ball call (threshold) that starts the cascade. */
  ballQty: number;
  /** This threshold row's own payout. */
  payout: number;
  /** Cumulative total = this row + all higher-ballQty (auto) rows (== amount). */
  total: number;
  /** How many higher-ballQty rows are auto-included on top of this one. */
  autoCount: number;
  /** True AllPatternsPaid payout on the current card (>= total when extras win). */
  inGameTotal: number;
  /** Extra patterns completed by this selection's daubs (also paid in-game). */
  extras: PatternWin[];
}

/** One pattern's chosen threshold inside a combination. */
interface ComboMember {
  patternId: number;
  patternName: string;
  /** The ball call (threshold) that starts this pattern's cascade. */
  ballQty: number;
  /** This threshold row's own payout. */
  payout: number;
  /** Cumulative total this pattern contributes (row + higher-ballQty auto rows). */
  total: number;
  /** How many higher-ballQty rows are auto-included on top of this one. */
  autoCount: number;
}

/** A set of distinct patterns (same bet line) whose totals sum to the amount. */
interface PatternCombo {
  facadeKey: string;
  /** Length 2..3, sorted by patternId. */
  members: ComboMember[];
  /** Sum of member totals (== the searched amount). */
  total: number;
  /** True when a member is geometrically contained in another (pattern + sub). */
  hasSubPattern: boolean;
  /** True AllPatternsPaid payout on the current card (>= total when extras win). */
  inGameTotal: number;
  /** Extra patterns completed by the combined daubs (also paid in-game). */
  extras: PatternWin[];
}

/** Max distinct patterns per combination, and a cap on results collected. */
const MAX_COMBO_PATTERNS = 3;
const MAX_COMBOS = 200;

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

/** Which kind of pattern result is shown in the tabs. */
type PatternTab = "single" | "double" | "triple" | "doubleSub" | "tripleSub";

/** A combo belongs to a tab by its member count + sub-pattern relationship. */
function comboTab(c: PatternCombo): Exclude<PatternTab, "single"> {
  if (c.members.length >= 3) return c.hasSubPattern ? "tripleSub" : "triple";
  return c.hasSubPattern ? "doubleSub" : "double";
}

/** First combo tab (in display order) that has any matching combo. */
function firstNonEmptyComboTab(
  combos: PatternCombo[]
): Exclude<PatternTab, "single"> | null {
  const order = ["double", "triple", "doubleSub", "tripleSub"] as const;
  for (const t of order) {
    if (combos.some((c) => comboTab(c) === t)) return t;
  }
  return null;
}

/**
 * Free-form DB lookup, independent of the tool's computed payout:
 *  • single amount (e.g. 500) — award cards, with optional positional filter;
 *  • range (e.g. 500-1000) — the amounts that exist in that range;
 *  • range + filter — only the in-range amounts that have a matching reelStop,
 *    each with its matches;
 *  • filter only (no amount) — every amount in the DB with a matching reelStop.
 * Collapsible; only shown once a .db is loaded.
 */
const DbAmountSearch = forwardRef<DbAmountSearchHandle, Props>(
  function DbAmountSearch(
    {
      handle,
      facades,
      data,
      bingoCard,
      onApply,
      onCreatePattern,
      onCreatePatterns,
      onSlot,
      reelStripLoaded,
    },
    ref
  ) {
  const panelRef = useRef<HTMLDivElement>(null);
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
  // Patterns whose total lands on the entered amount, or inside the entered
  // range (from "see patterns"). lo === hi means a single amount was entered.
  const [patternMatches, setPatternMatches] = useState<
    { lo: number; hi: number; matches: PatternMatch[] } | null
  >(null);
  // Pattern combinations (2..3 distinct patterns at one bet line) whose totals
  // land in the entered amount/range. Computed for both single amounts and ranges.
  const [combos, setCombos] = useState<
    { lo: number; hi: number; combos: PatternCombo[]; capped: boolean } | null
  >(null);
  // Which result kind the tabs are showing.
  const [patternTab, setPatternTab] = useState<PatternTab>("single");

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
    setCombos(null);

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
  const canSeePatterns =
    (amtParsed.kind === "single" || amtParsed.kind === "range") && !!data;

  /** List patterns whose total equals the entered amount, or falls inside the
   *  entered range, at the selected bet line(s). Gated to bet lines where the
   *  loaded .db actually has that amount (see below). */
  async function seePatterns() {
    // Resolve the entered amount/range into an inclusive [lo, hi] window.
    let lo: number;
    let hi: number;
    if (amtParsed.kind === "single") {
      lo = hi = amtParsed.v;
    } else if (amtParsed.kind === "range") {
      lo = amtParsed.lo;
      hi = amtParsed.hi;
    } else {
      setError("Enter an amount or a range (e.g. 500 or 500-1000) to see patterns.");
      return;
    }
    if (!data) {
      setError("Load the paytable XML first to see patterns.");
      return;
    }
    setError(null);
    // A specific bet line → just that paytable; "all" → every bet level.
    const selKey = facades.find(
      (f) => String(f.facadeId) === facadeSel
    )?.facadeKey;
    let tables = showFacade
      ? data.paytables
      : data.paytables.filter((p) => p.facadeKey === selKey);

    // Gate by the .db: only keep bet lines that actually have an Award for this
    // amount/range, so pattern results reflect real outcomes (not just what the
    // paytable could theoretically pay). For "All bet lines" this narrows to the
    // bet lines that contain the amount.
    try {
      const db = await import("@/lib/db");
      const presentIds =
        amtParsed.kind === "range"
          ? await db.findFacadesWithAmountInRange(handle, lo, hi)
          : await db.findFacadesWithAmount(handle, lo);
      const presentKeys = new Set(
        facades
          .filter((f) => presentIds.includes(f.facadeId))
          .map((f) => f.facadeKey)
      );
      tables = tables.filter((t) => presentKeys.has(t.facadeKey));
    } catch (e) {
      setError(e instanceof Error ? e.message : "DB lookup failed.");
      return;
    }

    if (tables.length === 0) {
      // Amount isn't present in the .db for the selected bet line(s).
      setPatternMatches({ lo, hi, matches: [] });
      setCombos(null);
      setPatternTab("single");
      return;
    }

    // Pattern lookup shared by the single-match and combination in-game scoring.
    const patternByIdAll = new Map<number, Pattern>(
      data.patterns.map((p) => [p.id, p])
    );

    const matches: PatternMatch[] = [];
    for (const pt of tables) {
      // Group this bet level's rows by pattern.
      const byPattern = new Map<number, MatchingPattern[]>();
      for (const e of pt.entries) {
        const arr = byPattern.get(e.patternId);
        if (arr) arr.push(e);
        else byPattern.set(e.patternId, [e]);
      }
      for (const [pid, arr] of byPattern) {
        // Selecting ballQty T selects every row with ballQty >= T, so the total
        // for threshold at index i is the suffix sum from i (matches the tool's
        // effectiveRows / totalPayout). Keep the thresholds whose total lands in
        // [lo, hi].
        arr.sort((a, b) => a.ballQty - b.ballQty);
        let suffix = 0;
        const suffixSums = new Array<number>(arr.length);
        for (let i = arr.length - 1; i >= 0; i--) {
          suffix += arr[i].payout;
          suffixSums[i] = suffix;
        }
        for (let i = 0; i < arr.length; i++) {
          if (suffixSums[i] >= lo && suffixSums[i] <= hi) {
            const ig = inGameFor(
              [{ patternId: pid, ballQty: arr[i].ballQty }],
              pt.entries,
              data.patterns,
              patternByIdAll,
              bingoCard
            );
            matches.push({
              facadeKey: pt.facadeKey,
              patternId: pid,
              patternName:
                data.patterns.find((p) => p.id === pid)?.name ?? `#${pid}`,
              ballQty: arr[i].ballQty,
              payout: arr[i].payout,
              total: suffixSums[i],
              autoCount: arr.length - 1 - i,
              inGameTotal: ig.total,
              extras: ig.extras,
            });
          }
        }
      }
    }
    // Total ascending (then ball call) so a range reads low → high.
    matches.sort((a, b) => a.total - b.total || a.ballQty - b.ballQty);
    setPatternMatches({ lo, hi, matches });

    // Combinations of 2..3 distinct patterns at ONE bet line whose totals land in
    // [lo, hi] (a single amount is just lo === hi). Shown alongside the single-
    // pattern matches and split by size / sub-pattern relationship in the tabs.
    const patternById = patternByIdAll;
    const found: PatternCombo[] = [];
    const seen = new Set<string>();
    let capped = false;

    outer: for (const pt of tables) {
      // Per pattern, the candidate thresholds whose total is still <= hi
      // (a pattern contributes its suffix-sum total, same as the single search).
      const byPattern = new Map<number, MatchingPattern[]>();
      for (const e of pt.entries) {
        const arr = byPattern.get(e.patternId);
        if (arr) arr.push(e);
        else byPattern.set(e.patternId, [e]);
      }
      const patternCands: ComboMember[][] = [];
      for (const [pid, arr] of byPattern) {
        arr.sort((a, b) => a.ballQty - b.ballQty);
        let suffix = 0;
        const suffixSums = new Array<number>(arr.length);
        for (let i = arr.length - 1; i >= 0; i--) {
          suffix += arr[i].payout;
          suffixSums[i] = suffix;
        }
        const name = data.patterns.find((p) => p.id === pid)?.name ?? `#${pid}`;
        const cands: ComboMember[] = [];
        for (let i = 0; i < arr.length; i++) {
          if (suffixSums[i] <= hi) {
            cands.push({
              patternId: pid,
              patternName: name,
              ballQty: arr[i].ballQty,
              payout: arr[i].payout,
              total: suffixSums[i],
              autoCount: arr.length - 1 - i,
            });
          }
        }
        if (cands.length > 0) patternCands.push(cands);
      }

      // DFS: pick at most one candidate per pattern (patterns kept in order so a
      // set is never revisited as a permutation), up to MAX_COMBO_PATTERNS.
      // Record whenever the running total lands in [lo, hi] with >= 2 members;
      // keep exploring (a valid pair can still extend into a valid triple). Prune
      // once a total would exceed hi. Returns false only to abort at MAX_COMBOS.
      const chosen: ComboMember[] = [];
      const record = (sum: number): boolean => {
        const members = [...chosen].sort((a, b) => a.patternId - b.patternId);
        const key =
          pt.facadeKey +
          "|" +
          members.map((m) => `${m.patternId}:${m.ballQty}`).join("|");
        if (seen.has(key)) return true;
        seen.add(key);
        // A containment relationship among any member pair marks this as a
        // "pattern + sub-pattern" combination.
        let hasSubPattern = false;
        for (let a = 0; a < members.length && !hasSubPattern; a++) {
          for (let b = 0; b < members.length; b++) {
            if (a === b) continue;
            const pa = patternById.get(members[a].patternId);
            const pb = patternById.get(members[b].patternId);
            if (pa && pb && patternContains(pa, pb)) {
              hasSubPattern = true;
              break;
            }
          }
        }
        const ig = inGameFor(
          members.map((m) => ({ patternId: m.patternId, ballQty: m.ballQty })),
          pt.entries,
          data.patterns,
          patternByIdAll,
          bingoCard
        );
        found.push({
          facadeKey: pt.facadeKey,
          members,
          total: sum,
          hasSubPattern,
          inGameTotal: ig.total,
          extras: ig.extras,
        });
        if (found.length >= MAX_COMBOS) {
          capped = true;
          return false;
        }
        return true;
      };
      const dfs = (start: number, sum: number): boolean => {
        if (chosen.length >= 2 && sum >= lo && sum <= hi) {
          if (!record(sum)) return false;
        }
        if (chosen.length >= MAX_COMBO_PATTERNS) return true;
        for (let pi = start; pi < patternCands.length; pi++) {
          for (const c of patternCands[pi]) {
            if (sum + c.total > hi) continue;
            chosen.push(c);
            const ok = dfs(pi + 1, sum + c.total);
            chosen.pop();
            if (!ok) return false;
          }
        }
        return true;
      };
      if (!dfs(0, 0)) break outer;
    }

    // Total ascending, then fewer members, then leading pattern name.
    found.sort(
      (a, b) =>
        a.total - b.total ||
        a.members.length - b.members.length ||
        a.members[0].patternName.localeCompare(b.members[0].patternName)
    );
    setCombos({ lo, hi, combos: found, capped });
    // Default the tab to the first non-empty kind (single first).
    setPatternTab(
      matches.length > 0
        ? "single"
        : firstNonEmptyComboTab(found) ?? "single"
    );
  }

  function toggleAmount(a: number) {
    setOpenAmounts((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  }

  // Driven by the reelStrip viewer's SEARCH button: fill the filter and run.
  useImperativeHandle(ref, () => ({
    runWithFilter(filter: string) {
      setOpen(true);
      setPattern(filter);
      void runSearch(amount, filter);
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      );
    },
  }));

  return (
    <div className="panel" ref={panelRef}>
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
                setCombos(null);
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
              onClick={() => void seePatterns()}
              disabled={!canSeePatterns || searching}
              title={
                canSeePatterns
                  ? "Find patterns whose total (incl. auto rows) equals this amount, or falls in this range"
                  : "Enter an amount or range (and load the paytable XML)"
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
            (() => {
              const { lo, hi } = patternMatches;
              const ranged = lo !== hi;
              const amtLabel = ranged
                ? `${lo.toLocaleString()}–${hi.toLocaleString()}`
                : lo.toLocaleString();
              const singles = patternMatches.matches;
              const comboList = combos?.combos ?? [];
              const byTab: Record<PatternTab, PatternCombo[]> = {
                single: [],
                double: [],
                triple: [],
                doubleSub: [],
                tripleSub: [],
              };
              for (const c of comboList) byTab[comboTab(c)].push(c);
              const counts: Record<PatternTab, number> = {
                single: singles.length,
                double: byTab.double.length,
                triple: byTab.triple.length,
                doubleSub: byTab.doubleSub.length,
                tripleSub: byTab.tripleSub.length,
              };
              const total =
                counts.single +
                counts.double +
                counts.triple +
                counts.doubleSub +
                counts.tripleSub;

              if (total === 0) {
                return (
                  <p className="muted small">
                    No pattern {ranged ? "totals fall in" : "total is exactly"}{" "}
                    {amtLabel}
                    {showFacade ? "." : " at this bet line."}
                  </p>
                );
              }

              const TABS: { key: PatternTab; label: string }[] = [
                { key: "single", label: "Single" },
                { key: "double", label: "Double" },
                { key: "triple", label: "Triple" },
                { key: "doubleSub", label: "Double + sub" },
                { key: "tripleSub", label: "Triple + sub" },
              ];
              const active =
                counts[patternTab] > 0
                  ? patternTab
                  : TABS.find((t) => counts[t.key] > 0)?.key ?? "single";

              return (
                <div className="pattern-results">
                  <div className="pattern-tabs" role="tablist">
                    {TABS.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={active === t.key}
                        className={
                          "pattern-tab" + (active === t.key ? " active" : "")
                        }
                        disabled={counts[t.key] === 0}
                        onClick={() => setPatternTab(t.key)}
                      >
                        {t.label}{" "}
                        <span className="pattern-tab-count">
                          {counts[t.key]}
                        </span>
                      </button>
                    ))}
                  </div>

                  {active === "single" ? (
                    <div className="pattern-matches">
                      <div className="pattern-matches-head">
                        {counts.single} pattern
                        {counts.single === 1 ? "" : "s"} total{" "}
                        {ranged ? "in " : ""}
                        {amtLabel}
                      </div>
                      {singles.map((m, i) => (
                        <div key={i} className="pattern-match">
                          <div className="pattern-match-info">
                            <span className="pattern-match-name">
                              {m.patternName}{" "}
                              <span className="pattern-id">#{m.patternId}</span>
                              <span className="pattern-match-amount">
                                {m.total.toLocaleString()}
                              </span>
                            </span>
                            <span className="pattern-match-meta">
                              {showFacade ? `${m.facadeKey} · ` : ""}
                              ball call {m.ballQty}
                              {m.autoCount > 0
                                ? ` · ${m.payout.toLocaleString()} + ${m.autoCount} auto`
                                : ""}
                            </span>
                            {m.extras.length > 0 && (
                              <span className="ingame-flag" title={extrasTitle(m.extras)}>
                                in-game {m.inGameTotal.toLocaleString()} · +
                                {m.extras.length} also won
                              </span>
                            )}
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
                  ) : (
                    <div className="pattern-matches">
                      <div className="pattern-matches-head">
                        {counts[active]} combination
                        {counts[active] === 1 ? "" : "s"}{" "}
                        {ranged ? "in " : "summing to "}
                        {amtLabel}
                        {combos?.capped ? ` · first ${MAX_COMBOS}` : ""}
                      </div>
                      {byTab[active].map((c, i) => (
                        <div key={i} className="pattern-combo">
                          <div className="pattern-combo-head">
                            <span className="pattern-match-meta">
                              {showFacade ? `${c.facadeKey} · ` : ""}
                              {c.members.length} patterns
                              {c.hasSubPattern ? (
                                <span className="badge badge-sub">
                                  incl. sub-pattern
                                </span>
                              ) : null}
                              <span className="pattern-match-amount">
                                {c.total.toLocaleString()}
                              </span>
                              {c.extras.length > 0 && (
                                <span
                                  className="ingame-flag"
                                  title={extrasTitle(c.extras)}
                                >
                                  in-game {c.inGameTotal.toLocaleString()} · +
                                  {c.extras.length} also won
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              className="btn btn-small"
                              onClick={() =>
                                onCreatePatterns(
                                  c.facadeKey,
                                  c.members.map((m) => ({
                                    patternId: m.patternId,
                                    ballQty: m.ballQty,
                                  }))
                                )
                              }
                              title="Select all these patterns in section 4 (fills payout, ballCalls & result)"
                            >
                              create combination
                            </button>
                          </div>
                          <div className="pattern-combo-members">
                            {c.members.map((m, j) => (
                              <div key={j} className="pattern-match">
                                <div className="pattern-match-info">
                                  <span className="pattern-match-name">
                                    {m.patternName}{" "}
                                    <span className="pattern-id">
                                      #{m.patternId}
                                    </span>
                                    <span className="pattern-match-amount">
                                      {m.total.toLocaleString()}
                                    </span>
                                  </span>
                                  <span className="pattern-match-meta">
                                    ball call {m.ballQty}
                                    {m.autoCount > 0
                                      ? ` · ${m.payout.toLocaleString()} + ${m.autoCount} auto`
                                      : ""}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

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
              onSlot={onSlot}
              reelStripLoaded={reelStripLoaded}
              hideEmpty
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
                          onSlot={onSlot}
                          reelStripLoaded={reelStripLoaded}
                          hideEmpty
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
);

export default DbAmountSearch;
