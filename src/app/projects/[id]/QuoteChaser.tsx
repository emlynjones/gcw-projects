"use client";

import { useState, useTransition } from "react";
import { draftQuoteChaserAction } from "./chaser-action";

export default function QuoteChaser({ projectId, email, aiConfigured }: {
  projectId: string;
  email: string | null;
  aiConfigured: boolean;
}) {
  const [language, setLanguage] = useState<"en" | "cy">("en");
  const [draft, setDraft] = useState<{ subject: string; body: string }>();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const recipient = email && /^[^\s@,;?&#]+@[^\s@,;?&#]+$/.test(email.trim()) ? email.trim() : null;

  return (
    <details className="card card-collapse">
      <summary>Chase quote</summary>
      <div className="stack mt">
        <div className="action-row">
          <label>Language{" "}
            <select value={language} disabled={pending} onChange={(event) => {
              setLanguage(event.target.value === "cy" ? "cy" : "en");
              setDraft(undefined);
              setError("");
            }}>
              <option value="en">English</option>
              <option value="cy">Cymraeg</option>
            </select>
          </label>
          <button type="button" className="btn btn-secondary" disabled={pending || !aiConfigured} onClick={() => {
            setError("");
            start(async () => {
              try {
                const result = await draftQuoteChaserAction(projectId, language);
                if (result.draft) setDraft(result.draft);
                else setError(result.error);
              } catch {
                setError("Could not draft a chaser. Please try again.");
              }
            });
          }}>{pending ? "Drafting…" : "Draft chaser with AI"}</button>
        </div>
        {!aiConfigured && <p className="muted">Configure AI in Settings to generate a chaser.</p>}
        {error && <p role="alert">{error}</p>}
        {draft && <>
          <label className="field">Subject<input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label>
          <label className="field">Message<textarea rows={6} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
          <div>{recipient
            ? <a className="btn" href={`mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(draft.subject.replace(/[\r\n]/g, " "))}&body=${encodeURIComponent(draft.body)}`}>Open email to send</a>
            : <p className="muted">Add a valid email address to the client record to open the draft in your email app.</p>}</div>
        </>}
      </div>
    </details>
  );
}
