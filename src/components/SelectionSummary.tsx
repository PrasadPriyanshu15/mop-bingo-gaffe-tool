"use client";

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
  /** Clear all selected rows for a pattern. */
  onRemove: (patternId: number) => void;
  onClear: () => void;
}

/** Persistent panel of chosen rows + running total payout. */
export default function SelectionSummary({ rows, onRemove, onClear }: Props) {
  const total = rows.reduce((sum, r) => sum + r.payout, 0);

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

          <div className="total-row">
            <span>
              Total payout ({rows.length} selected)
            </span>
            <span className="total-value">{total.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  );
}
