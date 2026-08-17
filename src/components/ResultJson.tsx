"use client";

import { useState } from "react";

interface Props {
  json: string;
}

/** Compact panel showing the generated gaffe result JSON with a copy button. */
export default function ResultJson({ json }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="panel result">
      <div className="result-field">
        <div className="result-key result-key-row">
          <span>result (JSON)</span>
          <button type="button" className="btn btn-small" onClick={copy}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="result-json">{json}</pre>
      </div>
    </div>
  );
}
