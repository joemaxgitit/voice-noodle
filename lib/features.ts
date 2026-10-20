/*
  The extras that show only in super mode (see lib/superMode.ts). Plain
  module so the middleware can use it too.
*/

/** Pages that only exist in super mode. */
export const EXTRA_PATHS = ["/admin/rotation", "/admin/dealclip", "/admin/mastery", "/admin/meeting", "/admin/coaching", "/admin/reports"];
export const isExtraPath = (path: string) => EXTRA_PATHS.some((p) => path.startsWith(p));
