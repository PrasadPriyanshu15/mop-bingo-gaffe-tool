"use client";

import { useMemo, useRef, useState } from "react";
import XmlUpload from "@/components/XmlUpload";
import BetLevelSelect from "@/components/BetLevelSelect";
import PatternSelect from "@/components/PatternSelect";
import BingoGrid from "@/components/BingoGrid";
import InstanceList from "@/components/InstanceList";
import SelectionSummary, {
  type SelectedRow,
} from "@/components/SelectionSummary";                                       
import GaffeResult from "@/components/GaffeResult";
import ReelStopFinder, { type Win } from "@/components/ReelStopFinder";
import DbAmountSearch, {                     
  type DbAmountSearchHandle,                                         
} from "@/components/DbAmountSearch";                                                   
import ReelStripViewer, {
  type ReelStripHandle,                                     
} from "@/components/ReelStripViewer";
import ResultJson from "@/components/ResultJson";
import PaytableIssues from "@/components/PaytableIssues";
import WebsocketCompare from "@/components/WebsocketCompare";
import { validatePaytable } from "@/lib/validatePaytable";
import type { DbHandle, Facade } from "@/lib/db";
import {
  containedPatterns,
  cardBallCallBase,
  highlightColor,
} from "@/lib/patterns";
import {
  buildBallCalls,
  layoutFromOrder,
  patternDaubNumbers,
  type Daub,
} from "@/lib/gaffe";
import { evaluateInGame, refineCompletionTiers } from "@/lib/evaluate";
import { SAMPLE_GAFFE } from "@/lib/sample";
import type { MatchingPattern, Pattern, Paytable59 } from "@/lib/types";

export default function Home() {
  const [data, setData] = useState<Paytable59 | null>(null);
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const [betKey, setBetKey] = useState<string | null>(null);
  const [patternId, setPatternId] = useState<number | null>(null);
  // Per-pattern selection threshold: the lowest chosen ballQty. Every instance
  // with ballQty >= threshold is selected (selecting one cascades to higher).
  const [thresholds, setThresholds] = useState<Map<number, number>>(new Map());
  // reelStops shown in the generated gaffe output. Empty until the user applies
  // a candidate from the DB finder (the "+" button on a looked-up reelStop);
  // while empty the result shows only bingoCard + ballCalls.
  const [reelStops, setReelStops] = useState<number[]>([]);
  // The bingo card driving daubs and ballCalls. Starts from the sample (cloned
  // so the shared constant is never mutated) and is editable in the card panel.
  const [bingoCard, setBingoCard] = useState<number[][]>(() =>
    SAMPLE_GAFFE.bingoCard.map((r) => [...r])
  );
  // The opened outcomes DB, hoisted so the left-column custom search can query
  // the same handle the finder opened.
  const [dbHandle, setDbHandle] = useState<DbHandle | null>(null);
  const [dbFacades, setDbFacades] = useState<Facade[]>([]);
  // Coordination for the reelStrip viewer <-> result rows <-> DB amount search.
  const [reelStripLoaded, setReelStripLoaded] = useState(false);
  const reelStripRef = useRef<ReelStripHandle>(null);
  const dbSearchRef = useRef<DbAmountSearchHandle>(null);

  const paytable = useMemo(
    () => data?.paytables.find((p) => p.facadeKey === betKey) ?? null,
    [data, betKey]
  );

  // Upload-time validation report (free-space placement + EvaluationPriority).
  const issues = useMemo(
    () => (data ? validatePaytable(data) : null),
    [data]
  );

  const selectedPattern = useMemo(
    () => data?.patterns.find((p) => p.id === patternId) ?? null,
    [data, patternId]
  );

  // Patterns actually referenced by the selected bet line — the pattern picker is
  // scoped to these (only the patterns present in that facade), not every pattern
  // the file defines.
  const betLinePatterns = useMemo(() => {
    if (!data || !paytable) return [];
    const ids = new Set(paytable.entries.map((e) => e.patternId));
    return data.patterns.filter((p) => ids.has(p.id));
  }, [data, paytable]);

  // Geometrically-contained ("also won") sub-patterns only matter for
  // AllPatternsPaid. HighestPriorityPaid games pay a single pattern and define
  // thousands of full-outcome patterns, so a selected outcome would "contain"
  // hundreds of them — computing and rendering an InstanceList for each would
  // freeze the page. Skip containment entirely for those games.
  const contained = useMemo(
    () =>
      selectedPattern && data && data.evaluationType !== "HighestPriorityPaid"
        ? containedPatterns(selectedPattern, data.patterns)
        : [],
    [selectedPattern, data]
  );

  // Patterns to color/list: the browsed pattern first (if any), then every other
  // forced (thresholded) pattern in insertion order — e.g. a combination's
  // members. Deduped; the index drives both the card color and the "Pattern N"
  // label so the two always agree.
  const highlightPatterns = useMemo<Pattern[]>(() => {
    if (!data) return [];
    const list: Pattern[] = [];
    const seen = new Set<number>();
    const push = (pid: number) => {
      if (seen.has(pid)) return;
      const p = data.patterns.find((x) => x.id === pid);
      if (p) {
        list.push(p);
        seen.add(pid);
      }
    };
    if (selectedPattern) push(selectedPattern.id);
    for (const pid of thresholds.keys()) push(pid);
    return list;
  }, [data, selectedPattern, thresholds]);

  const bingoHighlights = useMemo(
    () =>
      highlightPatterns.map((p, i) => ({
        name: p.name,
        cells: p.cells,
        color: highlightColor(i),
      })),
    [highlightPatterns]
  );

  // Per card-number -> the colors of the pattern(s) that force it (a shared
  // number carries several). Colors the result's card cells and ballCalls.
  const daubColors = useMemo(() => {
    const map = new Map<number, string[]>();
    highlightPatterns.forEach((p, i) => {
      const color = highlightColor(i);
      for (const n of patternDaubNumbers(p, bingoCard)) {
        const arr = map.get(n);
        if (arr) arr.push(color);
        else map.set(n, [color]);
      }
    });
    return map;
  }, [highlightPatterns, bingoCard]);

  /** Payable rows for a pattern id in the active bet level (ballQty asc). */
  function entriesFor(id: number): MatchingPattern[] {
    if (!paytable) return [];
    return paytable.entries
      .filter((e) => e.patternId === id)
      .sort((a, b) => a.ballQty - b.ballQty);
  }

  function patternName(pid: number): string {
    return data?.patterns.find((p) => p.id === pid)?.name ?? `#${pid}`;
  }

  function handleLoaded(loaded: Paytable59, fileName: string) {
    setData(loaded);
    setLoadedName(fileName);
    setBetKey(null);
    setPatternId(null);
    setThresholds(new Map());
    setBallCallsOverride(null);
  }

  function handleBetLevel(key: string) {
    setBetKey(key);
    // Thresholds reference this level's ballQty values; start fresh.
    setThresholds(new Map());
    setBallCallsOverride(null);
  }

  /** Click a row: set the pattern's threshold to ballQty, or clear if same. */
  function toggleRow(pid: number, ballQty: number) {
    setThresholds((prev) => {
      const next = new Map(prev);
      if (next.get(pid) === ballQty) next.delete(pid);
      else next.set(pid, ballQty);
      return next;
    });
  }

  /** Prefill section 4 from a DB "create pattern" click: set bet level, select
   *  the pattern, and threshold it at the matched ballQty (drives payout,
   *  daubs, ballCalls and the result). */
  function createPatternFromMatch(
    facadeKey: string,
    pid: number,
    ballQty: number
  ) {
    setBetKey(facadeKey);
    setPatternId(pid);
    setThresholds(new Map([[pid, ballQty]]));
  }

  /** Like createPatternFromMatch but selects several patterns at once (a
   *  combination whose payouts sum to a searched amount). */
  function createPatternsFromMatch(
    facadeKey: string,
    selections: { patternId: number; ballQty: number }[]
  ) {
    setBetKey(facadeKey);
    setPatternId(selections[0]?.patternId ?? null);
    setThresholds(new Map(selections.map((s) => [s.patternId, s.ballQty])));
  }

  function clearPattern(pid: number) {
    setThresholds((prev) => {
      const next = new Map(prev);
      next.delete(pid);
      return next;
    });
  }

  // Every selected row across all thresholded patterns (auto = above threshold).
  const effectiveRows = useMemo<SelectedRow[]>(() => {
    if (!paytable) return [];
    const rows: SelectedRow[] = [];
    for (const [pid, thr] of thresholds) {
      for (const e of entriesFor(pid)) {
        if (e.ballQty >= thr) {
          rows.push({
            key: `${pid}:${e.index}`,
            patternId: pid,
            patternName: patternName(pid),
            ballQty: e.ballQty,
            payout: e.payout,
            auto: e.ballQty > thr,
          });
        }
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thresholds, paytable, data]);

  // Sum of only the rows the user explicitly picked (shown as a subtotal).
  const selectedSubtotal = useMemo(
    () => effectiveRows.reduce((sum, r) => sum + r.payout, 0),
    [effectiveRows]
  );

  // Forced daubs = union across selected patterns. Each carries q = the pattern's
  // selected ball qty (threshold); a shared daub takes the strictest (min) q.
  const daubs = useMemo<Daub[]>(() => {
    if (!data) return [];
    const qByValue = new Map<number, number>();
    const nameByValue = new Map<number, string>();
    const order: number[] = [];
    for (const [pid, q] of thresholds) {
      const p = data.patterns.find((x) => x.id === pid);
      if (!p) continue;
      for (const n of patternDaubNumbers(p, bingoCard)) {
        if (!qByValue.has(n)) {
          qByValue.set(n, q);
          nameByValue.set(n, p.name);
          order.push(n);
        } else if (q < qByValue.get(n)!) {
          // A tighter pattern now binds this number; it names the requirement.
          qByValue.set(n, q);
          nameByValue.set(n, p.name);
        }
      }
    }
    return order.map((value) => ({
      value,
      q: qByValue.get(value)!,
      patternName: nameByValue.get(value)!,
    }));
  }, [thresholds, data, bingoCard]);

  // ballCalls base = 1..75 minus the (possibly edited) card numbers.
  const ballCallBase = useMemo(() => cardBallCallBase(bingoCard), [bingoCard]);

  // Payable rows grouped by pattern id for the active bet level (used by both
  // the in-game scorer and the draw-order refinement).
  const entriesByPattern = useMemo(() => {
    const m = new Map<number, MatchingPattern[]>();
    if (!paytable) return m;
    for (const e of paytable.entries) {
      const arr = m.get(e.patternId);
      if (arr) arr.push(e);
      else m.set(e.patternId, [e]);
    }
    return m;
  }, [paytable]);

  // Base packed order, then nudge each selected pattern into its chosen ball-qty
  // band so the emitted gaffe pays the intended amount instead of an inflated
  // total from a pattern that finished early and lit a lower tier. See
  // refineCompletionTiers; it's a no-op when nothing is selected.
  const builtBallCalls = useMemo(() => {
    const base = buildBallCalls(ballCallBase, daubs);
    if (!data || thresholds.size === 0) return base;
    const refined = refineCompletionTiers(
      base.calls,
      bingoCard,
      data.patterns,
      entriesByPattern,
      thresholds
    );
    return layoutFromOrder(refined, daubs);
  }, [ballCallBase, daubs, data, bingoCard, entriesByPattern, thresholds]);

  // Optional ballCalls override: null = auto (the computed default above); a
  // number[] = a randomized or custom draw order the user pasted. It only changes
  // the emitted ballCalls + the panel display/feasibility, not the payout math.
  const [ballCallsOverride, setBallCallsOverride] = useState<number[] | null>(
    null
  );

  const displayBuilt = useMemo(
    () =>
      ballCallsOverride
        ? layoutFromOrder(ballCallsOverride, daubs)
        : builtBallCalls,
    [ballCallsOverride, daubs, builtBallCalls]
  );

  // True in-game payout (AllPatternsPaid): score the generated draw order so the
  // total includes every pattern the machine would pay — including ones completed
  // only by the union of the selected patterns' daubs. This is what the game
  // shows, so it drives the total payout and the DB reelStop lookup.
  const inGame = useMemo(() => {
    if (!data || !paytable) {
      return { total: 0, wins: [], extras: [] };
    }
    return evaluateInGame(
      builtBallCalls.calls,
      bingoCard,
      data.patterns,
      entriesByPattern,
      new Set(thresholds.keys()),
      data.evaluationType === "HighestPriorityPaid"
    );
  }, [data, paytable, builtBallCalls, bingoCard, thresholds, entriesByPattern]);

  // The total payout is the real in-game amount, so downstream (DB search, wins)
  // reflect what the machine pays rather than only the hand-picked rows.
  const totalPayout = inGame.total;

  // One "win" per paying pattern (selected or incidental) so the DB finder can
  // look up each win's payout separately, not just the summed total.
  const wins = useMemo<Win[]>(
    () =>
      inGame.wins.map((w) => ({
        key: String(w.patternId),
        label: `${w.patternName} · ${w.completionBall} balls (${w.payout.toLocaleString()})${
          w.selected ? "" : " · also won"
        }`,
        payout: w.payout,
      })),
    [inGame]
  );

  // Per selected pattern: does the real completion ball make it pay a different
  // amount than the row(s) the user ticked? A pattern that finishes earlier than
  // its picked ball qty also lights up lower tiers (pays more); one that finishes
  // later can miss its tier (pays less). Surfaced as an inline note so the gap
  // between the selected subtotal and the in-game total is explained where the
  // draw order can't be nudged all the way into the intended band.
  const cascades = useMemo(() => {
    const intendedByPattern = new Map<number, number>();
    for (const r of effectiveRows) {
      intendedByPattern.set(
        r.patternId,
        (intendedByPattern.get(r.patternId) ?? 0) + r.payout
      );
    }
    const winByPattern = new Map(inGame.wins.map((w) => [w.patternId, w]));
    const out: {
      patternId: number;
      patternName: string;
      intended: number;
      inGame: number;
      completionBall: number | null;
      thresholdBallQty: number;
    }[] = [];
    for (const [pid, thr] of thresholds) {
      const intended = intendedByPattern.get(pid) ?? 0;
      const w = winByPattern.get(pid);
      const actual = w?.payout ?? 0;
      if (actual === intended) continue;
      out.push({
        patternId: pid,
        patternName: patternName(pid),
        intended,
        inGame: actual,
        completionBall: w?.completionBall ?? null,
        thresholdBallQty: thr,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRows, inGame, thresholds, data]);

  const gaffeJson = useMemo(
    () =>
      JSON.stringify(
        reelStops.length
          ? { reelStops, bingoCard, ballCalls: displayBuilt.calls }
          : { bingoCard, ballCalls: displayBuilt.calls }
      ),
    [reelStops, bingoCard, displayBuilt]
  );

  const forcedNames = useMemo(
    () => Array.from(thresholds.keys()).map(patternName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thresholds, data]
  );

  const ready = data != null;
  const canPick = ready && paytable != null;

  return (
    <main className="app">
      <header className="app-header">
        <h1>MOP Bingo Gaffe Tool</h1>
        <p className="subtitle">
          Class II bingo pattern &amp; payout explorer
          {data?.gameId ? ` · Game ${data.gameId}` : ""}
        </p>
      </header>

      <div className="layout">
        <section className="col-controls">
          <XmlUpload onLoaded={handleLoaded} loadedName={loadedName} />

          {ready && issues && <PaytableIssues issues={issues} />}

          {ready && data && <WebsocketCompare data={data} />}

          {ready && (
            <BetLevelSelect
              paytables={data.paytables}
              selectedKey={betKey}
              onSelect={handleBetLevel}
            />
          )}

          {canPick && (
            <PatternSelect
              patterns={betLinePatterns}
              selectedId={patternId}
              onSelect={setPatternId}
            />
          )}

          {dbHandle && (
            <ReelStripViewer
              ref={reelStripRef}
              onLoadedChange={setReelStripLoaded}
              onSearch={(filter) => dbSearchRef.current?.runWithFilter(filter)}
            />
          )}

          {dbHandle && (
            <DbAmountSearch
              ref={dbSearchRef}
              handle={dbHandle}
              facades={dbFacades}
              data={data}
              betKey={betKey}
              bingoCard={bingoCard}
              onApply={setReelStops}
              onCreatePattern={createPatternFromMatch}
              onCreatePatterns={createPatternsFromMatch}
              onSlot={(rs) => reelStripRef.current?.openWithReelStops(rs)}
              reelStripLoaded={reelStripLoaded}
            />
          )}
        </section>

        <section className="col-main" role="main">
          {ready ? (
            <BingoGrid
              bingoCard={bingoCard}
              highlights={bingoHighlights}
              onChange={setBingoCard}
            />
          ) : (
            <div className="panel empty">
              <p className="muted">Upload a VGTPaytable XML file to begin.</p>
            </div>
          )}

          {canPick && (selectedPattern || thresholds.size > 0) && (
            <div className="panel">
              <div className="panel-title">
                4 · Payouts &amp; contained patterns
              </div>

              {/* Every forced/browsed pattern, colored + labeled Pattern N. */}
              {highlightPatterns.map((p, i) => (
                <InstanceList
                  key={p.id}
                  pattern={p}
                  entries={entriesFor(p.id)}
                  threshold={thresholds.get(p.id) ?? null}
                  onToggle={(q) => toggleRow(p.id, q)}
                  badge={`Pattern ${i + 1}`}
                  color={highlightColor(i)}
                />
              ))}

              {/* Patterns contained in the browsed one that aren't already shown. */}
              {contained
                .filter((p) => !highlightPatterns.some((h) => h.id === p.id))
                .slice()
                .sort((a, b) => a.cells.length - b.cells.length)
                .map((p) => (
                  <InstanceList
                    key={p.id}
                    pattern={p}
                    entries={entriesFor(p.id)}
                    threshold={thresholds.get(p.id) ?? null}
                    onToggle={(q) => toggleRow(p.id, q)}
                    badge="Contained"
                  />
                ))}

              {selectedPattern &&
                contained.filter(
                  (p) => !highlightPatterns.some((h) => h.id === p.id)
                ).length === 0 && (
                  <p className="muted small">
                    No other patterns are fully contained inside{" "}
                    {selectedPattern.name}.
                  </p>
                )}
            </div>
          )}

          {canPick && (
            <ReelStopFinder
              totalPayout={totalPayout}
              wins={wins}
              onApply={setReelStops}
              onDbReady={(h, f) => {
                setDbHandle(h);
                setDbFacades(f);
              }}
              onSlot={(rs) => reelStripRef.current?.openWithReelStops(rs)}
              reelStripLoaded={reelStripLoaded}
            />
          )}
        </section>

        {canPick && (
          <section className="col-result">
            <ResultJson json={gaffeJson} />

            <SelectionSummary
              rows={effectiveRows}
              selectedSubtotal={selectedSubtotal}
              inGameTotal={inGame.total}
              extras={inGame.extras}
              cascades={cascades}
              onRemove={clearPattern}
              onClear={() => setThresholds(new Map())}
            />

            <GaffeResult
              reelStops={reelStops}
              bingoCard={bingoCard}
              built={displayBuilt}
              forcedNames={forcedNames}
              daubColors={daubColors}
              overridden={ballCallsOverride != null}
              defaultCalls={builtBallCalls.calls}
              makeRandomCalls={() => {
                const calls = buildBallCalls(ballCallBase, daubs, true).calls;
                if (!data || thresholds.size === 0) return calls;
                return refineCompletionTiers(
                  calls,
                  bingoCard,
                  data.patterns,
                  entriesByPattern,
                  thresholds
                );
              }}
              onOverrideBallCalls={setBallCallsOverride}
            />
          </section>
        )}
      </div>
    </main>
  );
}
