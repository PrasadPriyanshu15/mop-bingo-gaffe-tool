/**
 * Credit → currency formula support.
 *
 * Amounts in the paytable XML and the outcomes DB are always expressed in
 * *credits*. Each game converts credits to its own displayed *currency* with a
 * simple linear-ish formula (typically `credit / denomDivisor`, e.g.
 * `credit/100`). This module compiles that user-entered formula into a plain
 * JS function — WITHOUT `eval`/`Function` — so it can be applied to every
 * displayed amount when the tool is switched to currency mode.
 *
 * The grammar is a small arithmetic expression in the single variable `credit`:
 *
 *   expr   := term  (("+" | "-") term)*
 *   term   := factor (("*" | "/") factor)*
 *   factor := ("+" | "-") factor | primary
 *   primary:= number | "credit" | "(" expr ")"
 *
 * Anything outside this grammar (unknown identifiers, stray characters, an
 * unbalanced paren) makes compilation return `null` so callers can flag the
 * formula as invalid rather than silently mis-converting.
 */

type Token =
  | { t: "num"; v: number }
  | { t: "var" }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "lp" }
  | { t: "rp" };

/** The identifiers accepted as "the credit amount" (case-insensitive). */
const CREDIT_WORDS = new Set(["credit", "credits", "c"]);

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isLetter(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

/** Split the formula into tokens, or return null on any unexpected character. */
function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (isDigit(ch) || ch === ".") {
      let j = i;
      let dots = 0;
      while (j < src.length && (isDigit(src[j]) || src[j] === ".")) {
        if (src[j] === ".") dots++;
        j++;
      }
      if (dots > 1) return null; // e.g. "1.2.3"
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) return null;
      tokens.push({ t: "num", v });
      i = j;
      continue;
    }
    if (isLetter(ch)) {
      let j = i;
      while (j < src.length && (isLetter(src[j]) || isDigit(src[j]))) j++;
      const word = src.slice(i, j).toLowerCase();
      if (!CREDIT_WORDS.has(word)) return null; // unknown identifier
      tokens.push({ t: "var" });
      i = j;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ t: "lp" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ t: "rp" });
      i++;
      continue;
    }
    return null; // unrecognized character
  }
  return tokens;
}

type Fn = (credit: number) => number;

/**
 * Compile a credit→currency formula into a converter function, or return
 * `null` if the formula is empty or malformed. The returned function is pure
 * and cheap enough to call once per displayed amount.
 */
export function compileFormula(src: string): Fn | null {
  const tokens = tokenize(src);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  function parseExpr(): Fn | null {
    const first = parseTerm();
    if (!first) return null;
    let left: Fn = first;
    for (;;) {
      const tk = peek();
      if (tk?.t === "op" && (tk.v === "+" || tk.v === "-")) {
        pos++;
        const right = parseTerm();
        if (!right) return null;
        const l: Fn = left;
        const r: Fn = right;
        left =
          tk.v === "+"
            ? (c: number) => l(c) + r(c)
            : (c: number) => l(c) - r(c);
      } else break;
    }
    return left;
  }

  function parseTerm(): Fn | null {
    const first = parseFactor();
    if (!first) return null;
    let left: Fn = first;
    for (;;) {
      const tk = peek();
      if (tk?.t === "op" && (tk.v === "*" || tk.v === "/")) {
        pos++;
        const right = parseFactor();
        if (!right) return null;
        const l: Fn = left;
        const r: Fn = right;
        left =
          tk.v === "*"
            ? (c: number) => l(c) * r(c)
            : (c: number) => l(c) / r(c);
      } else break;
    }
    return left;
  }

  function parseFactor(): Fn | null {
    const tk = peek();
    if (tk?.t === "op" && (tk.v === "+" || tk.v === "-")) {
      pos++;
      const f = parseFactor();
      if (!f) return null;
      return tk.v === "-" ? (c) => -f(c) : f;
    }
    return parsePrimary();
  }

  function parsePrimary(): Fn | null {
    const tk = peek();
    if (!tk) return null;
    if (tk.t === "num") {
      pos++;
      const v = tk.v;
      return () => v;
    }
    if (tk.t === "var") {
      pos++;
      return (c) => c;
    }
    if (tk.t === "lp") {
      pos++;
      const e = parseExpr();
      if (!e) return null;
      if (peek()?.t !== "rp") return null;
      pos++;
      return e;
    }
    return null;
  }

  const fn = parseExpr();
  if (!fn || pos !== tokens.length) return null; // leftover tokens = malformed

  // Reject formulas that don't yield a finite number (e.g. a bare "credit/0").
  const probe = fn(100);
  if (!Number.isFinite(probe)) return null;
  return fn;
}

/** Format a raw credit amount with grouping separators (the default display). */
export function formatCredits(credits: number): string {
  return credits.toLocaleString();
}

/**
 * Format a credit amount as currency using an already-compiled converter, e.g.
 * `$123.45`. Two fraction digits, the usual convention for a $ amount.
 */
export function formatCurrency(credits: number, convert: Fn): string {
  return (
    "$" +
    convert(credits).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
