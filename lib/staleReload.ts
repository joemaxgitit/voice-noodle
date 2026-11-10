/*
  After a deploy, a page left open still points at the old build's files; the next click
  asks for a file that no longer exists and the page crashes. Reload once to pick up the new build.
*/
export function reloadIfStale(error: Error): boolean {
  const msg = `${error?.name ?? ""} ${error?.message ?? ""}`;
  if (!/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Failed to load chunk/i.test(msg)) return false;
  try {
    const last = Number(sessionStorage.getItem("vn-stale-reload") || 0);
    if (Date.now() - last < 30_000) return false; // already tried; don't loop
    sessionStorage.setItem("vn-stale-reload", String(Date.now()));
  } catch {
    // storage blocked: still reload once
  }
  window.location.reload();
  return true;
}
