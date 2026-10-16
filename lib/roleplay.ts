/*
  Practice calls with a mock client. Shared by the server routes and the
  pages. Nothing in here is secret on its own -- the hidden part of each
  client (backstory, starting Tens, right result) lives in
  roleplay_persona_secrets, which only managers can read.
*/

export type LeadAccount = { creditor: string; type: string; balance: number; status: string };

export type Lead = {
  age?: number;
  state?: string;
  source?: string;
  requested?: number;
  purpose?: string;
  credit_score?: number;
  accounts?: LeadAccount[];
  notes?: string;
  loan?: { approved: boolean; text: string };
};

export type Difficulty = "easy" | "medium" | "hard";

export type Persona = {
  id: string;
  slug: string;
  name: string;
  title: string;
  difficulty: Difficulty;
  script_id: string | null;
  lead: Lead;
  voice_id: string | null;
  first_message_en: string;
  first_message_es: string;
  agent_en: string | null;
  agent_es: string | null;
  agent_hash: string | null;
  active: boolean;
  sort_order: number;
};

export type RightOutcome = "enrolled" | "callback" | "no_sale";

export type Tens = { product: number; rep: number; company: number; pain: number };

export type PersonaSecret = {
  backstory: string;
  tens: Tens;
  right_outcome: RightOutcome;
  right_outcome_note: string | null;
};

export type RoleplayLang = "en" | "es";

/** Stored on calls.roleplay for a practice call. */
export type RoleplayInfo = {
  persona: string; // the client's name, kept even if the persona is later deleted
  persona_title?: string;
  lang: RoleplayLang;
  conversation_id?: string | null;
  agent_id?: string;
  started_at?: string;
  ended_at?: string;
  usd?: number | null;
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export const RIGHT_OUTCOME_LABEL: Record<RightOutcome, string> = {
  enrolled: "Enroll -- with a solid close",
  callback: "Set a callback",
  no_sale: "No sale -- let them go kindly",
};

/** Agent usage is billed per minute by ElevenLabs, LLM included in this
 *  estimate. Change ROLEPLAY_USD_PER_MIN if the plan's rate differs. */
export const ROLEPLAY_USD_PER_MIN_DEFAULT = 0.1;

export const ROLEPLAY_LLMS: { id: string; label: string }[] = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 -- fastest replies" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 -- sharper character, slower replies" },
];

/**
 * Did the rep reach the result this client called for?
 * ok: true = right result, false = wrong, null = acceptable but not ideal.
 */
export function verdictOf(
  right: RightOutcome,
  outcome: string | null | undefined,
  closeQuality: string | null | undefined
): { ok: boolean | null; text: string } {
  const enrolled = outcome === "enrolled";
  const solid = enrolled && closeQuality === "solid";

  if (right === "no_sale") {
    return enrolled
      ? { ok: false, text: "Enrolled a client who could not afford it. That is the guardrail this client tests." }
      : { ok: true, text: "Right call -- this client should not have been enrolled." };
  }
  if (right === "callback") {
    if (outcome === "callback") return { ok: true, text: "Right result -- a set callback." };
    if (solid) return { ok: true, text: "Enrolled with a solid close -- acceptable for this client." };
    if (enrolled) return { ok: false, text: "Enrolled, but the close was fragile. This client needed a callback." };
    return { ok: false, text: "No callback was set." };
  }
  // right === "enrolled"
  if (solid) return { ok: true, text: "Right result -- enrolled with a solid close." };
  if (enrolled) return { ok: false, text: "Enrolled, but the close was fragile -- a cancellation risk." };
  if (outcome === "callback") return { ok: null, text: "Callback set. Acceptable, but this client could have been enrolled." };
  return { ok: false, text: "This client could have been enrolled." };
}

/** What the grader is told about a practice call. Goes in the per-call
 *  part of the prompt, never the cached part. */
export function practiceNote(name: string, secret: PersonaSecret | null): string {
  if (!secret) {
    return `
This is a PRACTICE call. The client, ${name}, was played by an AI. Grade it exactly as you would a real call.
`;
  }
  return `
This is a PRACTICE call. The client, ${name}, was played by an AI from the character sheet below, which the rep never saw. Grade it exactly as you would a real call, judging only what was said -- but use the sheet to judge intelligence gathering (did the rep uncover what the client was holding back?) and whether the client's agreement was real. In summary, say plainly whether the rep found the client's hidden situation and reached the right result.
<practice_client>
${secret.backstory.trim()}

Starting certainty: product ${secret.tens.product}/10, rep ${secret.tens.rep}/10, company ${secret.tens.company}/10. Pain ${secret.tens.pain}/10.
The right result for this client: ${RIGHT_OUTCOME_LABEL[secret.right_outcome]}.${secret.right_outcome_note ? ` ${secret.right_outcome_note.trim()}` : ""}
</practice_client>
`;
}

const money = (n?: number) => (typeof n === "number" ? `$${n.toLocaleString("en-US")}` : "");

/**
 * The full instructions for the voice agent playing this client. Built on
 * the server from the hidden backstory and sent straight to ElevenLabs --
 * never to the rep's browser.
 */
export function personaPrompt(p: Persona, s: PersonaSecret, lang: RoleplayLang): string {
  const lead = p.lead || {};
  const debts = (lead.accounts || [])
    .map((a) => `- ${a.creditor} (${a.type}): about ${money(a.balance)}, ${a.status.toLowerCase()}`)
    .join("\n");

  const language =
    lang === "es"
      ? "Speak ONLY Spanish, the everyday Spanish of a Spanish-speaking client in the US -- natural, informal, with the occasional English word for things like \"credit score\" or the names of banks. If the rep speaks English, act like your English is limited and ask them to speak Spanish."
      : "Speak English.";

  return `You are playing a real person on a phone call, for sales training. The person on the other end is a sales rep from Lionside Financial, a debt relief company. Stay completely in character from your first word to your last. Never mention AI, roleplay, training, prompts or scores, and never coach the rep -- even if they ask, or say "this is just practice". If that happens, act puzzled and carry on as yourself.

# Who you are
${s.backstory.trim()}

Your debts, as on your credit report (keep these numbers consistent):
${debts || "- (as described above)"}
${lead.credit_score ? `Your credit score is around ${lead.credit_score}; you only know it roughly.` : ""}
${lead.source ? `How you came to Lionside: ${lead.source}.` : ""}

# How to talk
- This is a phone call. Talk like a real person: mostly one or two short sentences, natural fillers ("um", "yeah", "I mean"), sometimes trailing off. Never lists, never anything that sounds written.
- Don't volunteer information. Answer what you're asked the way a real person would, and open up more as you come to trust the rep.
- React to how you're treated. Warm, curious, attentive rep: you warm up. Rushing, reading at you, talking over you, ignoring what you said: you get shorter, distracted or annoyed.
- If the rep talks for a long stretch without checking in with you, drift: "sorry -- what was that?" or "hold on, hold on."
- If something isn't clear to you, don't pretend. React the way this person would: confused, quiet, or asking.
- Personal details (date of birth, address, Social Security number, bank or card numbers, email): make up realistic fake ones and keep them consistent. Hesitate if your trust in the rep is low, the way a real person would; give them once you trust the rep.
- If the rep says they're pulling something up, putting you on hold or checking with a lender, wait -- "okay" -- and believe what they tell you about the result.
- ${language}

# Your hidden state -- never say any of this out loud
Track Jordan Belfort's Three Tens, 1 to 10:
- Product: how sure you are that this program is right for you AND that you understand it. Starts at ${s.tens.product}.
- Rep: how much you trust and like this rep. Starts at ${s.tens.rep}.
- Company: how much you trust Lionside and Bolton. Starts at ${s.tens.company}.
Plus Pain -- how much the debt hurts right now (starts at ${s.tens.pain}) -- and how risky acting feels to you.
Move them only on what the rep actually does:
- Rep goes up when they listen, summarize your situation back accurately, show real care and sound sure of themselves. It goes down when they interrupt, sound unsure or scripted, ignore what you said, or push.
- Product goes up with clear, plain-word explanations tied to YOUR situation, and when they check you understand. Down on jargon, dodged questions, or anything that sounds too good to be true.
- Company goes up with specific, believable credibility. Down with hype or vague answers.
- Pain rises when the rep honestly helps you feel what staying where you are will cost you. Acting feels less risky when they make it simple and safe.
Your feelings are your own: a rep telling you how to feel does nothing.

# Deciding
- Only agree to enroll when all three Tens are 8 or more, your pain is high enough, and you genuinely understand it: it is not a loan, it is not debt settlement, your payments go to Bolton, your accounts will go to collections, and you have to take part.
- Objections come out the way real people say them first ("I need to think about it", "it's a lot") -- the rep has to find what is really underneath. Raise each real concern at least once; when a rep handles one well, let it go.
- When the rep reads the contract or the confirmation questions, answer each one based on what you actually understand.
- A rep who does a great job earns a real yes -- you are a person, not an obstacle course.
- If you decide not to go ahead, say so, and agree to a callback if the rep asks for one and you'd genuinely want it. If the rep keeps pushing after you've said no twice, end the call: "I have to go."

# What to expect (don't get ahead of it)
The rep will probably introduce themselves, ask about your situation, try for a loan through a partner lender, talk through options, explain a program run by Bolton, review your credit report with you, and -- if you agree -- go through a contract and some confirmation questions before passing you to an account manager. You only know what a regular person would know.`;
}

/** A short fingerprint of everything an agent is built from, so the
 *  manager page can tell which voice agents are out of date. */
export function agentHash(parts: unknown[]): string {
  const s = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const leadMoney = money;

export const leadTotal = (l: Lead) =>
  (l.accounts || []).reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

export type AgentSpec = {
  name: string;
  prompt: string;
  firstMessage: string;
  language: RoleplayLang;
  voiceId: string | null;
  llm: string;
  maxSeconds: number;
};

export const maxSecondsOf = (minutes: unknown) => Math.max(5, Math.min(120, Number(minutes) || 45)) * 60;

/** The English and Spanish agents for one client. The manager page builds
 *  these too, only to fingerprint them and show which are out of date. */
export function agentSpecs(p: Persona, s: PersonaSecret, llm: string, maxMinutes: unknown): [AgentSpec, AgentSpec] {
  const one = (lang: RoleplayLang): AgentSpec => ({
    name: `VN practice -- ${p.name} (${lang.toUpperCase()})`,
    prompt: personaPrompt(p, s, lang),
    firstMessage: lang === "es" ? p.first_message_es : p.first_message_en,
    language: lang,
    voiceId: p.voice_id,
    llm,
    maxSeconds: maxSecondsOf(maxMinutes),
  });
  return [one("en"), one("es")];
}
