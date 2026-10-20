"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/lang";
import { copyFor } from "@/lib/copy";
import TodayPanel from "./TodayPanel";
import ProgressPanel from "./ProgressPanel";
import RepShell, { useShell } from "./RepShell";
import "./training/training.css";

/**
 * The rep's home inside their menu: Today (their next best move) or
 * My progress (?s=progress). Script sections, loops and practice calls are
 * in the menu.
 */
export default function HomeView() {
  const supabase = createClient();
  const router = useRouter();
  const data = useShell();
  const lang = useLang();
  // Today, or My progress from the menu (?s=progress).
  const section: "today" | "progress" = useSearchParams().get("s") === "progress" ? "progress" : "today";


  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.replace("/login");
      const { data: p } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
      const isManager = ["admin", "manager"].includes(p?.role || "");
      const repView = new URLSearchParams(window.location.search).get("view") === "rep" || /(?:^|; )vn_repview=1/.test(document.cookie);
      const { data } = await supabase.from("profiles").select("must_change_password").eq("id", session.user.id).maybeSingle();
      if ((data as { must_change_password?: boolean } | null)?.must_change_password) router.replace("/account?first=1");
      else if (isManager && !repView) router.replace("/admin/home");
    })();
  }, [supabase, router]);

  const c = copyFor(lang);
  const es = lang === "es";

  return (
    <RepShell section={section}>
      <main className="shell">
        {!data ? (
          <p className="muted">{c.loading}</p>
        ) : (
          <>
            <div className="eyebrow">{data.name ? `${c.welcomeBack}, ${data.name.split(" ")[0]}` : c.training}</div>
            {section === "progress" ? (
              <>
                <h1>{es ? "Mi progreso" : "My progress"}</h1>
                <ProgressPanel supabase={supabase} userId={data.userId} es={es} linesDone={data.done.size} />
              </>
            ) : (
              <>
                <h1>{es ? "Hoy" : "Today"}</h1>
                <TodayPanel supabase={supabase} userId={data.userId} es={es} roleplayOn={data.roleplayOn} modules={data.modules} lang={lang} />
              </>
            )}
          </>
        )}
      </main>
    </RepShell>
  );
}
