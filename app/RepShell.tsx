"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setLang as rememberLang, useLang } from "@/lib/lang";
import { Icon } from "./admin/AdminFrame";
import "./admin/admin-frame.css";

/*
  The rep's frame: a left menu like the managers', built for one job --
  getting reps into practice. Today (their next best move), Practice calls,
  each script with its sections, the loops, My progress, and My training for
  reps still in training. Sales reps see the Lionside logo, service reps
  (account managers) Bolton's.

  viewAs: a manager looking at exactly what one rep sees (read only).
*/

export type ShellModule = { id: string; title: string; sort_order: number; script_id: string; kind: string; language: string; segments: { id: string }[] };
export type ShellScript = { id: string; title: string; sort_order: number; team?: string | null };
export type ShellData = {
  userId: string;
  name: string;
  role: string;
  team: string | null;
  inTraining: boolean;
  roleplayOn: boolean;
  scripts: ShellScript[];
  modules: ShellModule[];
  done: Set<string>;
};

const cleanTitle = (t: string) => t.replace(/\s+[—–-]+\s+.*$/, "").trim();

export async function loadShell(repId?: string): Promise<ShellData | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const uid = repId || session.user.id;
  const [p, s, m, pr] = await Promise.all([
    supabase.from("profiles").select("full_name, role, team, org_id").eq("id", uid).single(),
    supabase.from("scripts").select("id, title, sort_order, team"),
    supabase.from("modules").select("id, title, sort_order, script_id, kind, language, segments(id)"),
    supabase.from("progress").select("segment_id").eq("completed", true).eq("user_id", uid),
  ]);
  const tr = await supabase.from("profiles").select("in_training").eq("id", uid).maybeSingle();
  const org = p.data?.org_id ? await supabase.from("orgs").select("roleplay_enabled").eq("id", p.data.org_id).maybeSingle() : null;
  const team = (p.data?.team as string | null) ?? null;
  // RLS already limits a rep to their team's scripts; a manager viewing a rep gets the same filter here.
  const scripts = ((s.data || []) as ShellScript[]).filter((x) => !repId || !x.team || x.team === team).sort((a, b) => a.sort_order - b.sort_order);
  return {
    userId: uid,
    name: p.data?.full_name || "",
    role: p.data?.role || "rep",
    team,
    inTraining: !!(tr.data as { in_training?: boolean } | null)?.in_training,
    roleplayOn: !!org?.data?.roleplay_enabled,
    scripts,
    modules: ((m.data || []) as unknown as ShellModule[]).filter((x) => scripts.some((sc) => sc.id === x.script_id)).sort((a, b) => a.sort_order - b.sort_order),
    done: new Set((pr.data || []).map((r) => r.segment_id as string)),
  };
}

let cache: { key: string; data: ShellData } | null = null;

export function useShell(repId?: string) {
  const key = repId || "me";
  const [data, setData] = useState<ShellData | null>(cache?.key === key ? cache.data : null);
  useEffect(() => {
    let off = false;
    void loadShell(repId).then((d) => {
      if (off || !d) return;
      cache = { key, data: d };
      setData(d);
    });
    return () => {
      off = true;
    };
  }, [repId, key]);
  return data;
}

export default function RepShell({
  children,
  viewAs,
  onSection,
  section,
}: {
  children: ReactNode;
  /** A manager viewing this rep's screen. */
  viewAs?: { id: string; name: string; back: string };
  /** In view-as mode, Today / My progress switch here instead of navigating. */
  onSection?: (s: "today" | "progress") => void;
  section?: "today" | "progress";
}) {
  const path = usePathname() || "/";
  const router = useRouter();
  const data = useShell(viewAs?.id);
  const [open, setOpen] = useState(false);
  const lang = useLang();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => setOpen(false), [path]);

  const es = lang === "es";
  const mods = useMemo(() => (data?.modules || []).filter((m) => (m.language || "en") === lang), [data, lang]);
  const hasSpanish = (data?.modules || []).some((m) => m.language === "es");
  // Every loop in one place (deduped by name), however many scripts carry them.
  const loops = useMemo(() => {
    const seen = new Set<string>();
    return mods.filter((m) => m.kind === "loop" && m.segments?.length && !seen.has(m.title.toLowerCase()) && (seen.add(m.title.toLowerCase()), true));
  }, [mods]);
  const currentModule = path.startsWith("/train/") ? path.split("/")[2] : null;

  // Open the group holding the section they're on.
  useEffect(() => {
    if (!currentModule || !data) return;
    const m = data.modules.find((x) => x.id === currentModule);
    if (m) setExpanded((e) => new Set(e).add(m.kind === "loop" ? "loops" : m.script_id));
  }, [currentModule, data]);
  // On a whole-script page, open that script.
  useEffect(() => {
    if (path.startsWith("/script/")) setExpanded((e) => new Set(e).add(path.split("/")[2]));
  }, [path]);

  const toggle = (k: string) =>
    setExpanded((e) => {
      const n = new Set(e);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const viewing = !!viewAs;
  const service = data?.team === "ams";
  const logo = service ? { dark: "/bolton-logo.png", light: "/bolton-logo-light.png" } : { dark: "/lionside-logo.png", light: "/lionside-logo-print.png" };

  const homeActive = !viewing && (path === "/proedgesolutions" || path === "/") && section !== "progress";
  const progressActive = section === "progress";

  /** A menu link; in view-as mode only Today and My progress do anything. */
  const item = (key: string, href: string, label: ReactNode, icon: Parameters<typeof Icon>[0]["name"], active: boolean) =>
    viewing ? (
      <button type="button" key={key} className={`af-link${active ? " active" : ""}`} onClick={() => (key === "today" || key === "progress" ? onSection?.(key) : undefined)}>
        <Icon name={icon} />
        {label}
      </button>
    ) : (
      <Link key={key} href={href} className={`af-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
        <Icon name={icon} />
        {label}
      </Link>
    );

  const moduleList = (list: typeof mods, scriptId?: string) => (
    <div className="rs-sub">
      {scriptId && !viewing && (
        <Link href={`/script/${scriptId}`} className={`rs-sublink${path === `/script/${scriptId}` ? " active" : ""}`}>
          <span>{es ? "Guion completo" : "Whole script"}</span>
        </Link>
      )}
      {list.map((m) => {
        const total = m.segments?.length ?? 0;
        const complete = (m.segments || []).filter((s) => data?.done.has(s.id)).length;
        const inner = (
          <>
            <span>{m.title}</span>
            <small>{total ? `${complete}/${total}` : ""}</small>
          </>
        );
        return viewing ? (
          <span key={m.id} className="rs-sublink">
            {inner}
          </span>
        ) : (
          <Link key={m.id} href={`/train/${m.id}`} className={`rs-sublink${currentModule === m.id ? " active" : ""}`}>
            {inner}
          </Link>
        );
      })}
    </div>
  );

  const group = (key: string, label: string, icon: Parameters<typeof Icon>[0]["name"], list: typeof mods, scriptId?: string) =>
    list.length ? (
      <div key={key}>
        <button type="button" className={`af-link rs-group${expanded.has(key) ? " open" : ""}`} aria-expanded={expanded.has(key)} onClick={() => toggle(key)}>
          <Icon name={icon} />
          <span style={{ flex: 1 }}>{label}</span>
          <span className="rs-chev">
            <Icon name="chevron" />
          </span>
        </button>
        {expanded.has(key) && moduleList(list, scriptId)}
      </div>
    ) : null;

  return (
    <div className={`admin-frame rep-frame${viewAs ? " viewing" : ""}`}>
      {viewAs && (
        <div className="rs-viewbar">
          <span>
            Viewing as <b>{viewAs.name}</b><span className="rs-long"> -- this is exactly what they see</span>
          </span>
          <Link className="btn primary" href={viewAs.back} style={{ textDecoration: "none" }}>
            Exit rep view
          </Link>
        </div>
      )}
      <header className="af-mobilebar">
        <button className="af-menu" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="menu" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="rs-mobile-logo dark-only" src={logo.dark} alt="" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="rs-mobile-logo light-only" src={logo.light} alt="" />
      </header>

      {open && <div className="af-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside className={`af-side${open ? " open" : ""}`} aria-label="Menu">
        <div className="rs-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="dark-only" src={logo.dark} alt={service ? "Bolton" : "Lionside"} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="light-only" src={logo.light} alt="" />
          <button className="af-close" aria-label="Close menu" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>

        <nav className="af-nav">
          <div className="af-group">
            {item("today", "/proedgesolutions", es ? "Hoy" : "Today", "target", viewing ? section !== "progress" : homeActive)}
            {item("roleplay", "/roleplay", es ? "Llamadas de práctica" : "Practice calls", "headset", path.startsWith("/roleplay"))}
          </div>

          <div className="af-group">
            <div className="af-group-title">{es ? "Practica el guion" : "Practice the script"}</div>
            {/* Loops sit right under the script they belong to (the Options Script). */}
            {(data?.scripts || []).map((sc) => (
              <div key={sc.id}>
                {group(
                  sc.id,
                  cleanTitle(sc.title),
                  "script",
                  mods.filter((m) => m.script_id === sc.id && m.kind !== "loop"),
                  sc.id
                )}
                {loops[0]?.script_id === sc.id && group("loops", "Loops", "loop", loops)}
              </div>
            ))}
            {!(data?.scripts || []).some((sc) => sc.id === loops[0]?.script_id) && group("loops", "Loops", "loop", loops)}
          </div>

          <div className="af-group">
            {item("progress", "/proedgesolutions?s=progress", es ? "Mi progreso" : "My progress", "chart", viewing ? progressActive : path === "/proedgesolutions" && section === "progress")}
            {data?.inTraining && item("training", "/training", es ? "Mi capacitación" : "My training", "calendar", path.startsWith("/training"))}
          </div>
        </nav>

        <div className="af-foot">
          {hasSpanish && (
            <div className="rs-lang" role="group" aria-label="Language">
              <button aria-pressed={!es} onClick={() => rememberLang("en")}>
                English
              </button>
              <button aria-pressed={es} onClick={() => rememberLang("es")}>
                Español
              </button>
            </div>
          )}
          {!viewing && ["admin", "manager"].includes(data?.role || "") && (
            <Link href="/admin/home" className="af-link">
              <Icon name="home" />
              {es ? "Vista de gerente" : "Manager view"}
            </Link>
          )}
          {item("account", "/account", es ? "Cuenta" : "Account", "key", path.startsWith("/account"))}
          <button
            type="button"
            className="af-link"
            onClick={async () => {
              if (viewing) return;
              await createClient().auth.signOut();
              router.push("/login");
            }}
          >
            <Icon name="signout" />
            {es ? "Cerrar sesión" : "Sign out"}
          </button>
        </div>
      </aside>

      <div className="af-main">{children}</div>
    </div>
  );
}
