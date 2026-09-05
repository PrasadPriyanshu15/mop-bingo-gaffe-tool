// Parse a reelStrip XML (main_reelstrips.xml) into one strip per reel.
// Runs in the browser via DOMParser (imported client-side only), matching the
// approach in parseXml.ts.
//
// Shape:
//   <reelstripdefs>
//     <reelstripdef name="reel 1">
//       <stop symbolname="Wild"/> <stop symbolname="Mine"/> ...
//     </reelstripdef>
//     ...
//   </reelstripdefs>

export interface ReelStrip {
  name: string;
  symbols: string[];
  /** HPP (weighted) strips only: running inclusive weight sums, aligned to
   *  `symbols`. Absent ⇒ APP/unweighted, mapped positionally. */
  cumWeights?: number[];
  /** HPP only: total weight of the reel (= cumWeights at the last index). */
  totalWeight?: number;
}

/** One reelStrip set (a full game's worth of reels/columns). A single uploaded
 *  file can hold several sets of the same game — e.g. a "nomummy" set and a
 *  "mummy" set — so the viewer lets the user pick which set to load. */
export interface ReelStripSet {
  /** Label for the set (the text trailing the reel number, e.g. "mummy"), or
   *  "" when the names carry no trailing label. */
  name: string;
  reels: ReelStrip[];
}

/**
 * Split a flat reel list into sets. Reel names commonly follow "reel <N> <label>"
 * (e.g. "reel 1 nomummy" … "reel 5 nomummy", then "reel 1 mummy" …). A new set
 * starts wherever that leading number is 1 or drops back to/below the previous
 * reel's number; the trailing text labels the set. If the names don't all follow
 * this pattern, the whole list is returned as a single unlabeled set (the
 * previous behaviour), so nothing regresses for files without set numbering.
 */
export function groupReelStripSets(reels: ReelStrip[]): ReelStripSet[] {
  const parse = (name: string): { idx: number; label: string } | null => {
    const m = /^\s*reel\s+(\d+)\s*(.*)$/i.exec(name);
    return m ? { idx: Number(m[1]), label: m[2].trim() } : null;
  };

  // Only split when every reel name carries a "reel <N>" number to key on.
  if (reels.length === 0 || reels.some((r) => parse(r.name) === null)) {
    return [{ name: "", reels }];
  }

  const sets: ReelStripSet[] = [];
  let cur: ReelStrip[] = [];
  let curLabel = "";
  let prevIdx = Infinity;
  for (const r of reels) {
    const p = parse(r.name)!;
    if (cur.length > 0 && p.idx <= prevIdx) {
      sets.push({ name: curLabel, reels: cur });
      cur = [];
      curLabel = "";
    }
    cur.push(r);
    if (p.label && !curLabel) curLabel = p.label; // first non-empty label wins
    prevIdx = p.idx;
  }
  if (cur.length > 0) sets.push({ name: curLabel, reels: cur });

  return sets;
}

export function parseReelStrips(xml: string): ReelStrip[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  if (doc.querySelector("parsererror")) {
    throw new Error("The file is not valid XML.");
  }

  const defs = Array.from(doc.querySelectorAll("reelstripdefs reelstripdef"));
  if (defs.length === 0) {
    throw new Error("No <reelstripdef> reels found in the file.");
  }

  return defs.map((def, i) => ({
    name: def.getAttribute("name") ?? `reel ${i + 1}`,
    symbols: Array.from(def.querySelectorAll("stop")).map(
      (s) => s.getAttribute("symbolname") ?? "?"
    ),
  }));
}

// Parse an HPP reelStrip JSON (e.g. main-reelstrips-var99.json) into one strip
// per reel. Two flavours share this shape:
//   - Weighted: each stop carries a `weight`, so an RNG value maps to a symbol
//     via cumulative weights rather than a direct position.
//   - Unweighted (sequence): stops carry only a `name` — a plain sequence just
//     like the APP XML, where an RNG value maps to a symbol positionally. HPP
//     games can ship reelStrips in this form too.
// The flavour is detected from the data: if no stop anywhere carries a weight,
// the strips are parsed as unweighted (no cumWeights/totalWeight) so they behave
// identically to APP positional strips.
//
// Shape:
//   { "reelStripDefinitions": [
//       { "name": "reel 1",
//         "stops": [ { "name": "King", "weight": 5 }, { "name": "Jack", "weight": 8 }, ... ] },
//       ...
//   ] }

interface JsonStop {
  name?: string;
  weight?: number;
}
interface JsonReelDef {
  name?: string;
  stops?: JsonStop[];
}

export function parseReelStripsJson(text: string): ReelStrip[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }

  const defs = (doc as { reelStripDefinitions?: JsonReelDef[] })
    ?.reelStripDefinitions;
  if (!Array.isArray(defs) || defs.length === 0) {
    throw new Error("No \"reelStripDefinitions\" reels found in the file.");
  }

  // If no stop anywhere carries a weight, this is an unweighted sequence file
  // (same as APP): map RNG values positionally, so leave cumWeights/totalWeight
  // off entirely rather than building all-zero weights.
  const weighted = defs.some(
    (def) =>
      Array.isArray(def.stops) &&
      def.stops.some((s) => s.weight != null && !Number.isNaN(Number(s.weight)))
  );

  return defs.map((def, i) => {
    const stops = Array.isArray(def.stops) ? def.stops : [];
    if (stops.length === 0) {
      throw new Error(`Reel "${def.name ?? i + 1}" has no stops.`);
    }
    const symbols = stops.map((s) => s.name ?? "?");
    if (!weighted) {
      return { name: def.name ?? `reel ${i + 1}`, symbols };
    }
    const cumWeights: number[] = [];
    let running = 0;
    for (const s of stops) {
      running += Number(s.weight) || 0;
      cumWeights.push(running);
    }
    return {
      name: def.name ?? `reel ${i + 1}`,
      symbols,
      cumWeights,
      totalWeight: running,
    };
  });
}
