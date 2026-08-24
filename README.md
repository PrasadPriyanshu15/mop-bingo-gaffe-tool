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

1. **Upload** a VGTPaytable XML (e.g. `59304.xml`). An **XML validation** panel
   then reports two authoring checks: every pattern must mark the center free
   space as `2` at index 12 **or** declare `<FreeSpace>12</FreeSpace>` (with no
   `2` in the map), and within each bet line the `EvaluationPriority` values must
   ascend by exactly +1. Any mismatch is listed by pattern id/name or by facade +
   entry index; a clean file shows a "valid" note.
2. *(Optional)* **Compare with WebSocket data** — paste the game-info WebSocket
   payload (which carries every denomination), pick a denom, and the tool compares
   that denom's paytable against the loaded XML. Rows are paired by pattern id +
   ball qty per bet line and **payout** is compared; only **mismatches** (payout
   differences, plus entries missing on one side — which is how a ball-qty
   difference surfaces) are shown, grouped per bet line in collapsible sections.
   The comparison engine is adapted from a sibling project (see `public/ref/`).
   Purely informational — you can skip it and proceed with the XML.
3. **Select a bet level** (`BetPerLine 1..10`). All downstream data is scoped to it.
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

### True in-game payout (AllPatternsPaid)

The machine pays **every** pattern whose cells all get daubed by the generated
`ballCalls`, not only the ones you picked — including patterns completed solely by
the **union** of several selected patterns' daubs (e.g. `Arrowhead + Champagne
Glass` also complete `Cross` and `Letter Y`). So the tool replays the generated
draw order and scores each pattern the way the game does: a pattern completes at
the ball where its last needed number is drawn and pays the sum of its rows with
`BallQty ≥ that ball` (0 if it finishes after its slowest tier). The **selected
outcomes** panel shows both the *selected subtotal* and the true *in-game total*,
listing any incidental "also won" patterns; that in-game total is what drives the
DB reelStop lookup. The DB pattern/combination search flags any match whose real
in-game payout exceeds its searched amount.

This union/combination behavior applies only to **AllPatternsPaid** games. The
tool reads `<Bingo><EvaluationType>` from the XML: for **HighestPriorityPaid**
games only the single highest-priority satisfied pattern pays (lowest
`EvaluationPriority`), so the in-game total is that one pattern's payout, and the
DB amount search skips the combination search entirely and shows only
single-pattern matches. (These games also tend to define hundreds of distinct
patterns per bet line; skipping combinations there is both correct and keeps the
pattern search responsive.)

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

Before choosing the file, pick the **DB structure** (Type 1 / Type 2) — the two
vendor schemas store reelStops differently:

- **Type 1** (e.g. `HFNG_10k.db`): each `Award` owns a contiguous `PresentationId`
  range (`SequenceStart`..`SequenceStart+TotalCount-1`) and `Presentation.RngValues`
  holds the reelStops directly.
- **Type 2** (e.g. `MMMP.db`): `Facade` → `Award` (no `StartState` column) →
  `Presentation` (which only maps to an `Award`) → `Segment`. A presentation's RNG
  lives in the `Segment` table and may be split across `SegmentIndex` 1,2,… rows,
  which are **concatenated in index order** to reconstruct the full RNG. Each
  candidate shows its `PresentationId` (`P#…`). The award range still comes from
  `SequenceStart`/`TotalCount`, so lookups stay indexed PK-range reads.

Both share the same `Facade`/`Award` lookup by facade + amount, so the pattern
search, amount search and per-win breakdown work identically for either type.

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
