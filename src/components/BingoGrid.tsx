"use client";

import { useState } from "react";
import {
  CELL_COUNT,
  COLUMN_LETTERS,
  COLUMN_RANGES,
  FREE_INDEX,
  GRID_SIZE,
  cellHighlightStyle,
  cellToRowCol,
  columnBounds,
  randomBingoCard,
  validateBingoCard,
} from "@/lib/patterns";
import { SAMPLE_GAFFE } from "@/lib/sample";

/** One forced pattern to color on the card. */
export interface BingoHighlight {
  name: string;
  cells: number[];
  color: string;
}

interface Props {
  bingoCard: number[][];
  /** Forced patterns, each colored distinctly (gradient where cells overlap). */
  highlights: BingoHighlight[];
  /** Apply an edited card back to the page. */
  onChange: (card: number[][]) => void;
}

/** Build a string draft (for the inputs) from a numeric card; 0 = free. */
function toDraft(card: number[][]): string[][] {
  return card.map((row) => row.map((n) => (n === 0 ? "" : String(n))));
}

/** Parse a string draft into a numeric card; blank/free center -> 0. */
function fromDraft(draft: string[][]): number[][] {
  return draft.map((row, r) =>
    row.map((s, c) => {
      if (r * GRID_SIZE + c === FREE_INDEX) return 0;
      const t = s.trim();
      if (t === "") return NaN;
      const n = Number(t);
      return Number.isInteger(n) ? n : NaN;
    })
  );
}

/**
 * The bingo card as a 5x5 grid with B/I/N/G/O headers. In view mode, a selected
 * pattern highlights its marked cells and the center is the free space. An Edit
 * button switches to inline number inputs (Save / Cancel / Reset / Randomize).
 */
export default function BingoGrid({ bingoCard, highlights, onChange }: Props) {
  // Per-cell list of colors covering it (skip the free center).
  const colorsByCell = new Map<number, string[]>();
  for (const h of highlights) {
    for (const cell of h.cells) {
      if (cell === FREE_INDEX) continue;
      const arr = colorsByCell.get(cell);
      if (arr) arr.push(h.color);
      else colorsByCell.set(cell, [h.color]);
    }
  }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[][]>(() => toDraft(bingoCard));
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(toDraft(bingoCard));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setError(null);
    setEditing(false);
  }

  function save() {
    const card = fromDraft(draft);
    const msg = validateBingoCard(card);
    if (msg) {
      setError(msg);
      return;
    }
    onChange(card);
    setError(null);
    setEditing(false);
  }

  function setCell(row: number, col: number, value: string) {
    setDraft((prev) => {
      const next = prev.map((r) => [...r]);
      next[row][col] = value;
      return next;
    });
  }

  return (
    <div className="panel">
      <div className="panel-title">
        Bingo card
        {editing ? (
          <span className="bingo-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setDraft(toDraft(randomBingoCard()))}
            >
              Randomize
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setDraft(toDraft(SAMPLE_GAFFE.bingoCard))}
            >
              Reset
            </button>
            <button type="button" className="btn btn-small" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-small" onClick={save}>
              Save
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-small" onClick={startEdit}>
            Edit
          </button>
        )}
      </div>

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
            const isFree = i === FREE_INDEX;

            if (editing) {
              if (isFree) {
                return (
                  <div key={i} className="bingo-cell free">
                    FREE
                  </div>
                );
              }
              const { lo, hi } = columnBounds(col);
              return (
                <div key={i} className="bingo-cell editing">
                  <input
                    className="bingo-cell-input"
                    type="number"
                    inputMode="numeric"
                    min={lo}
                    max={hi}
                    value={draft[row]?.[col] ?? ""}
                    onChange={(e) => setCell(row, col, e.target.value)}
                  />
                </div>
              );
            }

            const value = bingoCard[row]?.[col];
            const colors = colorsByCell.get(i);
            const hlStyle = colors ? cellHighlightStyle(colors) : undefined;
            return (
              <div
                key={i}
                className={
                  "bingo-cell" +
                  (hlStyle ? " hl" : "") +
                  (isFree ? " free" : "")
                }
                style={hlStyle}
              >
                {isFree ? "FREE" : value}
              </div>
            );
          })}
        </div>
      </div>

      {editing && error && <p className="bingo-error">{error}</p>}

      {editing && !error && (
        <p className="muted small">
          Enter each column&apos;s numbers within its range; the center stays
          free. ballCalls update to 1–75 minus the card.
        </p>
      )}

      {!editing && highlights.length > 0 && (
        <p className="muted small bingo-legend">
          {highlights.map((h) => (
            <span key={h.name} className="bingo-legend-item">
              <span
                className="pattern-dot"
                style={{ background: h.color }}
                aria-hidden="true"
              />
              {h.name}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
