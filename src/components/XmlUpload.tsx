"use client";

import { useRef, useState } from "react";
import { parsePaytableXml } from "@/lib/parseXml";
import type { Paytable59 } from "@/lib/types";

interface Props {
  onLoaded: (data: Paytable59, fileName: string) => void;
  loadedName: string | null;
}

/** File input that parses a VGTPaytable XML client-side and reports the result. */
export default function XmlUpload({ onLoaded, loadedName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const data = parsePaytableXml(text);
      onLoaded(data, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse the file.");
    }
  }

  return (
    <div className="panel">
      <div className="panel-title">1 · Upload paytable XML</div>
      <div className="upload-row">
        <button
          type="button"
          className="btn"
          onClick={() => inputRef.current?.click()}
        >
          Choose XML file…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xml,application/xml,text/xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        {loadedName && !error && (
          <span className="loaded-name">Loaded: {loadedName}</span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
