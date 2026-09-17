"use client";

import { TONES, toneCopy, TONE_KEY_COPY } from "@/lib/tones";
import { useLang } from "@/lib/lang";

/**
 * Site-wide tone key.
 *
 * Open by default. This is the reference view -- the whole system in one
 * place, for a rep who wants to study it rather than perform one line. The
 * in-task version lives on the training card itself, beside the chips, so a
 * rep mid-recording never has to look away from the script to decode a tone.
 *
 * It follows the language being read. A Spanish card above an English tone
 * key is a half-translated page, and the definitions are the part a rep
 * actually learns the tone from.
 *
 * The codes stay in English -- AC, I CARE, CALM -- because those are what is
 * stored against each segment and printed on the chips.
 */
export default function ToneKey() {
  const lang = useLang();
  const copy = TONE_KEY_COPY[lang];

  return (
    <footer className="site-footer">
      <div className="shell">
        <details className="tone-key" open>
          <summary>
            {copy.title}
            <span className="tone-key-hint">{copy.hint}</span>
          </summary>

          <dl className="tone-grid">
            {TONES.map((t) => {
              const c = toneCopy(t, lang);
              return (
                <div className="tone-item" key={t.code}>
                  <dt>
                    <span className="tone">{t.code}</span>
                    <span className="tone-name">{c.name}</span>
                  </dt>
                  <dd>{c.body}</dd>
                </div>
              );
            })}
          </dl>

          <p className="tone-note">{copy.note}</p>
        </details>

        <div className="footer-legal">
          <p className="footer-rights">
            Script content &copy; 2026 ProEdge Solutions.
            Confidential &mdash; internal training use only.
          </p>
          <p className="footer-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/voicenoodle-mark-sm.png" alt="" />
            <span>Powered by Voice Noodle</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
