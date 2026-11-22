"use client";

import { useState } from "react";

export default function TaskSummary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <div className="task-summary">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(!open)}>
        {open ? "Hide summary" : "Generate summary"}
      </button>
      {open && (
        <div className="task-summary-output">
          <textarea aria-label="Task summary" readOnly rows={10} value={text} />
          <button type="button" className="btn btn-sm" onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }}>{copied ? "Copied" : "Copy to clipboard"}</button>
        </div>
      )}
    </div>
  );
}
