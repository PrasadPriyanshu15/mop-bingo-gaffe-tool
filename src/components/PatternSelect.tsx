"use client";

import { useMemo, useState } from "react";
import type { Pattern } from "@/lib/types";
import MiniPattern from "./MiniPattern";

interface Props {
  patterns: Pattern[];
  /** Every currently-selected pattern id, in the order they were added. */
  selectedIds: number[];
  /** Replace the whole selection with just this id (a fresh single pick). */
  onSelect: (id: number) => void;
  /** Add this id to — or remove it from — the selection (used in Add mode). */
  onToggle: (id: number) => void;
}

/** Searchbar + scrollable list of patterns, each shown as name + mini image.
 *  Picks a single pattern by default; the "+ Add" button next to the search
 *  switches to add mode, where clicks accumulate several patterns so their
 *  payouts can be combined (same ballQty/range logic as a DB combination). */
export default function PatternSelect({
  patterns,
  selectedIds,
  onSelect,
  onToggle,
}: Props) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(
    () => new Map(patterns.map((p) => [p.id, p])),
    [patterns]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...patterns].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter(
      (p) => p.name.toLowerCase().includes(q) || String(p.id).includes(q)
    );
  }, [patterns, query]);

  // Add mode only makes sense once a base pattern is chosen.
  const canAdd = selectedIds.length > 0;

  return (
    <div className="panel">
      <div className="panel-title">3 · Select pattern</div>

      <div className="pattern-search-row">
        <input
          className="search pattern-search-input"
          type="search"
          placeholder="Search patterns by name or id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
          <p className="muted">No patterns match “{query}”.</p>
        )}
      </div>
    </div>
  );
}
