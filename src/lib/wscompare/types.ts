// Shared types for the WebSocket-vs-XML paytable comparison (adapted from a
// sibling project's reference implementation in /public/ref).

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
   * Evaluation priority — used for display ordering (and priority pairing).
   * XML `EvaluationPriority` / websocket `Priority`.
   */
  priority: number;
  /** Friendly pattern name for display. */
  name?: string;
  /** 25-char pattern bitmap (XML `PatternMap` / websocket `pattern`). */
  pattern?: string;
}

/** Bet multiplier (1..10) -> its rows. */
export type MultiplierMap = Map<number, NormalizedRow[]>;

/**
 * How XML and websocket rows are paired within a multiplier:
 *  - "priority": legacy format — join on the shared evaluation priority slot.
 *  - "idBall": new format — join on the stable (pattern id + ball call) identity.
 */
export type PairBy = "priority" | "idBall";

export type RowStatus =
  | "match"
  | "mismatch"
  | "missing-in-websocket"
  | "missing-in-xml";

/** Which fields differ on a paired row (this mini build compares payout only). */
export type DiffField = "id" | "ballCall" | "payout" | "pattern";

export interface RowDiff {
  key: string;
  priority: number;
  id: number;
  ballCall: number;
  name?: string;
  status: RowStatus;
  diffFields: DiffField[];
  xml?: NormalizedRow;
  ws?: NormalizedRow;
}

export interface MultiplierDiff {
  multiplier: number;
  presence: "both" | "xml-only" | "ws-only";
  rows: RowDiff[];
  xmlRowCount: number;
  wsRowCount: number;
  matched: number;
  mismatched: number;
  missing: number;
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
  xmlMultipliers: number[];
  wsMultipliers: number[];
  multipliersOnlyInXml: number[];
  multipliersOnlyInWs: number[];
  multipliersMatch: boolean;
  pairBy: PairBy;
  pairedRowCount: number;
  idAlignedCount: number;
  likelyMisaligned: boolean;
}
