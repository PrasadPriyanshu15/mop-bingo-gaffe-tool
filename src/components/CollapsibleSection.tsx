"use client";

import { useState, type ReactNode } from "react";

interface Props {
  /** Header label shown on the toggle bar. */
  title: string;
  /** Whether the section starts expanded (default true). */
  defaultOpen?: boolean;
  /** Optional right-aligned content in the header (counts, quick actions). */
  aside?: ReactNode;
  /**
   * Keep the body mounted while collapsed (hidden with CSS) instead of
   * unmounting it. Use for sections whose children own state that must survive
   * a collapse — e.g. the DB viewer's loaded database and search results, which
   * would otherwise be wiped and re-initialised on every expand.
   */
  keepMounted?: boolean;
  children: ReactNode;
}

/**
 * A titled, expand/collapse container. Used to group the page into the top-level
 * sections (setup, bingo pattern, DB viewer). By default the body unmounts while
 * collapsed so nothing inside keeps rendering — cheap and keeps the page short.
 * Pass `keepMounted` to hide (rather than destroy) the body, preserving the
 * state of anything inside it until the tab/browser is closed.
 */
export default function CollapsibleSection({
  title,
  defaultOpen = true,
  aside,
  keepMounted = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <button
        type="button"
        className="section-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="section-caret">{open ? "▼" : "▶"}</span>
        <span className="section-title">{title}</span>
        {aside && <span className="section-aside">{aside}</span>}
      </button>
      {keepMounted ? (
        <div className="section-body" hidden={!open}>
          {children}
        </div>
      ) : (
        open && <div className="section-body">{children}</div>
      )}
    </section>
  );
}
