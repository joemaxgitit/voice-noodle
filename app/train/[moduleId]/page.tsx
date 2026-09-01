"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useKaraoke, stateFor, type Phrase } from "@/lib/useKaraoke";
import { findTone, tonesForPhrases, type ToneSpan } from "@/lib/tones";
import { useListenLog } from "@/lib/useListenLog";
import PracticeRecorder from "./PracticeRecorder";

type Segment = {
  id: string;
  segment_code: string;
  title: string | null;
  script_text: string;
  tones: string[];
  coaching: string | null;
  client_should_feel: string | null;
  verbatim: boolean;
  tone_map: ToneSpan[] | null;
  condition: string | null;
  script_note: string | null;
  section: string | null;
  sort_order: number;
  recordings: Recording[];
};

type Narrator = { id: string; name: string; sort_order: number };

type Recording = {
  narrator_id: string;
  audio_path: string | null;
  timings: Phrase[];
  words: Phrase[] | null;
};

export default function Train() {
  const supabase = createClient();
  const params = useParams<{ moduleId: string }>();
  const router = useRouter();

  const [moduleTitle, setModuleTitle] = useState("");
  const [nextModuleId, setNextModuleId] = useState<string | null>(null);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [index, setIndex] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [byWord, setByWord] = useState(false);
  const [narrators, setNarrators] = useState<Narrator[]>([]);
  const [narratorId, setNarratorId] = useState<string | null>(null);
  /*
    Whether this organisation has practice recording switched on, set from
    /admin. Defaults to off so a failed read hides the feature rather than
    exposing it -- every scored take costs an alignment call, and off is the
    safe direction to fail in.
  */
  const [practiceOn, setPracticeOn] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const segment = segments[index];

  // Named sections within this call, in script order.
  const sections = Array.from(
    new Set(segments.map((sg) => sg.section).filter(Boolean) as string[])
  );
  const currentSection = segment?.section || "";

  // Narrators vary in voice, not in tone. The tone chips and coaching below
  // belong to the segment, so every voice is performing the same map.
  const available = (segment?.recordings || []).filter((r) => r.audio_path);
  const chosen =
    available.find((r) => r.narrator_id === narratorId) || available[0] || null;

  const phrases: Phrase[] = chosen?.timings?.length ? chosen.timings : [];
  const words: Phrase[] = chosen?.words?.length ? chosen.words : [];

  // Phrase is the default: thought groups are what carry tone. Word-level is
  // available for reps who want to drill exact pronunciation.
  const units: Phrase[] = byWord && words.length ? words : phrases;

  const { audio, setAudioEl, time } = useKaraoke(units);

  // Banks seconds actually heard, per segment, for the admin view.
  useListenLog(audio, segment?.id ?? null, "train", chosen?.narrator_id ?? null);

  // Which tone is in force at each phrase, so the chip appears exactly where
  // the script shifts rather than as a flat list at the top of the card.
  const phraseTones = tonesForPhrases(
    segment?.tone_map ?? null,
    units.length ? units.map((u) => u.text) : [segment?.script_text ?? ""]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [modRes, segRes, narRes, meRes] = await Promise.all([
        supabase
          .from("modules")
          .select("title, script_id, language")
          .eq("id", params.moduleId)
          .single(),
        supabase
          .from("segments")
          .select(
            "id, segment_code, title, script_text, tones, tone_map, coaching, client_should_feel, verbatim, condition, script_note, section, sort_order, recordings(narrator_id, audio_path, timings, words)"
          )
          .eq("module_id", params.moduleId),
        supabase.from("narrators").select("id, name, sort_order"),
        supabase.auth.getUser(),
      ]);

      const { data: prog } = await supabase
        .from("progress")
        .select("segment_id")
        .eq("completed", true);

      if (!cancelled) {
        setDone(new Set((prog || []).map((r) => r.segment_id)));
      }

      if (cancelled) return;

      if (segRes.error) setError(segRes.error.message);
      const nar = ((narRes.data || []) as Narrator[]).sort(
        (a, b) => a.sort_order - b.sort_order
      );
      setNarrators(nar);

      const uid = meRes.data.user?.id;
      if (uid) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("narrator_id, org_id")
          .eq("id", uid)
          .single();

        if (!cancelled && prof?.narrator_id) setNarratorId(prof.narrator_id);

        // Practice recording is switched per organisation, from /admin.
        if (prof?.org_id) {
          const { data: org } = await supabase
            .from("orgs")
            .select("practice_enabled")
            .eq("id", prof.org_id)
            .single();

          if (!cancelled) setPracticeOn(!!org?.practice_enabled);
        }
      }

      setModuleTitle(modRes.data?.title || "Training");
      const sid = (modRes.data as { script_id?: string })?.script_id ?? null;
      setScriptId(sid);

      /*
        Which module follows this one, so finishing the last segment can hand
        the rep straight on. Same language only -- the Spanish playbook is a
        parallel run, not a continuation of the English one.
      */
      if (sid) {
        const lang = (modRes.data as { language?: string })?.language || "en";
        const { data: sibs } = await supabase
          .from("modules")
          .select("id, sort_order, language")
          .eq("script_id", sid);

        if (!cancelled) {
          const ordered = (
            (sibs || []) as { id: string; sort_order: number; language: string }[]
          )
            .filter((m) => (m.language || "en") === lang)
            .sort((a, b) => a.sort_order - b.sort_order);

          const at = ordered.findIndex((m) => m.id === params.moduleId);
          setNextModuleId(
            at >= 0 && at < ordered.length - 1 ? ordered[at + 1].id : null
          );
        }
      }
      setSegments(
        ((segRes.data || []) as unknown as Segment[]).sort(
          (a, b) => a.sort_order - b.sort_order
        )
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [params.moduleId, supabase]);

  // Signed URL per segment. Never a permanent public MP3 link.
  useEffect(() => {
    if (!chosen?.audio_path) {
      setAudioUrl(null);
      return;
    }

    let cancelled = false;

    supabase.storage
      .from("master-audio")
      .createSignedUrl(chosen.audio_path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        setAudioUrl(error ? null : data.signedUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [segment?.id, chosen?.audio_path, supabase]);

  useEffect(() => {
    if (audio) audio.playbackRate = speed;
  }, [speed, audio, audioUrl]);

  async function pickNarrator(id: string) {
    setNarratorId(id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ narrator_id: id }).eq("id", user.id);
    }
  }

  async function complete() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user && segment) {
      await supabase.from("progress").upsert({
        user_id: user.id,
        segment_id: segment.id,
        completed: true,
        updated_at: new Date().toISOString(),
      });
    }

    if (!segment) return;

    const nextDone = new Set(done).add(segment.id);
    setDone(nextDone);

    /*
      Move to the next segment that still needs work rather than the next in
      order. Someone picking up a half-finished module should land on what is
      left, not click through what they already did. Search forward first so
      the run stays in script order, then wrap for anything skipped earlier.
    */
    const ahead = segments.findIndex(
      (sg, i) => i > index && !nextDone.has(sg.id)
    );
    const target =
      ahead !== -1 ? ahead : segments.findIndex((sg) => !nextDone.has(sg.id));

    if (target !== -1) {
      setIndex(target);
      return;
    }

    /*
      Module finished. Standing on a completed card with nothing happening
      reads as a broken button, so move on -- the next module in the script,
      or the section list when this was the last one.
    */
    if (nextModuleId) {
      router.push(`/train/${nextModuleId}`);
    } else {
      router.push("/proedgesolutions");
    }
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  if (!segment) {
    return (
      <main className="shell">
        <div className="topbar">
          <Link className="btn" href="/proedgesolutions" style={{ textDecoration: "none" }}>
            &larr; Sections
          </Link>
        </div>
        <div className="card">
          <h1>Nothing to practice yet</h1>
          <p className="muted">
            This section has no published segments. An admin can add them from
            the admin area.
          </p>
          {error && <div className="error">{error}</div>}
        </div>
      </main>
    );
  }

  const pct = Math.round(((index + 1) / segments.length) * 100);

  return (
    <main className="shell">
      <div className="topbar">
        <Link className="btn" href="/proedgesolutions" style={{ textDecoration: "none" }}>
          &larr; Sections
        </Link>
        <div className="brand">
          {moduleTitle} &middot; {index + 1} of {segments.length}
        </div>
      </div>

      {/*
        A long call broken into its own named parts. Mayer's segmenting work
        found this helps most exactly where it applies here: complex material,
        fast pace, inexperienced learner.
      */}
      {sections.length > 1 && (
        <div className="section-tabs">
          {sections.map((sec) => {
            const inSec = segments.filter((sg) => (sg.section || "") === sec);
            const doneN = inSec.filter((sg) => done.has(sg.id)).length;
            return (
              <button
                key={sec}
                aria-pressed={sec === currentSection}
                onClick={() => {
                  const first = segments.findIndex(
                    (sg) => (sg.section || "") === sec
                  );
                  if (first >= 0) setIndex(first);
                }}
              >
                {sec}
                <span className="section-count">
                  {doneN}/{inSec.length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="progressbar">
        <div style={{ width: `${pct}%` }} />
      </div>

      {/*
        The branch condition. It belongs on the card and not in the script
        text -- forced alignment would hunt for the word "YES" in audio where
        nobody says it.
      */}
      {segment.condition && (
        <div className="condition-flag">{segment.condition}</div>
      )}

      {/*
        Definitions sit beside the chips rather than in the footer. Making a
        rep look away mid-playback to decode a tone splits their attention and
        spends working memory on hunting instead of on the delivery.
      */}
      <div className="tones">
        {segment.tones?.map((t) => {
          const info = findTone(t);
          return (
            <span className="tone-line" key={t}>
              <span className="tone">{t}</span>
              {info && <span className="tone-gloss">{info.short}</span>}
            </span>
          );
        })}
      </div>

      {/*
        Compliance lines cannot be paraphrased. This has to be visible at the
        moment of delivery, not buried in the coaching notes underneath.
      */}
      {segment.verbatim && (
        <div className="verbatim-flag">
          Say this word for word &mdash; required for compliance
        </div>
      )}

      <div className="script" aria-live="polite">
        {units.length ? (
          units.map((p, i) => (
            <span key={i}>
              {phraseTones[i] && phraseTones[i] !== phraseTones[i - 1] && (
                <span className="tone inline-tone">{phraseTones[i]}</span>
              )}
              <span className={`phrase ${stateFor(p, time)}`}>{p.text} </span>
            </span>
          ))
        ) : segment.tone_map?.length ? (
          /*
            No recording yet, but the script is annotated. Render the tone
            spans inline so a rep still sees which phrase carries which tone
            rather than an unattached list of chips at the top of the card.
          */
          segment.tone_map.map((span, i) => (
            <span key={i}>
              {span.tone && (
                <span className="tone inline-tone">{span.tone}</span>
              )}
              <span className="phrase">{span.text} </span>
            </span>
          ))
        ) : (
          <span className="phrase">{segment.script_text}</span>
        )}
      </div>

      {audioUrl ? (
        <>
          <audio
            ref={setAudioEl}
            className="player"
            src={audioUrl}
            loop={loop}
            controls
            preload="metadata"
          />
          <div className="row">
            <button onClick={() => setLoop(!loop)}>
              &#8635; Loop {loop ? "on" : "off"}
            </button>
            <button onClick={() => setSpeed(speed === 1 ? 0.75 : 1)}>
              {speed}&times; speed
            </button>
            {/*
              Two positions, the live one lit. Phrase is on the left because
              it is the default and the one that teaches delivery; word is the
              drill-down.
            */}
            {words.length > 0 && (
              <div className="unit-switch" role="group" aria-label="Highlight by">
                <button aria-pressed={!byWord} onClick={() => setByWord(false)}>
                  Phrase
                </button>
                <button aria-pressed={byWord} onClick={() => setByWord(true)}>
                  Word
                </button>
              </div>
            )}
          </div>

          {/*
            Only worth showing when there is a genuine choice. Hearing the same
            tone map in more than one voice is what stops a rep copying a
            particular person instead of learning the pattern.
          */}
          {available.length > 1 && (
            <div className="narrators">
              <span className="narrator-label">Voice</span>
              {narrators
                .filter((n) => available.some((r) => r.narrator_id === n.id))
                .map((n) => (
                  <button
                    key={n.id}
                    aria-pressed={chosen?.narrator_id === n.id}
                    onClick={() => pickNarrator(n.id)}
                  >
                    {n.name}
                  </button>
                ))}
            </div>
          )}
        </>
      ) : (
        <p className="muted">No master recording uploaded for this one yet.</p>
      )}

      {segment.script_note && (
        <p className="script-note">{segment.script_note}</p>
      )}

      {scriptId && segment && (
        <div className="row" style={{ marginTop: 18 }}>
          <Link
            className="btn"
            href={`/script/${scriptId}?segment=${segment.id}`}
            style={{ textDecoration: "none" }}
          >
            Show in full script
          </Link>
        </div>
      )}

      {/*
        Practice sits below the coaching notes, not above: read what it should
        sound like, then say it.

        Off means absent, not disabled. A greyed-out control invites people to
        ask when it is coming back; nothing at all reads as a tool that simply
        does not have this feature.
      */}
      {practiceOn && (
        <PracticeRecorder
          segmentId={segment.id}
          segmentCode={segment.segment_code}
          narratorId={chosen?.narrator_id ?? null}
          masterWords={chosen?.words?.length ? chosen.words : null}
          onPass={complete}
        />
      )}

      <div className="coaching">
        <div>
          <div className="label">Delivery</div>
          <div className="value">{segment.coaching || "\u2014"}</div>
        </div>
        <div>
          <div className="label">Client should feel</div>
          <div className="value">{segment.client_should_feel || "\u2014"}</div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="nav">
        <button disabled={index === 0} onClick={() => setIndex(index - 1)}>
          &larr; Previous
        </button>
        <button className="primary" onClick={complete}>
          {segments.some((sg) => sg.id !== segment.id && !done.has(sg.id))
            ? "Got it \u2192 next"
            : "Mark complete"}
        </button>
      </div>
    </main>
  );
}
