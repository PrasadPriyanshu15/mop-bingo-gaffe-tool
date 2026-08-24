import type {
  MatchingPattern,
  Pattern,
  Paytable,
  Paytable59,
} from "./types";
import { patternCells } from "./patterns";

/**
 * Parse a VGTPaytable XML string into patterns + paytables.
 * Runs in the browser via DOMParser (this module is only imported client-side).
 *
 * Throws an Error with a human-readable message if the document is malformed
 * or is not a recognizable VGTPaytable.
 */
export function parsePaytableXml(xml: string): Paytable59 {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("The file is not valid XML.");
  }

  const root = doc.querySelector("VGTPaytable");
  if (!root) {
    throw new Error("Not a VGTPaytable document (missing <VGTPaytable>).");
  }

  const gameId = doc.querySelector("Game")?.getAttribute("ID") ?? "";

  const patterns = parsePatterns(doc);
  if (patterns.length === 0) {
    throw new Error("No <Pattern> entries found under <Bingo><Patterns>.");
  }

  const paytables = parsePaytables(doc);
  if (paytables.length === 0) {
    throw new Error("No <Paytable> entries found under <Paytables>.");
  }

  const evaluationType =
    doc.querySelector("Bingo EvaluationType")?.textContent?.trim() || undefined;

  return { gameId, patterns, paytables, evaluationType };
}

function parsePatterns(doc: Document): Pattern[] {
  const nodes = Array.from(doc.querySelectorAll("Bingo Patterns Pattern"));
  return nodes.map((node) => {
    const id = Number(node.getAttribute("ID"));
    const name = text(node, "Name") ?? `Pattern ${id}`;
    const width = Number(text(node, "Width") ?? "5");
    const height = Number(text(node, "Height") ?? "5");
    const map = (text(node, "PatternMap") ?? "").trim();
    const freeSpaceRaw = text(node, "FreeSpace");
    const freeSpace =
      freeSpaceRaw != null && freeSpaceRaw !== "" ? Number(freeSpaceRaw) : undefined;

    return {
      id,
      name,
      width,
      height,
      map,
      freeSpace,
      cells: patternCells(map),
    };
  });
}

function parsePaytables(doc: Document): Paytable[] {
  const nodes = Array.from(doc.querySelectorAll("Paytables Paytable"));
  return nodes.map((node) => {
    const facadeKey = node.getAttribute("FacadeKey") ?? "";
    const minCredits = Number(node.getAttribute("minCredits") ?? "0");
    const maxCredits = Number(node.getAttribute("maxCredits") ?? "0");

    // FacadeKey looks like "Lines_20_BetPerLine_3" -> betPerLine = 3.
    const betMatch = facadeKey.match(/BetPerLine_(\d+)/);
    const betPerLine = betMatch ? Number(betMatch[1]) : NaN;

    // Newer paytables carry an explicit betMultiplier attribute (e.g. 44507).
    const betMultRaw = node.getAttribute("betMultiplier");
    const betMultiplier =
      betMultRaw != null && betMultRaw !== "" ? Number(betMultRaw) : undefined;

    const entries: MatchingPattern[] = Array.from(
      node.querySelectorAll("MatchingPatterns MatchingPattern")
    ).map((m) => ({
      patternId: Number(m.getAttribute("ID")),
      ballQty: Number(m.getAttribute("BallQty")),
      payout: Number(m.getAttribute("Payout")),
      index: Number(m.getAttribute("Index")),
      evaluationPriority: Number(m.getAttribute("EvaluationPriority")),
    }));

    return { facadeKey, minCredits, maxCredits, betPerLine, betMultiplier, entries };
  });
}

function text(parent: Element, tag: string): string | null {
  return parent.querySelector(tag)?.textContent ?? null;
}
