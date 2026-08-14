"use client";

import {
  CELL_COUNT,
  COLUMN_LETTERS,
  COLUMN_RANGES,
  FREE_INDEX,
  GRID_SIZE,
  cellToRowCol,
} from "@/lib/patterns";
import type { Pattern } from "@/lib/types";

interface Props {
  bingoCard: number[][];
  selected: Pattern | null;
}

/**
 * The fixed bingo card as a 5x5 grid with B/I/N/G/O headers. When a pattern is
 * selected, the cells at its marked positions are highlighted. The center is the
 * free space.
 */
export default function BingoGrid({ bingoCard, selected }: Props) {
  const markedSet = new Set(selected?.cells ?? []);

  return (
    <div className="panel">
      <div className="panel-title">Bingo card</div>

      <div className="bingo">
        <div className="bingo-header">
          {COLUMN_LETTERS.map((letter, c) => (
            <div key={letter} className="bingo-head-cell">
              <span className="bingo-letter">{letter}</span>
              <span className="bingo-range">{COLUMN_RANGES[c]}</span>
            </div>
          ))}
        </div>

        <div
          className="bingo-grid"
          style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)` }}
        >
          {Array.from({ length: CELL_COUNT }, (_, i) => {
            const { row, col } = cellToRowCol(i);
            const value = bingoCard[row]?.[col];
            const isFree = i === FREE_INDEX;
            const marked = markedSet.has(i);
            return (
              <div
                key={i}
                className={
                  "bingo-cell" +
                  (marked ? " marked" : "") +
                  (isFree ? " free" : "")
                }
              >
                {isFree ? "FREE" : value}
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <p className="muted">
          Highlighting <strong>{selected.name}</strong> (#{selected.id})
        </p>
      )}
    </div>
  );
}
