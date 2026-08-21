"use client";

import type { PatternWin } from "@/lib/evaluate";

export interface SelectedRow {
  key: string;
  patternId: number;
  patternName: string;
  ballQty: number;
  payout: number;
  /** True when the row was auto-included (contained pattern won earlier). */
  auto?: boolean;
}

interface Props {
  rows: SelectedRow[];
  /** Sum of only the explicitly-picked rows. */
  selectedSubtotal: number;
  /** True AllPatternsPaid total the machine would show (incl. incidental wins). */
  inGameTotal: number;
  /** Paying patterns that were NOT explicitly selected (union-completed wins). */
  extras: PatternWin[];
  /** Clear all selected rows for a pattern. */
  onRemove: (patternId: number) => void;
  onClear: () => void;
}

/** Persistent panel of chosen rows + the true in-game total payout. */
export default function SelectionSummary({
  rows,
  selectedSubtotal,
  inGameTotal,
  extras,
  onRemove,
  onClear,
}: Props) {
  const hasExtras = extras.length > 0;

  return (
    <div className="panel summary">
      <div className="panel-title">
        Selected outcomes
        {rows.length > 0 && (
          <button type="button" className="btn btn-small" onClick={onClear}>
            Clear all
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="muted">
          Tick payout rows to add them here. Single or multiple allowed.
        </p>
      ) : (
        <>
          <table className="instances">
            <thead>
              <tr>
                <th>Pattern</th>
                <th>Ball qty</th>
                <th>Payout</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.auto ? "row-auto" : ""}>
                  <td>
                    {r.patternName} <span className="pattern-id">#{r.patternId}</span>
                    {r.auto && <span className="badge badge-auto">auto</span>}
                  </td>
                  <td>{r.ballQty}</td>
                  <td className="payout">{r.payout.toLocaleString()}</td>
                  <td>
                    {!r.auto && (
                      <button
                        type="button"
                        className="link-remove"
                        onClick={() => onRemove(r.patternId)}
                        aria-label="Remove pattern"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasExtras && (
            <div className="extra-wins">
              <div className="extra-wins-head">
                Also won in-game (AllPatternsPaid) — completed by the combined
                daubs:
              </div>
              <table className="instances">
                <tbody>
                  {extras.map((w) => (
                    <tr key={w.patternId} className="row-extra">
                      <td>
                        {w.patternName}{" "}
                        <span className="pattern-id">#{w.patternId}</span>
                        <span className="badge badge-extra">also won</span>
                      </td>
                      <td>{w.completionBall} balls</td>
                      <td className="payout">{w.payout.toLocaleString()}</td>
                      <td></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="total-row total-row-sub">
            <span>Selected subtotal ({rows.length})</span>
            <span className="total-value">
              {selectedSubtotal.toLocaleString()}
            </span>
          </div>
          <div className="total-row">
            <span>
              In-game total{hasExtras ? ` (+${extras.length} also won)` : ""}
            </span>
            <span className="total-value">{inGameTotal.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  );
}
