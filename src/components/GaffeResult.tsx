"use client";

import { useState } from "react";
import type { BuiltBallCalls } from "@/lib/gaffe";
import { COLUMN_LETTERS, COLUMN_RANGES, cellHighlightStyle } from "@/lib/patterns";

interface Props {
  reelStops: number[];
  /** Drop the reelStops from the emitted result (keep bingoCard + ballCalls). */
  onRemoveReelStops: () => void;
  bingoCard: number[][];
  built: BuiltBallCalls;
  /** Names of the patterns currently being forced (for the hint line). */
  forcedNames: string[];
  /** Per-number highlight colors (a shared number carries several colors). */
  daubColors: Map<number, string[]>;
  /** True when ballCalls are a user override (randomized / custom) vs auto. */
  overridden: boolean;
  /** The auto-computed draw order (for "reset to default" / clearing override). */
  defaultCalls: number[];
  /** Produce a fresh randomized-but-valid draw order. */
  makeRandomCalls: () => number[];
  /** Apply a ballCalls override (null = back to auto/default). */
  onOverrideBallCalls: (calls: number[] | null) => void;
}

/** Parse a free-text list into ball numbers (1–75, unique). */
function parseCalls(
  s: string
): { ok: true; calls: number[] } | { ok: false; error: string } {
  const nums = s
    .split(/[^0-9]+/)
    .filter((t) => t !== "")
    .map(Number);
  if (nums.length === 0) return { ok: false, error: "Enter at least one number." };
  const seen = new Set<number>();
  for (const n of nums) {
    if (!Number.isInteger(n) || n < 1 || n > 75) {
      return { ok: false, error: `Each ball must be 1–75 (got ${n}).` };
    }
    if (seen.has(n)) return { ok: false, error: `Duplicate ball ${n}.` };
    seen.add(n);
  }
  return { ok: true, calls: nums };
}

const sameOrder = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Right-side panel: the generated gaffe result, with draw-order ballCalls. */
export default function GaffeResult({
  reelStops,
  onRemoveReelStops,
  bingoCard,
  built,
  forcedNames,
  daubColors,
  overridden,
  defaultCalls,
  makeRandomCalls,
  onOverrideBallCalls,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [bcError, setBcError] = useState<string | null>(null);

  // Numbers currently on the card — these never appear in ballCalls, so a pasted
  // draw log (which includes daubed card numbers) has them stripped on save.
  const cardNumbers = new Set<number>();
  for (const row of bingoCard) for (const n of row) if (n !== 0) cardNumbers.add(n);

  function startEdit() {
    setDraft(built.calls.join(", "));
    setBcError(null);
    setEditing(true);
  }
  function saveEdit() {
    const parsed = parseCalls(draft);
    if (!parsed.ok) {
      setBcError(parsed.error);
      return;
    }
    // Drop any card numbers from the pasted order: ballCalls are 1–75 minus the
    // card, so a pasted full draw log becomes just the non-card calls, in order.
    const calls = parsed.calls.filter((n) => !cardNumbers.has(n));
    if (calls.length === 0) {
      setBcError("No ball calls left after removing the card's numbers.");
      return;
    }
    onOverrideBallCalls(sameOrder(calls, defaultCalls) ? null : calls);
    setBcError(null);
    setEditing(false);
  }

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
        <span className="bingo-actions">
          {reelStops.length > 0 && (
            <button
              type="button"
              className="btn btn-small"
              onClick={onRemoveReelStops}
              title="Drop reelStops from the result (keep bingoCard + ballCalls)"
            >
              Remove reelStops
            </button>
          )}
          <button type="button" className="btn btn-small" onClick={copy}>
            {copied ? "Copied!" : "Copy JSON"}
          </button>
        </span>
      </div>

      {forcedNames.length > 0 ? (
        <p className="muted small">
          Forcing <strong>{forcedNames.join(", ")}</strong> —{" "}
          {built.daubSet.size} number(s) placed in draw order (highlighted).
        </p>
      ) : (
        <p className="muted small">
          {/* Select payout rows to splice a pattern&apos;s numbers into ballCalls.
          Showing the base sequence in draw order. */}
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
              {row.map((n, c) => {
                const colors = n !== 0 ? daubColors.get(n) : undefined;
                const hlStyle = colors ? cellHighlightStyle(colors) : undefined;
                return (
                  <span
                    key={c}
                    className={
                      "result-card-cell" +
                      (n === 0 ? " free" : "") +
                      (hlStyle ? " hl" : "")
                    }
                    style={hlStyle}
                  >
                    {n === 0 ? "★" : n}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="result-field">
        <span className="result-key result-key-row">
          <span>
            ballCalls <span className="muted">({built.calls.length})</span> —{" "}
            {overridden ? "custom / randomized" : "auto"} draw order (B/I/N/G/O)
          </span>
          {editing ? (
            <span className="bingo-actions">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setDraft(makeRandomCalls().join(", "))}
              >
                Randomize
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setDraft(defaultCalls.join(", "))}
              >
                Default
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setEditing(false);
                  setBcError(null);
                }}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-small" onClick={saveEdit}>
                Save
              </button>
            </span>
          ) : (
            <span className="bingo-actions">
              {overridden && (
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => onOverrideBallCalls(null)}
                >
                  Use default
                </button>
              )}
              <button
                type="button"
                className="btn btn-small"
                onClick={startEdit}
              >
                Edit
              </button>
            </span>
          )}
        </span>

        {editing ? (
          <>
            <textarea
              className="ws-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. 1, 16, 31, 47, 62, …"
              spellCheck={false}
            />
            {bcError ? (
              <p className="bingo-error">{bcError}</p>
            ) : (
              <p className="muted small">
                Balls 1–75, comma/space separated. Paste a full draw log and the
                card&apos;s own numbers are stripped automatically. Randomize keeps
                forced daubs within their ball qty; Default restores the auto
                sequence.
              </p>
            )}
          </>
        ) : (
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
                const colors = daubColors.get(v);
                // Infeasible balls keep the red .bad style; otherwise a forced
                // ball takes its pattern color(s).
                const hlStyle =
                  !bad && colors ? cellHighlightStyle(colors) : undefined;
                return (
                  <span
                    key={c}
                    className={
                      "bcall" +
                      (daub ? " inserted" : "") +
                      (bad ? " bad" : "") +
                      (hlStyle ? " hl" : "")
                    }
                    style={hlStyle}
                  >
                    {v}
                  </span>
                );
              })}
            </div>
          ))}
          </div>
        )}
      </div>
    </div>
  );
}
