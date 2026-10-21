"use client";

import { useState } from "react";
import { PLUM } from "./InstrumentChrome";

/**
 * Downloads the profile as a PDF.
 *
 * The document is assembled server-side from the same JSON the page reads, with
 * no language model anywhere in the path. What you see is what the file holds.
 */
export default function ExportButton({
  proposalId,
  stateSlug,
  disabled,
}: {
  proposalId: string;
  stateSlug: string | null;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    if (!stateSlug) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/instruments/consent/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, state: stateSlug }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `The PDF could not be prepared (error ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `people-and-consent-${proposalId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The PDF could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={download}
        disabled={busy || disabled || !stateSlug}
        className="px-4 py-2 border font-label text-[10px] uppercase tracking-[0.18em] transition-colors disabled:opacity-65 hover:text-[#fcf9f4]"
        style={{
          borderColor: PLUM,
          color: busy ? "#fcf9f4" : PLUM,
          background: busy ? PLUM : "transparent",
        }}
        onMouseEnter={(e) => {
          if (!busy && !disabled) e.currentTarget.style.background = PLUM;
        }}
        onMouseLeave={(e) => {
          if (!busy) e.currentTarget.style.background = "transparent";
        }}
      >
        {busy ? "Preparing…" : "Download this profile"}
      </button>
      {error ? (
        <span className="font-body text-[11.5px] opacity-70">{error}</span>
      ) : (
        <span className="font-body text-[11px] opacity-70">
          PDF, with the source of every figure
        </span>
      )}
    </div>
  );
}
