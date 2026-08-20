import type { Pattern } from "./types";

/** Center cell of a 5x5 grid — the bingo free space. */
export const FREE_INDEX = 12;
export const GRID_SIZE = 5;
export const CELL_COUNT = 25;

/** Column letters, one per grid column (B/I/N/G/O). */
export const COLUMN_LETTERS = ["B", "I", "N", "G", "O"] as const;

/** The number range covered by each column, e.g. column 0 -> "1-15". */
export const COLUMN_RANGES = ["1-15", "16-30", "31-45", "46-60", "61-75"] as const;

/**
 * Distinct highlight colors, one per forced pattern (cycles for >6). Order:
 * yellow, purple, blue, green, orange, pink — kept in sync with the CSS tokens.
 */
export const HIGHLIGHT_COLORS = [
  "#ffd23f",
  "#b98bff",
  "#4c8dff",
  "#4ad991",
  "#ff9f43",
  "#ff6b9d",
] as const;

/** Pick the highlight color for the i-th forced pattern (cycles). */
export function highlightColor(i: number): string {
  return HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length];
}

/**
 * Background for a cell/ball covered by `colors`: undefined for none, a solid
 * color for one, and an even-split diagonal gradient when shared by several.
 */
export function cellHighlightStyle(
  colors: string[]
): { background: string } | undefined {
  if (colors.length === 0) return undefined;
  if (colors.length === 1) return { background: colors[0] };
  const n = colors.length;
  const stops = colors
    .map((c, i) => `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`)
    .join(", ");
  return { background: `linear-gradient(135deg, ${stops})` };
}

/** Indices of cells that are part of the pattern (map char '1' or '2'). */
export function patternCells(map: string): number[] {
  const cells: number[] = [];
  for (let i = 0; i < map.length; i++) {
    if (map[i] === "1" || map[i] === "2") cells.push(i);
  }
  return cells;
}

/** Convert a flat cell index to { row, col } (row-major). */
export function cellToRowCol(index: number): { row: number; col: number } {
  return { row: Math.floor(index / GRID_SIZE), col: index % GRID_SIZE };
}

/** Inclusive number bounds for a column: 0 -> 1..15, 1 -> 16..30, … */
export function columnBounds(col: number): { lo: number; hi: number } {
  return { lo: col * 15 + 1, hi: col * 15 + 15 };
}

/** Row/col of the center free space (2, 2) on a 5x5 grid. */
const FREE_ROW = Math.floor(FREE_INDEX / GRID_SIZE);
const FREE_COL = FREE_INDEX % GRID_SIZE;

/**
 * Draw-order base for ballCalls: every number 1..75 that is NOT on the card
 * (the 0 free cell is ignored), ascending. Replaces the hardcoded sample list
 * so an edited card produces a matching ballCalls pool.
 */
export function cardBallCallBase(card: number[][]): number[] {
  const onCard = new Set<number>();
  for (const row of card) {
    for (const n of row) {
      if (n !== 0) onCard.add(n);
    }
  }
  const base: number[] = [];
  for (let n = 1; n <= 75; n++) {
    if (!onCard.has(n)) base.push(n);
  }
  return base;
}

/**
 * Validate an edited bingo card. Returns null when valid, else a human message.
 * Each non-free cell must be an integer within its column's range and unique
 * within its column (column ranges don't overlap, so that also makes the whole
 * card unique). The center cell (row 2, col 2) must stay the free space (0).
 */
export function validateBingoCard(card: number[][]): string | null {
  if (card.length !== GRID_SIZE) return "Card must have 5 rows.";
  for (let col = 0; col < GRID_SIZE; col++) {
    const { lo, hi } = columnBounds(col);
    const letter = COLUMN_LETTERS[col];
    const seen = new Set<number>();
    for (let row = 0; row < GRID_SIZE; row++) {
      const v = card[row]?.[col];
      if (row === FREE_ROW && col === FREE_COL) {
        if (v !== 0) return "The center cell must stay the free space.";
        continue;
      }
      if (!Number.isInteger(v)) {
        return `Column ${letter}: every cell needs a whole number.`;
      }
      if (v < lo || v > hi) {
        return `Column ${letter} numbers must be ${lo}–${hi} (got ${v}).`;
      }
      if (seen.has(v)) {
        return `Column ${letter} has a duplicate (${v}).`;
      }
      seen.add(v);
    }
  }
  return null;
}

/** A random valid bingo card: distinct numbers per column, center left free. */
export function randomBingoCard(): number[][] {
  const card: number[][] = Array.from({ length: GRID_SIZE }, () =>
    new Array<number>(GRID_SIZE).fill(0)
  );
  for (let col = 0; col < GRID_SIZE; col++) {
    const { lo, hi } = columnBounds(col);
    const pool: number[] = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    // Fisher–Yates shuffle, then take the first few.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let pi = 0;
    for (let row = 0; row < GRID_SIZE; row++) {
      if (row === FREE_ROW && col === FREE_COL) continue; // leave the free space
      card[row][col] = pool[pi++];
    }
  }
  return card;
}

/**
 * True when `inner` is geometrically contained inside `outer` (its marked cells
 * are a subset of outer's, with the free space always treated as daubed). Same
 * semantics as `containedPatterns`, for a single pair.
 */
export function patternContains(outer: Pattern, inner: Pattern): boolean {
  if (outer.id === inner.id) return false;
  if (inner.cells.length === 0) return false;
  const available = new Set<number>(outer.cells);
  available.add(FREE_INDEX);
  return inner.cells.every((c) => available.has(c));
}

/**
 * Patterns geometrically contained inside `selected` (AllPatternsPaid semantics):
 * every cell of the candidate must fall inside the selected pattern's marked cells,
 * where the center free space is always treated as daubed.
 *
 * Returns other patterns whose marked cells are a subset of selected's cells.
 */
export function containedPatterns(
  selected: Pattern,
  all: Pattern[]
): Pattern[] {
  const available = new Set<number>(selected.cells);
  available.add(FREE_INDEX);

  return all.filter((p) => {
    if (p.id === selected.id) return false;
    if (p.cells.length === 0) return false;
    return p.cells.every((c) => available.has(c));
  });
}
