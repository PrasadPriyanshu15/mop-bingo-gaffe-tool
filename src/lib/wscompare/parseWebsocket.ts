// Parse and normalize the game "game info" websocket payload into per-multiplier
// normalized rows for a chosen denomination. Adapted verbatim from the reference
// implementation in /public/ref/parseWebsocket.ts.
//
// Shape of the payload:
//   [ { data: { responseText: "<stringified JSON>" } } ]
// where the inner JSON is:
//   { PaytableInfo: { bingoPatterns: { patterns: [...], denoms: {...} } } }
//
// - `patterns[]` is the master list: { uuid, id, info: { name, Credits, "Balls Called", Priority } }
// - `denoms[D].lines["20"].multipliers[N].patterns[]` are slices: { uuid, id, info }
//   where info may carry a Credits override.

import type { MultiplierMap, NormalizedRow } from "./types";

interface MasterInfo {
  name?: string;
  Credits?: string | number;
  "Balls Called"?: string | number;
  Priority?: string | number;
}

interface MasterPattern {
  uuid: number | string;
  id: number;
  pattern?: string;
  width?: number;
  height?: number;
  info: MasterInfo;
}

interface SliceRow {
  uuid: number | string;
  id: number;
  info: { Credits?: string | number };
}

export interface PaytableInfoRoot {
  PaytableInfo?: {
    bingoPatterns?: {
      patterns?: MasterPattern[];
      denoms?: Record<
        string,
        {
          lines?: Record<
            string,
            { multipliers?: Record<string, { patterns?: SliceRow[] }> }
          >;
        }
      >;
    };
  };
}

const toNum = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : NaN;
};

/**
 * Resiliently turn whatever the tester pasted into a PaytableInfoRoot object.
 * Accepts: the full array, a single { data: { responseText } } object, the raw
 * responseText string, or an already-parsed PaytableInfo object.
 */
export function extractPayload(pasted: string): PaytableInfoRoot {
  const trimmed = pasted.trim();
  if (!trimmed) throw new Error("Websocket data is empty.");

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new Error("Websocket data is not valid JSON.");
  }

  // Unwrap array -> first element.
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error("Websocket data array is empty.");
    value = value[0];
  }

  // Unwrap { data: { responseText } }.
  if (
    value &&
    typeof value === "object" &&
    "data" in value &&
    (value as { data?: { responseText?: unknown } }).data?.responseText !==
      undefined
  ) {
    const rt = (value as { data: { responseText: unknown } }).data.responseText;
    value = typeof rt === "string" ? JSON.parse(rt) : rt;
  }

  // If the value itself is a responseText string.
  if (typeof value === "string") {
    value = JSON.parse(value);
  }

  const root = value as PaytableInfoRoot;
  if (!root?.PaytableInfo?.bingoPatterns) {
    throw new Error(
      "Could not find PaytableInfo.bingoPatterns in the pasted data. Paste the full game-info websocket message."
    );
  }
  return root;
}

/** List denominations available in the payload (e.g. ["0.05", "0.1", "0.25"]). */
export function listDenoms(root: PaytableInfoRoot): string[] {
  const denoms = root.PaytableInfo?.bingoPatterns?.denoms ?? {};
  return Object.keys(denoms);
}

/**
 * Normalize the websocket payload for one denom into a map of multiplier -> rows.
 * Each slice row is resolved against the master list by uuid; info.Credits
 * overrides the master Credits when present.
 */
export function normalizeWebsocket(
  root: PaytableInfoRoot,
  denom: string
): MultiplierMap {
  const bingo = root.PaytableInfo?.bingoPatterns;
  if (!bingo) throw new Error("Missing bingoPatterns in payload.");

  const master = bingo.patterns ?? [];
  const byUuid = new Map<string, MasterPattern>();
  for (const p of master) byUuid.set(String(p.uuid), p);

  const denomNode = bingo.denoms?.[denom];
  if (!denomNode) throw new Error(`Denomination "${denom}" not found in payload.`);

  const result: MultiplierMap = new Map();

  // lines is typically { "20": { multipliers: {...} } }.
  for (const lineKey of Object.keys(denomNode.lines ?? {})) {
    const multipliers = denomNode.lines?.[lineKey]?.multipliers ?? {};
    for (const multKey of Object.keys(multipliers)) {
      const mult = Number(multKey);
      const slice = multipliers[multKey]?.patterns ?? [];
      const rows: NormalizedRow[] = slice.map((row) => {
        const m = byUuid.get(String(row.uuid));
        if (!m) {
          throw new Error(
            `Websocket row references uuid ${row.uuid} (id ${row.id}) not present in the master patterns list.`
          );
        }
        const payout =
          row.info?.Credits !== undefined && row.info?.Credits !== null
            ? toNum(row.info.Credits)
            : toNum(m.info?.Credits);
        return {
          id: toNum(row.id ?? m.id),
          ballCall: toNum(m.info?.["Balls Called"]),
          payout,
          priority: toNum(m.info?.Priority),
          name: m.info?.name,
          pattern: m.pattern != null ? String(m.pattern) : undefined,
        };
      });
      result.set(mult, rows);
    }
  }

  if (result.size === 0) {
    throw new Error(`No multiplier data found for denomination "${denom}".`);
  }
  return result;
}
