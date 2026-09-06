"use client";

import { useState } from "react";
import { useCurrency } from "@/lib/CurrencyContext";

/**
 * Setup panel (sits in section 1, next to the WebSocket compare) for the
 * credit→currency conversion. Amounts in patterns and the DB are in credits;
 * enter this game's formula (e.g. `credit/100`) and flip the toggle to show
 * every amount across the tool as currency ("$…"). Purely a display switch —
 * search inputs stay in credits.
 */
export default function CreditToCurrency() {
  const { mode, setMode, formula, setFormula, formulaValid, toCurrency } =
    useCurrency();
  const [open, setOpen] = useState(false);

  const preview = toCurrency(12345);

  return (
    <div className="panel">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{open ? "▾" : "▸"} Credit → Currency</span>
        <span className="muted small">
          {mode === "currency" ? "showing $" : "showing credits"}
        </span>
      </button>

      {open && (
        <div className="ws-body">
          <div className="c2c-toggle-row">
            <span className="db-label">Show amounts in</span>
            <div className="c2c-toggle" role="group" aria-label="Amount display unit">
              <button
                type="button"
                className={"c2c-toggle-btn" + (mode === "credit" ? " on" : "")}
                aria-pressed={mode === "credit"}
                onClick={() => setMode("credit")}
              >
                Credits
              </button>
              <button
                type="button"
                className={"c2c-toggle-btn" + (mode === "currency" ? " on" : "")}
                aria-pressed={mode === "currency"}
                onClick={() => setMode("currency")}
                disabled={!formulaValid}
                title={
                  formulaValid
                    ? "Show every amount converted to currency"
                    : "Enter a valid formula first"
                }
              >
                $
              </button>
            </div>
          </div>

          <div className="c2c-formula-row">
            <span className="db-label">$&nbsp;=</span>
            <input
              type="text"
              className="c2c-formula-input"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="credit/100"
              spellCheck={false}
              aria-label="Credit to currency formula"
            />
          </div>

          {formulaValid ? (
            <p className="muted small">
              Example: 12,345 credits → <strong>{preview}</strong>
            </p>
          ) : (
            <p className="error">
              Invalid formula. Use the variable <code>credit</code>, numbers, and{" "}
              + − × ÷ ( ).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
