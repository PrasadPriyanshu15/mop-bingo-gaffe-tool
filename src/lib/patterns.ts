import type { Pattern } from "./types";

/** Center cell of a 5x5 grid — the bingo free space. */
export const FREE_INDEX = 12;
export const GRID_SIZE = 5;
export const CELL_COUNT = 25;

/** Column letters, one per grid column (B/I/N/G/O). */
export const COLUMN_LETTERS = ["B", "I", "N", "G", "O"] as const;

/** The number range covered by each column, e.g. column 0 -> "1-15". */
export const COLUMN_RANGES = ["1-15", "16-30", "31-45", "46-60", "61-75"] as const;

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
