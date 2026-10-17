"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createReviewedTasksAction,
  suggestTasksFromDetailsAction,
} from "./actions";

export default function GenerateTasks({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ error?: string; saved?: string }>({});
  const reviewedCount =
    suggestions?.filter((title) => title.trim()).length ?? 0;

  const generate = async () => {
    setPending(true);
    setResult({});
    const response = await suggestTasksFromDetailsAction(projectId);
    setSuggestions(response.suggestions ?? null);
    setResult(response.error ? { error: response.error } : {});
    setPending(false);
  };

  const create = async () => {
    if (!suggestions?.length) return;
    const reviewed = suggestions.filter((title) => title.trim());
    if (!reviewed.length) return;
    setPending(true);
    setResult({});
    const response = await createReviewedTasksAction(projectId, reviewed);
    setResult(response);
    if (response.saved) {
      setSuggestions(null);
      router.refresh();
    }
    setPending(false);
  };

  return (
    <div className="stack">
      <div className="action-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pending}
          onClick={generate}
        >
          {pending && !suggestions ? "Generating…" : "✨ Generate tasks"}
        </button>
        <span className="muted small">Nothing is created until you confirm.</span>
      </div>

      {suggestions && (
        <div className="stack">
          <div>
            <strong>Review suggested tasks</strong>
            <div className="muted small">Edit the titles or remove anything unnecessary.</div>
          </div>
          {suggestions.map((title, index) => (
            <div className="action-row" key={index}>
              <input
                aria-label={`Suggested task ${index + 1}`}
                value={title}
                maxLength={200}
                onChange={(event) =>
                  setSuggestions((current) =>
                    current?.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ) ?? null,
                  )
                }
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={pending}
                onClick={() =>
                  setSuggestions((current) =>
                    current?.filter((_, itemIndex) => itemIndex !== index) ?? null,
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <div className="action-row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending || !suggestions.some((title) => title.trim())}
              onClick={create}
            >
              {pending
                ? "Creating…"
                : `Create ${reviewedCount} reviewed task${reviewedCount === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={pending}
              onClick={() => setSuggestions(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result.saved && <span role="status">{result.saved}</span>}
      {result.error && <span role="alert" className="work-warning">{result.error}</span>}
    </div>
  );
}
