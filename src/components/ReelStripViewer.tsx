"use client";

import { useRef, useState } from "react";
import { parseReelStrips, type ReelStrip } from "@/lib/parseReelStrips";

/** Height of one symbol block, in px — used for the grid + payline math. */
const CELL = 44;
/** Min width per reel column so symbol names stay legible in the narrow panel. */
const MIN_COL = 58;

/**
 * reelStrip viewer: upload a reelStrip .xml and see the reels as a slot-style
 * grid. Columns are fixed to the number of reels in the file; rows (the visible
 * window) and the offset (which row is the landing row) are user inputs. Each
 * reel scrolls independently so its strip can be moved under the landing row.
 */
export default function ReelStripViewer() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reels, setReels] = useState<ReelStrip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState(3);
  const [offset, setOffset] = useState(0);

  async function handleFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseReelStrips(text);
      setReels(parsed);
      setFileName(file.name);
      setOpen(true);
    } catch (e) {
      setReels(null);
      setError(
        e instanceof Error ? e.message : "Failed to parse the reelStrip XML."
      );
    }
  }

  function changeRows(v: number) {
    const n = Math.max(1, Math.min(50, Math.floor(v || 1)));
    setRows(n);
    if (offset > n - 1) setOffset(n - 1);
  }

  const colHeight = rows * CELL;

  return (
    <div className="panel">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{open ? "▾" : "▸"} reelStrip viewer</span>
        <span className="muted small">slot grid</span>
      </button>

      {open && (
        <div className="reelstrip">
          <div className="upload-row">
            <button
              type="button"
              className="btn"
              onClick={() => inputRef.current?.click()}
            >
              Choose reelStrip .xml…
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
            {fileName && <span className="loaded-name">{fileName}</span>}
          </div>

          {error && <p className="error">{error}</p>}

          {reels && (
            <>
              <div className="db-controls">
                <div className="db-field">
                  <span className="db-label">Reels (columns)</span>
                  <div className="db-amount">{reels.length}</div>
                </div>

                <label className="db-field">
                  <span className="db-label">Rows</span>
                  <input
                    className="select reelstrip-rows"
                    type="number"
                    min={1}
                    max={50}
                    value={rows}
                    onChange={(e) => changeRows(Number(e.target.value))}
                  />
                </label>

                <label className="db-field">
                  <span className="db-label">Offset (landing row)</span>
                  <select
                    className="select"
                    value={offset}
                    onChange={(e) => setOffset(Number(e.target.value))}
                  >
                    {Array.from({ length: rows }, (_, i) => i).map((i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="reelstrip-scroll">
                <div
                  className="reelstrip-inner"
                  style={{ minWidth: reels.length * MIN_COL }}
                >
                  <div className="reelstrip-head">
                    {reels.map((r, i) => (
                      <div key={i} className="reelstrip-head-cell">
                        {r.name}
                      </div>
                    ))}
                  </div>

                  <div className="reel-strips" style={{ height: colHeight }}>
                    <div
                      className="reel-payline"
                      style={{ top: offset * CELL, height: CELL }}
                    />
                    {reels.map((r, i) => (
                      <div
                        key={i}
                        className="reel-col"
                        style={{ height: colHeight }}
                      >
                        {r.symbols.map((s, j) => (
                          <div
                            key={j}
                            className="reel-cell"
                            style={{ height: CELL }}
                            title={s}
                          >
                            {s}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <p className="muted small">
                Scroll a reel to move its symbols; row {offset} (highlighted) is
                the landing row.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
