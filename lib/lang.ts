"use client";

import { useEffect, useState } from "react";

export type Lang = "en" | "es";

const KEY = "vn-lang";
const EVENT = "vn-lang-change";

/**
 * Which language the person is reading.
 *
 * The tone key lives in the site-wide footer, outside any page, so it cannot
 * see a page's own language state. Rather than thread it through the layout,
 * the choice is written to localStorage and broadcast -- the same approach the
 * theme toggle already uses.
 *
 * A storage event only fires in OTHER tabs, so the custom event is what keeps
 * the footer in step with the page you are actually looking at.
 */
export function readLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    return localStorage.getItem(KEY) === "es" ? "es" : "en";
  } catch {
    return "en";
  }
}

export function setLang(next: Lang): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private browsing can refuse storage. The page still works; only the
    // footer's language stops following, which is not worth failing over.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

export function useLang(): Lang {
  /*
    Starts at "en" and reads storage in an effect rather than during render.
    Reading localStorage while rendering would disagree with the server's
    output and trip a hydration mismatch.
  */
  const [lang, set] = useState<Lang>("en");

  useEffect(() => {
    set(readLang());

    const sync = () => set(readLang());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return lang;
}
