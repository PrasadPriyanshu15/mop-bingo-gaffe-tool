"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  parseReelStrips,
  parseReelStripsJson,
  type ReelStrip,
} from "@/lib/parseReelStrips";

/** Height of one symbol block, in px — used for the grid + payline math. */
const CELL = 44;
/** Min width per reel column so symbol names stay legible in the narrow panel. */
const MIN_COL = 58;
/** How many first reelStop positions physically land on the slot grid. */
const SLOT_REELS = 5;

export interface ReelStripHandle {
  /** Expand the viewer and land the first reels on these reelStop indices. */
  openWithReelStops: (reelStops: number[]) => void;
}

interface Props {
  /** Report whether a reelStrip .xml is loaded (enables the "slot" button). */
  onLoadedChange: (loaded: boolean) => void;
  /** Send the current offset-row positions to the DB amount search. */
  onSearch: (filter: string) => void;
}

const wrap = (n: number, len: number) => ((n % len) + len) % len;

/**
 * Map an RNG value to the landing stop index for a reel.
 * - HPP (weighted .json): the RNG is wrapped over the reel's total weight, then
 *   the symbol whose cumulative range [prevCum, cum) contains it is chosen.
 * - APP (.xml, unweighted): direct positional wrap over the number of stops.
 */
function rngToIndex(rng: number, reel: ReelStrip): number {
  if (reel.cumWeights && reel.totalWeight) {
    const v = wrap(rng, reel.totalWeight);
    const cw = reel.cumWeights;
    for (let i = 0; i < cw.length; i++) if (v < cw[i]) return i; // first cum > v
    return cw.length - 1;
  }
  return wrap(rng, reel.symbols.length);
}

const ReelStripViewer = forwardRef<ReelStripHandle, Props>(
  function ReelStripViewer({ onLoadedChange, onSearch }, ref) {
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const colRefs = useRef<(HTMLDivElement | null)[]>([]);
    // Pending imperative scroll target, applied after render via slotSeq effect.
    // `undefined` at an index means "leave that reel where it is".
    const scrollTargetRef = useRef<(number | undefined)[] | null>(null);

    const [open, setOpen] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);
    const [reels, setReels] = useState<ReelStrip[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [rows, setRows] = useState(3);
    const [offset, setOffset] = useState(0);
    // Index at the offset (landing) row, per reel.
    const [positions, setPositions] = useState<number[]>([]);
    // Raw RNG values (weighted strips), preserved so SEARCH matches the DB on
    // the real RNG rather than the cumulative-mapped stop index.
    const [rawValues, setRawValues] = useState<(number | undefined)[]>([]);
    const [slotSeq, setSlotSeq] = useState(0);

    // Apply a requested imperative scroll once the columns are in the DOM.
    useEffect(() => {
      const target = scrollTargetRef.current;
      if (!target || !reels) return;
      scrollTargetRef.current = null;
      reels.forEach((r, i) => {
        const el = colRefs.current[i];
        if (!el) return;
        const t = target[i];
        if (t == null) return; // this reel is not being landed this time
        const L = r.symbols.length;
        // Strip is rendered 3× (see below); land on the middle copy so there is
        // room to scroll either way.
        el.scrollTop = (L + wrap(t, L) - offset) * CELL;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slotSeq]);

    function requestScroll(pos: (number | undefined)[]) {
      scrollTargetRef.current = pos;
      setSlotSeq((s) => s + 1);
    }

    async function handleFile(file: File) {
      setError(null);
      try {
        const text = await file.text();
        const isJson = file.name.toLowerCase().endsWith(".json");
        const parsed = isJson
          ? parseReelStripsJson(text)
          : parseReelStrips(text);
        const pos = parsed.map(() => 0);
        setReels(parsed);
        setPositions(pos);
        setRawValues(parsed.map(() => undefined));
        setFileName(file.name);
        setOpen(true);
        onLoadedChange(true);
        requestScroll(pos);
      } catch (e) {
        setReels(null);
        setPositions([]);
        setRawValues([]);
        onLoadedChange(false);
        setError(
          e instanceof Error
            ? e.message
            : "Failed to parse the reelStrip file (.xml / .json)."
        );
      }
    }

    useImperativeHandle(ref, () => ({
      openWithReelStops(reelStops: number[]) {
        if (!reels) return;
        // Carry the FULL candidate into the viewer (every reelStop value), so
        // the readout and SEARCH reflect all reels — not just the first 5.
        // Each RNG value is mapped to a landing stop index: cumulative weights
        // for HPP (.json) strips, direct positional wrap for APP (.xml).
        const pos = reelStops.map((v, i) =>
          reels[i] ? rngToIndex(v ?? 0, reels[i]) : v
        );
        setOpen(true);
        setPositions(pos);
        // Preserve the raw RNG values so SEARCH can send them for HPP strips.
        setRawValues(reelStops.slice());
        // Only the first SLOT_REELS reels physically land on the slot grid; the
        // remaining values stay in `positions` (leave those reels untouched).
        requestScroll(pos.map((v, i) => (i < SLOT_REELS ? v : undefined)));
        requestAnimationFrame(() =>
          panelRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          })
        );
      },
    }));

    // Read back which strip index sits on the offset row after a manual scroll.
    function onReelScroll(i: number) {
      const el = colRefs.current[i];
      if (!el || !reels) return;
      const L = reels[i].symbols.length;
      const raw = Math.round(el.scrollTop / CELL);
      const idx = wrap(raw + offset, L);
      setPositions((prev) =>
        prev[i] === idx ? prev : prev.map((v, j) => (j === i ? idx : v))
      );
      // For weighted strips a manually chosen stop no longer maps to the loaded
      // RNG, so make SEARCH use a representative raw value: the stop's lower
      // cumulative boundary.
      const reel = reels[i];
      if (reel.cumWeights) {
        const rngRep = idx === 0 ? 0 : reel.cumWeights[idx - 1];
        setRawValues((prev) =>
          prev[i] === rngRep ? prev : prev.map((v, j) => (j === i ? rngRep : v))
        );
      }
    }

    function changeRows(v: number) {
      const n = Math.max(1, Math.min(50, Math.floor(v || 1)));
      setRows(n);
      if (offset > n - 1) {
        setOffset(n - 1);
        requestScroll(positions);
      }
    }

    function changeOffset(v: number) {
      setOffset(v);
      // Keep the same reelStop values landing on the new offset row.
      requestScroll(positions);
    }

    // SEARCH sends every reel position to the DB amount search — not just the
    // first 5 that land on the slot grid. For HPP (weighted) strips the DB is
    // matched against raw RNG values, so send those instead of the stop index.
    const weighted = !!reels?.some((r) => r.cumWeights);
    const filterStr = (
      weighted
        ? reels!.map((_, i) => rawValues[i] ?? positions[i])
        : positions
    ).join(",");

    return (
      <div className="panel" ref={panelRef}>
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
                Choose reelStrip .xml / .json…
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".xml,.json,text/xml,application/xml,application/json"
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
                      onChange={(e) => changeOffset(Number(e.target.value))}
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

                    <div className="reel-strips" style={{ height: rows * CELL }}>
                      <div
                        className="reel-payline"
                        style={{ top: offset * CELL, height: CELL }}
                      />
                      {reels.map((r, i) => (
                        <div
                          key={i}
                          className="reel-col"
                          style={{ height: rows * CELL }}
                          ref={(el) => {
                            colRefs.current[i] = el;
                          }}
                          onScroll={() => onReelScroll(i)}
                        >
                          {[0, 1, 2].map((copy) =>
                            r.symbols.map((s, j) => {
                              const landed =
                                copy === 1 && j === positions[i];
                              return (
                                <div
                                  key={copy * r.symbols.length + j}
                                  className={
                                    "reel-cell" + (landed ? " landed" : "")
                                  }
                                  style={{ height: CELL }}
                                  title={s}
                                >
                                  {s}
                                </div>
                              );
                            })
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="reelstrip-result">
                  <div className="db-field">
                    <span className="db-label">
                      reelStop @ offset (all reels)
                    </span>
                    <code className="result-val">
                      [{positions.join(", ")}]
                    </code>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onSearch(filterStr)}
                    title="Copy these positions into the DB amount search filter and search"
                  >
                    SEARCH
                  </button>
                </div>

                <p className="muted small">
                  {/* Scroll a reel to move it; row {offset} (highlighted) is the
                  landing row. SEARCH sends the positions to the DB amount
                  search filter. */}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    );
  }
);

export default ReelStripViewer;
