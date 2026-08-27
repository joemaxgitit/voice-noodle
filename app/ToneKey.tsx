import { TONES } from "@/lib/tones";

/**
 * Site-wide tone key.
 *
 * Open by default. This is the reference view -- the whole system in one
 * place, for a rep who wants to study it rather than perform one line. The
 * in-task version lives on the training card itself, beside the chips, so a
 * rep mid-recording never has to look away from the script to decode a tone.
 */
export default function ToneKey() {
  return (
    <footer className="site-footer">
      <div className="shell">
        <details className="tone-key" open>
          <summary>
            Tone key
            <span className="tone-key-hint">
              The shift between tones is the skill
            </span>
          </summary>

          <dl className="tone-grid">
            {TONES.map((t) => (
              <div className="tone-item" key={t.code}>
                <dt>
                  <span className="tone">{t.code}</span>
                  <span className="tone-name">{t.name}</span>
                </dt>
                <dd>{t.body}</dd>
              </div>
            ))}
          </dl>

          <p className="tone-note">
            Never sit in one tone for long. Holding a single tonality is how a
            client habituates and tunes out &mdash; the movement between tones is
            what they actually respond to.
          </p>
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
