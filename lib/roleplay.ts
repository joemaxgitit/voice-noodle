import { realVoiceSection, type RealVoice } from "@/lib/learn";
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
  /** 1 (very short fuse) to 10 (very patient). Empty = from the difficulty. */
  patience?: number | null;
};

/** How patient a client is when nobody set it: easy clients rarely hang up, hard ones give the rep little room. */
export const patienceOf = (p: Pick<Persona, "difficulty">, s: Pick<PersonaSecret, "patience">) =>
  Math.max(1, Math.min(10, s.patience ?? (p.difficulty === "easy" ? 8 : p.difficulty === "hard" ? 4 : 6)));

export type RoleplayLang = "en" | "es";

/** Stored on calls.roleplay for a practice call. */
export type RoleplayMode = "first" | "followup";

/** What the practice client is told about which call this is (an ElevenLabs dynamic variable). */
export function callModeText(mode: RoleplayMode, previous: string | null): string {
  if (mode === "first") return "This is the FIRST call. You've never spoken with this rep or Lionside before.";
  return `This is a FOLLOW-UP call. You already spoke with Lionside a few days ago and didn't go ahead.${previous ? ` What happened last time: ${previous}` : " You got partway -- they asked about your situation and started talking about options -- and then you put it off."} Pick the reason you gave last time from how real clients put off deciding (listed below) if one fits you, and stay true to what was really behind it. Don't start over from scratch: you remember the last call, roughly. Raise the same hesitation again unless the rep gets to the bottom of it. A rep who re-connects with what you're going through and rebuilds your certainty before asking again earns a real yes; one who jumps straight to paperwork gets the same brush-off.`;
}

export type RoleplayInfo = {
  persona: string; // the client's name, kept even if the persona is later deleted
  persona_title?: string;
  lang: RoleplayLang;
  conversation_id?: string | null;
  agent_id?: string;
  started_at?: string;
  ended_at?: string;
  usd?: number | null;
  /** First call or a follow-up, and what the client was told happened last time. */
  mode?: RoleplayMode;
  previous?: string | null;
  /** The client archetype mixed into this call (from the approved set), and exactly what the voice was told. */
  archetype?: { name: string; text: string } | null;
};

/** The parts of an approved client archetype a practice client is built from (see app/api/archetypes). */
export type ArchetypeMix = {
  name: string;
  buyer_type: string;
  action_threshold: string;
  pain_awareness: string;
  weakest_ten: string;
  core_belief: string;
  openness: string;
  pluto: string;
  decision: string;
  layers: { facts: string; cause: string; impact: string; feelings: string; future: string };
  sounds_like: string[];
};

export const NO_MIX = "No special mix today: be yourself exactly as described above.";

/**
 * Today's client type, layered over the character's facts (an ElevenLabs
 * dynamic variable, so the same voice plays a different kind of client on
 * every call). Facts, debts and the right result never change; how this
 * person thinks, opens up and drifts off the line does.
 */
export function archetypeText(a: ArchetypeMix | null): string {
  if (!a) return NO_MIX;
  const ten = /product/i.test(a.weakest_ten) ? "product" : /rep|trust/i.test(a.weakest_ten) ? "rep" : /company|lionside|bolton/i.test(a.weakest_ten) ? "company" : null;
  const L = a.layers || ({} as ArchetypeMix["layers"]);
  return [
    `Today you are this kind of client -- keep every fact about your life and debts from above, but think, feel and talk like this:`,
    `- Where you are as a buyer: ${a.buyer_type}. How much certainty you need before you act: ${a.action_threshold}. Your pain: ${a.pain_awareness}.`,
    a.core_belief ? `- The belief behind your hesitation: "${a.core_belief}". It comes out as an objection at some point; it only goes away if the rep actually changes how you see it.` : "",
    ten ? `- Your certainty in the ${ten} starts lower than written above: 3 out of 10. It is the hardest one for the rep to raise.` : "",
    `- How open you are: ${a.openness}.${a.decision ? ` How you decide: ${a.decision}.` : ""}`,
    `- Your hardship comes out in layers, using your own story above. Each layer opens only when the rep earns it with an open question, a real follow-up on what you just said, and empathy (slowing down, reflecting it back). Yes/no questions and rushing keep you where you are.`,
    `  1. Facts: ${L.facts || "amounts and accounts"}`,
    `  2. What caused it: ${L.cause || "what happened"}`,
    `  3. How it hits your life: ${L.impact || "work, family, sleep"}`,
    `  4. How you feel about it: ${L.feelings || "said in your own words, only when you trust the rep"}`,
    `  5. What happens if nothing changes: ${L.future || "only when the rep helps you look ahead"}`,
    a.pluto
      ? `- You drift off the point the way this kind of client does: ${a.pluto}. Do it once or twice, early on. If the rep brings you back kindly with a question, come back with them. If they let you run on, keep going for a while -- the longer it runs, the harder you are to bring back.`
      : "",
    a.sounds_like?.length ? `- The way you talk sounds like: "${a.sounds_like.slice(0, 3).join('" / "')}" -- in your own words, never word for word.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

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
  // "ok" is the usual enrollment: no red flag standing at the signature.
  const solid = enrolled && (closeQuality === "solid" || closeQuality === "ok");

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
export function practiceNote(name: string, secret: PersonaSecret | null, archetype?: { name: string; text: string } | null): string {
  const mix = archetype?.text
    ? `
The client was also played as this client type ("${archetype.name}") -- use it to judge how deep the rep got through the hardship layers (the hardship depth part) and how they handled the client drifting off the line (line control). In the summary, name the client type and say whether the rep adapted to it:
<client_type>
${archetype.text}
</client_type>
`
    : "";
  return practiceNoteBase(name, secret) + mix;
}

function practiceNoteBase(name: string, secret: PersonaSecret | null): string {
  if (!secret) {
    return `
This is a PRACTICE call. The client, ${name}, was played by an AI. Grade it exactly as you would a real call.
`;
  }
  return `
This is a PRACTICE call. The client, ${name}, was played by an AI from the character sheet below, which the rep never saw. Grade it exactly as you would a real call, judging only what was said -- but use the sheet to judge intelligence gathering (did the rep uncover what the client was holding back?) and whether the client's agreement was real. In summary, say plainly whether the rep found the client's hidden situation and reached the right result.
<practice_client>
${secret.backstory.trim()}

If the client ended the call (said a goodbye line and hung up), say plainly in the summary what the rep did in the moments before that lost them, and make it the first coaching priority.

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
export function personaPrompt(p: Persona, s: PersonaSecret, lang: RoleplayLang, real?: RealVoice | null): string {
  const patience = patienceOf(p, s);
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

# Which call this is
{{call_mode}}

# Today's client type
{{client_type}}

# Two moments that matter most
- Your hardship comes out in layers. At first give the surface version ("I just fell behind", "things got tight"). Only when the rep stays with you -- real follow-up questions about what happened, how it's affecting you and your family, how you feel about it -- do you open up to the deeper, more personal part. Real trust builds over the first 8 to 12 minutes; if the rep rushes past your story to get to the loan or the numbers, keep the deeper part to yourself and stay a little guarded.
- When the rep tells you the loan was declined, it genuinely lands on you: deflated, embarrassed, maybe "so there's nothing I can do?". How you come back depends on the rep. If they come back with real, calm, positive certainty and lay out the options fairly, you lift back up and listen. If they sound flat, unsure, apologetic or rushed, you sink further and your patience drops. Options laid out evenly first make you trust the rep more; if the rep then recommends one, that's welcome.

# Deciding
- Only agree to enroll when all three Tens are 8 or more, your pain is high enough, and you genuinely understand it: it is not a loan, it is not debt settlement, your payments go to Bolton, your accounts will go to collections, and you have to take part.
- Objections come out the way real people say them first ("I need to think about it", "it's a lot") -- the rep has to find what is really underneath. Raise each real concern at least once; when a rep handles one well, let it go.
- When the rep reads the contract or the confirmation questions, answer each one based on what you actually understand.
- A rep who does a great job earns a real yes -- you are a person, not an obstacle course.
- If you decide not to go ahead, say so, and agree to a callback if the rep asks for one and you'd genuinely want it.

# Patience and hanging up
Your patience starts at ${patience} out of 10${patience <= 4 ? " -- you are busy and skeptical, and you give a rep very little room" : patience >= 8 ? " -- you are polite and give people a fair chance" : ""}. Track it silently, alongside the Tens.
- It drops when the rep does what makes real people hang up: a robotic or scripted opening, not saying who they are and why they're calling, talking at you for a long stretch, pitching before understanding your situation, sounding unsure, talking over you, dodging a direct question, or pushing after a clear no.
- It recovers when the rep earns it: real curiosity about you, listening, getting your situation right, sounding sure and calm.
- The first 30 seconds matter most: a rep who doesn't give you a reason to stay loses patience fast.
- When your patience runs out, end the call the way a real person would -- a short exit line ("I gotta go", "I'm not interested, thanks", or just "okay, bye") -- and then hang up using the end_call tool. Sometimes polite, sometimes abrupt, depending on who you are.
- Never hang up on a rep who is listening and building real rapport. A hang-up must be earned by what the rep did, so it can be coached afterwards.
- If the rep keeps pushing after you've said no twice, hang up.

# What to expect (don't get ahead of it)
The rep will probably introduce themselves, ask about your situation, try for a loan through a partner lender, talk through options, explain a program run by Bolton, review your credit report with you, and -- if you agree -- go through a contract and some confirmation questions before passing you to an account manager. You only know what a regular person would know.${realVoiceSection(real, lang)}`;
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
export function agentSpecs(
  p: Persona,
  s: PersonaSecret,
  llm: string,
  maxMinutes: unknown,
  real?: { en: RealVoice; es: RealVoice } | null
): [AgentSpec, AgentSpec] {
  const one = (lang: RoleplayLang): AgentSpec => ({
    name: `VN practice -- ${p.name} (${lang.toUpperCase()})`,
    prompt: personaPrompt(p, s, lang, real?.[lang]),
    firstMessage: lang === "es" ? p.first_message_es : p.first_message_en,
    language: lang,
    voiceId: p.voice_id,
    llm,
    maxSeconds: maxSecondsOf(maxMinutes),
  });
  return [one("en"), one("es")];
}
