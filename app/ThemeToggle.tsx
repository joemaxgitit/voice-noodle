"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

/**
 * Light / dark switch, fixed bottom right.
 *
 * The choice is written to <html data-theme> and to localStorage. A tiny
 * script in the document head applies it before first paint (see layout),
 * otherwise the page flashes dark before switching to light, which is worse
 * than not offering the option at all.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const current =
      (document.documentElement.getAttribute("data-theme") as Theme) || "dark";
    setTheme(current);
    setReady(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("vn-theme", next);
    } catch {
      // private browsing; the choice just will not persist
    }
  }

  return (
    <button
      className="theme-toggle no-print"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      style={{ visibility: ready ? "visible" : "hidden" }}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <circle cx="12" cy="12" r="4.4" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4" />
            <path d="M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M18.6 5.4l-1.7 1.7M7.1 16.9l-1.7 1.7" />
          </g>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path
            d="M20 14.2A8.2 8.2 0 019.8 4a8.4 8.4 0 102 10.2 8.2 8.2 0 008.2 0z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
}
