/**
 * Site-wide tone key.
 *
 * Uses a native <details> element so it needs no JavaScript and stays
 * collapsed by default -- the training card is the thing a rep should be
 * looking at, and a permanently expanded glossary would compete with it.
 */

const TONES: { code: string; name: string; body: string }[] = [
  {
    code: "AC",
    name: "Absolute Certainty",
    body:
      "Firm and unwavering. You are not hoping they agree \u2014 you already " +
      "know. Certainty transfers: whatever you feel, they feel.",
  },
  {
    code: "I CARE",
    name: "I Care",
    body:
      "Genuine empathy in response to what they just told you. Never say you " +
      "care. Let the tone say it, and then stop talking.",
  },
  {
    code: "PT",
    name: "Presupposing Tone",
    body:
      "Implied obviousness. Deliver it as something self-evident that goes " +
      "without saying, so it is absorbed rather than questioned.",
  },
  {
    code: "RM",
    name: "Reasonable Man",
    body:
      "Calm and level, on the small asks. We are both reasonable people " +
      "here, right? It implies that what you want is no big deal.",
  },
  {
    code: "S",
    name: "Scarcity",
    body:
      "Drop your voice toward a near-whisper. Creates urgency and the feeling " +
      "that they are being let in on something.",
  },
  {
    code: "CALM",
    name: "Calm",
    body:
      "Reassuring and steady, like a warm blanket. This is the antidote when " +
      "you hear any hint of uncertainty from them.",
  },
  {
    code: "Preacher",
    name: "The Preacher",
    body:
      "A Lionside tone, not a Straight Line one. Absolute Certainty with a " +
      "righteous edge \u2014 indignant on their behalf, in the spirit of the pulpit.",
  },
];

export default function ToneKey() {
  return (
    <footer className="site-footer">
      <div className="shell">
        <details className="tone-key">
          <summary>
            Tone key
            <span className="tone-key-hint">
              AC &middot; I Care &middot; PT &middot; RM &middot; S &middot; Calm
              &middot; Preacher
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
            client habituates and tunes out — the shift between tones is what
            they actually respond to.
          </p>
        </details>
      </div>
    </footer>
  );
}
