"use client";

import type { MatchingPattern, Pattern } from "@/lib/types";
import MiniPattern from "./MiniPattern";

interface GroupProps {
  pattern: Pattern;
  entries: MatchingPattern[];
  /** Lowest selected ball qty for this pattern (null = nothing selected). */
  threshold: number | null;
  /** Toggle selection at a ball qty (selects it + all higher). */
  onToggle: (ballQty: number) => void;
  /** Label shown as the group's role, e.g. "Pattern 1" or "Contained". */
  badge?: string;
  /** Highlight color for this pattern (shows a dot tying it to the card). */
  color?: string;
}

/**
 * One pattern's payable instances (sorted by ballQty). Selecting a row selects
 * it and every higher-ballQty row (cascade) — those higher rows show as "auto".
 */
export default function InstanceList({
  pattern,
  entries,
  threshold,
  onToggle,
  badge,
  color,
}: GroupProps) {
  return (
    <div className="group">
      <div className="group-head">
        <MiniPattern map={pattern.map} size={36} />
        <div className="group-title">
          {color && (
            <span
              className="pattern-dot"
              style={{ background: color }}
              aria-hidden="true"
            />
          )}
          <span className="group-name">
            {pattern.name} <span className="pattern-id">#{pattern.id}</span>
          </span>
          {badge && (
            <span className={"badge badge-" + badge.toLowerCase().split(" ")[0]}>
              {badge}
            </span>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="muted small">No payable instances at this bet level.</p>
      ) : (
        <table className="instances">
          <thead>
            <tr>
              <th></th>
              <th>Ball qty</th>
              <th>Payout</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const checked = threshold != null && e.ballQty >= threshold;
              const auto = threshold != null && e.ballQty > threshold;
              return (
                <tr
                  key={e.index}
                  className={
                    (checked ? "row-selected" : "") + (auto ? " row-auto" : "")
                  }
                  onClick={() => onToggle(e.ballQty)}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(e.ballQty)}
                      onClick={(ev) => ev.stopPropagation()}
                    />
                  </td>
                  <td>
                    {e.ballQty}
                    {auto && <span className="badge badge-auto">auto</span>}
                  </td>
                  <td className="payout">{e.payout.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
