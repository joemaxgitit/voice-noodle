"use client";

import { useEffect } from "react";
import { reloadIfStale } from "@/lib/staleReload";

/** Any page that crashes: reload if it's just an old build after a deploy, otherwise say what broke. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reloadIfStale(error);
  }, [error]);
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 16px" }}>
      <h2>Something went wrong on this page</h2>
      <p className="muted">Reloading usually fixes it. If it keeps happening, send a screenshot of this box.</p>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, padding: 12, border: "1px solid var(--line)", borderRadius: 8 }}>
        {error?.message || String(error)}
        {error?.digest ? `\n(${error.digest})` : ""}
        {typeof window !== "undefined" ? `\n${window.location.pathname}` : ""}
      </pre>
      <div className="row" style={{ gap: 8 }}>
        <button className="primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        <button onClick={() => reset()}>Try again</button>
      </div>
    </main>
  );
}
