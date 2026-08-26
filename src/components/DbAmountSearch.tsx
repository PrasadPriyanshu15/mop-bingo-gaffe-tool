"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { DbHandle, Facade, RngLenFilter } from "@/lib/db";
import type { MatchingPattern, Pattern, Paytable, Paytable59 } from "@/lib/types";
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
  /** The bet line chosen in section 2 (Select bet level) — the XML paytable that
   *  "map DB amount → Patterns" matches against. */
  betKey: string | null;
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

/** One DB amount with the section-2 patterns/combos whose total equals it. */
interface MappedGroup {
  amount: number;
  singles: PatternMatch[];
  combos: PatternCombo[];
  /** True when the combo search for this amount hit the MAX_COMBOS cap. */
  capped: boolean;
}

type View =
  | { mode: "awards"; awards: AwardResult[]; amount: number }
  | { mode: "amountList"; amounts: number[]; lo: number; hi: number }
  | { mode: "groups"; groups: AmountGroup[]; ranged: boolean }
  | {
      mode: "minmax";
      min: number;
      max: number;
      facadeKey: string;
      filtered: boolean;
    }
  | {
      mode: "mapped";
      groups: MappedGroup[];
      lo: number;
      hi: number;
      filtered: boolean;
      capped: boolean;
    };

/** Which kind of pattern result is shown in the tabs. */
type PatternTab = "single" | "double" | "triple" | "doubleSub" | "tripleSub";

/** A combo belongs to a tab by its member count + sub-pattern relationship. */
function comboTab(c: PatternCombo): Exclude<PatternTab, "single"> {
  if (c.members.length >= 3) return c.hasSubPattern ? "tripleSub" : "triple";
  return c.hasSubPattern ? "doubleSub" : "double";
}

/**
 * Given the bet-line paytable(s) to consider, find the single-pattern thresholds
 * and the 2..3 pattern combinations whose totals land in [lo, hi]. Pure math,
 * shared by "see patterns" and "map DB amount → Patterns". Combinations are
 * skipped for HighestPriorityPaid games (only one pattern ever pays), and the
 * combo search is capped at MAX_COMBOS.
 */
function computePatternMatches(
  tables: Paytable[],
  data: Paytable59,
  bingoCard: number[][],
  lo: number,
  hi: number
): { matches: PatternMatch[]; combos: PatternCombo[]; capped: boolean } {
  // Pattern lookup shared by the single-match and combination in-game scoring.
  const patternByIdAll = new Map<number, Pattern>(
    data.patterns.map((p) => [p.id, p])
  );

  // HighestPriorityPaid games pay only the single highest-priority satisfied
  // pattern — never a combination, and no "also won" union completion. Skip the
  // combination search (which is also what would otherwise churn through the
  // hundreds of unique patterns these games define and stall the panel), and
  // don't compute an inflated in-game total per match.
  const highestPriority = data.evaluationType === "HighestPriorityPaid";

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
          const ig = highestPriority
            ? { total: suffixSums[i], extras: [] as PatternWin[] }
            : inGameFor(
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

  // Combinations of 2..3 distinct patterns at ONE bet line whose totals land in
  // [lo, hi] (a single amount is just lo === hi). Shown alongside the single-
  // pattern matches and split by size / sub-pattern relationship in the tabs.
  const patternById = patternByIdAll;
  const found: PatternCombo[] = [];
  const seen = new Set<string>();
  let capped = false;

  if (!highestPriority)
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

  return { matches, combos: found, capped };
}

/** One single-pattern match row. `withFacade` prefixes the bet-line key. */
function renderSingle(
  m: PatternMatch,
  key: number | string,
  withFacade: boolean,
  onCreatePattern: (facadeKey: string, patternId: number, ballQty: number) => void
) {
  return (
    <div key={key} className="pattern-match">
      <div className="pattern-match-info">
        <span className="pattern-match-name">
          {m.patternName}{" "}
          <span className="pattern-id">#{m.patternId}</span>
          <span className="pattern-match-amount">
            {m.total.toLocaleString()}
          </span>
        </span>
        <span className="pattern-match-meta">
          {withFacade ? `${m.facadeKey} · ` : ""}
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
        onClick={() => onCreatePattern(m.facadeKey, m.patternId, m.ballQty)}
        title="Select this pattern in section 4 (fills payout, ballCalls & result)"
      >
        create pattern
      </button>
    </div>
  );
}

/** One combination card. */
function renderCombo(
  c: PatternCombo,
  key: number | string,
  withFacade: boolean,
  onCreatePatterns: (
    facadeKey: string,
    selections: { patternId: number; ballQty: number }[]
  ) => void
) {
  return (
    <div key={key} className="pattern-combo">
      <div className="pattern-combo-head">
        <span className="pattern-match-meta">
          {withFacade ? `${c.facadeKey} · ` : ""}
          {c.members.length} patterns
          {c.hasSubPattern ? (
            <span className="badge badge-sub">incl. sub-pattern</span>
          ) : null}
          <span className="pattern-match-amount">
            {c.total.toLocaleString()}
          </span>
          {c.extras.length > 0 && (
            <span className="ingame-flag" title={extrasTitle(c.extras)}>
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
                <span className="pattern-id">#{m.patternId}</span>
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
  );
}

/**
 * Tabbed single/combination pattern results (Single · Double · Triple · Double +
 * sub · Triple + sub). Owns its own active-tab state, so each instance (the
 * "see patterns" block and every mapped amount) tabs independently. `ranged`
 * tweaks the header wording; `amtLabel` is the amount/range being described.
 */
function PatternResults({
  singles,
  combos,
  capped,
  ranged,
  amtLabel,
  showFacade,
  onCreatePattern,
  onCreatePatterns,
}: {
  singles: PatternMatch[];
  combos: PatternCombo[];
  capped: boolean;
  ranged: boolean;
  amtLabel: string;
  showFacade: boolean;
  onCreatePattern: (facadeKey: string, patternId: number, ballQty: number) => void;
  onCreatePatterns: (
    facadeKey: string,
    selections: { patternId: number; ballQty: number }[]
  ) => void;
}) {
  const [tab, setTab] = useState<PatternTab>("single");

  const byTab: Record<PatternTab, PatternCombo[]> = {
    single: [],
    double: [],
    triple: [],
    doubleSub: [],
    tripleSub: [],
  };
  for (const c of combos) byTab[comboTab(c)].push(c);
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
        No pattern {ranged ? "totals fall in" : "total is exactly"} {amtLabel}
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
    counts[tab] > 0 ? tab : TABS.find((t) => counts[t.key] > 0)?.key ?? "single";

  return (
    <div className="pattern-results">
      <div className="pattern-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={"pattern-tab" + (active === t.key ? " active" : "")}
            disabled={counts[t.key] === 0}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="pattern-tab-count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {active === "single" ? (
        <div className="pattern-matches">
          <div className="pattern-matches-head">
            {counts.single} pattern{counts.single === 1 ? "" : "s"} total{" "}
            {ranged ? "in " : ""}
            {amtLabel}
          </div>
          {singles.map((m, i) =>
            renderSingle(m, i, showFacade, onCreatePattern)
          )}
        </div>
      ) : (
        <div className="pattern-matches">
          <div className="pattern-matches-head">
            {counts[active]} combination{counts[active] === 1 ? "" : "s"}{" "}
            {ranged ? "in " : "summing to "}
            {amtLabel}
            {capped ? ` · first ${MAX_COMBOS}` : ""}
          </div>
          {byTab[active].map((c, i) =>
            renderCombo(c, i, showFacade, onCreatePatterns)
          )}
        </div>
      )}
    </div>
  );
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
      betKey,
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
  // HPP (Type 2) only: bound the reconstructed RNG length. Blank = no bound;
  // a single "300" keeps candidates with ≤ 300 RNG values, a range "100-300"
  // keeps 100..300. Applies to both "Search DB" and "map DB amount → Patterns".
  const [maxRng, setMaxRng] = useState("");
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

  // Increments on every new search / cancel; a running loop bails out as soon
  // as it sees its id is stale, so long scans can be interrupted.
  const runIdRef = useRef(0);

  const showFacade = facadeSel === "all";
  // The RNG-count cap only applies to HPP (Type 2) databases.
  const isType2 = handle.type === "type2";

  /** Resolve the "RNG count" field into a length bound. Blank / non-Type-2 → no
   *  bound. A single "300" → ≤ 300; a range "100-300" → 100..300 (inclusive).
   *  Values must be positive integers, otherwise `error` is set so callers bail. */
  function parseMaxRng(): { filter: RngLenFilter | null; error: boolean } {
    if (!isType2) return { filter: null, error: false };
    const t = maxRng.trim();
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

  async function runSearch(amountStr: string, patternStr: string) {
    const amt = parseAmountInput(amountStr);
    const pat = parsePattern(patternStr);
    const active = patternIsActive(pat);
    const { filter: rngLen, error: maxRngErr } = parseMaxRng();
    // A bound set alongside a positional filter (or on its own) also gates results.
    const filterActive = active || rngLen != null;

    if (maxRngErr) {
      setError("RNG count must be a positive number or range, e.g. 300 or 100-300.");
      return;
    }
    if (amt.kind === "invalid") {
      setError("Enter a valid amount or range, e.g. 500 or 500-1000.");
      return;
    }
    if (amt.kind === "none" && !filterActive) {
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
            const reelStops = filterActive
              ? await db.findMatchingReelStops(handle, award, pat, 2000, rngLen)
              : await db.getReelStops(handle, award, 8);
            if (stale()) return;
            awards.push({ award, facadeKey: facade.facadeKey, reelStops });
          }
        }
        setView({ mode: "awards", awards, amount: amt.v });
        return;
      }

      // Range, no filter → just the amounts present in that range.
      if (amt.kind === "range" && !filterActive) {
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
            const rs = await db.findMatchingReelStops(
              handle,
              award,
              pat,
              2000,
              rngLen
            );
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

  /** Find the smallest and largest award amount for the selected bet line,
   *  honoring the reelStop filter when one is entered. Requires a specific bet
   *  line (not "All bet lines"). */
  async function runMinMax() {
    if (showFacade) {
      setError("Select a specific bet line to find its min–max amount.");
      return;
    }
    const facade = facades.find((f) => String(f.facadeId) === facadeSel);
    if (!facade) return;

    const pat = parsePattern(pattern);
    const active = patternIsActive(pat);
    const { filter: rngLen, error: maxRngErr } = parseMaxRng();
    if (maxRngErr) {
      setError("RNG count must be a positive number or range, e.g. 300 or 100-300.");
      return;
    }
    const constrained = active || rngLen != null;

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
      const res = await db.findMinMaxAmount(
        handle,
        facade.facadeId,
        active ? pat : null,
        rngLen
      );
      if (stale()) return;
      if (!res) {
        setError(
          constrained
            ? "No award matches this filter for this bet line."
            : "No amounts found for this bet line."
        );
        return;
      }
      setView({
        mode: "minmax",
        min: res.min,
        max: res.max,
        facadeKey: facade.facadeKey,
        filtered: constrained,
      });
    } catch (e) {
      if (!stale()) setError(e instanceof Error ? e.message : "Query failed.");
    } finally {
      if (!stale()) setSearching(false);
    }
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
    if (!showFacade && tables.length === 0) {
      // The selected DB facade's key doesn't match any XML bet-line key (Type 2
      // convention mismatch, e.g. "D10_B1" vs "75_B1_FG3"), so it can't be scoped
      // to a single bet line — consider all XML bet lines instead of none.
      tables = data.paytables;
    }

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
      const gated = tables.filter((t) => presentKeys.has(t.facadeKey));
      if (gated.length > 0) {
        // The DB's facade keys line up with the XML bet lines (typical Type 1):
        // keep only the bet lines the DB actually has this amount for.
        tables = gated;
      } else if (presentIds.length === 0) {
        // The amount/range doesn't exist anywhere in the DB.
        tables = [];
      }
      // else: the amount exists in the DB but under a different facade-key
      // convention than the XML (common for Type 2 DBs, e.g. "D10_B1" vs
      // "75_B1_FG3"), so the keys can't be matched up. Fall back to the selected
      // XML bet line(s) ungated rather than showing nothing.
    } catch (e) {
      setError(e instanceof Error ? e.message : "DB lookup failed.");
      return;
    }

    if (tables.length === 0) {
      // Amount isn't present in the .db for the selected bet line(s).
      setPatternMatches({ lo, hi, matches: [] });
      setCombos(null);
      return;
    }

    const { matches, combos: found, capped } = computePatternMatches(
      tables,
      data,
      bingoCard,
      lo,
      hi
    );
    setPatternMatches({ lo, hi, matches });
    setCombos({ lo, hi, combos: found, capped });
  }

  // The section-2 XML paytable that "map DB amount → Patterns" matches against.
  const mapTable = data?.paytables.find((p) => p.facadeKey === betKey) ?? null;
  const canMap = !showFacade && !!mapTable && !searching;

  /** For the selected DB bet line, take its Min–Max amount range (honoring the
   *  reelStop filter when present) and show every DB amount in that range for
   *  which the section-2 XML bet level has a single pattern or combination whose
   *  total equals it. Amounts with no matching pattern are omitted. */
  async function mapAmountsToPatterns() {
    if (showFacade) {
      setError("Select a specific bet line to map amounts to patterns.");
      return;
    }
    if (!data || !mapTable) {
      setError("Select a bet level in section 2 (Select bet level) first.");
      return;
    }
    const facade = facades.find((f) => String(f.facadeId) === facadeSel);
    if (!facade) return;

    const pat = parsePattern(pattern);
    const active = patternIsActive(pat);
    const { filter: rngLen, error: maxRngErr } = parseMaxRng();
    if (maxRngErr) {
      setError("RNG count must be a positive number or range, e.g. 300 or 100-300.");
      return;
    }
    const constrained = active || rngLen != null;

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
      const mm = await db.findMinMaxAmount(
        handle,
        facade.facadeId,
        active ? pat : null,
        rngLen
      );
      if (stale()) return;
      if (!mm) {
        setError(
          constrained
            ? "No award matches this filter for this bet line."
            : "No amounts found for this bet line."
        );
        return;
      }
      const amounts = await db.listAmountsMatchingPattern(
        handle,
        facade.facadeId,
        mm.min,
        mm.max,
        active ? pat : null,
        rngLen
      );
      if (stale()) return;
      setProgress({ done: 0, total: amounts.length });

      // Match patterns per exact amount: with lo === hi === a the combo DFS
      // records only combinations summing exactly to `a`, and the MAX_COMBOS cap
      // applies per amount (never exhausted by irrelevant totals). Keep only
      // amounts that have at least one single or combination.
      const groups: MappedGroup[] = [];
      let capped = false;
      for (let i = 0; i < amounts.length; i++) {
        const a = amounts[i];
        const res = computePatternMatches([mapTable], data, bingoCard, a, a);
        if (res.matches.length > 0 || res.combos.length > 0) {
          groups.push({
            amount: a,
            singles: res.matches,
            combos: res.combos,
            capped: res.capped,
          });
        }
        if (res.capped) capped = true;
        // Yield periodically so the scan stays cancelable and the UI can paint
        // (computePatternMatches is synchronous CPU work).
        if (i % 10 === 9) {
          setProgress({ done: i + 1, total: amounts.length });
          await new Promise((r) => setTimeout(r, 0));
          if (stale()) return;
        }
      }

      setView({
        mode: "mapped",
        groups,
        lo: mm.min,
        hi: mm.max,
        filtered: constrained,
        capped,
      });
    } catch (e) {
      if (!stale()) setError(e instanceof Error ? e.message : "Query failed.");
    } finally {
      if (!stale()) {
        setSearching(false);
        setProgress(null);
      }
    }
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
            <div className="amount-input-row">
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
              <button
                type="button"
                className="btn btn-alt"
                onClick={() => void runMinMax()}
                disabled={searching || showFacade}
                title={
                  showFacade
                    ? "Select a specific bet line first"
                    : "Show the smallest and largest award amount for the selected bet line (honors the reelStop filter)"
                }
              >
                Min–Max
              </button>
            </div>
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

          <div className="amount-actions">
            <button
              type="button"
              className="btn btn-alt"
              onClick={() => void mapAmountsToPatterns()}
              disabled={!canMap}
              title={
                showFacade
                  ? "Select a specific bet line first"
                  : !mapTable
                    ? "Choose a bet level in section 2 (Select bet level) first"
                    : "For this bet line's min–max amount range, show every DB amount the section-2 bet level can pay (single or combination)"
              }
            >
              map DB amount → Patterns
            </button>
          </div>

          {isType2 && (
            <label className="db-field">
              <span className="db-label">
                RNG count (HPP only, single or range, blank = no bound)
              </span>
              <input
                className="select"
                type="text"
                value={maxRng}
                onChange={(e) => setMaxRng(e.target.value)}
                placeholder="e.g. 300 or 100-300"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch(amount, pattern);
                }}
              />
              <span className="muted small">
                {/* Keep only results whose RNG value count fits — “300” = up to 300,
                “100-300” = between 100 and 300. Applies to Search DB and “map DB
                amount → Patterns”. */}
              </span>
            </label>
          )}

          {patternMatches &&
            (() => {
              const { lo, hi } = patternMatches;
              const ranged = lo !== hi;
              const amtLabel = ranged
                ? `${lo.toLocaleString()}–${hi.toLocaleString()}`
                : lo.toLocaleString();
              return (
                <PatternResults
                  singles={patternMatches.matches}
                  combos={combos?.combos ?? []}
                  capped={!!combos?.capped}
                  ranged={ranged}
                  amtLabel={amtLabel}
                  showFacade={showFacade}
                  onCreatePattern={onCreatePattern}
                  onCreatePatterns={onCreatePatterns}
                />
              );
            })()}

          {progress && (
            <p className="muted small">
              Scanned {progress.done} / {progress.total} amounts…
            </p>
          )}

          {error && <p className="error">{error}</p>}

          {view?.mode === "mapped" &&
            (view.groups.length === 0 ? (
              <p className="muted small">
                No DB amount between {view.lo.toLocaleString()} and{" "}
                {view.hi.toLocaleString()}
                {view.filtered ? " (matching the reelStop filter)" : ""} has a
                pattern or combination at{" "}
                <strong>{betKey}</strong>.
              </p>
            ) : (
              <>
                <p className="muted small">
                  {view.groups.length} amount
                  {view.groups.length === 1 ? "" : "s"} in{" "}
                  {view.lo.toLocaleString()}–{view.hi.toLocaleString()} map to a
                  pattern at <strong>{betKey}</strong>
                  {view.filtered ? " · filter applied" : ""}
                  {view.capped ? ` · first ${MAX_COMBOS} combos` : ""} (click to
                  open):
                </p>
                <div className="win-sections">
                  {view.groups.map((g) => {
                    const isOpen = openAmounts.has(g.amount);
                    const count = g.singles.length + g.combos.length;
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
                            {count} pattern{count === 1 ? "" : "s"}
                          </span>
                        </button>
                        {isOpen && (
                          <PatternResults
                            singles={g.singles}
                            combos={g.combos}
                            capped={g.capped}
                            ranged={false}
                            amtLabel={g.amount.toLocaleString()}
                            showFacade={false}
                            onCreatePattern={onCreatePattern}
                            onCreatePatterns={onCreatePatterns}
                          />
                        )}
                      </section>
                    );
                  })}
                </div>
              </>
            ))}

          {view?.mode === "minmax" && (
            <div className="minmax-result">
              <div className="minmax-line">
                Bet line <strong>{view.facadeKey}</strong>
              </div>
              <div className="minmax-values">
                <span className="minmax-chip">
                  <span className="minmax-key">Min</span>
                  {view.min.toLocaleString()}
                </span>
                <span className="minmax-chip">
                  <span className="minmax-key">Max</span>
                  {view.max.toLocaleString()}
                </span>
              </div>
              {view.filtered && (
                <p className="muted small">filter applied</p>
              )}
            </div>
          )}

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
