// True in-game payout for a generated gaffe under AllPatternsPaid semantics.
//
// The tool's "selected outcomes" total only sums the patterns you explicitly
// pick. The game, however, pays EVERY pattern whose cells all get daubed by the
// generated ball-call order — including ones completed only by the *union* of
// several selected patterns' daubs (e.g. Arrowhead + Champagne Glass together
// also complete Letter Y and Cross). This evaluator replays the draw order and
// scores every pattern the way the game does, so the headline total matches the
// machine.

import type { MatchingPattern, Pattern } from "./types";
import { patternDaubNumbers } from "./gaffe";

export interface PatternWin {
  patternId: number;
  patternName: string;
  /** 1-indexed ball at which the pattern's last needed number is drawn. */
  completionBall: number;
  /** Payout = sum of the pattern's rows with BallQty >= completionBall. */
  payout: number;
  /** True when the player explicitly forced this pattern (vs. an incidental win). */
  selected: boolean;
}

export interface InGameResult {
  /** Sum of every winning pattern's payout — the amount the game would show. */
  total: number;
  /** All paying patterns, ordered by completion ball. */
  wins: PatternWin[];
  /** Wins that were NOT explicitly selected (the AllPatternsPaid "surprises"). */
  extras: PatternWin[];
}

/**
 * Score a generated draw order under AllPatternsPaid.
 *
 * A pattern wins when every one of its non-free card numbers appears in `calls`
 * (numbers not in the draw order are never daubed, so a pattern needing one can
 * never complete). It completes at the ball where its last needed number is
 * drawn and pays the sum of its rows with `BallQty >= completionBall` — the same
 * threshold/cascade rule the tool already uses for a selected pattern (a pattern
 * that finishes after its slowest tier makes no tier and pays 0). This matches
 * observed machine behavior (verified against a BetPerLine_10 case that pays
 * 2120, not the 1190 a naive member-sum reports).
 */
export function evaluateInGame(
  calls: number[],
  bingoCard: number[][],
  patterns: Pattern[],
  entriesByPattern: Map<number, MatchingPattern[]>,
  selectedIds: Set<number>,
  highestPriorityPaid = false
): InGameResult {
  const posByValue = new Map<number, number>();
  for (let i = 0; i < calls.length; i++) posByValue.set(calls[i], i + 1);

  const wins: PatternWin[] = [];
  for (const p of patterns) {
    const nums = patternDaubNumbers(p, bingoCard);
    if (nums.length === 0) continue; // free-only / off-card: no payable tier

    let completionBall = 0;
    let complete = true;
    for (const n of nums) {
      const pos = posByValue.get(n);
      if (pos === undefined) {
        complete = false;
        break;
      }
      if (pos > completionBall) completionBall = pos;
    }
    if (!complete) continue;

    const rows = entriesByPattern.get(p.id);
    if (!rows) continue; // pattern isn't payable at this bet line

    let payout = 0;
    for (const r of rows) if (r.ballQty >= completionBall) payout += r.payout;
    if (payout <= 0) continue; // completed too late for any tier

    wins.push({
      patternId: p.id,
      patternName: p.name,
      completionBall,
      payout,
      selected: selectedIds.has(p.id),
    });
  }

  // HighestPriorityPaid: only the single highest-priority satisfied pattern pays
  // (lowest EvaluationPriority number wins), never the sum of all completions.
  if (highestPriorityPaid && wins.length > 0) {
    const priorityOf = (patternId: number): number => {
      const rows = entriesByPattern.get(patternId);
      if (!rows || rows.length === 0) return Number.POSITIVE_INFINITY;
      let min = Number.POSITIVE_INFINITY;
      for (const r of rows) if (r.evaluationPriority < min) min = r.evaluationPriority;
      return min;
    };
    let best = wins[0];
    let bestPriority = priorityOf(best.patternId);
    for (const w of wins) {
      const pr = priorityOf(w.patternId);
      if (pr < bestPriority) {
        best = w;
        bestPriority = pr;
      }
    }
    return {
      total: best.payout,
      wins: [best],
      extras: best.selected ? [] : [best],
    };
  }

  wins.sort(
    (a, b) => a.completionBall - b.completionBall || b.payout - a.payout
  );
  const total = wins.reduce((s, w) => s + w.payout, 0);
  const extras = wins.filter((w) => !w.selected);
  return { total, wins, extras };
}

/** Range index (0=B 1-15, 1=I 16-30, 2=N 31-45, 3=G 46-60, 4=O 61-75). */
function rangeOfValue(n: number): number {
  return Math.min(4, Math.max(0, Math.floor((n - 1) / 15)));
}

/**
 * Nudge a generated draw order so each selected pattern completes at the ball
 * qty it was picked at, so the emitted gaffe pays the intended amount instead of
 * an inflated total.
 *
 * Why this is needed: a pattern's payout is the sum of its rows with
 * `BallQty >= completionBall`. If a pattern the user selected at, say, ball 40
 * actually completes at ball 35 in the packed draw order, it *also* satisfies
 * its 38-ball tier and pays more than the row the user ticked — so the in-game
 * total exceeds the intended "selected subtotal". buildBallCalls places each
 * daub as late as its qty allows, but when two selected patterns contend for the
 * same late column slots one of them gets pushed early.
 *
 * The pass minimizes, over the selected patterns, the gap between each one's
 * real payout and its intended payout. It repeatedly looks for the single daub
 * move that most reduces that gap — pushing a daub of an early-finishing pattern
 * into a later slot, swapping it either with a non-card "filler" ball or with a
 * daub of *another* selected pattern that can spare the slot (its own completion
 * stays in band). A daub is never moved past its ball qty, and a swap is kept
 * only when it strictly lowers the total gap, so the pass can never make the
 * result worse or infeasible. When geometry leaves no room, the residual is
 * explained by the UI's cascade note.
 */
export function refineCompletionTiers(
  calls: number[],
  bingoCard: number[][],
  patterns: Pattern[],
  entriesByPattern: Map<number, MatchingPattern[]>,
  thresholds: Map<number, number>
): number[] {
  const result = calls.slice();
  const pos = new Map<number, number>(); // value -> 1-indexed draw position
  result.forEach((v, i) => pos.set(v, i + 1));

  // Selected pattern -> its non-free card numbers (as a set for membership) and
  // as a list; each daub value -> the strictest ball qty of any selected pattern
  // using it (the latest ball it may be drawn at).
  const patternDaubs = new Map<number, number[]>();
  const patternDaubSet = new Map<number, Set<number>>();
  const qByValue = new Map<number, number>();
  for (const [pid, thr] of thresholds) {
    const p = patterns.find((x) => x.id === pid);
    if (!p) continue;
    const nums = patternDaubNumbers(p, bingoCard);
    patternDaubs.set(pid, nums);
    patternDaubSet.set(pid, new Set(nums));
    for (const n of nums) {
      const cur = qByValue.get(n);
      if (cur === undefined || thr < cur) qByValue.set(n, thr);
    }
  }
  if (patternDaubs.size === 0) return result;

  const completionOf = (nums: number[]): number => {
    let c = 0;
    for (const n of nums) {
      const p = pos.get(n);
      if (p === undefined) return -1; // never drawn -> pattern can't complete
      if (p > c) c = p;
    }
    return c;
  };

  // Payout a pattern makes when it completes at `ball` (sum of rows the ball
  // reaches); intended = the payout at the ball qty the user picked.
  const payoutAt = (pid: number, ball: number): number => {
    if (ball < 0) return 0;
    let sum = 0;
    for (const r of entriesByPattern.get(pid) ?? []) {
      if (r.ballQty >= ball) sum += r.payout;
    }
    return sum;
  };
  const intended = new Map<number, number>();
  for (const [pid, thr] of thresholds) intended.set(pid, payoutAt(pid, thr));

  // Gap = how far the selected patterns' real payouts sit from what was picked.
  // Reaching 0 means the in-game total (for the selected set) equals the subtotal.
  const gap = (): number => {
    let g = 0;
    for (const [pid] of thresholds) {
      const c = completionOf(patternDaubs.get(pid)!);
      g += Math.abs(payoutAt(pid, c) - (intended.get(pid) ?? 0));
    }
    return g;
  };

  const swap = (a: number, b: number): void => {
    const va = result[a - 1];
    const vb = result[b - 1];
    result[a - 1] = vb;
    result[b - 1] = va;
    pos.set(va, b);
    pos.set(vb, a);
  };

  // Greedy: apply the single most-improving daub move until none helps. Each
  // accepted move strictly lowers a bounded, non-negative gap, so this ends.
  const maxIters = thresholds.size * result.length + 8;
  for (let iter = 0; iter < maxIters; iter++) {
    let current = gap();
    if (current === 0) break;

    let bestGap = current;
    let bestFrom = -1;
    let bestTo = -1;

    for (const [pid] of thresholds) {
      const own = patternDaubSet.get(pid)!;
      for (const n of patternDaubs.get(pid)!) {
        const cap = qByValue.get(n)!; // n must stay <= this ball
        const curPos = pos.get(n);
        if (curPos === undefined) continue;
        // Try pushing n to any later slot within its cap.
        for (let p = curPos + 1; p <= cap && p <= result.length; p++) {
          const val = result[p - 1];
          if (val === undefined) continue;
          if (own.has(val)) continue; // swapping with our own daub can't help
          swap(curPos, p);
          const g = gap();
          swap(curPos, p); // restore
          if (g < bestGap) {
            bestGap = g;
            bestFrom = curPos;
            bestTo = p;
          }
        }
      }
    }

    if (bestFrom < 0) break; // no improving move
    swap(bestFrom, bestTo);
  }

  return result;
}
