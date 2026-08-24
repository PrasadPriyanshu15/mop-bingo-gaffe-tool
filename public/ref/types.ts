// Shared types for the bingo pattern verification tool.

/**
 * A single bingo pattern row normalized to a common shape, whether it came from
 * the XML paytable or the websocket payload. This is the unit of comparison.
 */
export interface NormalizedRow {
  /** Pattern ID (XML `MatchingPattern ID` / websocket `id`). */
  id: number;
  /** Ball call count (XML `BallQty` / websocket `Balls Called`). */
  ballCall: number;
  /** Payout in credits (XML `Payout` / websocket `Credits`). */
  payout: number;
  /**
   * Evaluation priority — the stable slot rows are paired on.
   * XML `EvaluationPriority` (optional; falls back to `Index`, then document
   * order) / websocket `Priority`.
   */
  priority: number;
  /** Friendly pattern name for display (from XML pattern dict / websocket master info). */
  name?: string;
  /** 25-char pattern bitmap (XML `PatternMap` / websocket `pattern`). */
  pattern?: string;
}

/** Bet multiplier (1..10) -> its rows. */
export type MultiplierMap = Map<number, NormalizedRow[]>;

/**
 * How XML and websocket rows are paired within a multiplier:
 *  - "priority": legacy format — join on the shared evaluation priority slot.
 *  - "idBall": new format — join on the stable (pattern id + ball call) identity,
 *    because Index (XML) and Priority (WS) are unrelated orderings.
 */
export type PairBy = "priority" | "idBall";

export type RowStatus = "match" | "mismatch" | "missing-in-websocket" | "missing-in-xml";

/** Which fields differ on a paired row. */
export type DiffField = "id" | "ballCall" | "payout" | "pattern";

/**
 * Comparison outcome for one evaluation priority within a multiplier.
 * Rows are paired by priority (the stable evaluation slot); ID, ball call, and
 * payout are then compared as fields.
 */
export interface RowDiff {
  key: string; // priority as string
  priority: number;
  id: number; // representative id (xml, else ws) for display
  ballCall: number; // representative ball call for display
  name?: string;
  status: RowStatus;
  diffFields: DiffField[];
  xml?: NormalizedRow;
  ws?: NormalizedRow;
}

export interface MultiplierDiff {
  multiplier: number;
  /** Which side(s) declared this bet multiplier at all. */
  presence: "both" | "xml-only" | "ws-only";
  rows: RowDiff[];
  xmlRowCount: number;
  wsRowCount: number;
  matched: number;
  mismatched: number;
  missing: number;
  /** (id+ballCall) keys that appear more than once on a side. */
  duplicateWarnings: string[];
  ok: boolean;
}

export interface CompareResult {
  denom: string;
  multipliers: MultiplierDiff[];
  totalRows: number;
  totalMatched: number;
  totalMismatched: number;
  totalMissing: number;
  ok: boolean;
  /** Sorted list of bet multipliers each source declares, and their disagreement. */
  xmlMultipliers: number[];
  wsMultipliers: number[];
  /** Multipliers present on only one side (e.g. a stray x4 in the websocket). */
  multipliersOnlyInXml: number[];
  multipliersOnlyInWs: number[];
  /** True when both sources declare exactly the same set of bet multipliers. */
  multipliersMatch: boolean;
  /** Which strategy paired the rows (see PairBy). */
  pairBy: PairBy;
  /** Rows where both sides had a partner (i.e. actually compared). */
  pairedRowCount: number;
  /** Of the paired rows, how many landed on the SAME pattern id. */
  idAlignedCount: number;
  /**
   * True when priority-pairing lined up mostly DIFFERENT pattern ids — a strong
   * signal the two files are different games/denominations (or ordered differently),
   * so the comparison is pairing unrelated patterns. Always false for id+ball pairing.
   */
  likelyMisaligned: boolean;
}
