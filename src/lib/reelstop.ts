// Pure helpers for the positional reelStop filter. Kept free of any wa-sqlite
// import so components can use them without pulling the DB layer into the
// initial bundle.

/**
 * Parse a positional search string into one constraint per reel position.
 * Each comma-separated token: empty (or non-numeric) → null = wildcard, else
 * the number the stop must equal. E.g. ",,,,,,,,2" → [null×8, 2] (9th = 2).
 */
export function parsePattern(s: string): (number | null)[] {
  if (s.trim() === "") return [];
  return s.split(",").map((tok) => {
    const t = tok.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  });
}

/**
 * True when `rs` satisfies `pattern`: at every index where the pattern has a
 * number, rs must equal it; null entries (and positions beyond the pattern's
 * length) are unconstrained. An empty/all-null pattern matches everything.
 */
export function matchesPattern(
  rs: number[],
  pattern: (number | null)[]
): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i];
    if (want == null) continue;
    if (rs[i] !== want) return false;
  }
  return true;
}

/** True when the pattern has at least one non-wildcard constraint. */
export function patternIsActive(pattern: (number | null)[]): boolean {
  return pattern.some((v) => v != null);
}

// --- Advanced filter --------------------------------------------------------
// The per-position pattern above needs one leading comma per skipped position,
// which is impractical for a stop deep in the RNG (e.g. position 43). The
// advanced filter instead names an explicit position (or position range) and a
// value (or value range): "in positions 20–30, find any RNG value 500–600".

/** An inclusive numeric range parsed from a "lo-hi" or single "n" string. */
export interface Range {
  lo: number;
  hi: number;
}

/**
 * One advanced constraint: within `pos` (a position or position range, 0-based)
 * the RNG must hold at least one value inside `val` (a value or value range).
 */
export interface AdvancedRule {
  pos: Range;
  val: Range;
}

/**
 * Parse an inclusive range string. Accepts a single non-negative integer ("43")
 * → {lo:43,hi:43}, or "lo-hi" ("20-30") → {lo:20,hi:30} (ends swapped if given
 * high-first). Returns null for blank or malformed input.
 */
export function parseRange(s: string): Range | null {
  const t = s.trim();
  if (t === "") return null;
  const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) {
    let lo = Number(m[1]);
    let hi = Number(m[2]);
    if (lo > hi) [lo, hi] = [hi, lo];
    return { lo, hi };
  }
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return { lo: n, hi: n };
  }
  return null;
}

/**
 * True when `rs` satisfies every advanced rule: for each rule there is some
 * position p in [pos.lo, pos.hi] (within the RNG's length) whose value falls in
 * [val.lo, val.hi]. An empty rule list matches everything.
 */
export function matchesAdvanced(rs: number[], rules: AdvancedRule[]): boolean {
  for (const rule of rules) {
    let ok = false;
    const hi = Math.min(rule.pos.hi, rs.length - 1);
    for (let p = rule.pos.lo; p <= hi; p++) {
      const v = rs[p];
      if (v >= rule.val.lo && v <= rule.val.hi) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}
