"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { convertDetailsToTasksAction } from "./actions";

// Explicit and retry-safe: titles already on the job are skipped.
export default function ConvertDetailsToTasks({
  projectId,
  count,
}: {
  projectId: string;
  count: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ error?: string; saved?: string }>({});
  return (
    <div className="action-row">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setResult(await convertDetailsToTasksAction(projectId));
          setPending(false);
          router.refresh();
        }}
      >
        {pending
          ? "Creating…"
          : `Create ${count} task${count === 1 ? "" : "s"} from this list`}
      </button>
      {result.saved && <span role="status">{result.saved}</span>}
      {result.error && (
        <span role="alert" className="work-warning">
          {result.error}
        </span>
      )}
    </div>
  );
}
