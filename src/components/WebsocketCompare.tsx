"use client";

import { useMemo, useState } from "react";
import type { Paytable59 } from "@/lib/types";
import {
  extractPayload,
  listDenoms,
  normalizeWebsocket,
  type PaytableInfoRoot,
} from "@/lib/wscompare/parseWebsocket";
import { compare } from "@/lib/wscompare/compare";
import { normalizeXml } from "@/lib/wscompare/normalizeXml";
import type { CompareResult, RowDiff } from "@/lib/wscompare/types";

/** Max mismatched rows rendered per bet line before summarizing. */
const ROW_CAP = 200;

function rowText(r: RowDiff): string {
  const head = `#${r.id} · ${r.ballCall} balls`;
  if (r.status === "mismatch") {
    return `${head} — payout: XML ${r.xml?.payout.toLocaleString()} → WS ${r.ws?.payout.toLocaleString()}`;
  }
  if (r.status === "missing-in-websocket") {
    return `${head} — in XML (${r.xml?.payout.toLocaleString()}) · missing in WebSocket`;
  }
  return `${head} — in WebSocket (${r.ws?.payout.toLocaleString()}) · missing in XML`;
}

/**
 * Optional step after XML validation: paste the game-info WebSocket payload,
 * pick a denomination, and compare its paytable against the loaded XML. Shows
 * ONLY mismatches (payout differences + entries missing on one side), grouped
 * per bet line in collapsible sections. Purely informational — skipping it and
 * proceeding with the XML is the normal flow.
 */
export default function WebsocketCompare({ data }: { data: Paytable59 }) {
  const [open, setOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [root, setRoot] = useState<PaytableInfoRoot | null>(null);
  const [denoms, setDenoms] = useState<string[]>([]);
  const [denom, setDenom] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [labels, setLabels] = useState<Map<number, string>>(new Map());
  const [closed, setClosed] = useState<Set<number>>(new Set());

  // XML side is denom-independent; normalize once.
  const xmlNorm = useMemo(() => normalizeXml(data), [data]);

  function parse() {
    setError(null);
    setResult(null);
    setDenom(null);
    setDenoms([]);
    setRoot(null);
    try {
      const r = extractPayload(pasted);
      const d = listDenoms(r);
      if (d.length === 0) {
        setError("No denominations found in the pasted data.");
        return;
      }
      setRoot(r);
      setDenoms(d);
      if (d.length === 1) runCompare(r, d[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse WebSocket data.");
    }
  }

  function runCompare(r: PaytableInfoRoot, d: string) {
    setError(null);
    try {
      const wsMap = normalizeWebsocket(r, d);
      const res = compare(d, xmlNorm.map, wsMap, "idBall");
      setDenom(d);
      setResult(res);
      setLabels(xmlNorm.labels);
      setClosed(new Set()); // all mismatch sections open by default
    } catch (e) {
      setDenom(d);
      setResult(null);
      setError(e instanceof Error ? e.message : "Comparison failed.");
    }
  }

  function toggle(mult: number) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(mult)) next.delete(mult);
      else next.add(mult);
      return next;
    });
  }

  const badMultipliers = result
    ? result.multipliers.filter((m) => !m.ok)
    : [];

  return (
    <div className="panel">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{open ? "▾" : "▸"} Compare with WebSocket data</span>
        <span className="muted small">optional</span>
      </button>

      {open && (
        <div className="ws-body">
          <p className="muted small">
            Paste the game-info WebSocket message (with all denoms). Pick a denom
            to compare its paytable against this XML — only mismatches (payout
            differences and entries missing on one side) are shown, per bet line.
          </p>

          <textarea
            className="ws-textarea"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder='Paste WebSocket JSON here (e.g. [{ "data": { "responseText": "…" } }])'
            spellCheck={false}
          />

          <div className="amount-actions">
            <button
              type="button"
              className="btn"
              onClick={parse}
              disabled={pasted.trim() === ""}
            >
              Parse &amp; list denoms
            </button>
          </div>

          {error && <p className="error">{error}</p>}

          {denoms.length > 0 && (
            <div className="ws-denoms">
              <span className="db-label">Denomination</span>
              <div className="ws-denom-chips">
                {denoms.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={"amount-chip" + (denom === d ? " on" : "")}
                    onClick={() => root && runCompare(root, d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className="ws-result">
              {result.ok ? (
                <p className="ws-ok">
                  ✅ All entries match for denom {result.denom} (payout &amp; ball
                  qty).
                </p>
              ) : (
                <p className="ws-bad">
                  ⚠ Mismatches for denom {result.denom}:{" "}
                  {result.totalMismatched} payout, {result.totalMissing} missing.
                </p>
              )}

              {!result.multipliersMatch && (
                <p className="muted small">
                  Bet multipliers differ —
                  {result.multipliersOnlyInXml.length > 0 &&
                    ` only in XML: ${result.multipliersOnlyInXml
                      .map((m) => "x" + m)
                      .join(", ")}`}
                  {result.multipliersOnlyInWs.length > 0 &&
                    ` only in WebSocket: ${result.multipliersOnlyInWs
                      .map((m) => "x" + m)
                      .join(", ")}`}
                  .
                </p>
              )}

              {badMultipliers.map((m) => {
                const isOpen = !closed.has(m.multiplier);
                const label = labels.get(m.multiplier);
                const badRows = m.rows.filter((r) => r.status !== "match");
                return (
                  <section key={m.multiplier} className="win-section">
                    <button
                      type="button"
                      className="win-section-head"
                      aria-expanded={isOpen}
                      onClick={() => toggle(m.multiplier)}
                    >
                      <span className="win-section-caret">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span className="win-section-label">
                        x{m.multiplier}
                        {label ? ` · ${label}` : ""}
                        {m.presence === "ws-only" && " (WebSocket only)"}
                        {m.presence === "xml-only" && " (XML only)"}
                      </span>
                      <span className="award-badge">
                        {m.mismatched} mismatch · {m.missing} missing
                      </span>
                    </button>
                    {isOpen && (
                      <div className="ws-rows">
                        {m.duplicateWarnings.map((w, i) => (
                          <div key={"d" + i} className="ws-row ws-row-dup">
                            {w}
                          </div>
                        ))}
                        {badRows.slice(0, ROW_CAP).map((r) => (
                          <div
                            key={r.key}
                            className={"ws-row ws-row-" + r.status}
                          >
                            {rowText(r)}
                          </div>
                        ))}
                        {badRows.length > ROW_CAP && (
                          <p className="muted small">
                            …and {badRows.length - ROW_CAP} more.
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
