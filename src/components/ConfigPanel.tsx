"use client";

import type { Dispatch, SetStateAction } from "react";

type SetRule = { position: string; range: string };
type AdvRule = { pos: string; val: string };

interface Props {
  /** Set names from the main reelStrip file. */
  reelSetNames: string[];
  setRules: SetRule[];
  setSetRules: Dispatch<SetStateAction<SetRule[]>>;
  rows: number;
  setRows: Dispatch<SetStateAction<number>>;
  offset: number;
  setOffset: Dispatch<SetStateAction<number>>;
  slotStart: number;
  setSlotStart: Dispatch<SetStateAction<number>>;
  advRules: AdvRule[];
  setAdvRules: Dispatch<SetStateAction<AdvRule[]>>;
}

/**
 * Config page: the single place to enter the filter data used by the DB and
 * reelStrip viewer sections. It only edits state owned by the page — the
 * viewers read the same values, so nothing here searches or loads anything.
 */
export default function ConfigPanel({
  reelSetNames,
  setRules,
  setSetRules,
  rows,
  setRows,
  offset,
  setOffset,
  slotStart,
  setSlotStart,
  advRules,
  setAdvRules,
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
    <div className="panel">
      <h3 className="db-label">reelStrip set mapping</h3>
      <div className="reelset-rules">
        {reelSetNames.map((name, i) => (
          <div className="reelset-rule" key={i}>
            <strong className="reelset-rule-name">{name}</strong>
            <label className="db-field">
              <span className="db-label">Position (0-based)</span>
              <input
                className="select reelstrip-rows"
                type="number"
                min={0}
                value={setRules[i]?.position ?? ""}
                onChange={(e) =>
                  setSetRules((prev) =>
                    reelSetNames.map((_, j) => {
                      const rule = prev[j] ?? { position: "", range: "" };
                      return j === i
                        ? { ...rule, position: e.target.value }
                        : rule;
                    })
                  )
                }
              />
            </label>
            <label className="db-field">
              <span className="db-label">RNG range</span>
              <input
                className="select db-search"
                type="text"
                placeholder="e.g. 100-200"
                value={setRules[i]?.range ?? ""}
                onChange={(e) =>
                  setSetRules((prev) =>
                    reelSetNames.map((_, j) => {
                      const rule = prev[j] ?? { position: "", range: "" };
                      return j === i
                        ? { ...rule, range: e.target.value }
                        : rule;
                    })
                  )
                }
              />
            </label>
          </div>
        ))}
        <p className="muted small">
          On slot, the first matching range selects its reelStrip set. No match
          keeps the current selection.
        </p>
      </div>

      <h3 className="db-label">reelStrip viewer</h3>
      <div className="db-controls">
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
            className="select reelstrip-rows"
            value={offset}
            onChange={(e) => setOffset(Number(e.target.value))}
          >
            {Array.from({ length: rows }, (_, i) => (
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
            value={slotStart}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSlotStart(Math.max(0, Math.floor(Number.isFinite(v) ? v : 0)));
            }}
          />
        </label>
      </div>

      <h3 className="db-label">Advanced filter</h3>
      <div className="adv-filter">
        <p className="muted small">
          Position and value each take a single number (<code>43</code>) or a
          range (<code>20-30</code>). Rows are combined with AND. These feed the
          Advanced filter in the DB section.
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
  );
}
