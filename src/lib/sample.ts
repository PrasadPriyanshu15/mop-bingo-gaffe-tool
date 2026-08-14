import type { Gaffe } from "./types";

/**
 * Hardcoded sample gaffe result (Phase 1). Columns are B/I/N/G/O; the center
 * cell (row 2, col 2) is 0 = the free space. ballCalls are the numbers NOT on
 * the card. In a later phase these become editable / pasted inputs.
 */
export const SAMPLE_GAFFE: Gaffe = {
  reelStops: [35, 31, 25, 19, 1, 0, 0],
  bingoCard: [
    [14, 18, 43, 54, 63],
    [7, 23, 36, 55, 64],
    [11, 28, 0, 58, 65],
    [15, 25, 34, 46, 66],
    [12, 20, 42, 53, 61],
  ],
  ballCalls: [
    1, 2, 3, 4, 5, 6, 8, 9, 10, 13, 16, 17, 19, 21, 22, 24, 26, 27, 29, 30, 31,
    32, 33, 35, 37, 38, 39, 40, 41, 44, 45, 47, 48, 49, 50, 51, 52, 56, 57, 59,
    60, 62, 67, 68, 69, 70, 71, 72, 73, 74, 75,
  ],
};
