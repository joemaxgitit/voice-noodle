/**
 * Managers read these pages, not statisticians: turn shorthand like "(n=2)"
 * or "n = 5" that a model sometimes writes into plain words.
 */
export function plainCounts(s: string): string {
  return (s || "")
    .replace(/\(\s*n\s*=\s*(\d+)\s*\)/gi, (_, n) => `(from ${n} call${n === "1" ? "" : "s"})`)
    .replace(/\bn\s*=\s*(\d+)\b/gi, (_, n) => `${n} call${n === "1" ? "" : "s"}`);
}

/**
 * Belfort's buyer types in words a sales floor uses. "In heat", "in power"
 * and "lookie-loo" are his book's terms; nobody on the team should need the
 * book to read a page.
 */
export function plainBuyer(s: string): string {
  return (s || "")
    .replace(/buyers?\s+in\s+heat|\bin\s+heat\b/gi, "ready to act now")
    .replace(/buyers?\s+in\s+power|\bin\s+power\b/gi, "needs it, no urgency yet")
    .replace(/lookie[\s-]?loos?|tire[\s-]?kickers?/gi, "just looking (not serious)");
}

/** Both: plain counts and plain buyer types. */
export const plainWords = (s: string) => plainBuyer(plainCounts(s));
