"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  parseReelStrips,
  parseReelStripsJson,
  groupReelStripSets,
  type ReelStrip,
  type ReelStripSet,
} from "@/lib/parseReelStrips";
import type { DbHandle, Facade, MatchedReelStop } from "@/lib/db";

/** Height of one symbol block, in px — used for the grid + payline math. */
const CELL = 44;
/** Min width per reel column so symbol names stay legible in the narrow panel. */
const MIN_COL = 58;
/** How many first reelStop positions physically land on the slot grid. */
const SLOT_REELS = 5;

export interface ReelStripHandle {
  /** Expand the viewer and land the first reels on these reelStop indices.
   *  `presentationId` (HPP / Type 2 candidates) lets FREE GAME auto-load that
   *  presentation's segment-2+ RNG into the free-game extractor. */
  openWithReelStops: (reelStops: number[], presentationId?: number) => void;
}

interface Props {
  /** Report whether a reelStrip .xml is loaded (enables the "slot" button). */
  onLoadedChange: (loaded: boolean) => void;
  /** Send the current offset-row positions to the DB amount search. */
  onSearch: (filter: string) => void;
  /** Open outcomes DB — lets FREE GAME pull segment-2+ RNG for HPP candidates,
   *  and powers the symbol search. */
  dbHandle: DbHandle | null;
  /** Bet lines from the open DB — the symbol search scopes to one of these. */
  facades: Facade[];
  /** Push a chosen reelStop into the main generated gaffe output (symbol-search
   *  results' "+" button). */
  onApply: (reelStops: number[]) => void;
}

const wrap = (n: number, len: number) => ((n % len) + len) % len;

/** A reel symbol counts as a scatter when its name contains "SCAT" (any case),
 *  matching Scat / SCAT / SCATTER. */
const isScatter = (s: string) => s.toUpperCase().includes("SCAT");

/**
 * Map an RNG value to the landing stop index for a reel.
 * - HPP (weighted .json): the RNG is 1-based (1..totalWeight) and wrapped into
 *   that range, then the symbol whose cumulative range (prevCum, cum] contains
 *   it is chosen — a value equal to a symbol's cumulative sum lands on the
 *   symbol that ends there (e.g. 131 → the stop ending at 131, not the next).
 * - APP (.xml, unweighted): direct positional wrap over the number of stops.
 */
function rngToIndex(rng: number, reel: ReelStrip): number {
  if (reel.cumWeights && reel.totalWeight) {
    const total = reel.totalWeight;
    const v = ((rng - 1) % total + total) % total + 1; // 1..total
    const cw = reel.cumWeights;
    for (let i = 0; i < cw.length; i++) if (v <= cw[i]) return i; // first cum >= v
    return cw.length - 1;
  }
  return wrap(rng, reel.symbols.length);
}

const ReelStripViewer = forwardRef<ReelStripHandle, Props>(
  function ReelStripViewer(
    { onLoadedChange, onSearch, dbHandle, facades, onApply },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const colRefs = useRef<(HTMLDivElement | null)[]>([]);
    // Pending imperative scroll target, applied after render via slotSeq effect.
    // `undefined` at an index means "leave that reel where it is".
    const scrollTargetRef = useRef<(number | undefined)[] | null>(null);

    const [open, setOpen] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);
    // All reelStrip sets parsed from the uploaded file (one file can hold
    // several sets of the same game), plus which one is active. `reels` below is
    // derived from the active set — the rest of the component works off `reels`.
    const [sets, setSets] = useState<ReelStripSet[] | null>(null);
    const [setIdx, setSetIdx] = useState(0);
    const reels = useMemo(
      () => (sets ? sets[setIdx]?.reels ?? null : null),
      [sets, setIdx]
    );
    const [error, setError] = useState<string | null>(null);
    const [rows, setRows] = useState(3);
    const [offset, setOffset] = useState(0);
    // Which position in the RNG stream the slot's reel stops start from. The
    // slot shows SLOT_REELS consecutive values beginning here (default 0 = the
    // start of the stream). Lets a candidate whose base-game stops are preceded
    // by preamble values in the RNG land the correct 5 values on the grid.
    const [slotStart, setSlotStart] = useState(0);
    // Index at the offset (landing) row, per reel.
    const [positions, setPositions] = useState<number[]>([]);
    // Raw RNG values (weighted strips), preserved so SEARCH matches the DB on
    // the real RNG rather than the cumulative-mapped stop index.
    const [rawValues, setRawValues] = useState<(number | undefined)[]>([]);
    const [slotSeq, setSlotSeq] = useState(0);

    // Free-game workflow -------------------------------------------------
    const fgInputRef = useRef<HTMLInputElement>(null);
    // Manual arm: enables FREE GAME even without 3+ scatters on the grid.
    const [freeGameArmed, setFreeGameArmed] = useState(false);
    // Whether the free-game section (upload + paste + results) is expanded.
    const [fgOpen, setFgOpen] = useState(false);
    // The uploaded APP-format free-game reel strips (positional / unweighted).
    const [fgReels, setFgReels] = useState<ReelStrip[] | null>(null);
    const [fgFileName, setFgFileName] = useState<string | null>(null);
    const [fgError, setFgError] = useState<string | null>(null);
    // Raw pasted number list (mixed reel stops + long RNG numbers). Auto-filled
    // from the loaded candidate's segment-2+ RNG when available, but freely
    // editable — clear it and paste custom data if the auto data is wrong.
    const [fgText, setFgText] = useState("");
    // PresentationId of the candidate loaded via `openWithReelStops` (HPP /
    // Type 2 only), so FREE GAME can pull that presentation's free-game RNG.
    const [fgPid, setFgPid] = useState<number | null>(null);
    // Status of an auto-load of segment-2+ RNG from the DB.
    const [fgAutoLoading, setFgAutoLoading] = useState(false);
    const [fgAutoNote, setFgAutoNote] = useState<string | null>(null);
    // Slot grid controls for the free-game viewer (mirrors the main viewer).
    const [fgRows, setFgRows] = useState(3);
    const [fgOffset, setFgOffset] = useState(1);

    // Symbol search -----------------------------------------------------
    // Whether the symbol-search section is expanded.
    const [symOpen, setSymOpen] = useState(false);
    // Selected target symbol per reel (null = any). Length tracks reels.length.
    const [symSel, setSymSel] = useState<(string | null)[]>([]);
    // Bet line (DB facadeId) the symbol search scopes to.
    const [symFacadeId, setSymFacadeId] = useState<number | null>(null);
    const [symSearching, setSymSearching] = useState(false);
    const [symError, setSymError] = useState<string | null>(null);
    const [symResults, setSymResults] = useState<MatchedReelStop[] | null>(null);
    const [symCapped, setSymCapped] = useState(false);
    const [symProgress, setSymProgress] = useState<{
      done: number;
      total: number;
      found: number;
    } | null>(null);
    const [symCopied, setSymCopied] = useState<string | null>(null);
    const [symApplied, setSymApplied] = useState<string | null>(null);
    // Bumped on every new symbol search / cancel; a running scan bails when it
    // sees its id is stale.
    const symRunId = useRef(0);

    // Default the symbol-search bet line to the first facade once the DB opens.
    useEffect(() => {
      if (symFacadeId == null && facades.length > 0)
        setSymFacadeId(facades[0].facadeId);
    }, [facades, symFacadeId]);

    // Distinct symbols per reel, for the dropdowns (sorted for scanning).
    const symOptions = useMemo(
      () =>
        (reels ?? []).map((r) =>
          Array.from(new Set(r.symbols)).sort((a, b) => a.localeCompare(b))
        ),
      [reels]
    );

    // Landing strip index shown in each slot column. The RNG value feeding
    // column i is rawValues[slotStart + i], so `slotStart` shifts which slice
    // of the stream lands on the grid (default 0 = the first values). Falls
    // back to the reel's own manual position when no RNG value covers it (fresh
    // upload, or a start position past the end of the stream).
    const slotLandings = useMemo(() => {
      if (!reels) return [] as number[];
      return reels.map((r, i) => {
        const rng = rawValues[slotStart + i];
        return rng != null ? rngToIndex(rng, r) : positions[i] ?? 0;
      });
    }, [reels, rawValues, slotStart, positions]);

    // Count scatter symbols visible in the slot area (rows × all reels). The
    // visible cell at row k of reel i is the strip index landing at `offset`
    // shifted up by k — the same window the scroll math (below) renders.
    const scatterCount = useMemo(() => {
      if (!reels) return 0;
      let count = 0;
      reels.forEach((r, i) => {
        const L = r.symbols.length;
        const landing = slotLandings[i] ?? 0;
        for (let k = 0; k < rows; k++) {
          if (isScatter(r.symbols[wrap(landing - offset + k, L)])) count++;
        }
      });
      return count;
    }, [reels, slotLandings, offset, rows]);

    const canFreeGame = freeGameArmed || scatterCount >= 3;

    // Split the pasted list into free-spin sets: keep only 1–2 digit numbers
    // (0–99 reel stops), drop the long RNG numbers, then chunk into groups of 5.
    const fgSets = useMemo(() => {
      const nums = fgText.split(/[^0-9]+/).filter(Boolean).map(Number);
      const small = nums.filter((n) => n <= 99);
      const sets: number[][] = [];
      for (let i = 0; i + 5 <= small.length; i += 5) sets.push(small.slice(i, i + 5));
      return sets;
    }, [fgText]);

    async function handleFgFile(file: File) {
      setFgError(null);
      try {
        const text = await file.text();
        const isJson = file.name.toLowerCase().endsWith(".json");
        // Weights (if the JSON carries any) are ignored — free-game stops are
        // a direct 0-based position into each reel's symbol list.
        const parsed = isJson ? parseReelStripsJson(text) : parseReelStrips(text);
        setFgReels(parsed);
        setFgFileName(file.name);
      } catch (e) {
        setFgReels(null);
        setFgFileName(null);
        setFgError(
          e instanceof Error
            ? e.message
            : "Failed to parse the free-game reel file (.xml / .json)."
        );
      }
    }

    // Pull this presentation's free-game RNG (segment index 2+) from the DB and
    // drop it into the paste box. `force` overwrites whatever is there; without
    // it, existing text (a manual paste or a previous auto-load) is left alone.
    async function autoFillFreeGame(force = false) {
      if (!dbHandle || fgPid == null) return;
      if (!force && fgText.trim() !== "") return;
      setFgAutoLoading(true);
      setFgAutoNote(null);
      try {
        const db = await import("@/lib/db");
        const rng = await db.getFreeGameRng(dbHandle, fgPid);
        if (rng.trim() === "") {
          setFgAutoNote(
            `No free-game segment (index 2+) for P#${fgPid} — paste data manually.`
          );
        } else {
          setFgText(rng);
          setFgAutoNote(`Loaded free-game RNG from P#${fgPid}, segment 2+.`);
        }
      } catch (e) {
        setFgAutoNote(
          e instanceof Error
            ? `Free-game auto-load failed: ${e.message}`
            : "Free-game auto-load failed — paste data manually."
        );
      } finally {
        setFgAutoLoading(false);
      }
    }

    // Open the free-game extractor and, for HPP candidates, auto-load the
    // segment-2+ RNG (only when the box is empty, so manual edits are kept).
    function openFreeGame() {
      setFgOpen(true);
      if (fgPid != null && fgText.trim() === "") void autoFillFreeGame();
    }

    // Symbol search: scan the selected bet line's RNG candidates and keep those
    // whose reel i shows the chosen symbol anywhere in its visible window (the
    // current rows × offset the grid renders), for every reel that has a choice.
    // The RNG value still drives the landing (offset) row; the match just looks
    // across the whole visible window rather than only that row.
    async function runSymbolSearch() {
      if (!dbHandle || !reels) return;
      if (symFacadeId == null) {
        setSymError("Select a bet line to search.");
        return;
      }
      const wanted = reels.map((_, i) => symSel[i] ?? null);
      if (!wanted.some((s) => s != null)) {
        setSymError("Choose at least one symbol in the dropdowns below the grid.");
        return;
      }

      // Snapshot the grid window so the predicate is stable for this run.
      const win = { rows, offset };
      const predicate = (values: number[]): boolean => {
        for (let i = 0; i < reels.length; i++) {
          const want = wanted[i];
          if (!want) continue;
          const rng = values[i];
          if (rng == null) return false;
          const reel = reels[i];
          const L = reel.symbols.length;
          const p = rngToIndex(rng, reel);
          let found = false;
          for (let k = 0; k < win.rows; k++) {
            if (reel.symbols[wrap(p - win.offset + k, L)] === want) {
              found = true;
              break;
            }
          }
          if (!found) return false;
        }
        return true;
      };

      const myId = ++symRunId.current;
      const stale = () => symRunId.current !== myId;
      setSymSearching(true);
      setSymError(null);
      setSymResults(null);
      setSymCapped(false);
      setSymProgress({ done: 0, total: 0, found: 0 });
      try {
        const db = await import("@/lib/db");
        const { results, capped } = await db.findReelStopsMatching(
          dbHandle,
          symFacadeId,
          predicate,
          {
            maxResults: 100,
            onProgress: (done, total, found) => {
              if (!stale()) setSymProgress({ done, total, found });
            },
            shouldStop: stale,
          }
        );
        if (stale()) return;
        setSymResults(results);
        setSymCapped(capped);
      } catch (e) {
        if (!stale())
          setSymError(e instanceof Error ? e.message : "Symbol search failed.");
      } finally {
        if (!stale()) {
          setSymSearching(false);
          setSymProgress(null);
        }
      }
    }

    function cancelSymbolSearch() {
      symRunId.current++;
      setSymSearching(false);
      setSymProgress(null);
    }

    async function copySym(text: string) {
      try {
        await navigator.clipboard.writeText(text);
        setSymCopied(text);
        setTimeout(() => setSymCopied(null), 1200);
      } catch {
        /* ignore */
      }
    }

    function applySym(rs: number[], text: string) {
      onApply(rs);
      setSymApplied(text);
      setTimeout(() => setSymApplied(null), 1200);
    }

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
        // A file may hold several reelStrip sets of the same game; load the
        // first and let the user switch sets from the selector.
        const grouped = groupReelStripSets(parsed);
        const first = grouped[0].reels;
        const pos = first.map(() => 0);
        setSets(grouped);
        setSetIdx(0);
        setPositions(pos);
        setRawValues(first.map(() => undefined));
        setSlotStart(0);
        setFileName(file.name);
        setOpen(true);
        onLoadedChange(true);
        requestScroll(pos);
        // A new strip changes the symbol set — clear any symbol search state.
        setSymSel(first.map(() => null));
        setSymResults(null);
        setSymError(null);
        setSymProgress(null);
      } catch (e) {
        setSets(null);
        setSetIdx(0);
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

    // Switch the active reelStrip set: reset the grid landing and any symbol
    // search state to match the newly selected set's reels.
    function selectSet(idx: number) {
      if (!sets || idx === setIdx || !sets[idx]) return;
      const r = sets[idx].reels;
      const pos = r.map(() => 0);
      setSetIdx(idx);
      setPositions(pos);
      setRawValues(r.map(() => undefined));
      requestScroll(pos);
      setSymSel(r.map(() => null));
      setSymResults(null);
      setSymError(null);
      setSymProgress(null);
    }

    // Land an RNG candidate on the slot grid. Shared by the imperative handle
    // (used by the DB finders' "slot" buttons) and the symbol-search results.
    function loadReelStops(reelStops: number[], presentationId?: number) {
      if (!reels) return;
      // A fresh candidate: remember its presentation for FREE GAME auto-load
      // and clear any previous free-game paste/notes so it re-fills cleanly.
      setFgPid(presentationId ?? null);
      setFgText("");
      setFgAutoNote(null);
      setFgOpen(false);
      // Carry the FULL candidate into the viewer (every reelStop value), so
      // the readout and SEARCH reflect all reels — not just the first 5.
      // Each RNG value is mapped to a landing stop index: cumulative weights
      // for HPP (.json) strips, direct positional wrap for APP (.xml).
      const pos = reelStops.map((v, i) =>
        reels[i] ? rngToIndex(v ?? 0, reels[i]) : v
      );
      setOpen(true);
      setPositions(pos);
      // Keep the current RNG-start window — it persists across candidates and
      // resets only when a new reelStrip file is loaded.
      // Preserve the raw RNG values so SEARCH can send them for HPP strips.
      setRawValues(reelStops.slice());
      // Only the first SLOT_REELS reels physically land on the slot grid; the
      // remaining values stay in `positions` (leave those reels untouched).
      // Honour the persisted RNG-start window: column i lands on the value at
      // reelStops[slotStart + i], not the 1:1 position.
      requestScroll(
        reels.map((r, i) => {
          if (i >= SLOT_REELS) return undefined;
          const rng = reelStops[slotStart + i];
          return rng != null ? rngToIndex(rng, r) : undefined;
        })
      );
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        })
      );
    }

    useImperativeHandle(ref, () => ({
      openWithReelStops: loadReelStops,
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
      // RNG, so make SEARCH use a representative raw value: the stop's own
      // cumulative sum (its upper boundary), which maps back to this stop under
      // the 1-based (prevCum, cum] rule.
      const reel = reels[i];
      if (reel.cumWeights) {
        const rngRep = reel.cumWeights[idx];
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

    // Move the slot's RNG window: land the SLOT_REELS values starting at the new
    // position on the grid (clamped to the available stream).
    function changeSlotStart(v: number) {
      const max = Math.max(0, rawValues.length - 1);
      setSlotStart(Math.max(0, Math.min(max, Math.floor(v || 0))));
    }

    // Re-land the grid whenever the RNG window moves.
    useEffect(() => {
      if (!reels) return;
      requestScroll(
        slotLandings.map((v, i) => (i < SLOT_REELS ? v : undefined))
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slotStart]);

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

            {sets && sets.length > 1 && (
              <div className="db-controls">
                <label className="db-field db-field-grow">
                  <span className="db-label">
                    reelStrip set ({sets.length} in file)
                  </span>
                  <select
                    className="select"
                    value={setIdx}
                    onChange={(e) => selectSet(Number(e.target.value))}
                  >
                    {sets.map((s, i) => (
                      <option key={i} value={i}>
                        {s.name ? s.name : `Set ${i + 1}`} — {s.reels.length}{" "}
                        reels
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

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

                  <label className="db-field">
                    <span className="db-label">RNG start (slot)</span>
                    <input
                      className="select reelstrip-rows"
                      type="number"
                      min={0}
                      max={Math.max(0, rawValues.length - 1)}
                      value={slotStart}
                      onChange={(e) => changeSlotStart(Number(e.target.value))}
                      title="Which position in the RNG the slot's reel stops start from (default 0). The grid shows the values beginning at this position (e.g. 1 = start from the 2nd RNG value)."
                    />
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
                                copy === 1 && j === slotLandings[i];
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

                <div className="sym-search">
                  <button
                    type="button"
                    className="panel-title panel-title-toggle sym-search-toggle"
                    onClick={() => setSymOpen((v) => !v)}
                    aria-expanded={symOpen}
                  >
                    <span>
                      {symOpen ? "▾" : "▸"} Search by symbol — matches anywhere
                      in the visible grid ({rows} row{rows === 1 ? "" : "s"})
                    </span>
                  </button>

                  {symOpen && (
                  <>
                  <div className="sym-dropdowns">
                    {reels.map((r, i) => (
                      <label key={i} className="db-field">
                        <span className="db-label">{r.name}</span>
                        <select
                          className="select"
                          value={symSel[i] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            setSymSel((prev) => {
                              const next = reels.map(
                                (_, j) => prev[j] ?? null
                              );
                              next[i] = v;
                              return next;
                            });
                          }}
                        >
                          <option value="">(any)</option>
                          {symOptions[i]?.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>

                  <div className="sym-search-controls">
                    <label className="db-field db-field-grow">
                      <span className="db-label">Facade (bet line)</span>
                      <select
                        className="select"
                        value={symFacadeId ?? ""}
                        onChange={(e) =>
                          setSymFacadeId(
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      >
                        {facades.map((f) => (
                          <option key={f.facadeId} value={f.facadeId}>
                            {f.facadeKey}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void runSymbolSearch()}
                      disabled={symSearching}
                      title="Find RNG whose reels show the selected symbols anywhere in the visible grid (any amount, this bet line)"
                    >
                      {symSearching ? "Searching…" : "Search symbols"}
                    </button>
                    {symSearching && (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={cancelSymbolSearch}
                      >
                        Cancel
                      </button>
                    )}
                    {(symSel.some((s) => s) || symResults) && (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => {
                          setSymSel(reels.map(() => null));
                          setSymResults(null);
                          setSymError(null);
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {symProgress && (
                    <p className="muted small">
                      Scanned {symProgress.done} / {symProgress.total} awards ·{" "}
                      {symProgress.found} found…
                    </p>
                  )}
                  {symError && <p className="error">{symError}</p>}

                  {symResults &&
                    (symResults.length === 0 ? (
                      <p className="muted small">
                        No RNG in this bet line shows those symbols in the
                        visible grid.
                      </p>
                    ) : (
                      <>
                        <p className="muted small">
                          {symResults.length} match
                          {symResults.length === 1 ? "" : "es"}
                          {symCapped ? " (first 100)" : ""}:
                        </p>
                        <div className="reelstop-list">
                          {symResults.map((m, i) => {
                            const text = `[${m.values.join(",")}]`;
                            // Full RNG feeds copy/apply/slot; show only a few
                            // leading values inline so the row stays compact.
                            const preview =
                              m.values.length > 8
                                ? `[${m.values.slice(0, 8).join(",")}, …+${
                                    m.values.length - 8
                                  }]`
                                : text;
                            return (
                              <div key={i} className="reelstop sym-result">
                                <div className="sym-result-meta">
                                  <span
                                    className="reelstop-pid"
                                    title="Award amount"
                                  >
                                    amt {m.amount.toLocaleString()}
                                  </span>
                                  <span
                                    className="reelstop-pid"
                                    title="AwardId"
                                  >
                                    A#{m.awardId}
                                  </span>
                                  {m.presentationId != null && (
                                    <span
                                      className="reelstop-pid"
                                      title="PresentationId"
                                    >
                                      P#{m.presentationId}
                                    </span>
                                  )}
                                </div>
                                <span
                                  className="reelstop-vals"
                                  title={text}
                                >
                                  {preview}
                                </span>
                                <button
                                  type="button"
                                  className="reelstop-btn reelstop-apply"
                                  onClick={() => applySym(m.values, text)}
                                  title="Use in gaffe result"
                                >
                                  {symApplied === text ? "✓" : "+"}
                                </button>
                                <button
                                  type="button"
                                  className="reelstop-btn"
                                  onClick={() => copySym(text)}
                                  title="Copy reelStops"
                                >
                                  {symCopied === text ? "✓" : "copy"}
                                </button>
                                <button
                                  type="button"
                                  className="reelstop-btn reelstop-slot"
                                  onClick={() =>
                                    loadReelStops(m.values, m.presentationId)
                                  }
                                  title="Land this RNG on the slot grid above"
                                >
                                  slot
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ))}
                  </>
                  )}
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
                  <div className="reelstrip-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onSearch(filterStr)}
                      title="Copy these positions into the DB amount search filter and search"
                    >
                      SEARCH
                    </button>
                    <button
                      type="button"
                      className={"btn" + (canFreeGame ? " free-game-armed" : "")}
                      disabled={!canFreeGame}
                      onClick={openFreeGame}
                      title={
                        canFreeGame
                          ? "Open the free-game symbol extractor"
                          : "Land 3+ scatters on the grid, or arm manually, to enable"
                      }
                    >
                      FREE GAME
                    </button>
                    <label className="free-game-arm" title="Enable FREE GAME without 3+ scatters">
                      <input
                        type="checkbox"
                        checked={freeGameArmed}
                        onChange={(e) => setFreeGameArmed(e.target.checked)}
                      />
                      arm
                    </label>
                  </div>
                </div>

                <p className="muted small">
                  Scatters in view: {scatterCount}
                  {scatterCount >= 3 ? " — FREE GAME triggered" : ""}
                </p>

                {fgOpen && (
                  <div className="free-game">
                    <div className="panel-title">
                      Free game — symbol extractor
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => setFgOpen(false)}
                      >
                        Close
                      </button>
                    </div>

                    {fgPid != null && (
                      <div className="upload-row">
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={fgAutoLoading}
                          onClick={() => void autoFillFreeGame(true)}
                          title="Reload this presentation's segment-2+ RNG (overwrites the box)"
                        >
                          {fgAutoLoading
                            ? "Loading…"
                            : "Auto-load segment 2+ RNG"}
                        </button>
                        <span className="reelstop-pid" title="PresentationId">
                          P#{fgPid}
                        </span>
                        {fgAutoNote && (
                          <span className="muted small">{fgAutoNote}</span>
                        )}
                      </div>
                    )}

                    <div className="upload-row">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => fgInputRef.current?.click()}
                      >
                        Choose free-game reels .xml / .json…
                      </button>
                      <input
                        ref={fgInputRef}
                        type="file"
                        accept=".xml,.json,text/xml,application/xml,application/json"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleFgFile(f);
                          e.target.value = "";
                        }}
                      />
                      {fgFileName && (
                        <span className="loaded-name">{fgFileName}</span>
                      )}
                    </div>

                    {fgError && <p className="error">{fgError}</p>}

                    <textarea
                      className="ws-textarea"
                      value={fgText}
                      onChange={(e) => setFgText(e.target.value)}
                      placeholder="Paste the free-game data (comma/space separated). 5 consecutive 1–2 digit numbers make one spin; long RNG numbers are ignored."
                      spellCheck={false}
                    />

                    {!fgReels && fgText.trim() !== "" && (
                      <p className="muted small">
                        Upload the free-game reel file above to resolve symbols.
                      </p>
                    )}

                    {fgReels && fgSets.length > 0 && (
                      <>
                        <div className="db-controls">
                          <div className="db-field">
                            <span className="db-label">Reels (columns)</span>
                            <div className="db-amount">{fgReels.length}</div>
                          </div>
                          <label className="db-field">
                            <span className="db-label">Rows</span>
                            <input
                              className="select reelstrip-rows"
                              type="number"
                              min={1}
                              max={50}
                              value={fgRows}
                              onChange={(e) => {
                                const n = Math.max(
                                  1,
                                  Math.min(50, Math.floor(Number(e.target.value) || 1))
                                );
                                setFgRows(n);
                                if (fgOffset > n - 1) setFgOffset(n - 1);
                              }}
                            />
                          </label>
                          <label className="db-field">
                            <span className="db-label">Offset (landing row)</span>
                            <select
                              className="select"
                              value={fgOffset}
                              onChange={(e) => setFgOffset(Number(e.target.value))}
                            >
                              {Array.from({ length: fgRows }, (_, i) => i).map(
                                (i) => (
                                  <option key={i} value={i}>
                                    {i}
                                  </option>
                                )
                              )}
                            </select>
                          </label>
                        </div>

                        <div className="free-game-count">
                          {fgSets.length} free spin
                          {fgSets.length === 1 ? "" : "s"}
                        </div>

                        <div className="free-game-sets">
                          {fgSets.map((set, si) => {
                            // Landing strip index per reel for this spin.
                            const landings = fgReels.map((_, j) => set[j] ?? 0);
                            // Count scatters visible in this spin's slot window.
                            let scat = 0;
                            fgReels.forEach((r, j) => {
                              const L = r.symbols.length;
                              for (let k = 0; k < fgRows; k++) {
                                if (
                                  isScatter(
                                    r.symbols[wrap(landings[j] - fgOffset + k, L)]
                                  )
                                )
                                  scat++;
                              }
                            });
                            return (
                              <div key={si} className="free-game-set">
                                <div className="free-game-set-head">
                                  <span className="reelstop-pid">Set {si + 1}</span>
                                  <code className="free-game-seq">
                                    {set.join(", ")}
                                  </code>
                                  {scat >= 2 && (
                                    <span className="free-game-scat-badge">
                                      {scat} SCAT
                                    </span>
                                  )}
                                </div>
                                <div
                                  className={
                                    "fg-grid" + (scat >= 2 ? " has-scatter" : "")
                                  }
                                  style={{
                                    gridTemplateColumns: `repeat(${fgReels.length}, minmax(0, 1fr))`,
                                  }}
                                >
                                  {fgReels.map((r, j) => (
                                    <div key={`h${j}`} className="fg-grid-head">
                                      {r.name}
                                    </div>
                                  ))}
                                  {Array.from({ length: fgRows }, (_, k) => k).map(
                                    (k) =>
                                      fgReels.map((r, j) => {
                                        const L = r.symbols.length;
                                        const sym =
                                          r.symbols[wrap(landings[j] - fgOffset + k, L)];
                                        const landed = k === fgOffset;
                                        const scatCell = isScatter(sym);
                                        return (
                                          <div
                                            key={`${k}-${j}`}
                                            className={
                                              "fg-cell" +
                                              (landed ? " landed" : "") +
                                              (scatCell ? " scat" : "")
                                            }
                                            title={sym}
                                          >
                                            {sym}
                                          </div>
                                        );
                                      })
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }
);

export default ReelStripViewer;
