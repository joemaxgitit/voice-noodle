"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/lang";
import { copyFor } from "@/lib/copy";
import SectionsHome from "./SectionsHome";
import RepShell, { useShell } from "./RepShell";
import "./training/training.css";

/**
 * The rep's home inside their menu: the Options Script's sections, straight
 * into practice. Scripts and practice calls are in the menu.
 */
export default function HomeView() {
  const supabase = createClient();
  const router = useRouter();
  const data = useShell();
  const lang = useLang();


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
    <RepShell>
      <main className="shell">
        {!data ? (
          <p className="muted">{c.loading}</p>
        ) : (
          <>
            <SectionsHome data={data} lang={lang} />
          </>
        )}
      </main>
    </RepShell>
  );
}
