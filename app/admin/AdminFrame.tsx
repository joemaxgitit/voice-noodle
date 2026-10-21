"use client";

import { useEffect, useState, type ReactNode } from "react";
import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMode } from "@/lib/superMode";
import { createClient } from "@/lib/supabase/client";
import "./admin-frame.css";

/*
  The manager side of the app: a fixed sidebar on desktop, a menu button and
  slide-in drawer on a phone. Navigation only -- every page underneath is
  unchanged and keeps its own data, buttons and behaviour.
*/

type Item = { href: string; label: string; icon: keyof typeof ICONS; match: (p: string) => boolean; salesOnly?: boolean; extra?: boolean };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "",
    items: [{ href: "/admin/home", label: "Home", icon: "home", match: (p) => p.startsWith("/admin/home") }],
  },
  {
    title: "Team",
    items: [
      { href: "/admin/reps", label: "Reps", icon: "people", match: (p) => p.startsWith("/admin/reps") },
      { href: "/admin/rotation", label: "Rotation", icon: "rotate", match: (p) => p.startsWith("/admin/rotation"), salesOnly: true, extra: true },
      { href: "/admin/dealclip", label: "Deal Clip", icon: "chart", match: (p) => p.startsWith("/admin/dealclip"), salesOnly: true, extra: true },
      { href: "/admin/coaching", label: "Coaching trends", icon: "chart", match: (p) => p.startsWith("/admin/coaching"), extra: true },
      { href: "/admin/reports", label: "Sales reports", icon: "table", match: (p) => p.startsWith("/admin/reports"), extra: true },
    ],
  },
  {
    title: "Call review",
    items: [
      {
        href: "/admin/calls",
        label: "Calls",
        icon: "phone",
        match: (p) => p.startsWith("/admin/calls") && !p.startsWith("/admin/calls/insights"),
      },
      { href: "/admin/calls/insights", label: "Insights & tuning", icon: "chart", match: (p) => p.startsWith("/admin/calls/insights") },
    ],
  },
  {
    title: "Meetings",
    items: [
      { href: "/admin/mastery", label: "Master Your Craft", icon: "cap", match: (p) => p.startsWith("/admin/mastery"), extra: true },
      { href: "/admin/meeting", label: "Thursday meeting", icon: "megaphone", match: (p) => p.startsWith("/admin/meeting"), extra: true },
    ],
  },
  {
    title: "Training",
    items: [
      { href: "/admin/training", label: "Training hub", icon: "calendar", match: (p) => p.startsWith("/admin/training") },
      { href: "/admin/roleplay", label: "Practice calls", icon: "headset", match: (p) => p.startsWith("/admin/roleplay") },
      { href: "/admin/attempts", label: "Attempts", icon: "mic", match: (p) => p.startsWith("/admin/attempts") },
      { href: "/admin/listening", label: "Listening", icon: "ear", match: (p) => p.startsWith("/admin/listening") },
      { href: "/admin/live", label: "Live", icon: "live", match: (p) => p.startsWith("/admin/live") },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/admin/people", label: "People & access", icon: "key", match: (p) => p.startsWith("/admin/people") },
      { href: "/admin/spending", label: "Spending", icon: "dollar", match: (p) => p.startsWith("/admin/spending") },
    ],
  },
];

const ICONS = {
  home: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  rotate: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  dollar: "M12 3v18M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.6 0-4.2 1.3-4.2 3s1.6 2.6 4.2 3 4.5 1.4 4.5 3.2-1.9 3.3-4.5 3.3c-2.2 0-3.9-.9-4.7-2.3",
  table: "M4 4h16v16H4zM4 9h16M4 14h16M10 9v11",
  cap: "M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6",
  megaphone: "M3 10v4h3l7 4V6L6 10zM16 9a4 4 0 0 1 0 6M6 14l1 6h3l-1-5",
  key: "M15 7a4 4 0 1 1-3.9 4.9L4 19v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7zM16 9h.01",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  headset: "M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1zM17 20a4 4 0 0 1-4 2h-1",
  script: "M7 3h8l4 4v14H7zM14 3v5h5M10 12h6M10 16h6",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  ear: "M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0M10 9a2 2 0 0 1 4 0",
  live: "M12 12h.01M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8",
  people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7",
  back: "M15 18l-6-6 6-6",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  signout: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11",
  chevron: "M9 6l6 6-6 6",
  loop: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="af-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

type TreeScript = { id: string; title: string; sort_order: number };
type TreeModule = { id: string; title: string; script_id: string; kind: string; language: string; sort_order: number };
let treeCache: { scripts: TreeScript[]; modules: TreeModule[] } | null = null;

const cleanTitle = (t: string) => t.replace(/\s+[—-]\s+.*$/, "");

/**
 * The scripts in the menu, organised like the rep side: each script opens to
 * its sections, and the objection loops sit together under Loops. Each link
 * opens the recording page on that script or section.
 */
function ScriptTree({ path }: { path: string }) {
  const [tree, setTree] = useState(treeCache);
  const [qs, setQs] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (treeCache) return;
    const supabase = createClient();
    void Promise.all([
      supabase.from("scripts").select("id, title, sort_order").eq("active", true).order("sort_order"),
      supabase.from("modules").select("id, title, script_id, kind, language, sort_order").eq("active", true).order("sort_order"),
    ]).then(([s, m]) => {
      treeCache = { scripts: (s.data || []) as TreeScript[], modules: (m.data || []) as TreeModule[] };
      setTree(treeCache);
    });
  }, []);
  // Which script / section is open on the recording page (read from the address, kept in step with clicks).
  useEffect(() => setQs(window.location.search), [path]);
  const q = new URLSearchParams(qs);
  const onRecording = path === "/admin" || path.startsWith("/admin/timing");
  const curScript = onRecording ? q.get("script") : null;
  const curModule = onRecording ? q.get("module") : null;
  useEffect(() => {
    if (!tree || !curScript) return;
    const m = tree.modules.find((x) => x.id === curModule);
    setOpen((o) => new Set(o).add(m?.kind === "loop" ? "loops" : curScript));
  }, [tree, curScript, curModule]);

  if (!tree) return null;
  const en = tree.modules.filter((m) => (m.language || "en") === "en");
  const seen = new Set<string>();
  const loops = en.filter((m) => m.kind === "loop" && !seen.has(m.title.toLowerCase()) && (seen.add(m.title.toLowerCase()), true));
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const link = (href: string, label: string, active: boolean) => (
    <Link key={href} href={href} onClick={() => setQs(href.slice(href.indexOf("?")))} className={`rs-sublink${active ? " active" : ""}`}>
      <span>{label}</span>
    </Link>
  );
  const group = (key: string, label: string, icon: keyof typeof ICONS, body: ReactNode) => (
    <div key={key}>
      <button type="button" className={`af-link rs-group${open.has(key) ? " open" : ""}`} aria-expanded={open.has(key)} onClick={() => toggle(key)}>
        <Icon name={icon} />
        <span style={{ flex: 1 }}>{label}</span>
        <span className="rs-chev">
          <Icon name="chevron" />
        </span>
      </button>
      {open.has(key) && <div className="rs-sub">{body}</div>}
    </div>
  );
  const loopsGroup =
    loops.length > 0 &&
    group(
      "loops",
      "Loops",
      "loop",
      loops.map((m) => link(`/admin?script=${m.script_id}&module=${m.id}`, m.title, curModule === m.id))
    );
  // Loops sit right under the script they belong to (the Options Script).
  const loopsAfter = loops[0]?.script_id;
  return (
    <>
      {tree.scripts.map((sc) => {
        const mods = en.filter((m) => m.script_id === sc.id && m.kind !== "loop");
        if (!mods.length) return null;
        return (
          <div key={sc.id}>
            {group(
              sc.id,
              cleanTitle(sc.title),
              "script",
              <>
                {link(`/admin?script=${sc.id}`, "All sections", curScript === sc.id && !curModule)}
                {mods.map((m) => link(`/admin?script=${sc.id}&module=${m.id}`, m.title, curModule === m.id))}
              </>
            )}
            {sc.id === loopsAfter && loopsGroup}
          </div>
        );
      })}
      {!tree.scripts.some((sc) => sc.id === loopsAfter) && loopsGroup}
    </>
  );
}

export default function AdminFrame({ children }: { children: ReactNode }) {
  const path = usePathname() || "/admin";
  const [open, setOpen] = useState(false);
  // Who's signed in: service managers don't have rotation or the Deal Clip.
  const [who, setWho] = useState<{ label: string; service: boolean; superAdmin: boolean }>({ label: "Manager", service: false, superAdmin: false });
  const mode = useMode();
  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from("profiles").select("role, team").eq("id", session.user.id).single();
      const { data: sa } = await supabase.from("profiles").select("super_admin").eq("id", session.user.id).maybeSingle();
      const service = data?.role === "manager" && data?.team === "ams";
      const label = (sa as { super_admin?: boolean } | null)?.super_admin
        ? "Super admin"
        : data?.role === "admin"
          ? "Admin"
          : service
            ? "Service manager"
            : "Sales manager";
      setWho({ label, service, superAdmin: !!(sa as { super_admin?: boolean } | null)?.super_admin });
    })();
  }, []);

  // Close the drawer on navigation and on Escape.
  useEffect(() => setOpen(false), [path]);
  // Back in the manager side: the next visit to the rep home sends them here again.
  useEffect(() => {
    document.cookie = "vn_repview=; path=/; max-age=0";
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = GROUPS.flatMap((g) => g.items).find((i) => i.match(path));

  // Scripts and Settings start folded; each opens with a click (and stays open while you're on one of its pages).
  const [shown, setShown] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setShown(new Set(JSON.parse(localStorage.getItem("vn_menu_open") || "[]") as string[]));
    } catch {
      // private window or blocked storage: start folded
    }
  }, []);
  const fold = (k: string) =>
    setShown((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      try {
        localStorage.setItem("vn_menu_open", JSON.stringify([...n]));
      } catch {
        // fine without it
      }
      return n;
    });
  const foldHead = (k: string, style?: React.CSSProperties) => (
    <button type="button" className="af-group-title af-fold" style={style} aria-expanded={shown.has(k)} onClick={() => fold(k)}>
      {k}
      <span className={`rs-chev${shown.has(k) ? " open" : ""}`} aria-hidden="true">
        <Icon name="chevron" />
      </span>
    </button>
  );

  return (
    <div className="admin-frame">
      <header className="af-mobilebar">
        <button className="af-menu" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="menu" />
        </button>
        <span className="af-mobile-title">{current?.label ?? "Admin"}</span>
      </header>

      {open && <div className="af-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside className={`af-side${open ? " open" : ""}`} aria-label="Manager navigation">
        <div className="af-brand">
          <span className="af-mark" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/voicenoodle-mark-sm.png" alt="" />
          </span>
          <span>
            <b>Voice Noodle</b>
            <small>{who.label}</small>
          </span>
          <button className="af-close" aria-label="Close menu" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>

        <nav className="af-nav">
          {GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !(i.salesOnly && who.service) && !(i.extra && !mode.superMode)) }))
            // A heading with nothing under it (Meetings, for everyone but the super admin) isn't shown.
            .filter((g) => g.items.length)
            .map((g) => (
            <div className="af-group" key={g.title || "top"}>
              {g.title && g.title !== "Settings" && <div className="af-group-title">{g.title}</div>}
              {g.title === "Settings" ? (
                <>
                  {foldHead("Settings")}
                  {(shown.has("Settings") || g.items.some((i) => i.match(path))) &&
                    g.items.map((i) => {
                      const active = i.match(path);
                      return (
                        <Link key={i.href} href={i.href} className={`af-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
                          <Icon name={i.icon} />
                          {i.label}
                        </Link>
                      );
                    })}
                </>
              ) : g.items.map((i) => {
                const active = i.match(path);
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`af-link${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon name={i.icon} />
                    {i.label}
                  </Link>
                );
              })}
              {g.title === "Training" && (
                <>
                  {foldHead("Scripts", { marginTop: 10 })}
                  {(shown.has("Scripts") || path === "/admin" || path.startsWith("/admin/timing")) && <ScriptTree path={path} />}
                </>
              )}
            </div>
          ))}
        </nav>

        <div className="af-foot">
          <Link href="/roleplay" className="af-link">
            <Icon name="headset" />
            Try a practice call
          </Link>
          <Link href="/account" className="af-link">
            <Icon name="key" />
            Account
          </Link>
          <button
            type="button"
            className="af-link"
            onClick={async () => {
              await createClient().auth.signOut();
              document.cookie = "vn_repview=; Max-Age=0; path=/";
              window.location.href = "/login";
            }}
          >
            <Icon name="signout" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="af-main">{children}</div>
    </div>
  );
}
