"use client";

import { useState } from "react";
import type { Award } from "@/lib/db";
import { matchesPattern, parsePattern, patternIsActive } from "@/lib/reelstop";

export interface AwardResult {
  award: Award;
  facadeKey: string;
  reelStops: number[][];
}

interface Props {
  results: AwardResult[];
  /** Raw positional-filter string; narrows shown candidates + badge counts. */
  pattern: string;
  /** Show the facade key in each card's subline (when searching >1 bet line). */
  showFacade: boolean;
  /** Push a chosen reelStop into the main generated gaffe output. */
  onApply: (reelStops: number[]) => void;
  /** Message when `results` is empty. */
  emptyText: string;
  /** Load a reelStop into the reelStrip viewer (enabled only if xml loaded). */
  onSlot?: (reelStops: number[]) => void;
  /** Whether a reelStrip .xml has been loaded (enables the "slot" button). */
  reelStripLoaded?: boolean;
  /** With an active filter, drop award cards that have no matching reelStop
   *  instead of showing them as disabled "no results" rows. */
  hideEmpty?: boolean;
}

/**
 * Presentational list of award cards with collapsible reelStop candidates,
 * per-card result badges, a live positional filter, and copy / "use in gaffe"
 * actions. Shared by the main finder, its per-win sections, and the custom
 * amount search.
 */
export default function AwardResults({
  results,
  pattern,
  showFacade,
  onApply,
  emptyText,
  onSlot,
  reelStripLoaded,
  hideEmpty,
}: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const parsed = parsePattern(pattern);
  const filterActive = patternIsActive(parsed);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* ignore */
    }
  }

  function apply(rs: number[], text: string) {
    onApply(rs);
    setApplied(text);
    setTimeout(() => setApplied(null), 1200);
  }

  function toggle(awardId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(awardId)) next.delete(awardId);
      else next.add(awardId);
      return next;
    });
  }

  // Resolve each card's visible reelStops up front. With `hideEmpty` and an
  // active filter, cards with no match are dropped entirely (rather than shown
  // as disabled "no results" rows) so only matched awards remain.
  const cards = results
    .map(({ award, facadeKey, reelStops }) => ({
      award,
      facadeKey,
      shown: filterActive
        ? reelStops.filter((rs) => matchesPattern(rs, parsed))
        : reelStops,
    }))
    .filter((c) => !(hideEmpty && filterActive) || c.shown.length > 0);

  if (cards.length === 0) {
    return <p className="muted small">{emptyText}</p>;
  }

  return (
    <div className="award-results">
      {cards.map(({ award, facadeKey, shown }) => {
        const isEmpty = shown.length === 0;
        const open = filterActive ? !isEmpty : expanded.has(award.awardId);
        return (
          <div
            key={`${facadeKey}:${award.awardId}`}
            className={"award-card" + (isEmpty ? " empty" : "")}
          >
            <button
              type="button"
              className="award-head"
              onClick={() => !isEmpty && toggle(award.awardId)}
              disabled={isEmpty || filterActive}
              aria-expanded={open}
            >
              <span className="award-head-main">
                <span className="award-caret">
                  {isEmpty ? "·" : open ? "▾" : "▸"}
                </span>
                <span className="award-title">Award #{award.awardId}</span>
                <span
                  className={
                    "award-badge" + (isEmpty ? " award-badge-empty" : "")
                  }
                >
                  {isEmpty
                    ? "no results"
                    : `${shown.length} result${shown.length === 1 ? "" : "s"}`}
                </span>
              </span>
              <span className="muted small">
                {showFacade ? `${facadeKey} · ` : ""}tier {award.tier} · flags{" "}
                {award.flags} · start {award.startState ?? "—"} ·{" "}
                {award.totalCount} presentations
              </span>
            </button>

            {open && !isEmpty && (
              <div className="reelstop-list">
                {shown.map((rs, i) => {
                  const text = `[${rs.join(",")}]`;
                  return (
                    <div key={i} className="reelstop">
                      <span className="reelstop-vals">{text}</span>
                      <button
                        type="button"
                        className="reelstop-btn reelstop-apply"
                        onClick={() => apply(rs, text)}
                        title="Use in gaffe result"
                      >
                        {applied === text ? "✓" : "+"}
                      </button>
                      <button
                        type="button"
                        className="reelstop-btn"
                        onClick={() => copy(text)}
                        title="Copy reelStops"
                      >
                        {copied === text ? "✓" : "copy"}
                      </button>
                      {onSlot && (
                        <button
                          type="button"
                          className="reelstop-btn reelstop-slot"
                          disabled={!reelStripLoaded}
                          onClick={() => onSlot(rs)}
                          title={
                            reelStripLoaded
                              ? "Load into the reelStrip viewer"
                              : "Upload a reelStrip .xml first"
                          }
                        >
                          slot
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
