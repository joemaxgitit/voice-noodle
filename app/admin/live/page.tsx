"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { presenceChannel, type Here } from "@/lib/usePresence";

function ago(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Who is on the app right now.
 *
 * Reads the same presence channel the training and script pages announce on.
 * Nothing is stored -- close the tab and the entry goes. That means this
 * cannot be looked at retrospectively, which is what /admin/listening is for.
 *
 * "Playing" means audio is running. "Idle" means the page is open and it is
 * not. A tab left open on a segment shows as idle, not away, so treat this as
 * who has it open rather than who is working.
 */
export default function Live() {
  const supabase = createClient();

  const [people, setPeople] = useState<Here[]>([]);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  // Re-render every half minute so the "for how long" figures stay honest.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (!prof?.org_id || cancelled) return;

      const ch = supabase.channel(presenceChannel(prof.org_id));
      channel = ch;

      const read = () => {
        /*
          presenceState returns Presence<Here> -- our shape plus a
          presence_ref the library adds. That is assignable to Here as it
          stands, so the annotation does the narrowing and a type predicate
          would be rejected for narrowing to something wider's subset.
        */
        const all: Here[] = Object.values(ch.presenceState<Here>())
          .flat()
          .filter((p) => typeof p?.name === "string");

        setPeople([...all].sort((a, b) => a.name.localeCompare(b.name)));
      };

      ch.on("presence", { event: "sync" }, read)
        .on("presence", { event: "join" }, read)
        .on("presence", { event: "leave" }, read)
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && !cancelled) setReady(true);
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase]);

  return (
    <main className="shell">
      <div className="topbar">
        <Link className="btn" href="/admin" style={{ textDecoration: "none" }}>
          &larr; Segments
        </Link>
        <Link
          className="btn"
          href="/admin/listening"
          style={{ textDecoration: "none" }}
        >
          Listening
        </Link>
      </div>

      <div className="eyebrow">
        {people.length} {people.length === 1 ? "person" : "people"} on now
      </div>
      <h1>Live</h1>
      <p className="muted">
        Who has the app open and what they are on. Nothing here is kept &mdash;
        for what happened earlier, use Listening.
      </p>

      {!ready && <p className="muted">Connecting&hellip;</p>}

      {ready && people.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>
          Nobody is on at the moment.
        </p>
      )}

      {people.length > 0 && (
        <ul className="list" style={{ marginTop: 20 }} key={tick}>
          {people.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <div className="attempt">
                <span className={`live-dot ${p.playing ? "on" : ""}`} />
                <span className="attempt-when">
                  {p.name}
                  <br />
                  <span className="count">
                    {p.segment ? (
                      <>
                        <span className="code">{p.segment}</span>
                        {p.title ? ` \u00b7 ${p.title}` : ""}
                      </>
                    ) : (
                      p.where
                    )}
                    {` \u00b7 ${ago(p.since)}`}
                  </span>
                </span>
                <span className="scores">
                  <span className={`score ${p.playing ? "good" : "fair"}`}>
                    {p.playing ? "Playing" : "Idle"}
                  </span>
                  <span className="source-tag">{p.where}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
