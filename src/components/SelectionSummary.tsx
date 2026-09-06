"use client";

import type { PatternWin } from "@/lib/evaluate";
import { useCurrency } from "@/lib/CurrencyContext";

export interface SelectedRow {
  key: string;
  patternId: number;
  patternName: string;
  ballQty: number;
  payout: number;
  /** True when the row was auto-included (contained pattern won earlier). */
  auto?: boolean;
}

/** A selected pattern whose real completion ball changes its payout vs. the
 *  ticked row(s) — the reason the in-game total can differ from the subtotal. */
export interface CascadeNote {
  patternId: number;
  patternName: string;
  /** Sum of the rows the user ticked for this pattern. */
  intended: number;
  /** What this pattern actually pays in the generated draw order. */
  inGame: number;
  /** Ball at which the pattern completes in the draw order (null = never). */
  completionBall: number | null;
  /** Ball qty the user selected the pattern at. */
  thresholdBallQty: number;
}

interface Props {
  rows: SelectedRow[];
  /** Sum of only the explicitly-picked rows. */
  selectedSubtotal: number;
  /** True AllPatternsPaid total the machine would show (incl. incidental wins). */
  inGameTotal: number;
  /** Paying patterns that were NOT explicitly selected (union-completed wins). */
  extras: PatternWin[];
  /** Selected patterns whose completion ball makes them pay more/less than picked. */
  cascades: CascadeNote[];
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
  cascades,
  onRemove,
  onClear,
}: Props) {
  const { fmt } = useCurrency();
  const hasExtras = extras.length > 0;
  const hasCascades = cascades.length > 0;

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
                  <td className="payout">{fmt(r.payout)}</td>
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
                      <td className="payout">{fmt(w.payout)}</td>
                      <td></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasCascades && (
            <div className="cascade-notes">
              <div className="cascade-notes-head">
                Tier cascade — completion ball changes the payout:
              </div>
              <ul className="cascade-list">
                {cascades.map((c) => {
                  const delta = c.inGame - c.intended;
                  const early = delta > 0;
                  return (
                    <li key={c.patternId} className="cascade-item">
                      <span className="cascade-pattern">
                        {c.patternName} <span className="pattern-id">#{c.patternId}</span>
                      </span>{" "}
                      {c.completionBall == null ? (
                        <>never completes in this draw order — pays 0 instead of{" "}
                          {fmt(c.intended)}.</>
                      ) : early ? (
                        <>completes at ball {c.completionBall} (earlier than the{" "}
                          {c.thresholdBallQty}-ball row you picked), so it also
                          pays its lower tier(s): {fmt(c.inGame)} vs{" "}
                          {fmt(c.intended)} selected{" "}
                          <span className="cascade-delta up">
                            (+{fmt(delta)})
                          </span>
                          .</>
                      ) : (
                        <>completes at ball {c.completionBall} (later than the{" "}
                          {c.thresholdBallQty}-ball row you picked), so it misses
                          a tier: {fmt(c.inGame)} vs{" "}
                          {fmt(c.intended)} selected{" "}
                          <span className="cascade-delta down">
                            ({fmt(delta)})
                          </span>
                          .</>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="cascade-notes-foot muted small">
                The draw order is auto-tuned to hit the ball qty you pick; a
                residual gap here means the card geometry left no later slot to
                push the completion into.
              </div>
            </div>
          )}

          <div className="total-row total-row-sub">
            <span>Selected subtotal ({rows.length})</span>
            <span className="total-value">{fmt(selectedSubtotal)}</span>
          </div>
          <div className="total-row">
            <span>
              In-game total{hasExtras ? ` (+${extras.length} also won)` : ""}
            </span>
            <span className="total-value">{fmt(inGameTotal)}</span>
          </div>
        </>
      )}
    </div>
  );
}
