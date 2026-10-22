"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import RepShell, { useShell } from "../../RepShell";
import SectionsHome from "../../SectionsHome";
import "../../training/training.css";

/**
 * A manager seeing the whole screen exactly as one rep sees it: their menu,
 * their home (the Options Script sections).
 * Read only -- cards aren't marked as seen, and nothing can be changed.
 */
export default function ViewAs() {
  const { repId } = useParams<{ repId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const data = useShell(repId);
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
    <RepShell viewAs={{ id: repId, name: data?.name || "this rep", back: `/admin/reps/${repId}` }}>
      <main className="shell">
        {!data ? (
          <p className="muted">Loading…</p>
        ) : (
          <div inert>
            <SectionsHome data={data} lang="en" viewing />
          </div>
        )}
      </main>
    </RepShell>
  );
}
