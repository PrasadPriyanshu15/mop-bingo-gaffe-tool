"use client";

import type { Paytable } from "@/lib/types";

interface Props {
  paytables: Paytable[];
  selectedKey: string | null;
  onSelect: (facadeKey: string) => void;
}

function label(p: Paytable): string {
  const credits = p.minCredits ? ` — ${p.minCredits} credits` : "";
  // Old style: "Lines_20_BetPerLine_2" → parse a BetPerLine number to label.
  if (!Number.isNaN(p.betPerLine)) {
    return `BetPerLine ${p.betPerLine}${credits}`;
  }
  // Type-2 style facade keys (e.g. "D1_B1") — show the key itself.
  return `${p.facadeKey}${credits}`;
}

/** Dropdown of the (up to) 10 bet levels. Required before downstream steps. */
export default function BetLevelSelect({
  paytables,
  selectedKey,
  onSelect,
}: Props) {
  return (
    <div className="panel">
      <div className="panel-title">2 · Select bet level</div>
      <select
        className="select"
        value={selectedKey ?? ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="" disabled>
          Choose a bet level…
        </option>
        {paytables.map((p) => (
          <option key={p.facadeKey} value={p.facadeKey}>
            {label(p)}
          </option>
        ))}
      </select>
    </div>
  );
}
