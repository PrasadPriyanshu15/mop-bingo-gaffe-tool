// Convert the parsed XML paytable into the same MultiplierMap shape the websocket
// normalizer produces, so the two can be compared. One XML bet line = one bet
// multiplier; each MatchingPattern row becomes a NormalizedRow.

import type { MultiplierMap, NormalizedRow } from "./types";
import type { Paytable, Paytable59 } from "@/lib/types";

/** Best-effort bet multiplier for a bet line: attribute, then facade-key parse. */
export function betMultiplierOf(pt: Paytable): number {
  if (pt.betMultiplier != null && Number.isFinite(pt.betMultiplier)) {
    return pt.betMultiplier;
  }
  const byPerLine = pt.facadeKey.match(/BetPerLine_(\d+)/i);
  if (byPerLine) return Number(byPerLine[1]);
  // e.g. "75_B1_FG3", "D10_B1" -> the "B<n>" bet-multiplier token.
  const byB = pt.facadeKey.match(/(?:^|[_-])B(\d+)/i);
  if (byB) return Number(byB[1]);
  if (Number.isFinite(pt.betPerLine)) return pt.betPerLine;
  return NaN;
}

export interface XmlNormalized {
  map: MultiplierMap;
  /** Bet multiplier -> the source facade key, for display. */
  labels: Map<number, string>;
}

export function normalizeXml(data: Paytable59): XmlNormalized {
  const map: MultiplierMap = new Map();
  const labels = new Map<number, string>();
  const patternById = new Map(data.patterns.map((p) => [p.id, p]));

  for (const pt of data.paytables) {
    const mult = betMultiplierOf(pt);
    if (!Number.isFinite(mult)) continue;

    const rows: NormalizedRow[] = pt.entries.map((e) => ({
      id: e.patternId,
      ballCall: e.ballQty,
      payout: e.payout,
      priority: e.evaluationPriority,
      name: patternById.get(e.patternId)?.name,
      pattern: patternById.get(e.patternId)?.map,
    }));

    const existing = map.get(mult);
    if (existing) existing.push(...rows);
    else {
      map.set(mult, rows);
      labels.set(mult, pt.facadeKey);
    }
  }

  return { map, labels };
}
