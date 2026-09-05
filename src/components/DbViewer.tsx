"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { DbHandle, DbType, Facade, RngLenFilter } from "@/lib/db";
import type { MatchingPattern, Pattern, Paytable, Paytable59 } from "@/lib/types";
import { parsePattern, patternIsActive } from "@/lib/reelstop";
import { patternContains, cardBallCallBase } from "@/lib/patterns";
import { buildBallCalls, patternDaubNumbers } from "@/lib/gaffe";
import {
  evaluateInGame,
  refineCompletionTiers,
  type PatternWin,
} from "@/lib/evaluate";
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
  const entriesByPattern = new Map<number, MatchingPattern[]>();
  for (const e of entries) {
    const arr = entriesByPattern.get(e.patternId);
    if (arr) arr.push(e);
    else entriesByPattern.set(e.patternId, [e]);
  }
  // Same draw-order refinement the main tool applies, so the flagged in-game
  // total reflects the gaffe it would actually generate (completions nudged into
  // the picked ball-qty band) rather than the raw packed order.
  const thresholds = new Map(selections.map((s) => [s.patternId, s.ballQty]));
  const calls = refineCompletionTiers(
    buildBallCalls(cardBallCallBase(bingoCard), daubs).calls,
    bingoCard,
    patterns,
    entriesByPattern,
    thresholds
  );
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

/** A pattern threshold whose cumulative total equals the searched amount. */
interface PatternMatch {
  facadeKey: string;
  patternId: number;
  patternName: string;
  ballQty: number;
  payout: number;
  total: number;
  autoCount: number;
  inGameTotal: number;
  extras: PatternWin[];
}

/** One pattern's chosen threshold inside a combination. */
interface ComboMember {
  patternId: number;
  patternName: string;
  ballQty: number;
  payout: number;
  total: number;
  autoCount: number;
}

/** A set of distinct patterns (same bet line) whose totals sum to the amount. */
interface PatternCombo {
  facadeKey: string;
  members: ComboMember[];
  total: number;
  hasSubPattern: boolean;
  inGameTotal: number;
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
  capped: boolean;
}

/** One searched amount with its matching awards (Each-win mode). */
interface WinSection {
  key: string;
  label: string;
  amount: number;
  awards: AwardResult[];
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
 * skipped for HighestPriorityPaid games, and the combo search is capped.
 */
function computePatternMatches(
  tables: Paytable[],
  data: Paytable59,
  bingoCard: number[][],
  lo: number,
  hi: number
): { matches: PatternMatch[]; combos: PatternCombo[]; capped: boolean } {
  const patternByIdAll = new Map<number, Pattern>(
    data.patterns.map((p) => [p.id, p])
  );

  const highestPriority = data.evaluationType === "HighestPriorityPaid";

  const matches: PatternMatch[] = [];
  for (const pt of tables) {
    const byPattern = new Map<number, MatchingPattern[]>();
    for (const e of pt.entries) {
      const arr = byPattern.get(e.patternId);
      if (arr) arr.push(e);
      else byPattern.set(e.patternId, [e]);
    }
    for (const [pid, arr] of byPattern) {
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
  matches.sort((a, b) => a.total - b.total || a.ballQty - b.ballQty);

  const patternById = patternByIdAll;
  const found: PatternCombo[] = [];
  const seen = new Set<string>();
  let capped = false;

  if (!highestPriority)
  outer: for (const pt of tables) {
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

    const chosen: ComboMember[] = [];
    const record = (sum: number): boolean => {
      const members = [...chosen].sort((a, b) => a.patternId - b.patternId);
      const key =
        pt.facadeKey +
        "|" +
        members.map((m) => `${m.patternId}:${m.ballQty}`).join("|");
      if (seen.has(key)) return true;
      seen.add(key);
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
          {m.patternName} <span className="pattern-id">#{m.patternId}</span>
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
            in-game {m.inGameTotal.toLocaleString()} · +{m.extras.length} also won
          </span>
        )}
      </div>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => onCreatePattern(m.facadeKey, m.patternId, m.ballQty)}
        title="Select this pattern in section 2 (fills payout, ballCalls & result)"
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
              in-game {c.inGameTotal.toLocaleString()} · +{c.extras.length} also
              won
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
          title="Select all these patterns in section 2 (fills payout, ballCalls & result)"
        >
          create combination
        </button>
      </div>
      <div className="pattern-combo-members">
        {c.members.map((m, j) => (
          <div key={j} className="pattern-match">
            <div className="pattern-match-info">
              <span className="pattern-match-name">
                {m.patternName} <span className="pattern-id">#{m.patternId}</span>
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
 * sub · Triple + sub). Owns its own active-tab state, so each instance tabs
 * independently. `ranged` tweaks the header wording; `amtLabel` is the
 * amount/range being described.
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

/** The individual selected wins (one per ticked payout row). */
export interface Win {
  key: string;
  label: string;
  payout: number;
}

export interface DbViewerHandle {
  /** Set the reelStop filter and run a search (driven by the reelStrip viewer). */
  runWithFilter: (filter: string) => void;
  /** Current filter values + selected DB bet line, so a "create pattern" click
   *  can mirror them back into an auto-find. `facadeSel` is a DB facadeId as a
   *  string, or "all". */
  getFilters: () => { pattern: string; maxRng: string; facadeSel: string };
}

interface Props {
  /** Parsed paytable XML — used to find which patterns pay a given amount. */
  data: Paytable59 | null;
  /** The bet line chosen in section 1 — the XML paytable "map DB amount →
   *  Patterns" matches against. */
  betKey: string | null;
  /** Current bingo card — used to compute each match's true in-game payout. */
  bingoCard: number[][];
  /** The tool's current total payout — the amount field's default (yellow). */
  totalPayout: number;
  /** The individual selected wins (enables the Total / Each-win toggle). */
  wins: Win[];
  /** Report the opened DB handle upward so other panels can query it. */
  onDbReady: (handle: DbHandle | null, facades: Facade[]) => void;
  /** Push a chosen reelStop candidate into the main generated gaffe output. */
  onApply: (reelStops: number[]) => void;
  /** Prefill section 2 by selecting this pattern/ballQty at this bet line. */
  onCreatePattern: (
    facadeKey: string,
    patternId: number,
    ballQty: number
  ) => void;
  /** Prefill section 2 with a whole combination. */
  onCreatePatterns: (
    facadeKey: string,
    selections: { patternId: number; ballQty: number }[]
  ) => void;
  /** Load a reelStop into the reelStrip viewer. */
  onSlot: (reelStops: number[], presentationId?: number) => void;
  /** Whether a reelStrip .xml is loaded (enables the "slot" button). */
  reelStripLoaded: boolean;
  /** Bet line (facadeKey) a "create pattern" click wants pre-selected here. */
  autoFindFacadeKey?: string | null;
  /** DB facadeId selected in the search — preferred over facadeKey. */
  autoFindFacadeId?: number | null;
  /** reelStop positional filter to mirror on auto-find. */
  autoFindPattern?: string;
  /** RNG-length bound (HPP) to mirror on auto-find. */
  autoFindMaxRng?: string;
  /** Changes each time an auto-find is requested; triggers the lookup. */
  autoFindToken?: number;
}

/**
 * Unified DB explorer: owns the outcomes .db upload (APP / HPP schema) and a
 * single set of inputs — bet line, one editable Amount field (defaulting to the
 * tool's total payout, shown yellow until you type a custom value), reelStop
 * filter and RNG bound — with every search action (Search DB, see patterns, map
 * DB amount → Patterns, Min–Max, and the Total / Each-win reelStop lookup). All
 * results render in the right-hand column. The DB layer (wa-sqlite) is imported
 * lazily so it stays out of the initial bundle and only runs in the browser.
 */
const DbViewer = forwardRef<DbViewerHandle, Props>(function DbViewer(
  {
    data,
    betKey,
    bingoCard,
    totalPayout,
    wins,
    onDbReady,
    onApply,
    onCreatePattern,
    onCreatePatterns,
    onSlot,
    reelStripLoaded,
    autoFindFacadeKey,
    autoFindFacadeId,
    autoFindPattern,
    autoFindMaxRng,
    autoFindToken,
  },
  ref
) {
  // ── DB upload / schema ─────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<DbHandle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "opening" | "ready">("idle");
  // Schema for the NEXT file chosen; openedType is the current DB's real schema.
  const [dbType, setDbType] = useState<DbType>("type1");
  const [openedType, setOpenedType] = useState<DbType | null>(null);
  const [facades, setFacades] = useState<Facade[]>([]);
  // FacadeIds that have an award for the current single amount — flagged (✓).
  const [facadesWithResults, setFacadesWithResults] = useState<Set<number>>(
    new Set()
  );

  // ── Search inputs ──────────────────────────────────────────────────────
  const panelRef = useRef<HTMLDivElement>(null);
  const [facadeSel, setFacadeSel] = useState<string>("all");
  const [amount, setAmount] = useState("");
  // Whether the amount was hand-typed. While false, it mirrors totalPayout and
  // shows in yellow; once true it holds a custom value in regular text.
  const [custom, setCustom] = useState(false);
  const [pattern, setPattern] = useState("");
  const [maxRng, setMaxRng] = useState("");
  // "total" searches the amount field; "each" searches every selected win.
  const [mode, setMode] = useState<"total" | "each">("total");

  // ── Results / progress ─────────────────────────────────────────────────
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [openAmounts, setOpenAmounts] = useState<Set<number>>(new Set());
  const [patternMatches, setPatternMatches] = useState<
    { lo: number; hi: number; matches: PatternMatch[] } | null
  >(null);
  const [combos, setCombos] = useState<
    { lo: number; hi: number; combos: PatternCombo[]; capped: boolean } | null
  >(null);
  // Each-win reelStop sections + which are expanded.
  const [sections, setSections] = useState<WinSection[] | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  const runIdRef = useRef(0);

  const ready = status === "ready";
  const showFacade = facadeSel === "all";
  const isType2 = openedType === "type2";
  const multiWin = wins.length > 1;
  const eachMode = mode === "each" && multiWin;

  // The amount field tracks the tool's total until the user types a custom value.
  useEffect(() => {
    if (!custom) setAmount(totalPayout ? String(totalPayout) : "");
  }, [totalPayout, custom]);

  // Flag which facades have an award for the current single amount, so the picker
  // can mark them (✓). Cheap indexed query; re-runs when the amount changes.
  useEffect(() => {
    if (!ready || !handleRef.current) return;
    const amt = parseAmountInput(amount);
    if (amt.kind !== "single") {
      setFacadesWithResults(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const db = await import("@/lib/db");
        const ids = await db.findFacadesWithAmount(handleRef.current!, amt.v);
        if (!cancelled) setFacadesWithResults(new Set(ids));
      } catch {
        if (!cancelled) setFacadesWithResults(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, amount]);

  async function handleFile(file: File) {
    setError(null);
    setView(null);
    setSections(null);
    setPatternMatches(null);
    setCombos(null);
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
      setFacadeSel("all");
      setStatus("ready");
      onDbReady(h, list);
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : "Failed to open the database.");
      onDbReady(null, []);
    }
  }

  /** Resolve the "RNG count" field into a length bound (Type 2 only). */
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

  function resetResults() {
    setView(null);
    setSections(null);
    setProgress(null);
    setOpenAmounts(new Set());
    setPatternMatches(null);
    setCombos(null);
  }

  async function runSearch(
    amountStr: string,
    patternStr: string,
    facadeSelOverride?: string
  ) {
    if (!handleRef.current) return;
    const sel = facadeSelOverride ?? facadeSel;
    const showAll = sel === "all";
    const amt = parseAmountInput(amountStr);
    const pat = parsePattern(patternStr);
    const active = patternIsActive(pat);
    const { filter: rngLen, error: maxRngErr } = parseMaxRng();
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
    resetResults();

    try {
      const db = await import("@/lib/db");
      const targets = showAll
        ? facades
        : facades.filter((f) => String(f.facadeId) === sel);
      const facadeIdParam = showAll ? null : Number(sel);

      // Single amount → award cards (with reelStops).
      if (amt.kind === "single") {
        const awards: AwardResult[] = [];
        for (const facade of targets) {
          const found = await db.findAwardsByAmount(
            handleRef.current,
            facade.facadeId,
            amt.v
          );
          if (stale()) return;
          for (const award of found) {
            const reelStops = filterActive
              ? await db.findMatchingReelStops(handleRef.current, award, pat, 2000, rngLen)
              : await db.getReelStops(handleRef.current, award, 8);
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
          handleRef.current,
          facadeIdParam,
          amt.lo,
          amt.hi
        );
        if (stale()) return;
        setView({ mode: "amountList", amounts, lo: amt.lo, hi: amt.hi });
        return;
      }

      // Filter present → for each candidate amount, keep matching awards.
      const lo = amt.kind === "range" ? amt.lo : null;
      const hi = amt.kind === "range" ? amt.hi : null;
      const amounts = await db.listAmounts(handleRef.current, facadeIdParam, lo, hi);
      if (stale()) return;
      setProgress({ done: 0, total: amounts.length });

      const groups: AmountGroup[] = [];
      for (let i = 0; i < amounts.length; i++) {
        const a = amounts[i];
        const matched: AwardResult[] = [];
        for (const facade of targets) {
          const found = await db.findAwardsByAmount(handleRef.current, facade.facadeId, a);
          if (stale()) return;
          for (const award of found) {
            const rs = await db.findMatchingReelStops(
              handleRef.current,
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

  /** Each-win mode: look up every selected win's payout in its own section. */
  async function findEachWin() {
    if (!handleRef.current) return;
    const pat = parsePattern(pattern);
    const active = patternIsActive(pat);
    const { filter: rngLen, error: rngErr } = parseMaxRng();
    if (rngErr) {
      setError("RNG count must be a positive number or range, e.g. 300 or 100-300.");
      return;
    }
    const constrained = active || rngLen != null;

    const myId = ++runIdRef.current;
    const stale = () => runIdRef.current !== myId;

    setSearching(true);
    setError(null);
    resetResults();

    try {
      const db = await import("@/lib/db");
      const targets = showFacade
        ? facades
        : facades.filter((f) => String(f.facadeId) === facadeSel);

      const out: WinSection[] = [];
      for (const w of wins) {
        const awards: AwardResult[] = [];
        for (const facade of targets) {
          const found = await db.findAwardsByAmount(
            handleRef.current,
            facade.facadeId,
            w.payout
          );
          if (stale()) return;
          for (const award of found) {
            const reelStops = constrained
              ? await db.findMatchingReelStops(handleRef.current, award, pat, 2000, rngLen)
              : await db.getReelStops(handleRef.current, award, 8);
            if (stale()) return;
            awards.push({ award, facadeKey: facade.facadeKey, reelStops });
          }
        }
        out.push({ key: w.key, label: w.label, amount: w.payout, awards });
      }
      setSections(out);
    } catch (e) {
      if (!stale()) setError(e instanceof Error ? e.message : "Query failed.");
    } finally {
      if (!stale()) setSearching(false);
    }
  }

  function cancel() {
    runIdRef.current++;
    setSearching(false);
    setProgress(null);
  }

  /** Smallest & largest award amount for the selected bet line (honors filter). */
  async function runMinMax() {
    if (!handleRef.current) return;
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
    resetResults();

    try {
      const db = await import("@/lib/db");
      const res = await db.findMinMaxAmount(
        handleRef.current,
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

  /** List patterns whose total equals / falls inside the entered amount. */
  async function seePatterns() {
    if (!handleRef.current) return;
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
    const selKey = facades.find((f) => String(f.facadeId) === facadeSel)?.facadeKey;
    let tables = showFacade
      ? data.paytables
      : data.paytables.filter((p) => p.facadeKey === selKey);
    if (!showFacade && tables.length === 0) {
      tables = data.paytables;
    }

    try {
      const db = await import("@/lib/db");
      const presentIds =
        amtParsed.kind === "range"
          ? await db.findFacadesWithAmountInRange(handleRef.current, lo, hi)
          : await db.findFacadesWithAmount(handleRef.current, lo);
      const presentKeys = new Set(
        facades
          .filter((f) => presentIds.includes(f.facadeId))
          .map((f) => f.facadeKey)
      );
      const gated = tables.filter((t) => presentKeys.has(t.facadeKey));
      if (gated.length > 0) {
        tables = gated;
      } else if (presentIds.length === 0) {
        tables = [];
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "DB lookup failed.");
      return;
    }

    if (tables.length === 0) {
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

  // The section-1 XML paytable that "map DB amount → Patterns" matches against.
  const mapTable = data?.paytables.find((p) => p.facadeKey === betKey) ?? null;
  const canMap = !showFacade && !!mapTable && !searching && ready;

  /** For the selected DB bet line's min–max range, show every DB amount the
   *  section-1 bet level can pay (single or combination). */
  async function mapAmountsToPatterns() {
    if (!handleRef.current) return;
    if (showFacade) {
      setError("Select a specific bet line to map amounts to patterns.");
      return;
    }
    if (!data || !mapTable) {
      setError("Select a bet level in section 1 (Select bet level) first.");
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
    resetResults();

    try {
      const db = await import("@/lib/db");
      const mm = await db.findMinMaxAmount(
        handleRef.current,
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
        handleRef.current,
        facade.facadeId,
        mm.min,
        mm.max,
        active ? pat : null,
        rngLen
      );
      if (stale()) return;
      setProgress({ done: 0, total: amounts.length });

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

  // Auto-find: a "create pattern" click bumps autoFindToken. Point this panel at
  // the same bet line, mirror its filters, reset the amount to the (new) total,
  // and run the lookup. Runs after the parent re-render, so totalPayout is fresh.
  const lastAutoToken = useRef(autoFindToken ?? 0);
  useEffect(() => {
    const token = autoFindToken ?? 0;
    if (token === lastAutoToken.current) return;
    lastAutoToken.current = token;
    if (status !== "ready" || !handleRef.current) return;
    const targetId =
      autoFindFacadeId != null &&
      facades.some((f) => f.facadeId === autoFindFacadeId)
        ? autoFindFacadeId
        : facades.find((f) => f.facadeKey === autoFindFacadeKey)?.facadeId ?? null;
    if (targetId == null) return;
    const pat = autoFindPattern ?? "";
    const rng = autoFindMaxRng ?? "";
    const sel = String(targetId);
    setFacadeSel(sel);
    setPattern(pat);
    setMaxRng(rng);
    setCustom(false);
    setMode("total");
    void runSearch(String(totalPayout), pat, sel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFindToken]);

  // Driven by the reelStrip viewer's SEARCH button: fill the filter and run.
  useImperativeHandle(ref, () => ({
    runWithFilter(filter: string) {
      setPattern(filter);
      void runSearch(amount, filter);
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      );
    },
    getFilters() {
      return { pattern, maxRng, facadeSel };
    },
  }));

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (eachMode) void findEachWin();
      else void runSearch(amount, pattern);
    }
  };

  const hasResults =
    !!patternMatches || !!view || (eachMode && !!sections) || !!progress;

  return (
    <div className="panel db-viewer" ref={panelRef}>
      <div className="panel-title">DB search &amp; reelStops</div>

      <div className="db-viewer-cols">
        {/* ── Inputs column ─────────────────────────────────────────── */}
        <div className="db-inputs">
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
          </div>

          <div className="upload-row">
            <button
              type="button"
              className="btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={status === "opening"}
            >
              {status === "opening" ? "Opening…" : "Choose .db file…"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".db,.sqlite,.sqlite3,application/octet-stream"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
          {fileName && <span className="loaded-name">{fileName}</span>}

          {!ready && (
            <p className="muted small">
              Choose the DB structure, then upload the outcomes .db to search.
            </p>
          )}

          {ready && (
            <>
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
                      {(facadesWithResults.has(f.facadeId) ? "✅ " : "　") +
                        f.facadeKey}
                    </option>
                  ))}
                </select>
              </label>

              <label className="db-field">
                <span className="db-label">
                  Amount or range {custom ? "(custom)" : "· tool total"}
                </span>
                <div className="amount-input-row">
                  <input
                    className={"select amount-field" + (custom ? "" : " auto")}
                    type="text"
                    value={amount}
                    onChange={(e) => {
                      setCustom(true);
                      setAmount(e.target.value);
                      setPatternMatches(null);
                      setCombos(null);
                    }}
                    placeholder="e.g. 500 or 500-1000"
                    onKeyDown={onEnter}
                  />
                  {custom && (
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setCustom(false)}
                      title="Reset to the tool's total payout"
                    >
                      ↺ total
                    </button>
                  )}
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
                  onKeyDown={onEnter}
                />
              </label>

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
                    onKeyDown={onEnter}
                  />
                </label>
              )}

              <p className="muted small">
                Leave the amount blank and type a filter to find every amount that
                has it (slower — pair with a range to narrow the scan).
              </p>

              <div className="amount-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    eachMode ? void findEachWin() : void runSearch(amount, pattern)
                  }
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
                        ? "Choose a bet level in section 1 (Select bet level) first"
                        : "For this bet line's min–max amount range, show every DB amount the section-1 bet level can pay (single or combination)"
                  }
                >
                  map DB amount → Patterns
                </button>
              </div>

              {error && <p className="error">{error}</p>}
            </>
          )}
        </div>

        {/* ── Results column ────────────────────────────────────────── */}
        <div className="db-results">
          {!ready ? (
            <p className="muted small">
              Results appear here once a .db is loaded and searched.
            </p>
          ) : !hasResults && !error ? (
            <p className="muted small">Run a search to see results.</p>
          ) : null}

          {progress && (
            <p className="muted small">
              Scanned {progress.done} / {progress.total} amounts…
            </p>
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

          {eachMode && sections && (
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
                      <span className="win-section-caret">{open ? "▾" : "▸"}</span>
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
                        showFacade={showFacade}
                        onApply={onApply}
                        onSlot={onSlot}
                        reelStripLoaded={reelStripLoaded}
                        emptyText={`No award with Amount = ${sec.amount.toLocaleString()}${
                          showFacade ? " in any facade." : " in this facade."
                        }`}
                      />
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {view?.mode === "mapped" &&
            (view.groups.length === 0 ? (
              <p className="muted small">
                No DB amount between {view.lo.toLocaleString()} and{" "}
                {view.hi.toLocaleString()}
                {view.filtered ? " (matching the reelStop filter)" : ""} has a
                pattern or combination at <strong>{betKey}</strong>.
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
              {view.filtered && <p className="muted small">filter applied</p>}
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
                        setCustom(true);
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
      </div>
    </div>
  );
});

export default DbViewer;
