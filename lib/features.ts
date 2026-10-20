/*
  Extra manager features the super admin can turn on or off for every
  other admin and manager. The super admin always has all of them.
  Stored per org in public.app_features (flags: {"rotation": true, ...});
  anything not set is off.
*/

export const FEATURES = [
  { key: "rotation", label: "Rotation", desc: "Nightly rotation upload, overrides and the rotation history.", paths: ["/admin/rotation"] },
  { key: "dealclip", label: "Deal Clip", desc: "The morning Deal Clip and the copy for the sales chat.", paths: ["/admin/dealclip"] },
  { key: "mastery", label: "Master Your Craft", desc: "Planning the weekly MYC class, rosters and topic history.", paths: ["/admin/mastery"] },
  { key: "meeting", label: "Thursday meeting", desc: "The Thursday sales meeting agenda and backlog.", paths: ["/admin/meeting"] },
  { key: "coaching", label: "Coaching trends", desc: "What keeps coming up in one-on-ones across the team.", paths: ["/admin/coaching"] },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type FeatureFlags = Partial<Record<FeatureKey, boolean>>;

/** Is this feature on for this person? */
export const hasFeature = (flags: FeatureFlags | null | undefined, key: FeatureKey, superAdmin: boolean) => superAdmin || !!flags?.[key];

/** The feature a page belongs to, if any. */
export const featureForPath = (path: string): FeatureKey | null => FEATURES.find((f) => f.paths.some((p) => path.startsWith(p)))?.key ?? null;
