import type { CompareResult } from "@/lib/types";

const fmtMults = (m: number[]) =>
  m.length ? m.map((n) => `x${n}`).join(", ") : "—";

export function SummaryCard({ result }: { result: CompareResult }) {
  const {
    denom,
    ok,
    totalRows,
    totalMatched,
    totalMismatched,
    totalMissing,
    multipliers,
    xmlMultipliers,
    wsMultipliers,
    multipliersOnlyInXml,
    multipliersOnlyInWs,
    multipliersMatch,
    likelyMisaligned,
    pairedRowCount,
    idAlignedCount,
  } = result;

  const idAlignedPct =
    pairedRowCount > 0 ? Math.round((idAlignedCount / pairedRowCount) * 100) : 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Comparison summary</h2>
          <p className="text-sm text-slate-500">
            Denomination <span className="font-mono">{denom}</span> ·{" "}
            {multipliers.length} bet multiplier(s)
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
          }`}
        >
          {ok ? "ALL MATCH" : "MISMATCHES FOUND"}
        </span>
      </div>

      {/* Alignment guard: priority-pairing lined up mostly different pattern IDs. */}
      {likelyMisaligned && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">⚠ These files may not match</div>
          <p className="mt-1 text-xs">
            Only <span className="font-semibold">{idAlignedPct}%</span> of
            priority-paired rows landed on the same pattern ID ({idAlignedCount} of{" "}
            {pairedRowCount}). Pairing by priority assumes both sources put the same
            pattern at each evaluation slot — so a low match here usually means the
            pasted websocket is a <strong>different game or denomination</strong> than
            this XML (or the two order patterns differently). Double-check that the
            websocket &ldquo;game info&rdquo; belongs to this exact game/denom before
            trusting the row-level diffs below.
          </p>
        </div>
      )}

      {/* Bet-multiplier set check: do XML and websocket declare the same multipliers? */}
      <div
        className={`mt-4 rounded-md border p-3 text-sm ${
          multipliersMatch
            ? "border-green-200 bg-green-50 text-green-800"
            : "border-red-200 bg-red-50 text-red-800"
        }`}
      >
        <div className="flex items-center gap-2 font-semibold">
          {multipliersMatch ? "✓" : "⚠"} Bet multipliers{" "}
          {multipliersMatch
            ? `match — ${xmlMultipliers.length} on both sides`
            : `DIFFER — XML has ${xmlMultipliers.length}, websocket has ${wsMultipliers.length}`}
        </div>
        <div className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
          <div>
            XML: <span className="font-mono">{fmtMults(xmlMultipliers)}</span>
          </div>
          <div>
            Websocket: <span className="font-mono">{fmtMults(wsMultipliers)}</span>
          </div>
        </div>
        {!multipliersMatch && (
          <div className="mt-1 text-xs">
            {multipliersOnlyInWs.length > 0 && (
              <div>
                Only in websocket (extra):{" "}
                <span className="font-mono font-semibold">
                  {fmtMults(multipliersOnlyInWs)}
                </span>
              </div>
            )}
            {multipliersOnlyInXml.length > 0 && (
              <div>
                Only in XML (missing from websocket):{" "}
                <span className="font-mono font-semibold">
                  {fmtMults(multipliersOnlyInXml)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Rows compared" value={totalRows} />
        <Stat label="Matched" value={totalMatched} tone="green" />
        <Stat label="Mismatched" value={totalMismatched} tone={totalMismatched ? "red" : "slate"} />
        <Stat label="Missing" value={totalMissing} tone={totalMissing ? "amber" : "slate"} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {multipliers.map((m) => (
          <span
            key={m.multiplier}
            className={`rounded px-2 py-1 text-xs font-medium ${
              m.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
            title={
              m.presence === "both"
                ? `matched ${m.matched} · mismatched ${m.mismatched} · missing ${m.missing}`
                : m.presence === "ws-only"
                  ? "Present only in the websocket (not in the XML)"
                  : "Present only in the XML (not in the websocket)"
            }
          >
            x{m.multiplier} {m.ok ? "✓" : "✗"}
            {m.presence === "ws-only" && " (WS only)"}
            {m.presence === "xml-only" && " (XML only)"}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "green" | "red" | "amber";
}) {
  const tones: Record<string, string> = {
    slate: "text-slate-900",
    green: "text-green-700",
    red: "text-red-700",
    amber: "text-amber-700",
  };
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className={`text-2xl font-bold ${tones[tone]}`}>{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
