"use client";

import { useState } from "react";
import type { PaytableIssues as Issues } from "@/lib/validatePaytable";

/** Max rows rendered per issue group (the rest are summarized). */
const CAP = 100;

/**
 * Shows the upload-time validation report: patterns whose free space is wrong,
 * and bet lines whose EvaluationPriority doesn't ascend by +1. Collapsible;
 * shows a compact "valid" line when there's nothing to flag.
 */
export default function PaytableIssues({ issues }: { issues: Issues }) {
  const total = issues.patterns.length + issues.priorities.length;
  const [open, setOpen] = useState(true);

  if (total === 0) {
    return (
      <div className="panel">
        <div className="panel-title">XML validation</div>
        <p className="muted small">
          ✓ Free spaces and evaluation priorities look valid.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>
          {open ? "▾" : "▸"} XML validation
        </span>
        <span className="issue-badge">
          {total} mismatch{total === 1 ? "" : "es"}
        </span>
      </button>

      {open && (
        <div className="issue-body">
          {issues.patterns.length > 0 && (
            <div className="issue-group">
              <div className="issue-group-head">
                Free space — {issues.patterns.length} pattern
                {issues.patterns.length === 1 ? "" : "s"}
              </div>
              <ul className="issue-list">
                {issues.patterns.slice(0, CAP).map((p, i) => (
                  <li key={i}>
                    <span className="issue-id">#{p.id}</span> {p.name} —{" "}
                    {p.reason}
                  </li>
                ))}
              </ul>
              {issues.patterns.length > CAP && (
                <p className="muted small">
                  …and {issues.patterns.length - CAP} more.
                </p>
              )}
            </div>
          )}

          {issues.priorities.length > 0 && (
            <div className="issue-group">
              <div className="issue-group-head">
                EvaluationPriority — {issues.priorities.length} break
                {issues.priorities.length === 1 ? "" : "s"}
              </div>
              <ul className="issue-list">
                {issues.priorities.slice(0, CAP).map((p, i) => (
                  <li key={i}>
                    <span className="issue-id">{p.facadeKey}</span> Index{" "}
                    {p.index} (pattern #{p.patternId}) — expected {p.expected},
                    got {p.actual}
                  </li>
                ))}
              </ul>
              {issues.priorities.length > CAP && (
                <p className="muted small">
                  …and {issues.priorities.length - CAP} more.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
