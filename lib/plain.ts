/**
 * Managers read these pages, not statisticians: turn shorthand like "(n=2)"
 * or "n = 5" that a model sometimes writes into plain words.
 */
export function plainCounts(s: string): string {
  return (s || "")
    .replace(/\(\s*n\s*=\s*(\d+)\s*\)/gi, (_, n) => `(from ${n} call${n === "1" ? "" : "s"})`)
    .replace(/\bn\s*=\s*(\d+)\b/gi, (_, n) => `${n} call${n === "1" ? "" : "s"}`);
}
