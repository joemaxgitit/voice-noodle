"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OUTCOME_LABEL, RETENTION_LABEL, scoreBand, type Outcome, type Retention } from "@/lib/calls";
import "../../calls.css";

/*
  One client's whole journey by phone number: every call in every department,
  in order -- the opener call, the sales calls, the service calls -- whatever
  lead ID each system gave them (supabase/call-phone.sql).
*/
type Row = { id: string; call_date: string | null; created_at: string; dept: string; rep: string | null; result: string | null; score: number | null };
type More = { id: string; client_label: string | null; summary: string | null };
type Status = { enrolled: boolean; retention: string | null; cancelled_on: string | null };

const DEPT_TONE: Record<string, string> = { Openers: "fair", Sales: "good", Service: "" };

export default function PhoneJourney() {
  const { phone: raw } = useParams<{ phone: string }>();
  const phone = decodeURIComponent(raw || "").replace(/\D/g, "").slice(-10);
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [more, setMore] = useState<Map<string, More>>(new Map());
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc("calls_on_phone", { p_phone: phone });
      if (error) return setError(/calls_on_phone/.test(error.message) ? "Run supabase/call-phone.sql first." : error.message);
      const list = (data || []) as Row[];
      setRows(list);
      const [m, s] = await Promise.all([
        list.length ? supabase.from("calls").select("id, client_label, summary:grade->>summary").in("id", list.map((r) => r.id)) : Promise.resolve({ data: [] }),
        supabase.rpc("phone_results", { p_phones: [phone] }),
      ]);
      setMore(new Map(((m.data || []) as More[]).map((x) => [x.id, x])));
      setStatus((((s as { data: unknown }).data || []) as Status[])[0] ?? null);
    })();
  }, [supabase, phone]);

  const pretty = phone.length === 10 ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` : phone;
  const day = (r: Row) => new Date(`${(r.call_date || r.created_at).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const ids = [...new Set([...more.values()].map((x) => x.client_label?.trim()).filter(Boolean))];

  return (
    <main className="shell" style={{ maxWidth: 900 }}>
      <div className="topbar">
        <Link className="btn" href="/admin/calls" style={{ textDecoration: "none" }}>
          &larr; Calls
        </Link>
      </div>
      <div className="eyebrow">Client journey &middot; every department</div>
      <h1>{pretty}</h1>
      {ids.length > 0 && <p className="muted" style={{ marginTop: -6 }}>Client / lead IDs: {ids.join(", ")}</p>}
      {status && (
        <p style={{ margin: "4px 0 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {status.enrolled ? <span className="pill good">Enrolled</span> : <span className="pill">Not enrolled</span>}
          {status.retention && <span className={`pill ${status.retention === "cancelled" ? "poor" : "good"}`}>{RETENTION_LABEL[status.retention as Retention] ?? status.retention}</span>}
          {status.cancelled_on && <span className="pill poor">Cancel requested {new Date(`${status.cancelled_on}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}
        </p>
      )}
      {error && <div className="error">{error}</div>}
      {rows === null && !error && <p className="muted">Loading&hellip;</p>}
      {rows?.length === 0 && <p className="muted">No calls with this number.</p>}
      {rows && rows.length > 0 && (
        <div className="rx-timeline">
          {rows.map((r, i) => {
            const x = more.get(r.id);
            return (
              <Link key={r.id} href={`/admin/calls/${r.id}`} className="rx-ev" style={{ alignItems: "flex-start" }}>
                <span className="when">
                  {i + 1}. {day(r)}
                </span>
                <span className="what">
                  <b>
                    <span className={`pill ${DEPT_TONE[r.dept] ?? ""}`} style={{ marginRight: 6 }}>
                      {r.dept}
                    </span>
                    {r.rep || "Unknown rep"}
                    {r.result && <small className="muted"> &middot; {OUTCOME_LABEL[r.result as Outcome] ?? r.result.replace(/_/g, " ")}</small>}
                  </b>
                  {x?.summary ? <small style={{ display: "block", marginTop: 4, lineHeight: 1.5 }}>{x.summary}</small> : !x ? <small className="muted">Another department&rsquo;s call</small> : null}
                </span>
                {typeof r.score === "number" && <span className={`pill ${scoreBand(r.score)}`}>Script {r.score}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
