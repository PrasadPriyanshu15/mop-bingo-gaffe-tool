// Upload-time sanity checks on a parsed VGTPaytable, surfaced to the user so a
// malformed authoring file is caught before it drives the tool.
//
//  1. Free space: every pattern must represent the center free space either as a
//     '2' at index 12 (0-based, the middle of the 5x5) OR as <FreeSpace>12</…>
//     with no '2' anywhere in the map. Anything else is flagged.
//  2. EvaluationPriority: within each bet line (facade), the priorities must
//     ascend by exactly +1 from one entry to the next (…,n,n+1,n+2,…). Any break
//     is flagged.

import type { Paytable59 } from "./types";
import { FREE_INDEX, CELL_COUNT } from "./patterns";

export interface PatternIssue {
  id: number;
  name: string;
  reason: string;
}

export interface PriorityIssue {
  facadeKey: string;
  /** The offending entry's Index within the paytable. */
  index: number;
  patternId: number;
  expected: number;
  actual: number;
}

export interface PaytableIssues {
  patterns: PatternIssue[];
  priorities: PriorityIssue[];
}

/** Validate free-space placement and EvaluationPriority continuity. */
export function validatePaytable(data: Paytable59): PaytableIssues {
  const patterns: PatternIssue[] = [];

  for (const p of data.patterns) {
    const map = p.map ?? "";

    if (map.length !== CELL_COUNT) {
      patterns.push({
        id: p.id,
        name: p.name,
        reason: `PatternMap length ${map.length} (expected ${CELL_COUNT}).`,
      });
      // A wrong-length map makes the index checks meaningless; skip them.
      continue;
    }

    const twoPositions: number[] = [];
    for (let i = 0; i < map.length; i++) if (map[i] === "2") twoPositions.push(i);
    const freeAt12 = p.freeSpace === FREE_INDEX;

    if (twoPositions.length > 0) {
      const misplaced = twoPositions.filter((i) => i !== FREE_INDEX);
      if (misplaced.length > 0) {
        patterns.push({
          id: p.id,
          name: p.name,
          reason: `free-space '2' at index ${twoPositions.join(", ")} — expected only at ${FREE_INDEX} (center).`,
        });
      } else if (twoPositions.length > 1) {
        patterns.push({
          id: p.id,
          name: p.name,
          reason: `${twoPositions.length} '2' marks — expected a single free space at ${FREE_INDEX}.`,
        });
      }
      // else: exactly one '2', at index 12 → valid.
    } else if (!freeAt12) {
      const fs =
        p.freeSpace == null
          ? "no <FreeSpace>"
          : `<FreeSpace>${p.freeSpace}</FreeSpace>`;
      patterns.push({
        id: p.id,
        name: p.name,
        reason: `no '2' at index ${FREE_INDEX} and ${fs} — expected '2' at ${FREE_INDEX} or <FreeSpace>${FREE_INDEX}</FreeSpace>.`,
      });
    }
  }

  const priorities: PriorityIssue[] = [];

  for (const pt of data.paytables) {
    // Check in the entries' authored order (Index) so the report reads top-down.
    const entries = [...pt.entries].sort((a, b) => a.index - b.index);
    for (let i = 1; i < entries.length; i++) {
      const expected = entries[i - 1].evaluationPriority + 1;
      if (entries[i].evaluationPriority !== expected) {
        priorities.push({
          facadeKey: pt.facadeKey,
          index: entries[i].index,
          patternId: entries[i].patternId,
          expected,
          actual: entries[i].evaluationPriority,
        });
      }
    }
  }

  return { patterns, priorities };
}
