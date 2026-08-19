import { FREE_INDEX, cellToRowCol } from "./patterns";
import type { Pattern } from "./types";

/** Range index (0=B 1-15, 1=I 16-30, 2=N 31-45, 3=G 46-60, 4=O 61-75). */
export function rangeOf(n: number): number {
  return Math.min(4, Math.max(0, Math.floor((n - 1) / 15)));
}

/**
 * Card numbers the player must daub to complete a pattern: the marked,
 * non-free cells, ordered by column then row (B/I/N/G/O, top -> bottom).
 * The center free space and any 0 (free) card value are excluded.
 */
export function patternDaubNumbers(
  pattern: Pattern,
  bingoCard: number[][]
): number[] {
  return pattern.cells
    .filter((cell) => cell !== FREE_INDEX)
    .map((cell) => ({ cell, ...cellToRowCol(cell) }))
    .filter(({ row, col }) => (bingoCard[row]?.[col] ?? 0) !== 0)
    .sort((a, b) => a.col - b.col || a.row - b.row)
    .map(({ row, col }) => bingoCard[row][col]);
}

/** A forced number plus the ball count by which it must be called. */
export interface Daub {
  value: number;
  /** Selected ball qty: this number must be daubed by this ball. */
  q: number;
  /** Pattern whose ball qty is binding on this number (for infeasibility hints). */
  patternName?: string;
}

/** Where a forced number ended up in the built draw order. */
export interface DaubPlacement {
  value: number;
  /** Ball qty this number had to be called within. */
  q: number;
  /** 1-indexed position in the flat draw order. */
  position: number;
  /** True when position <= q (the requirement is met). */
  ok: boolean;
  patternName?: string;
}

export interface BuiltBallCalls {
  /** Flat draw-order sequence (what goes in the gaffe JSON). */
  calls: number[];
  /** Per-range call order (5 columns) for the aligned B/I/N/G/O display. */
  columns: number[][];
  /** Number of display rows = longest column. */
  rows: number;
  /** Forced numbers, for highlighting. */
  daubSet: Set<number>;
  /** Every forced number's placement, ordered by draw position. */
  placements: DaubPlacement[];
  /** Placements that could NOT be called within their ball qty (over-constrained). */
  infeasible: DaubPlacement[];
}

/**
 * Rebuild ballCalls in draw order (B,I,N,G,O cycling every 5) and force each
 * daub to complete its pattern at the chosen ball count.
 *
 * A daub is placed at the LATEST slot of its own range whose ball position is
 * <= its ball qty `q`, so the pattern completes as late as allowed (right at the
 * selected ball qty when that position's range holds a daub) and therefore
 * crosses any lower, unselected payout tier. Within a range, tighter `q` daubs
 * are placed first so they still get a valid late slot. Base (non-card) numbers
 * fill the remaining slots ascending. Each forced number's real flat position is
 * checked against its `q` and reported as infeasible when it can't fit in time.
 */
export function buildBallCalls(base: number[], daubs: Daub[]): BuiltBallCalls {
  const daubSet = new Set(daubs.map((d) => d.value));

  const baseByRange: number[][] = [[], [], [], [], []];
  for (const n of base) {
    if (!daubSet.has(n)) baseByRange[rangeOf(n)].push(n);
  }
  baseByRange.forEach((a) => a.sort((x, y) => x - y));

  const daubsByRange: Daub[][] = [[], [], [], [], []];
  for (const d of daubs) daubsByRange[rangeOf(d.value)].push(d);

  const columns: number[][] = [[], [], [], [], []];
  for (let r = 0; r < 5; r++) {
    const colLen = daubsByRange[r].length + baseByRange[r].length;
    const slots: (number | null)[] = new Array(colLen).fill(null);

    // Tightest ball qty first, so a small-q daub is not blocked out of its slots.
    const ordered = [...daubsByRange[r]].sort((a, b) => a.q - b.q);
    for (const d of ordered) {
      let maxRow = Math.floor((d.q - r - 1) / 5);
      if (maxRow > colLen - 1) maxRow = colLen - 1;
      if (maxRow < 0) maxRow = 0;

      let row = -1;
      for (let i = maxRow; i >= 0; i--) {
        if (slots[i] === null) {
          row = i;
          break;
        }
      }
      if (row === -1) {
        // Over-constrained: fall back to the lowest free slot.
        for (let i = 0; i < colLen; i++) {
          if (slots[i] === null) {
            row = i;
            break;
          }
        }
      }
      if (row >= 0) slots[row] = d.value;
    }

    let bi = 0;
    for (let i = 0; i < colLen; i++) {
      if (slots[i] === null) slots[i] = baseByRange[r][bi++];
    }
    columns[r] = slots as number[];
  }

  const rows = columns.reduce((m, c) => Math.max(m, c.length), 0);

  // Flatten in draw order (row-major over the 5 columns) and record where each
  // forced number actually landed, so feasibility uses the true ball position.
  const calls: number[] = [];
  const posByValue = new Map<number, number>();
  for (let i = 0; i < rows; i++) {
    for (let r = 0; r < 5; r++) {
      if (i < columns[r].length) {
        calls.push(columns[r][i]);
        posByValue.set(columns[r][i], calls.length);
      }
    }
  }

  const placements: DaubPlacement[] = daubs
    .map((d) => {
      const position = posByValue.get(d.value) ?? -1;
      return {
        value: d.value,
        q: d.q,
        position,
        ok: position > 0 && position <= d.q,
        patternName: d.patternName,
      };
    })
    .sort((a, b) => a.position - b.position);
  const infeasible = placements.filter((p) => !p.ok);

  return { calls, columns, rows, daubSet, placements, infeasible };
}
