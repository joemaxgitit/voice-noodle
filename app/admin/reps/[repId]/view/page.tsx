"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TodayPanel from "../../../../TodayPanel";
import ProgressPanel from "../../../../ProgressPanel";

/**
 * What this rep sees on their own home (Today and My progress), for a
 * manager. Read-only: nothing here can be clicked or changed, and cards
 * aren't marked as seen.
 */
export default function RepView() {
  const { repId } = useParams<{ repId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState("");
  const [linesDone, setLinesDone] = useState(0);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("profiles").select("full_name").eq("id", repId).single();
      setName(data?.full_name || "This rep");
      const { count } = await supabase.from("progress").select("segment_id", { count: "exact", head: true }).eq("user_id", repId).eq("completed", true);
      setLinesDone(count ?? 0);
    })();
  }, [supabase, repId]);

  const es = false; // language is chosen on the rep's own device; shown in English here
  const first = name.split(" ")[0];
  return (
    <main className="shell rx-page">
      <div className="eyebrow">
        <Link href="/admin/reps">Reps</Link> / <Link href={`/admin/reps/${repId}`}>{name || "Profile"}</Link> / their view
      </div>
      <h1>What {first || "they"} see{first ? "s" : ""}</h1>
      <p className="muted" style={{ maxWidth: "66ch" }}>
        {first || "The rep"}&rsquo;s own home, exactly as it shows for them: their focus cards, rotation and progress. Read-only -- nothing you do here changes
        anything, and their cards stay unread until they open them.
      </p>
      <div inert style={{ maxWidth: 720, border: "1px dashed var(--line)", borderRadius: 14, padding: "4px 18px 18px" }}>
        {repId && (
          <>
            <TodayPanel supabase={supabase} userId={repId} viewing es={es} resume={null} roleplayOn={false} openPractice={() => {}} />
            <h2 className="eyebrow" style={{ marginTop: 26 }}>
              My progress
            </h2>
            <ProgressPanel supabase={supabase} userId={repId} es={es} linesDone={linesDone} />
          </>
        )}
      </div>
    </main>
  );
}
