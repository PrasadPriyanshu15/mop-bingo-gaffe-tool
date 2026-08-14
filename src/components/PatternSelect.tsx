"use client";

import { useMemo, useState } from "react";
import type { Pattern } from "@/lib/types";
import MiniPattern from "./MiniPattern";

interface Props {
  patterns: Pattern[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

/** Searchbar + scrollable list of patterns, each shown as name + mini image. */
export default function PatternSelect({
  patterns,
  selectedId,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...patterns].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter(
      (p) => p.name.toLowerCase().includes(q) || String(p.id).includes(q)
    );
  }, [patterns, query]);

  return (
    <div className="panel">
      <div className="panel-title">3 · Select pattern</div>
      <input
        className="search"
        type="search"
        placeholder="Search patterns by name or id…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="pattern-list">
        {filtered.map((p) => (
          <button
            type="button"
            key={p.id}
            className={
              "pattern-item" + (p.id === selectedId ? " selected" : "")
            }
            onClick={() => onSelect(p.id)}
          >
            <MiniPattern map={p.map} />
            <span className="pattern-name">
              {p.name}
              <span className="pattern-id">#{p.id}</span>
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="muted">No patterns match “{query}”.</p>
        )}
      </div>
    </div>
  );
}
