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
