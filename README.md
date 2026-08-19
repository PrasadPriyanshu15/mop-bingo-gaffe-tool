# MOP Bingo Gaffe Tool

A client-side tool for authoring **gaffe / forcer results** for MOP Class II slot
bingo. Phase 1 is a **pattern & payout explorer**: upload a `VGTPaytable` XML, pick a
bet level, pick a pattern, see it mapped onto the fixed bingo card, and select payout
rows (including geometrically-contained patterns) to accumulate a total payout.

Built with Next.js (static export) so it can be hosted on **GitHub Pages**. Everything
runs in the browser — no server, no data leaves the page.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
```

## How to use

1. **Upload** a VGTPaytable XML (e.g. `59304.xml`).
2. **Select a bet level** (`BetPerLine 1..10`). All downstream data is scoped to it.
3. **Select a pattern** (searchbar + list with mini images).
4. The **bingo card** highlights the pattern's cells (center = free space).
5. The **payouts** panel lists that pattern's instances (by ball qty) plus every
   pattern geometrically **contained** inside it (AllPatternsPaid). Tick rows to add
   them to the **selected outcomes** panel, which keeps a running **total payout**.
6. The right-side **generated gaffe result** panel shows the full
   `{ reelStops, bingoCard, ballCalls }`. `ballCalls` is built as a **free draw
   order** (balls may come in any order — the game does not cycle B/I/N/G/O). Every
   selected pattern's daub numbers are placed **within its selected ball qty**, and
   as late as that allows so the pattern completes right at that ball qty (crossing
   lower, unselected tiers) rather than earlier. This is applied across all selected
   patterns at once — including **contained** ones — so e.g. an Open Vee ticked at 5
   balls has all its numbers inside the first 5 draws. If too many forced numbers
   compete for the early draws to all fit, the panel shows a **warning** naming each
   number that can't meet its pattern's ball qty. Daubs are highlighted (offenders in
   red); **Copy JSON** copies the result.

Selection is a **per-pattern cascade**: clicking a payout row selects it and every
higher-ball-qty row of that pattern (marked "auto"), and their payouts sum. Contained
patterns are selected manually — only then do their daubs enter `ballCalls`.

### Data model notes

- `PatternMap` is a 25-char row-major 5×5 string: `0` empty, `1` marked, `2` free-space
  marked (center, index 12). Cell `i` → row `⌊i/5⌋`, col `i%5`; columns are B/I/N/G/O.
- A pattern id recurs across a paytable with different ball qty / payout.
- Containment: a pattern is "also won" if all its marked cells fit inside the selected
  pattern's marked cells, with the center free space always treated as daubed.

The bingo card and ball calls are hardcoded sample values in `src/lib/sample.ts`
(Phase 1). reelStops handling and ball-call forcing come in later phases.

### reelStops from the outcomes DB

The "reelStops (from DB)" panel reads a vendor outcomes SQLite file (e.g.
`HFNG_10k.db`, ~182 MB) that the user uploads. It runs entirely client-side via
`wa-sqlite` (WASM SQLite) with a **read-only, file-backed VFS**: SQLite page reads
become `File.slice()` byte-range reads, so indexed queries touch only a few KB — the
file is never fully loaded into memory. Pick a facade, and for the current total
payout it looks up `Award` rows (`AwardIndex(FacadeId, Amount, …)`) and shows their
reelStops (`Presentation.RngValues`, fetched by the award's contiguous
`PresentationId` range) as copyable candidates. Nothing is uploaded to a server.

The `.db` is never committed (`.gitignore` excludes `*.db` — it also exceeds GitHub's
file-size limit). The wa-sqlite runtime lives in `public/wa-sqlite/` and loads lazily
on first use.

## Deploy to GitHub Pages

Push to `main` on a GitHub repo with **Pages → Source: GitHub Actions** enabled. The
workflow in `.github/workflows/deploy.yml` builds the static export and deploys it. It
sets `NEXT_PUBLIC_BASE_PATH=/<repo-name>` automatically so assets resolve under
`https://<user>.github.io/<repo-name>/`.

To build locally the same way:

```bash
NEXT_PUBLIC_BASE_PATH=/<repo-name> npm run build   # outputs ./out
```
