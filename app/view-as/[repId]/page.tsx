"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import RepShell, { useShell } from "../../RepShell";
import TodayPanel from "../../TodayPanel";
import ProgressPanel from "../../ProgressPanel";
import "../../training/training.css";

/**
 * A manager seeing the whole screen exactly as one rep sees it: their menu,
 * their Today (next best move, weekly goal, focus cards) and My progress.
 * Read only -- cards aren't marked as seen, and nothing can be changed.
 */
export default function ViewAs() {
  const { repId } = useParams<{ repId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const data = useShell(repId);
  const [section, setSection] = useState<"today" | "progress">("today");
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return setAllowed(false);
      const { data: p } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
      setAllowed(["admin", "manager"].includes(p?.role || ""));
    })();
  }, [supabase]);

  if (allowed === false) return <main className="shell"><p className="muted">Managers only.</p></main>;

  return (
    <RepShell viewAs={{ id: repId, name: data?.name || "this rep", back: `/admin/reps/${repId}` }} section={section} onSection={setSection}>
      <main className="shell">
        {!data ? (
          <p className="muted">Loading…</p>
        ) : (
          <div inert>
            <div className="eyebrow">Welcome back, {data.name.split(" ")[0]}</div>
            {section === "progress" ? (
              <>
                <h1>My progress</h1>
                <ProgressPanel supabase={supabase} userId={data.userId} es={false} linesDone={data.done.size} />
              </>
            ) : (
              <>
                <h1>Today</h1>
                <TodayPanel supabase={supabase} userId={data.userId} es={false} roleplayOn={data.roleplayOn} modules={data.modules} lang="en" viewing />
              </>
            )}
          </div>
        )}
      </main>
    </RepShell>
  );
}
