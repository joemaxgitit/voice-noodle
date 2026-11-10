"use client";

import { useEffect } from "react";
import { reloadIfStale } from "@/lib/staleReload";

/** When even the app frame crashes: same as app/error.tsx, with its own page shell. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reloadIfStale(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ background: "#18181b", color: "#edeae4", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 16px" }}>
          <h2>Something went wrong</h2>
          <p style={{ opacity: 0.7 }}>Reloading usually fixes it. If it keeps happening, send a screenshot of this box.</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, padding: 12, border: "1px solid #333", borderRadius: 8 }}>
            {error?.message || String(error)}
            {error?.digest ? `\n(${error.digest})` : ""}
          </pre>
          <button onClick={() => window.location.reload()} style={{ padding: "8px 14px", background: "#f0a63c", border: 0, borderRadius: 6 }}>
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
