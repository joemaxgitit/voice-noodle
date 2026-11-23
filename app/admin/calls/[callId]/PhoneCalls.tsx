"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { createClient } from "@/lib/supabase/client";
import { OUTCOME_LABEL, type Outcome } from "@/lib/calls";

/*
  Every call with this client's phone number (read from the recording's file
  name), in every department: the opener call, the sales calls, the service
  calls -- whatever lead ID each system gave them (supabase/call-phone.sql).
*/
type Row = { id: string; call_date: string | null; created_at: string; dept: string; rep: string | null; result: string | null; score: number | null };

export default function PhoneCalls({ supabase, callId }: { supabase: ReturnType<typeof createClient>; callId: string }) {
  const [phone, setPhone] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let off = false;
    void (async () => {
      const { data: me, error } = await supabase.from("calls").select("phone").eq("id", callId).maybeSingle();
      const p = error ? null : ((me as { phone?: string | null } | null)?.phone ?? null);
      if (off) return;
      setPhone(p);
      if (!p) return setRows([]);
      const { data } = await supabase.rpc("calls_on_phone", { p_phone: p });
      if (!off) setRows(((data || []) as Row[]).filter((r) => r.id !== callId));
    })();
    return () => {
      off = true;
    };
  }, [supabase, callId]);

  if (!phone) return null;
  const pretty = `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  const day = (r: Row) => new Date(`${(r.call_date || r.created_at).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div style={{ marginTop: 10 }}>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Phone {pretty} &middot; {rows.length ? `${rows.length} other call${rows.length === 1 ? "" : "s"} with this number, in any department:` : "no other calls with this number yet."}
      </p>
      {rows.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/calls/${r.id}`}>
                {day(r)} &middot; {r.dept}
                {r.rep ? ` · ${r.rep}` : ""}
              </Link>
              {r.result && <small className="muted"> &middot; {OUTCOME_LABEL[r.result as Outcome] ?? r.result.replace(/_/g, " ")}</small>}
              {typeof r.score === "number" && <small className="muted"> &middot; script {r.score}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
