"use client";

import { useState } from "react";
import type { BuiltBallCalls } from "@/lib/gaffe";
import { COLUMN_LETTERS, COLUMN_RANGES } from "@/lib/patterns";

interface Props {
  reelStops: number[];
  bingoCard: number[][];
  built: BuiltBallCalls;
  /** Names of the patterns currently being forced (for the hint line). */
  forcedNames: string[];
}

/** Right-side panel: the generated gaffe result, with draw-order ballCalls. */
export default function GaffeResult({
  reelStops,
  bingoCard,
  built,
  forcedNames,
}: Props) {
  const [copied, setCopied] = useState(false);

  const gaffe = reelStops.length
    ? { reelStops, bingoCard, ballCalls: built.calls }
    : { bingoCard, ballCalls: built.calls };
  const rawJson = JSON.stringify(gaffe);

  async function copy() {
    try {
      await navigator.clipboard.writeText(rawJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="panel result">
      <div className="panel-title">
        Generated gaffe result
        <button type="button" className="btn btn-small" onClick={copy}>
          {copied ? "Copied!" : "Copy JSON"}
        </button>
      </div>

      {forcedNames.length > 0 ? (
        <p className="muted small">
          Forcing <strong>{forcedNames.join(", ")}</strong> —{" "}
          {built.daubSet.size} number(s) placed in draw order (highlighted).
        </p>
      ) : (
        <p className="muted small">
          Select payout rows to splice a pattern&apos;s numbers into ballCalls.
          Showing the base sequence in draw order.
        </p>
      )}

      {built.infeasible.length > 0 && (
        <div className="result-warn">
          <strong>
            ⚠ {built.infeasible.length} number(s) can&apos;t be called within
            their pattern&apos;s ball quantity:
          </strong>
          <ul>
            {built.infeasible.map((p) => (
              <li key={p.value}>
                {p.patternName ?? "Pattern"} needs <strong>{p.value}</strong>{" "}
                within {p.q} balls, but it lands at ball {p.position}.
              </li>
            ))}
          </ul>
          <span className="muted">
            Too many forced numbers share the early draws — lower a ball qty or
            deselect a contained pattern.
          </span>
        </div>
      )}

      {reelStops.length > 0 && (
        <div className="result-field">
          <span className="result-key">reelStops</span>
          <code className="result-val">[{reelStops.join(", ")}]</code>
        </div>
      )}

      <div className="result-field">
        <span className="result-key">bingoCard</span>
        <div className="result-card">
          {bingoCard.map((row, r) => (
            <div key={r} className="result-card-row">
              {row.map((n, c) => (
                <span
                  key={c}
                  className={"result-card-cell" + (n === 0 ? " free" : "")}
                >
                  {n === 0 ? "★" : n}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="result-field">
        <span className="result-key">
          ballCalls <span className="muted">({built.calls.length})</span> — draw
          order (B/I/N/G/O)
        </span>
        <div className="bcalls">
          <div className="bcalls-head">
            {COLUMN_LETTERS.map((letter, c) => (
              <div key={letter} className="bcalls-head-cell">
                <span className="bingo-letter">{letter}</span>
                <span className="bingo-range">{COLUMN_RANGES[c]}</span>
              </div>
            ))}
          </div>
          {Array.from({ length: built.rows }, (_, r) => (
            <div key={r} className="bcalls-row">
              {[0, 1, 2, 3, 4].map((c) => {
                const v = built.columns[c][r];
                if (v == null) return <span key={c} className="bcall empty" />;
                const daub = built.daubSet.has(v);
                const bad = built.infeasible.some((p) => p.value === v);
                return (
                  <span
                    key={c}
                    className={
                      "bcall" + (daub ? " inserted" : "") + (bad ? " bad" : "")
                    }
                  >
                    {v}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
