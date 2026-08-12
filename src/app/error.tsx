"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: "60px auto" }}>
        <h2>Something went wrong</h2>
        <p className="muted small">
          {error.message || "An unexpected error occurred."}
          {error.digest && <> (ref: {error.digest})</>}
        </p>
        <button type="button" className="btn" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}
