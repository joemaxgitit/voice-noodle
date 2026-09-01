"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useKaraoke, stateFor, type Phrase } from "@/lib/useKaraoke";
import { useListenLog } from "@/lib/useListenLog";
import { tonesForPhrases, type ToneSpan } from "@/lib/tones";

type Recording = {
  narrator_id: string;
  audio_path: string | null;
  timings: Phrase[];
  words: Phrase[] | null;
};

type Seg = {
  id: string;
  segment_code: string;
  script_text: string;
  tones: string[];
  tone_map: ToneSpan[] | null;
  verbatim: boolean;
  condition: string | null;
  script_note: string | null;
  section: string | null;
  sort_order: number;
  module_id: string;
  recordings: Recording[];
};

type Narrator = { id: string; name: string; sort_order: number };

type Mod = {
  id: string;
  title: string;
  sort_order: number;
  kind: string;
  language: string;
};

/**
 * The whole script on one page.
 *
 * This is a second rendering of the same segments the cards use, not a
 * separate document -- so it cannot drift out of sync with training, and it
 * prints as the handout. Module names sit in the left margin inside a bracket
 * spanning their segments, which is the signalling cue: a rep can see at a
 * glance which part of the script they are looking at.
 *
 * It also reads aloud. Press play and it works down the script, playing every
 * segment that has been recorded and highlighting the words as they are
 * spoken. Unrecorded segments still show -- the reader follows the whole call
 * and hears the parts that exist. With 24 of 431 recorded, skipping the rest
 * entirely would have made a read-through that was mostly not the script.
 */
function ScriptView() {
  const supabase = createClient();
  const params = useParams<{ scriptId: string }>();
  const search = useSearchParams();
  const focus = search.get("segment");

  const [title, setTitle] = useState("");
  const [mods, setMods] = useState<Mod[]>([]);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [lang, setLang] = useState<"en" | "es">("en");
  const [loading, setLoading] = useState(true);

  const [narratorId, setNarratorId] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [byWord, setByWord] = useState(false);
  const [narrators, setNarrators] = useState<Narrator[]>([]);
  // A single-segment replay stops at the end instead of running on.
  const [single, setSingle] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [readError, setReadError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [sRes, mRes, nRes] = await Promise.all([
        supabase.from("scripts").select("title").eq("id", params.scriptId).single(),
        supabase
          .from("modules")
          .select("id, title, sort_order, kind, language")
          .eq("script_id", params.scriptId),
        supabase.from("narrators").select("id, name, sort_order"),
      ]);

      if (cancelled) return;

      const modules = ((mRes.data || []) as Mod[]).sort(
        (a, b) => a.sort_order - b.sort_order
      );

      const { data: segData } = await supabase
        .from("segments")
        .select(
          "id, segment_code, script_text, tones, tone_map, verbatim, condition, script_note, section, sort_order, module_id, recordings(narrator_id, audio_path, timings, words)"
        )
        .in("module_id", modules.map((m) => m.id));

      if (cancelled) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("narrator_id")
          .eq("id", user.id)
          .single();
        if (!cancelled && prof?.narrator_id) setNarratorId(prof.narrator_id);
      }

      if (cancelled) return;

      setNarrators(
        ((nRes.data || []) as Narrator[]).sort(
          (a, b) => a.sort_order - b.sort_order
        )
      );
      setTitle(sRes.data?.title || "Script");
      setMods(modules);
      setSegs(((segData || []) as unknown as Seg[]).sort((a, b) => a.sort_order - b.sort_order));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [params.scriptId, supabase]);

  // Scroll to the passage a rep came from, then leave it marked.
  useEffect(() => {
    if (!focus || loading) return;
    const el = document.getElementById(`seg-${focus}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, loading, segs]);

  const visible = useMemo(
    () => mods.filter((m) => (m.language || "en") === lang),
    [mods, lang]
  );

  const hasSpanish = mods.some((m) => m.language === "es");

  // The take to play for a segment: this rep's chosen voice if they recorded
  // it, otherwise whoever did.
  const takeFor = useCallback(
    (sg: Seg): Recording | null => {
      const withAudio = (sg.recordings || []).filter((r) => r.audio_path);
      if (withAudio.length === 0) return null;
      return (
        withAudio.find((r) => r.narrator_id === narratorId) || withAudio[0]
      );
    },
    [narratorId]
  );

  /*
    Script order: module by module, then by sort_order within each. sort_order
    is per module, so sorting the flat list interleaves them -- rendering hides
    this because it groups by module first, but playback does not.
  */
  const ordered = useMemo(() => {
    const out: Seg[] = [];
    for (const m of visible) {
      out.push(
        ...segs
          .filter((sg) => sg.module_id === m.id)
          .sort((a, b) => a.sort_order - b.sort_order)
      );
    }
    return out;
  }, [segs, visible]);

  // The ones that can actually be heard, still in script order.
  const playable = useMemo(
    () => ordered.filter((sg) => takeFor(sg)),
    [ordered, takeFor]
  );

  /*
    Only voices that actually recorded something in this script. Offering a
    narrator with nothing here would produce a silent read.
  */
  const voices = useMemo(() => {
    const ids = new Set<string>();
    for (const sg of ordered) {
      for (const r of sg.recordings || []) {
        if (r.audio_path) ids.add(r.narrator_id);
      }
    }
    return narrators.filter((n) => ids.has(n.id));
  }, [ordered, narrators]);

  const active = activeId ? segs.find((sg) => sg.id === activeId) ?? null : null;
  const activeTake = active ? takeFor(active) : null;

  /*
    Word-level when the switch is over, phrase-level otherwise. A take that was
    never aligned has no words, so it falls back to phrases rather than going
    blank -- the switch stays usable across a script that is only partly
    aligned.
  */
  const units: Phrase[] =
    byWord && activeTake?.words?.length
      ? activeTake.words
      : activeTake?.timings?.length
        ? activeTake.timings
        : [];
  const { audio, setAudioEl, playing, time } = useKaraoke(units);

  // Banks seconds actually heard, per segment, for the admin view.
  useListenLog(audio, activeId, "read");

  const activeTones = useMemo(
    () =>
      tonesForPhrases(
        active?.tone_map ?? null,
        units.length ? units.map((u) => u.text) : []
      ),
    [active?.tone_map, units]
  );

  // Keep the playing line on screen without yanking the page around.
  useEffect(() => {
    if (!activeId) return;
    const el = document.getElementById(`seg-${activeId}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeId]);

  /*
    Sign every playable path in one call rather than per segment. Signing as
    each one starts leaves an audible gap between segments, which reads as a
    stutter in what is meant to be a continuous run of the call.
  */
  async function prepare(): Promise<Record<string, string>> {
    const paths = playable
      .map((sg) => takeFor(sg)?.audio_path)
      .filter((p): p is string => !!p);

    if (paths.length === 0) return {};

    const { data, error } = await supabase.storage
      .from("master-audio")
      .createSignedUrls(paths, 3600);

    if (error) throw error;

    const map: Record<string, string> = {};
    for (const row of data || []) {
      if (row.signedUrl && row.path) map[row.path] = row.signedUrl;
    }
    return map;
  }

  // Signs once per session, or again after a change of voice.
  async function ensureUrls(): Promise<boolean> {
    if (Object.keys(urls).length > 0) return true;

    setPreparing(true);
    try {
      setUrls(await prepare());
      return true;
    } catch (e) {
      setReadError(
        e instanceof Error ? e.message : "Could not load the recordings."
      );
      return false;
    } finally {
      setPreparing(false);
    }
  }

  // One segment, then stop. Distinct from the play arrow, which runs on
  // through the rest of the call from that point.
  async function playOne(id: string) {
    setReadError("");
    if (!(await ensureUrls())) return;
    setSingle(true);
    setActiveId(id);
  }

  async function pickVoice(id: string) {
    audio?.pause();
    setActiveId(null);
    setSingle(false);
    setNarratorId(id);
    // Different voice, different files -- the signed URLs no longer apply.
    setUrls({});

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("profiles").update({ narrator_id: id }).eq("id", user.id);
    }
  }

  async function startRead(fromId?: string) {
    setReadError("");
    setSingle(false);

    if (!(await ensureUrls())) return;

    /*
      Default to the top of the call. The exception is arriving from a training
      card via "Show in full script": that carries ?segment=, the rep is
      already looking at that passage, and sending them back to the opening
      would lose their place.
    */
    let start = playable[0];

    if (fromId) {
      start = playable.find((sg) => sg.id === fromId) ?? playable[0];
    } else if (focus) {
      const at = ordered.findIndex((sg) => sg.id === focus);
      if (at >= 0) {
        const fromFocus = ordered.slice(at).find((sg) => takeFor(sg));
        if (fromFocus) start = fromFocus;
      }
    }

    if (!start) {
      setReadError("Nothing in this script has been recorded yet.");
      return;
    }


    setActiveId(start.id);
  }

  function stopRead() {
    audio?.pause();
    setSingle(false);
    setActiveId(null);
  }

  // Pause holds position; stop clears the read entirely.
  function togglePause() {
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }

  // Source follows the active segment; play once it is loaded.
  const src = activeTake?.audio_path ? urls[activeTake.audio_path] : undefined;

  useEffect(() => {
    if (!audio || !src) return;
    void audio.play().catch(() => {
      // Autoplay refusal only bites the first segment, which is user-initiated.
    });
  }, [audio, src]);

  const advance = useCallback(() => {
    if (!activeId) return;

    if (single) {
      setSingle(false);
      setActiveId(null);
      return;
    }

    const at = playable.findIndex((sg) => sg.id === activeId);
    const next = at >= 0 ? playable[at + 1] : undefined;
    setActiveId(next ? next.id : null);
  }, [activeId, playable, single]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    if (!audio) return;
    const onEnd = () => advanceRef.current();
    audio.addEventListener("ended", onEnd);
    return () => audio.removeEventListener("ended", onEnd);
  }, [audio]);

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  const recordedCount = playable.length;
  const totalInLang = segs.filter((sg) =>
    visible.some((m) => m.id === sg.module_id)
  ).length;

  return (
    <main className="shell script-page">
      <div className="topbar no-print">
        <Link className="btn" href="/proedgesolutions" style={{ textDecoration: "none" }}>
          &larr; Sections
        </Link>
        <button onClick={() => window.print()}>Print</button>
      </div>

      {/* Print only: the paper leaves the building, so it carries the brand. */}
      <div className="print-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/lionside-logo-print.png" alt="Lionside Financial" />
        <span>
          {title}
          <br />
          Confidential &mdash; internal training use only
        </span>
      </div>

      <h1>{title}</h1>
      <p className="muted no-print">
        The full script. Section names sit in the margin &mdash; click one to
        practise that part. When printing, switch off &ldquo;Headers and
        footers&rdquo; in the browser dialog for a clean page.
      </p>

      {hasSpanish && (
        <div className="lang-switch no-print">
          <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>
            English
          </button>
          <button aria-pressed={lang === "es"} onClick={() => setLang("es")}>
            Espa&ntilde;ol
          </button>
        </div>
      )}

      {/*
        Read-along. Plays straight down the script, skipping what has not been
        recorded rather than sitting in silence on it.
      */}
      <div className="read-bar no-print">
        {activeId ? (
          <>
            <button className="primary" onClick={togglePause}>
              {playing ? "\u23f8 Pause" : "\u25b6 Resume"}
            </button>
            <button onClick={stopRead}>&#9632; Stop</button>
          </>
        ) : (
          <button
            className="primary"
            onClick={() => startRead()}
            disabled={preparing || recordedCount === 0}
          >
            {preparing ? "Loading\u2026" : "\u25b6 Read the whole call"}
          </button>
        )}
        <span className="read-count">
          {recordedCount} of {totalInLang} segments recorded
        </span>

        {/*
          Whose voice reads. Only shown when more than one person has recorded
          in this script -- otherwise it is a control with one option.
        */}
        {voices.length > 1 && (
          <div className="narrators" style={{ marginTop: 0 }}>
            <span className="narrator-label">Voice</span>
            {voices.map((n) => (
              <button
                key={n.id}
                aria-pressed={narratorId === n.id}
                onClick={() => pickVoice(n.id)}
              >
                {n.name}
              </button>
            ))}
          </div>
        )}

        {/* Same control as the training card, on purpose. */}
        <div className="unit-switch" role="group" aria-label="Highlight by">
          <button aria-pressed={!byWord} onClick={() => setByWord(false)}>
            Phrase
          </button>
          <button aria-pressed={byWord} onClick={() => setByWord(true)}>
            Word
          </button>
        </div>
        {src && (
          <audio ref={setAudioEl} src={src} preload="auto" className="read-audio" />
        )}
      </div>

      {readError && <div className="error no-print">{readError}</div>}

      {visible.map((m) => {
        const mine = segs.filter((sg) => sg.module_id === m.id);
        if (mine.length === 0) return null;

        return (
          <section className="script-block" key={m.id}>
            {/*
              Margin bracket. The label reads horizontally and sits at the
              vertical midpoint of the bracket spanning its segments.
            */}
            <div className="script-margin">
              <Link className="script-margin-label" href={`/train/${m.id}`}>
                {m.title}
                {m.kind === "loop" && <span className="margin-note">loop</span>}
              </Link>
              <span className="script-brace" aria-hidden="true" />
            </div>

            <div className="script-body">
              {mine.map((sg) => {
                const isActive = sg.id === activeId;
                const hasAudio = !!takeFor(sg);

                return (
                  <p
                    key={sg.id}
                    id={`seg-${sg.id}`}
                    className={`script-line ${
                      focus === sg.id ? "script-line-focus" : ""
                    } ${sg.verbatim ? "script-line-verbatim" : ""} ${
                      isActive ? "script-line-playing" : ""
                    }`}
                  >
                    {sg.condition && (
                      <span className="script-condition">{sg.condition}</span>
                    )}

                    {/*
                      While a segment is playing it renders as timed phrases so
                      the words can light up. Tone chips are kept by mapping the
                      tone spans onto those phrases. Every other segment renders
                      from tone_map as usual -- the two split the text
                      differently, so only the live one switches.
                    */}
                    {isActive && units.length > 0 ? (
                      units.map((p, i) => (
                        <span key={i}>
                          {activeTones[i] && activeTones[i] !== activeTones[i - 1] && (
                            <span className="script-tones">{activeTones[i]}</span>
                          )}
                          <span className={`phrase ${stateFor(p, time)}`}>
                            {p.text}{" "}
                          </span>
                        </span>
                      ))
                    ) : sg.tone_map && sg.tone_map.length > 0 ? (
                      sg.tone_map.map((span, k) => (
                        <span key={k}>
                          {span.tone && (
                            <span className="script-tones">{span.tone}</span>
                          )}
                          {span.text}{" "}
                        </span>
                      ))
                    ) : (
                      sg.script_text
                    )}

                    {hasAudio && (
                      <>
                        <button
                          className="read-from-here no-print"
                          onClick={() => startRead(sg.id)}
                          aria-label="Read from here to the end"
                          title="Read from here to the end"
                        >
                          &#9654;
                        </button>
                        {/*
                          Just this line. Separate from the arrow above, which
                          carries on through the rest of the call.
                        */}
                        <button
                          className="read-from-here no-print"
                          onClick={() => playOne(sg.id)}
                          aria-label="Play this segment only"
                          title="Play this segment only"
                        >
                          &#8635;
                        </button>
                      </>
                    )}

                    {sg.script_note && (
                      <span className="script-note-inline">{sg.script_note}</span>
                    )}
                  </p>
                );
              })}
            </div>
          </section>
        );
      })}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="shell">
          <p className="muted">Loading&hellip;</p>
        </main>
      }
    >
      <ScriptView />
    </Suspense>
  );
}
