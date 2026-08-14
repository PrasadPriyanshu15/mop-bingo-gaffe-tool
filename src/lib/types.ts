// Domain types for the MOP Class II bingo paytable (VGTPaytable XML).

/** A master pattern shape from <Bingo><Patterns>. */
export interface Pattern {
  id: number;
  name: string;
  width: number;
  height: number;
  /** 25-char row-major map: '0' empty, '1' marked, '2' free-space marked. */
  map: string;
  /** Optional free-space cell index (always 12 / center when present). */
  freeSpace?: number;
  /** Precomputed marked cell indices (where map[i] is '1' or '2'). */
  cells: number[];
}

/** A single payable row inside a paytable, referencing a Pattern by id. */
export interface MatchingPattern {
  patternId: number;
  ballQty: number;
  payout: number;
  /** Unique index within its paytable — used as a stable row key. */
  index: number;
  evaluationPriority: number;
}

/** One bet level (<Paytable>), e.g. Lines_20_BetPerLine_1. */
export interface Paytable {
  facadeKey: string;
  minCredits: number;
  maxCredits: number;
  /** Bet-per-line multiplier parsed from the facade key (1..10). */
  betPerLine: number;
  entries: MatchingPattern[];
}

/** Result of parsing a VGTPaytable XML document. */
export interface Paytable59 {
  gameId: string;
  patterns: Pattern[];
  paytables: Paytable[];
}

/** A gaffe result structure (only bingoCard + ballCalls used this phase). */
export interface Gaffe {
  reelStops?: number[];
  bingoCard: number[][];
  ballCalls: number[];
}
