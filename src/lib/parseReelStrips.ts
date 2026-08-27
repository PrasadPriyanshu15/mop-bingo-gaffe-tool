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
// per reel. Unlike the APP XML, each stop carries a `weight`, so an RNG value
// maps to a symbol via cumulative weights rather than a direct position.
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

  return defs.map((def, i) => {
    const stops = Array.isArray(def.stops) ? def.stops : [];
    if (stops.length === 0) {
      throw new Error(`Reel "${def.name ?? i + 1}" has no stops.`);
    }
    const symbols = stops.map((s) => s.name ?? "?");
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
