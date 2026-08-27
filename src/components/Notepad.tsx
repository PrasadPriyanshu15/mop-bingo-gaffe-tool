"use client";

import { useState } from "react";

/**
 * Scratch notepad for jotting notes while building a gaffe. Intentionally
 * ephemeral: the text lives only in React state, so it is never written to
 * cookies, localStorage or sessionStorage and resets on reload / tab close.
 */
export default function Notepad() {
  const [text, setText] = useState("");

  return (
    <div className="panel notepad">
      <div className="panel-title">
        Notepad
        {text.length > 0 && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setText("")}
          >
            Clear
          </button>
        )}
      </div>
      <textarea
        className="notepad-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Scratch notes… (not saved — clears when the tab closes)"
        spellCheck={false}
      />
      <p className="muted small notepad-hint">
        Temporary only — nothing here is saved.
      </p>
    </div>
  );
}
