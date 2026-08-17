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
