// Comparison engine: pair XML and websocket rows by evaluation PRIORITY within
// each bet multiplier, then compare ID, ball call, and payout as fields.
//
// Priority is the stable evaluation slot that both sources agree on; ID / ball
// call / payout are the values verified at that slot. A priority present on only
// one side is reported as missing.

import type {
  CompareResult,
  DiffField,
  MultiplierDiff,
  MultiplierMap,
  NormalizedRow,
  PairBy,
  RowDiff,
  RowStatus,
} from "./types";

/** The join key a row is paired on, per the chosen strategy. */
function keyOf(r: NormalizedRow, pairBy: PairBy): string {
  return pairBy === "idBall" ? `${r.id}|${r.ballCall}` : String(r.priority);
}

/** Index rows by their pairing key, tracking any duplicate keys on this side. */
function indexRows(
  rows: NormalizedRow[],
  pairBy: PairBy,
): { map: Map<string, NormalizedRow>; duplicates: Set<string> } {
  const map = new Map<string, NormalizedRow>();
  const duplicates = new Set<string>();
  for (const r of rows) {
    const k = keyOf(r, pairBy);
    if (map.has(k)) duplicates.add(k);
    else map.set(k, r);
  }
  return { map, duplicates };
}

function diffFields(xml: NormalizedRow, ws: NormalizedRow): DiffField[] {
  const out: DiffField[] = [];
  if (xml.id !== ws.id) out.push("id");
  if (xml.ballCall !== ws.ballCall) out.push("ballCall");
  if (xml.payout !== ws.payout) out.push("payout");
  if ((xml.pattern ?? "") !== (ws.pattern ?? "")) out.push("pattern");
  return out;
}

function compareMultiplier(
  multiplier: number,
  presence: MultiplierDiff["presence"],
  xmlRows: NormalizedRow[],
  wsRows: NormalizedRow[],
  pairBy: PairBy,
): MultiplierDiff {
  const x = indexRows(xmlRows, pairBy);
  const w = indexRows(wsRows, pairBy);

  const keys = new Set<string>([...x.map.keys(), ...w.map.keys()]);
  const rows: RowDiff[] = [];

  let matched = 0;
  let mismatched = 0;
  let missing = 0;

  for (const key of keys) {
    const xml = x.map.get(key);
    const ws = w.map.get(key);

    let status: RowStatus;
    let fields: DiffField[] = [];

    if (xml && ws) {
      fields = diffFields(xml, ws);
      if (fields.length === 0) {
        status = "match";
        matched += 1;
      } else {
        status = "mismatch";
        mismatched += 1;
      }
    } else if (xml && !ws) {
      status = "missing-in-websocket";
      missing += 1;
    } else {
      status = "missing-in-xml";
      missing += 1;
    }

    const ref = xml ?? ws!;
    rows.push({
      key,
      priority: ref.priority,
      id: ref.id,
      ballCall: ref.ballCall,
      name: xml?.name ?? ws?.name,
      status,
      diffFields: fields,
      xml,
      ws,
    });
  }

  // Sort by the XML priority (payout rank / eval slot) when available so the
  // table reads top-prize-first; fall back to the WS priority for XML-only-missing
  // rows. Ties keep a stable order via the join key.
  rows.sort(
    (a, b) =>
      (a.xml?.priority ?? a.ws?.priority ?? a.priority) -
        (b.xml?.priority ?? b.ws?.priority ?? b.priority) ||
      a.key.localeCompare(b.key),
  );

  const dupLabel = pairBy === "idBall" ? "id+ball" : "priority";
  const duplicateWarnings = [
    ...[...x.duplicates].map((k) => `XML duplicate ${dupLabel}: ${k}`),
    ...[...w.duplicates].map((k) => `Websocket duplicate ${dupLabel}: ${k}`),
  ];

  return {
    multiplier,
    presence,
    rows,
    xmlRowCount: xmlRows.length,
    wsRowCount: wsRows.length,
    matched,
    mismatched,
    missing,
    duplicateWarnings,
    ok: mismatched === 0 && missing === 0 && duplicateWarnings.length === 0,
  };
}

export function compare(
  denom: string,
  xml: MultiplierMap,
  ws: MultiplierMap,
  pairBy: PairBy = "priority",
): CompareResult {
  const xmlMultipliers = [...xml.keys()].sort((a, b) => a - b);
  const wsMultipliers = [...ws.keys()].sort((a, b) => a - b);
  const multipliersOnlyInXml = xmlMultipliers.filter((m) => !ws.has(m));
  const multipliersOnlyInWs = wsMultipliers.filter((m) => !xml.has(m));
  const multipliersMatch =
    multipliersOnlyInXml.length === 0 && multipliersOnlyInWs.length === 0;

  const multKeys = new Set<number>([...xml.keys(), ...ws.keys()]);
  const multipliers: MultiplierDiff[] = [];

  for (const mult of [...multKeys].sort((a, b) => a - b)) {
    const inXml = xml.has(mult);
    const inWs = ws.has(mult);
    const presence: MultiplierDiff["presence"] =
      inXml && inWs ? "both" : inXml ? "xml-only" : "ws-only";
    multipliers.push(
      compareMultiplier(mult, presence, xml.get(mult) ?? [], ws.get(mult) ?? [], pairBy),
    );
  }

  const totalRows = multipliers.reduce((s, m) => s + m.rows.length, 0);
  const totalMatched = multipliers.reduce((s, m) => s + m.matched, 0);
  const totalMismatched = multipliers.reduce((s, m) => s + m.mismatched, 0);
  const totalMissing = multipliers.reduce((s, m) => s + m.missing, 0);

  // Alignment health: among rows that actually paired, how many landed on the same
  // pattern id? When pairing by priority, a low ratio means the two sources disagree
  // on which pattern sits at each slot — usually because they are different games or
  // denominations, or the pasted websocket doesn't belong to this XML.
  let pairedRowCount = 0;
  let idAlignedCount = 0;
  for (const m of multipliers) {
    for (const r of m.rows) {
      if (r.xml && r.ws) {
        pairedRowCount += 1;
        if (r.xml.id === r.ws.id) idAlignedCount += 1;
      }
    }
  }
  const likelyMisaligned =
    pairBy === "priority" &&
    pairedRowCount > 0 &&
    idAlignedCount / pairedRowCount < 0.5;

  return {
    denom,
    multipliers,
    totalRows,
    totalMatched,
    totalMismatched,
    totalMissing,
    ok: multipliers.every((m) => m.ok) && multipliersMatch,
    xmlMultipliers,
    wsMultipliers,
    multipliersOnlyInXml,
    multipliersOnlyInWs,
    multipliersMatch,
    pairBy,
    pairedRowCount,
    idAlignedCount,
    likelyMisaligned,
  };
}
