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
import type { DbHandle, Facade } from "@/lib/db";
import { containedPatterns } from "@/lib/patterns";
import { buildBallCalls, patternDaubNumbers, type Daub } from "@/lib/gaffe";
import { SAMPLE_GAFFE } from "@/lib/sample";
import type { MatchingPattern, Paytable59 } from "@/lib/types";

export default function Home() {
  const [data, setData] = useState<Paytable59 | null>(null);
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const [betKey, setBetKey] = useState<string | null>(null);
  const [patternId, setPatternId] = useState<number | null>(null);
  // Per-pattern selection threshold: the lowest chosen ballQty. Every instance
  // with ballQty >= threshold is selected (selecting one cascades to higher).
  const [thresholds, setThresholds] = useState<Map<number, number>>(new Map());
  // reelStops shown in the generated gaffe output. Seeded from the sample; the
  // DB finder can overwrite it via the "+" button on a looked-up candidate.
  const [reelStops, setReelStops] = useState<number[]>(
    SAMPLE_GAFFE.reelStops ?? []
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

  const selectedPattern = useMemo(
    () => data?.patterns.find((p) => p.id === patternId) ?? null,
    [data, patternId]
  );

  const contained = useMemo(
    () =>
      selectedPattern && data
        ? containedPatterns(selectedPattern, data.patterns)
        : [],
    [selectedPattern, data]
  );

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
  }

  function handleBetLevel(key: string) {
    setBetKey(key);
    // Thresholds reference this level's ballQty values; start fresh.
    setThresholds(new Map());
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

  const totalPayout = useMemo(
    () => effectiveRows.reduce((sum, r) => sum + r.payout, 0),
    [effectiveRows]
  );

  // One "win" per selected payout row — lets the DB finder look up each win's
  // payout separately instead of only the summed total.
  const wins = useMemo<Win[]>(
    () =>
      effectiveRows.map((r) => ({
        key: r.key,
        label: `${r.patternName} · ${r.ballQty} balls (${r.payout.toLocaleString()})`,
        payout: r.payout,
      })),
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
      for (const n of patternDaubNumbers(p, SAMPLE_GAFFE.bingoCard)) {
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
  }, [thresholds, data]);

  const builtBallCalls = useMemo(
    () => buildBallCalls(SAMPLE_GAFFE.ballCalls, daubs),
    [daubs]
  );

  const gaffeJson = useMemo(
    () =>
      JSON.stringify({
        reelStops,
        bingoCard: SAMPLE_GAFFE.bingoCard,
        ballCalls: builtBallCalls.calls,
      }),
    [reelStops, builtBallCalls]
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

          {ready && (
            <BetLevelSelect
              paytables={data.paytables}
              selectedKey={betKey}
              onSelect={handleBetLevel}
            />
          )}

          {canPick && (
            <PatternSelect
              patterns={data.patterns}
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
              onApply={setReelStops}
              onCreatePattern={createPatternFromMatch}
              onSlot={(rs) => reelStripRef.current?.openWithReelStops(rs)}
              reelStripLoaded={reelStripLoaded}
            />
          )}
        </section>

        <section className="col-main" role="main">
          {ready ? (
            <BingoGrid
              bingoCard={SAMPLE_GAFFE.bingoCard}
              selected={selectedPattern}
            />
          ) : (
            <div className="panel empty">
              <p className="muted">Upload a VGTPaytable XML file to begin.</p>
            </div>
          )}

          {canPick && selectedPattern && (
            <div className="panel">
              <div className="panel-title">
                4 · Payouts &amp; contained patterns
              </div>

              <InstanceList
                pattern={selectedPattern}
                entries={entriesFor(selectedPattern.id)}
                threshold={thresholds.get(selectedPattern.id) ?? null}
                onToggle={(q) => toggleRow(selectedPattern.id, q)}
                badge="Selected"
              />

              {contained.length > 0 ? (
                contained
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
                  ))
              ) : (
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
              onRemove={clearPattern}
              onClear={() => setThresholds(new Map())}
            />

            <GaffeResult
              reelStops={reelStops}
              bingoCard={SAMPLE_GAFFE.bingoCard}
              built={builtBallCalls}
              forcedNames={forcedNames}
            />
          </section>
        )}
      </div>
    </main>
  );
}
