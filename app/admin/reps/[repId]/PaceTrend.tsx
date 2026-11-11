"use client";

import { useEffect, useState } from "react";
import { callAt, resolveRoles, type Grade, type Transcript } from "@/lib/calls";
import { paceOf, type PaceRead } from "@/lib/pace";
import { LineChart } from "../charts";
import type { Ctx } from "./page";

type Row = { id: string; created_at: string; call_date: string | null; call_time: string | null; duration_secs: number | null; pace: PaceRead | null };

const DAY = 86400000;
const fmt = (x: number) => new Date(x).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/*
  Is the rep rushing more or less lately? The last 30 graded real calls: how
  much of each call they spent sped up (20%+ above their own usual), and how
  many calls had a speed-up at a key moment (price, options, objections,
  close). Newer grades carry their pace; older ones are worked out here from
  the transcript -- free, no re-grade.
*/
export default function PaceTrend({ ctx }: { ctx: Ctx }) {
  const { supabase, repId } = ctx;
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let off = false;
    void (async () => {
      const { data } = await supabase
        .from("calls")
        .select("id, created_at, call_date, call_time, duration_secs, pace:grade->pace")
        .eq("rep_id", repId)
        .eq("status", "graded")
        .neq("source", "roleplay")
        .order("created_at", { ascending: false })
        .limit(30);
      const list = (data || []) as unknown as (Omit<Row, "pace"> & { pace: PaceRead | null | undefined })[];
      // Older grades have no pace saved: work it out from their transcripts.
      const need = list.filter((r) => r.pace === undefined || r.pace === null).map((r) => r.id);
      const worked = new Map<string, PaceRead | null>();
      for (let i = 0; i < need.length; i += 10) {
        const { data: tx } = await supabase.from("calls").select("id, transcript, speaker_roles, grade").in("id", need.slice(i, i + 10));
        for (const c of (tx || []) as { id: string; transcript: Transcript | null; speaker_roles: Record<string, "rep" | "client" | "am" | "other"> | null; grade: Grade | null }[]) {
          const roles = resolveRoles(c.transcript, c.speaker_roles, c.grade);
          const rep = Object.entries(roles).find(([, r]) => r === "rep")?.[0] ?? null;
          worked.set(c.id, paceOf(c.transcript, rep, c.grade?.sections));
        }
        if (off) return;
      }
      if (!off) setRows(list.map((r) => ({ ...r, pace: r.pace ?? worked.get(r.id) ?? null })));
    })();
    return () => {
      off = true;
    };
  }, [supabase, repId]);

  if (!rows) return <p className="hint">Measuring pace&hellip;</p>;
  const withPace = rows.filter((r) => r.pace && r.duration_secs);
  if (!withPace.length) return <p className="hint">No graded calls long enough to measure pace yet.</p>;

  const share = (r: Row) => Math.min(100, Math.round(((r.pace!.fast_secs || 0) / (r.duration_secs || 1)) * 100));
  const keyCount = (r: Row) => r.pace!.stretches.filter((s) => s.key).length;
  const now = Date.now();
  const recent = withPace.filter((r) => now - callAt(r) <= 14 * DAY);
  const before = withPace.filter((r) => now - callAt(r) > 14 * DAY && now - callAt(r) <= 28 * DAY);
  const rushed = (xs: Row[]) => xs.filter((r) => keyCount(r) > 0).length;
  const usual = Math.round(withPace.reduce((n, r) => n + r.pace!.usual, 0) / withPace.length);
  const top = Math.max(20, ...withPace.map(share));

  return (
    <>
      <p style={{ marginTop: 0 }}>
        Usual pace about <b>{usual}</b> words a minute.{" "}
        {recent.length ? (
          <>
            Sped up at a key moment on <b>{rushed(recent)}</b> of {recent.length} calls in the last 2 weeks
            {before.length ? (
              <>
                {" "}
                (<b>{rushed(before)}</b> of {before.length} the 2 weeks before
                {rushed(recent) / recent.length < rushed(before) / before.length ? " -- better" : rushed(recent) / recent.length > rushed(before) / before.length ? " -- rushing more" : ""})
              </>
            ) : null}
            .
          </>
        ) : (
          <>No calls in the last 2 weeks.</>
        )}
      </p>
      <LineChart
        yMax={Math.ceil(top / 10) * 10}
        fmtX={fmt}
        series={[
          {
            name: "Share of the call sped up",
            color: "var(--live)",
            points: withPace
              .slice()
              .reverse()
              .map((r) => ({
                x: callAt(r),
                y: share(r),
                label: `${fmt(callAt(r))}: sped up ${share(r)}% of the call${keyCount(r) ? `, ${keyCount(r)} at a key moment` : ""} (usual ${r.pace!.usual} wpm)`,
                href: `/admin/calls/${r.id}`,
              })),
          },
        ]}
      />
      <small className="muted">Each dot is a call: how much of it the rep spent 20%+ faster than their own usual pace. Hover for key moments; click to open the call.</small>
    </>
  );
}
