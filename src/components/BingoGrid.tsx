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

/**
 * Parse a pasted card line into a string draft. Accepts any 25 numbers (e.g.
 * `[[4,26,33,57,70],[5,17,38,59,72],…]`, row-major B/I/N/G/O) — the center
 * (index 12) is forced to the free space regardless of what's pasted there.
 */
function fromPaste(
  text: string
): { ok: true; draft: string[][] } | { ok: false; error: string } {
  const nums = text
    .split(/[^0-9]+/)
    .filter((t) => t !== "")
    .map(Number);
  if (nums.length !== CELL_COUNT) {
    return {
      ok: false,
      error: `Expected ${CELL_COUNT} numbers (got ${nums.length}).`,
    };
  }
  const draft: string[][] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: string[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const i = r * GRID_SIZE + c;
      row.push(i === FREE_INDEX ? "" : String(nums[i]));
    }
    draft.push(row);
  }
  return { ok: true, draft };
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
  const [paste, setPaste] = useState("");

  function startEdit() {
    setDraft(toDraft(bingoCard));
    setError(null);
    setPaste("");
    setEditing(true);
  }

  function applyPaste() {
    const res = fromPaste(paste);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDraft(res.draft);
    setPaste("");
    setError(null);
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

      {editing && (
        <div className="bingo-paste">
          <textarea
            className="ws-textarea"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste a card, e.g. [[4, 26, 33, 57, 70],[5, 17, 38, 59, 72],[12, 16, 40, 47, 61],[9, 21, 31, 49, 65],[3, 24, 39, 60, 67]]"
            spellCheck={false}
            rows={2}
          />
          <button
            type="button"
            className="btn btn-small"
            onClick={applyPaste}
            disabled={paste.trim() === ""}
          >
            Fill from paste
          </button>
        </div>
      )}

      {editing && error && <p className="bingo-error">{error}</p>}

      {editing && !error && (
        <p className="muted small">
          Enter each column&apos;s numbers within its range, or paste a whole card
          line above; the center (12th cell) stays free. ballCalls update to 1–75
          minus the card.
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
