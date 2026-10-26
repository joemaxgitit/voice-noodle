/*
  Signed-in accounts time out after 30 minutes with no activity. Activity is
  shared across tabs (localStorage), and long jobs that run without clicks --
  a recording playing, a bulk upload -- call stayAwake() so they're not cut off.
*/
export const IDLE_MS = 30 * 60_000;
export const IDLE_KEY = "vn_last_active";

export function stayAwake() {
  try {
    localStorage.setItem(IDLE_KEY, String(Date.now()));
  } catch {}
}
