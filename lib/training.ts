/*
  Training Hub: shared types and date helpers.

  Dates are plain local dates ("2026-10-19") and clock times ("13:30"), the
  way the managers think about them. Nothing here converts time zones, so a
  1:30 class is 1:30 on every screen and through daylight saving.
*/

export type Person = { id: string; full_name: string | null; role?: string; team?: string | null; in_training?: boolean };

export type Topic = {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  archived: boolean;
};

export type MaterialKind = "video" | "pdf" | "doc" | "slides" | "link" | "quiz" | "module" | "practice";

export type Material = {
  id: string;
  topic_id: string | null;
  title: string;
  description: string | null;
  kind: MaterialKind;
  storage_path: string | null;
  url: string | null;
  file_name: string | null;
  size_bytes: number | null;
  duration_secs: number | null;
  version: number;
  published: boolean;
  required: boolean;
  audience: "all" | "closers" | "ams";
  due_date: string | null;
  complete_pct: number;
  module_id?: string | null; // kind "module": a script section in the karaoke trainer
  persona_id?: string | null; // kind "practice": a mock client
  pass_pct?: number; // kind "quiz"
  min_score?: number | null; // kind "practice": lowest Straight Line score that counts
  created_at: string;
};

export type QuizQuestion = {
  id?: string;
  position: number;
  prompt: string;
  options: string[];
  correct: number;
  explain: string | null;
};

export type Track = { id: string; title: string; description: string | null; archived: boolean };
export type TrackItem = { id: string; track_id: string; material_id: string; day_offset: number; position: number };
export type Enrollment = { id: string; track_id: string; rep_id: string; start_date: string };

/** One thing a rep has to do, with where the requirement came from. */
export type Assignment = {
  material: Material;
  due: string | null;
  from: string; // "Required" or the track's title
  done: boolean;
  pct: number;
  overdue: boolean;
};

/**
 * Everything assigned to one rep: required materials for their team, plus
 * every item of every track they're enrolled in, due N days after their
 * start date. A material that's assigned twice counts once, earliest due.
 */
export function assignmentsFor(
  rep: { id: string; team?: string | null },
  materials: Material[],
  progress: Progress[],
  enrollments: Enrollment[],
  items: TrackItem[],
  tracks: Track[],
  onDate: string
): Assignment[] {
  const byMat = new Map(materials.map((m) => [m.id, m]));
  const prog = new Map(progress.filter((p) => p.user_id === rep.id).map((p) => [p.material_id, p]));
  const out = new Map<string, Assignment>();
  const add = (m: Material, due: string | null, from: string) => {
    const p = prog.get(m.id);
    const current = p && p.version === m.version ? p : null;
    const done = !!current?.completed_at;
    const prev = out.get(m.id);
    if (prev && (prev.due ?? "9999") <= (due ?? "9999")) return;
    out.set(m.id, { material: m, due, from, done, pct: current?.pct ?? 0, overdue: !done && !!due && due < onDate });
  };
  for (const m of materials) {
    if (m.published && m.required && (m.audience === "all" || m.audience === rep.team)) add(m, m.due_date, "Required");
  }
  for (const e of enrollments.filter((x) => x.rep_id === rep.id)) {
    const t = tracks.find((x) => x.id === e.track_id);
    for (const it of items.filter((x) => x.track_id === e.track_id)) {
      const m = byMat.get(it.material_id);
      if (m && m.published) add(m, addDays(e.start_date, it.day_offset), t?.title ?? "Track");
    }
  }
  return [...out.values()].sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}

export type Progress = {
  material_id: string;
  user_id: string;
  version: number;
  position_secs: number;
  watched_secs: number;
  pct: number;
  completed_at: string | null;
};

export type TrainingEvent = {
  id: string;
  kind: "training" | "break";
  title: string;
  topic_id: string | null;
  event_date: string;
  start_time: string; // "09:00:00"
  minutes: number;
  instructor_ids: string[];
  guest_instructors: string | null;
  audience: "all" | "new_hires" | "closers" | "ams";
  required: boolean;
  status: "draft" | "published";
  notes: string | null;
  material_ids: string[];
};

export type MasteryWeek = {
  id: string;
  week_start: string;
  topic_id: string | null;
  title: string | null;
  instructor_id: string | null;
  day_instructors: Record<string, string>;
  material_ids: string[];
  notes: string | null;
  capacity: number | null;
  status: "draft" | "published";
  recordings?: { path?: string; link?: string; name: string; size?: number; day?: string; added_at: string }[] | null;
  leave_behind?: string | null;
  content?: string | null;
};

export type Attendance = "present" | "absent" | "excused" | "makeup_required" | "makeup_done";

export type MasteryRequest = {
  id: string;
  week_start: string;
  rep_id: string;
  to_day: number;
  note: string | null;
  status: "pending" | "approved" | "declined";
  created_at: string;
};

export type Meeting = {
  id: string;
  meeting_date: string;
  start_time: string;
  status: "draft" | "published";
  notes: string | null;
};

export type MeetingItem = {
  id: string;
  meeting_id: string | null;
  title: string;
  notes: string | null;
  presenter_id: string | null;
  minutes: number;
  position: number;
  prep: "draft" | "ready";
  delivery: "planned" | "presented" | "deferred";
  material_ids: string[];
};

// ---------------------------------------------------------------- fixed schedule

export const MASTERY = { start: "13:30", minutes: 30, days: [1, 2, 3] as const };
export const MEETING = { start: "10:00", target: 20, typical: "15-20 minutes, 4-7 topics" };

export const DAY_NAME: Record<number, string> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday" };

export const ATTENDANCE_LABEL: Record<Attendance, string> = {
  present: "Present",
  absent: "Absent",
  excused: "Excused",
  makeup_required: "Make-up needed",
  makeup_done: "Made up",
};

export const CATEGORIES = [
  "Credit Background",
  "Sales Psychology",
  "Discovery",
  "Hardship",
  "Tone",
  "Options Presentation",
  "Company Trust",
  "Objections",
  "Closing",
  "Compliance",
  "CRM",
  "Pipeline Management",
  "Account Management",
  "New Hire Training",
];

export const KIND_LABEL: Record<MaterialKind, string> = {
  video: "Video",
  pdf: "PDF",
  doc: "Document",
  slides: "Slides",
  link: "Link",
  quiz: "Knowledge check",
  module: "Script practice",
  practice: "Practice call",
};

export const KIND_ICON: Record<MaterialKind, string> = {
  video: "▶",
  pdf: "PDF",
  doc: "DOC",
  slides: "PPT",
  link: "LINK",
  quiz: "?",
  module: "♪",
  practice: "☎",
};

export const AUDIENCE_LABEL: Record<string, string> = {
  all: "Everyone",
  new_hires: "New hires",
  closers: "Sales reps",
  ams: "Account managers",
};

/** Supabase's free plan refuses files over 50 MB. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------- dates

const pad = (n: number) => String(n).padStart(2, "0");

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d, 12); // noon: never slips a day
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function today(): string {
  return toISO(new Date());
}

/** The Monday of the week containing this date. */
export function mondayOf(iso: string): string {
  const d = fromISO(iso);
  const dow = d.getDay(); // 0 Sun
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/** The work week to show by default: this one, or next week on a weekend. */
export function workWeek(): string {
  const t = today();
  return weekdayOf(t) >= 6 ? addDays(mondayOf(t), 7) : mondayOf(t);
}

export function weekdayOf(iso: string): number {
  const dow = fromISO(iso).getDay();
  return dow === 0 ? 7 : dow; // 1 Mon .. 7 Sun
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  return fromISO(iso).toLocaleDateString("en-US", opts);
}

export function fmtWeek(monday: string) {
  const fri = addDays(monday, 4);
  const a = fromISO(monday);
  const b = fromISO(fri);
  const sameMonth = a.getMonth() === b.getMonth();
  return `${a.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${b.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
}

/** "13:30:00" -> minutes after midnight. */
export function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function timeOf(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** "13:30" -> "1:30 PM" */
export function fmtTime(t: string): string {
  const total = minutesOf(t);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtRange(start: string, minutes: number): string {
  return `${fmtTime(start)} – ${fmtTime(timeOf(minutesOf(start) + minutes))}`;
}

export function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "";
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export const firstName = (p: Person | undefined | null) => (p?.full_name || "").trim().split(/\s+/)[0] || "Unknown";

/** Which class day a rep is in for a week: a one-week move wins over the regular day. 0 = not in class. */
export function classDayOf(repId: string, regular: Map<string, number>, moves: Map<string, number>): number {
  return moves.has(repId) ? moves.get(repId)! : regular.get(repId) ?? 0;
}

export function guessKind(file: File): MaterialKind {
  const n = file.name.toLowerCase();
  if (file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/.test(n)) return "video";
  if (file.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (/\.(ppt|pptx|key)$/.test(n)) return "slides";
  return "doc";
}

/** Title from a file name: "CRM_Sorting_for_Reps_1.mp4" -> "CRM Sorting for Reps 1". */
export function titleFromFile(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^[0-9a-f]{8}-/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Length of a local video file, read in the browser. */
export function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) ? v.duration : null;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    v.src = url;
  });
}

// ---------------------------------------------------------------- new-hire week

/**
 * The new-hire week from the Aug 31 - Sep 4, 2026 schedule. Loaded as DRAFT
 * events for Pat to adjust before publishing. Each session runs until the
 * next one starts (capped at an hour); the document gives start times only,
 * so every length is a starting point to edit. "KF" is Kevin Fallis.
 * Lunches and wrap-ups had no times in the copy we have, so they are left
 * for Pat to add.
 */
export const NEW_HIRE_WEEK: { day: number; time: string; title: string; who: string[]; guest?: string }[] = [
  { day: 1, time: "09:00", title: "Credit Background", who: ["pat"] },
  { day: 1, time: "11:00", title: "Dealing with Debt", who: ["pat"] },
  { day: 1, time: "12:00", title: "Collections", who: ["pat"] },
  { day: 1, time: "14:00", title: "Inner Game", who: ["kevin"] },
  { day: 2, time: "09:00", title: "Sales Strategy / Choice Options", who: ["pat"] },
  { day: 2, time: "10:00", title: "Financial Restoration", who: ["pat"] },
  { day: 2, time: "12:00", title: "OneDrive / Office / Chats", who: ["pat"], guest: "Monique" },
  { day: 2, time: "13:00", title: "Straight Line Persuasion", who: ["pat"] },
  { day: 3, time: "09:00", title: "Script and Loops", who: ["pat"] },
  { day: 3, time: "10:00", title: "Contract Walkthrough", who: ["pat"] },
  { day: 3, time: "12:00", title: "Listen to a Call", who: ["pat"] },
  { day: 3, time: "13:00", title: "Covering Credit Reports", who: ["pat"] },
  { day: 3, time: "15:00", title: "SuperMoney and Guidelines", who: ["max"] },
  { day: 4, time: "09:00", title: "CRM", who: ["pat"] },
  { day: 4, time: "11:00", title: "Hardship Probing Questions", who: ["kevin"] },
  { day: 4, time: "13:00", title: "Take a Lead Beginning to End", who: ["pat"] },
  { day: 4, time: "15:00", title: "Slate Legal Plan / Price / Tradeline Reporting", who: ["max"] },
  { day: 5, time: "09:00", title: "Script Roleplay", who: [], guest: "Sebastian" },
  { day: 5, time: "11:00", title: "Guest Speaker", who: [], guest: "KJ or Rafael" },
  { day: 5, time: "13:00", title: "CRM Refreshers / Pipeline Management", who: ["max"] },
  { day: 5, time: "14:00", title: "DS Flips", who: ["kevin"] },
  { day: 5, time: "15:00", title: "Script Roleplay", who: [] },
];

export function newHireLengths(): number[] {
  return NEW_HIRE_WEEK.map((s, i) => {
    const next = NEW_HIRE_WEEK[i + 1];
    if (!next || next.day !== s.day) return 60;
    return Math.max(15, Math.min(60, minutesOf(next.time) - minutesOf(s.time)));
  });
}

/** Who teaches Master Your Craft. Anyone else is typed in as a guest speaker. */
export const MYC_TEACHERS = ["patrick", "kevin", "max"];
export function isMycTeacher(p: Person): boolean {
  return MYC_TEACHERS.includes((p.full_name || "").trim().split(/\s+/)[0].toLowerCase());
}

/** The guest speaker for a Master Your Craft week, kept alongside the per-day covers. */
export const GUEST_KEY = "guest";

/** Name of whoever teaches a Master Your Craft class that day: a one-day cover, the guest, or the week's teacher. */
export function mycTeacherName(w: Pick<MasteryWeek, "day_instructors" | "instructor_id"> | null | undefined, day: number, nameOf: (id: string) => string): string {
  if (!w) return "";
  const cover = w.day_instructors?.[String(day)];
  if (cover) return nameOf(cover);
  const guest = w.day_instructors?.[GUEST_KEY];
  if (guest) return guest;
  return w.instructor_id ? nameOf(w.instructor_id) : "";
}
