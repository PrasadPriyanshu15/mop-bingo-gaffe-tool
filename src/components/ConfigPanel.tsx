"use client";

import type { Dispatch, SetStateAction } from "react";

type AdvRule = { pos: string; val: string };

interface Props {
  rows: number;
  setRows: Dispatch<SetStateAction<number>>;
  offset: number;
  setOffset: Dispatch<SetStateAction<number>>;
  slotStart: number;
  setSlotStart: Dispatch<SetStateAction<number>>;
  advRules: AdvRule[];
  setAdvRules: Dispatch<SetStateAction<AdvRule[]>>;
  pattern: string;
  setPattern: Dispatch<SetStateAction<string>>;
  maxRng: string;
  setMaxRng: Dispatch<SetStateAction<string>>;
  /** Callback refs for the slots the DB / reelStrip viewers portal their file
   *  uploads into. */
  dbSlotRef: (el: HTMLDivElement | null) => void;
  reelSlotRef: (el: HTMLDivElement | null) => void;
  fgSlotRef: (el: HTMLDivElement | null) => void;
}

/**
 * Config page: the single place to upload the DB / reelStrip files and enter
 * the filter data used by the DB and reelStrip viewer sections. It only edits state owned by the page — the
 * viewers read the same values, so nothing here searches or loads anything.
 */
export default function ConfigPanel({
  rows,
  setRows,
  offset,
  setOffset,
  slotStart,
  setSlotStart,
  advRules,
  setAdvRules,
  pattern,
  setPattern,
  maxRng,
  setMaxRng,
  dbSlotRef,
  reelSlotRef,
  fgSlotRef,
}: Props) {
  function changeRows(v: number) {
    const n = Math.max(1, Math.min(50, Math.floor(v || 1)));
    setRows(n);
    if (offset > n - 1) setOffset(n - 1);
  }

  function setAdvRule(i: number, key: "pos" | "val", value: string) {
    setAdvRules((prev) =>
      prev.map((r, j) => (j === i ? { ...r, [key]: value } : r))
    );
  }
  function addAdvRule() {
    setAdvRules((prev) => [...prev, { pos: "", val: "" }]);
  }
  function removeAdvRule(i: number) {
    setAdvRules((prev) =>
      prev.length > 1 ? prev.filter((_, j) => j !== i) : [{ pos: "", val: "" }]
    );
  }

  return (
    <div className="section-grid grid-3">
      {/* 1 · DB + viewer inputs + advanced filter */}
      <div className="panel">
        <div className="panel-title">DB search</div>
        <div ref={dbSlotRef} />

      <h3 className="db-label">DB filters</h3>
      <label className="db-field">
        <span className="db-label">
          reelStop filter (per position, blank = any)
        </span>
        <input
          className="select db-search"
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="e.g. ,,,,,,,,2"
        />
      </label>
      <label className="db-field">
        <span className="db-label">
          RNG count (single = exact length, range = in range, blank = no bound)
        </span>
        <input
          className="select db-search"
          type="text"
          value={maxRng}
          onChange={(e) => setMaxRng(e.target.value)}
          placeholder="e.g. 300 or 100-300"
        />
      </label>

      <h3 className="db-label">Advanced filter</h3>
      <div className="adv-filter">
        <p className="muted small">
          Position and value each take a single number (<code>43</code>) or a
          range (<code>20-30</code>). Rows are combined with AND. Used by every DB
          search in section 5.
        </p>
        {advRules.map((r, i) => (
          <div key={i} className="adv-rule">
            <label className="db-field">
              <span className="db-label">Position (0-based)</span>
              <input
                className="select db-search"
                type="text"
                value={r.pos}
                onChange={(e) => setAdvRule(i, "pos", e.target.value)}
                placeholder="e.g. 43 or 20-30"
              />
            </label>
            <label className="db-field">
              <span className="db-label">Value</span>
              <input
                className="select db-search"
                type="text"
                value={r.val}
                onChange={(e) => setAdvRule(i, "val", e.target.value)}
                placeholder="e.g. 500 or 500-600"
              />
            </label>
            {advRules.length > 1 && (
              <button
                type="button"
                className="btn btn-small adv-rule-del"
                onClick={() => removeAdvRule(i)}
                title="Remove this rule"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn btn-small"
          onClick={addAdvRule}
          title="Add another position/value rule (ANDed)"
        >
          + rule
        </button>
      </div>
      </div>

      {/* 2 · main / base-game reelStrip */}
      <div className="panel">
        <div className="panel-title">Main reelStrip</div>
        <div ref={reelSlotRef} />
      </div>

      {/* 3 · feature-game reelStrip */}
      <div className="panel">
        <div className="panel-title">Feature reelStrip</div>
        <div ref={fgSlotRef} />
      </div>
    </div>
  );
}
