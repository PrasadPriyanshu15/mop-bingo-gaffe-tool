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
  selectedIds: Set<number>
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

  wins.sort(
    (a, b) => a.completionBall - b.completionBall || b.payout - a.payout
  );
  const total = wins.reduce((s, w) => s + w.payout, 0);
  const extras = wins.filter((w) => !w.selected);
  return { total, wins, extras };
}
