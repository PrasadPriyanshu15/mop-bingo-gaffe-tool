"use client";

import { useMemo, useState } from "react";
import type { Pattern } from "@/lib/types";
import { useCurrency } from "@/lib/CurrencyContext";
import MiniPattern from "./MiniPattern";

interface Props {
  patterns: Pattern[];
  /** Per-pattern payout totals for the active bet line (each threshold's suffix
   *  sum). Enables searching the list by amount or amount range. */
  patternAmounts?: Map<number, number[]>;
  /** Every currently-selected pattern id, in the order they were added. */
  selectedIds: number[];
  /** Replace the whole selection with just this id (a fresh single pick). */
  onSelect: (id: number) => void;
  /** Add this id to — or remove it from — the selection (used in Add mode). */
  onToggle: (id: number) => void;
}

/** What the one search box resolves to. `#123` → id, plain number → amount,
 *  `100-500` → amount range, anything else → name (the default). */
type Search =
  | { kind: "none" }
  | { kind: "id"; digits: string }
  | { kind: "name"; q: string }
  | { kind: "amount"; v: number }
  | { kind: "range"; lo: number; hi: number };

function parseSearch(raw: string): Search {
  const t = raw.trim();
  if (t === "") return { kind: "none" };
  if (t.startsWith("#"))
    return { kind: "id", digits: t.slice(1).replace(/[^0-9]/g, "") };
  const rng = t.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (rng) {
    let lo = Number(rng[1]);
    let hi = Number(rng[2]);
    if (lo > hi) [lo, hi] = [hi, lo];
    return { kind: "range", lo, hi };
  }
  if (/^\d+(?:\.\d+)?$/.test(t)) return { kind: "amount", v: Number(t) };
  return { kind: "name", q: t.toLowerCase() };
}

/** Searchbar + scrollable list of patterns, each shown as name + mini image.
 *  Picks a single pattern by default; the "+ Add" button next to the search
 *  switches to add mode, where clicks accumulate several patterns so their
 *  payouts can be combined (same ballQty/range logic as a DB combination). */
export default function PatternSelect({
  patterns,
  patternAmounts,
  selectedIds,
  onSelect,
  onToggle,
}: Props) {
  const { fmt } = useCurrency();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(
    () => new Map(patterns.map((p) => [p.id, p])),
    [patterns]
  );

  const search = useMemo(() => parseSearch(query), [query]);

  const filtered = useMemo(() => {
    const sorted = [...patterns].sort((a, b) => a.name.localeCompare(b.name));
    switch (search.kind) {
      case "none":
        return sorted;
      case "id":
        return search.digits === ""
          ? sorted
          : sorted.filter((p) => String(p.id).includes(search.digits));
      case "name":
        return sorted.filter((p) => p.name.toLowerCase().includes(search.q));
      case "amount":
        return sorted.filter((p) =>
          (patternAmounts?.get(p.id) ?? []).some((a) => a === search.v)
        );
      case "range":
        return sorted.filter((p) =>
          (patternAmounts?.get(p.id) ?? []).some(
            (a) => a >= search.lo && a <= search.hi
          )
        );
    }
  }, [patterns, search, patternAmounts]);

  // For an amount / range search, the matching payout totals of a pattern, so
  // each row can show why it matched.
  const amountMatchesFor = (id: number): number[] => {
    if (search.kind === "amount")
      return (patternAmounts?.get(id) ?? []).filter((a) => a === search.v);
    if (search.kind === "range")
      return (patternAmounts?.get(id) ?? []).filter(
        (a) => a >= search.lo && a <= search.hi
      );
    return [];
  };
  const amountSearch = search.kind === "amount" || search.kind === "range";

  // Add mode only makes sense once a base pattern is chosen.
  const canAdd = selectedIds.length > 0;

  return (
    <div className="panel">
      <div className="panel-title">3 · Select pattern</div>

      <div className="pattern-search-row">
        <input
          className="search pattern-search-input"
          type="search"
          placeholder="Name · #id · amount · 100-500 range…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          title="Search by pattern name, #id (prefix #), a payout amount (just the number), or an amount range (e.g. 100-500)"
        />
        <button
          type="button"
          className={
            "btn btn-small pattern-add-btn" + (adding ? " active" : "")
          }
          onClick={() => setAdding((v) => !v)}
          disabled={!canAdd}
          title={
            !canAdd
              ? "Pick a pattern first, then Add another to combine payouts"
              : adding
                ? "Done adding — click patterns to add/remove; press to return to single-pick"
                : "Add another pattern; choose payout rows for each in section 4"
          }
        >
          {adding ? "Done" : "+ Add"}
        </button>
      </div>

      {selectedIds.length > 0 && (
        <div className="pattern-chips">
          {selectedIds.map((id) => {
            const p = byId.get(id);
            return (
              <span key={id} className="pattern-chip">
                {p?.name ?? `#${id}`}
                <span className="pattern-id">#{id}</span>
                <button
                  type="button"
                  className="pattern-chip-x"
                  onClick={() => onToggle(id)}
                  aria-label={`Remove ${p?.name ?? id} from selection`}
                  title="Remove from selection"
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      {adding && (
        <p className="muted small pattern-add-hint">
          Add mode — click patterns to add or remove them. Each selected pattern
          gets its own payout rows in section 4.
        </p>
      )}

      <div className="pattern-list">
        {filtered.map((p) => {
          const isSel = selectedSet.has(p.id);
          const amts = amountSearch ? amountMatchesFor(p.id) : [];
          return (
            <button
              type="button"
              key={p.id}
              className={"pattern-item" + (isSel ? " selected" : "")}
              onClick={() => (adding ? onToggle(p.id) : onSelect(p.id))}
            >
              <MiniPattern map={p.map} />
              <span className="pattern-name">
                {p.name}
                <span className="pattern-id">#{p.id}</span>
                {amts.length > 0 && (
                  <span
                    className="pattern-amt"
                    title="Payout total(s) matching your search (row + higher auto rows)"
                  >
                    {amts
                      .slice()
                      .sort((a, b) => a - b)
                      .map((a) => fmt(a))
                      .join(" · ")}
                  </span>
                )}
              </span>
              {isSel && (
                <span className="pattern-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="muted">
            {amountSearch
              ? `No pattern in this bet line pays ${
                  search.kind === "range"
                    ? `${search.lo.toLocaleString()}–${search.hi.toLocaleString()}`
                    : search.kind === "amount"
                      ? search.v.toLocaleString()
                      : ""
                }.`
              : `No patterns match “${query}”.`}
          </p>
        )}
      </div>
    </div>
  );
}
