import type { Lang } from "@/lib/lang";

/**
 * Interface text a rep reads, in both languages.
 *
 * Scope is deliberate: rep-facing surfaces only -- the section list, the
 * training card, the full script. The admin area stays English, which is the
 * same line already drawn for `coaching` on the segments themselves, and for
 * the tone codes.
 *
 * Kept in one file rather than scattered so a Spanish reader never gets a
 * half-translated page. That was the actual complaint: Spanish modules under
 * an English heading reads worse than no translation at all.
 */
export type Copy = {
  loading: string;

  // section list
  sections: string;
  admin: string;
  signOut: string;
  welcomeBack: string;
  training: string;
  pickSection: string;
  pickSectionBlurb: string;
  noScripts: string;
  callInOrder: string;
  fullScriptLink: string;
  whenTheyObject: string;
  objectionBlurb: string;
  empty: string;

  // training card
  nothingYet: string;
  nothingYetBlurb: string;
  of: string;
  verbatim: string;
  stale: string;
  noRecording: string;
  loop: string;
  on: string;
  off: string;
  speed: string;
  phrase: string;
  word: string;
  highlightBy: string;
  voice: string;
  showInScript: string;
  delivery: string;
  clientShouldFeel: string;
  previous: string;
  next: string;
  gotItNext: string;
  markComplete: string;

  // full script
  print: string;
  fullScriptBlurb: string;
  readWholeCall: string;
  pause: string;
  resume: string;
  stop: string;
  segmentsRecorded: string;
  readFromHere: string;
  playOnlyThis: string;
  nothingRecorded: string;
  couldNotLoad: string;
};

const EN: Copy = {
  loading: "Loading…",

  sections: "Sections",
  admin: "Admin",
  signOut: "Sign out",
  welcomeBack: "Welcome back",
  training: "Training",
  pickSection: "Pick a section",
  pickSectionBlurb:
    "Work one card at a time. Listen, repeat it out loud, then move on.",
  noScripts:
    "No scripts are assigned to your account yet. Ask your manager to add you to an organization.",
  callInOrder: "The call, in order",
  fullScriptLink: "Full script",
  whenTheyObject: "When they object",
  objectionBlurb:
    "An objection is uncertainty about one of three things: the program, you, or the company. Pick the loop that rebuilds the one that slipped.",
  empty: "empty",

  nothingYet: "Nothing to practice yet",
  nothingYetBlurb:
    "This section has no published segments. An admin can add them from the admin area.",
  of: "of",
  verbatim: "Say this word for word — required for compliance",
  stale:
    "The script changed after this was recorded. Read what is on screen — the audio still says the old version and needs redoing.",
  noRecording: "No master recording uploaded for this one yet.",
  loop: "Loop",
  on: "on",
  off: "off",
  speed: "speed",
  phrase: "Phrase",
  word: "Word",
  highlightBy: "Highlight by",
  voice: "Voice",
  showInScript: "Show in full script",
  delivery: "Delivery",
  clientShouldFeel: "Client should feel",
  previous: "Previous",
  next: "Next",
  gotItNext: "Got it → next",
  markComplete: "Mark complete",

  print: "Print",
  fullScriptBlurb:
    "The full script. Section names sit in the margin — click one to practise that part. When printing, switch off “Headers and footers” in the browser dialog for a clean page.",
  readWholeCall: "Read the whole call",
  pause: "Pause",
  resume: "Resume",
  stop: "Stop",
  segmentsRecorded: "segments recorded",
  readFromHere: "Read from here to the end",
  playOnlyThis: "Play this segment only",
  nothingRecorded: "Nothing in this script has been recorded yet.",
  couldNotLoad: "Could not load the recordings.",
};

/*
  Written in tú, informal, matching the register of the translated scripts
  themselves -- a rep reading a card should not hit a tonal shift between the
  interface and the words they are about to say.
*/
const ES: Copy = {
  loading: "Cargando…",

  sections: "Secciones",
  admin: "Admin",
  signOut: "Cerrar sesión",
  welcomeBack: "Bienvenido de nuevo",
  training: "Entrenamiento",
  pickSection: "Elige una sección",
  pickSectionBlurb:
    "Trabaja una tarjeta a la vez. Escucha, repítelo en voz alta y sigue adelante.",
  noScripts:
    "Todavía no tienes guiones asignados a tu cuenta. Pídele a tu gerente que te agregue a una organización.",
  callInOrder: "La llamada, en orden",
  fullScriptLink: "Guion completo",
  whenTheyObject: "Cuando objetan",
  objectionBlurb:
    "Una objeción es incertidumbre sobre una de tres cosas: el programa, tú o la compañía. Elige el loop que reconstruya la que se cayó.",
  empty: "vacío",

  nothingYet: "Todavía no hay nada que practicar",
  nothingYetBlurb:
    "Esta sección no tiene segmentos publicados. Un administrador puede agregarlos desde el área de administración.",
  of: "de",
  verbatim: "Di esto palabra por palabra — requerido por cumplimiento",
  stale:
    "El guion cambió después de grabar esto. Lee lo que está en pantalla — el audio todavía dice la versión anterior y hay que volver a grabarlo.",
  noRecording: "Todavía no se ha subido una grabación maestra para este.",
  loop: "Repetir",
  on: "activado",
  off: "desactivado",
  speed: "velocidad",
  phrase: "Frase",
  word: "Palabra",
  highlightBy: "Resaltar por",
  voice: "Voz",
  showInScript: "Ver en el guion completo",
  delivery: "Entrega",
  clientShouldFeel: "El cliente debe sentir",
  previous: "Anterior",
  next: "Siguiente",
  gotItNext: "Entendido → siguiente",
  markComplete: "Marcar como completo",

  print: "Imprimir",
  fullScriptBlurb:
    "El guion completo. Los nombres de las secciones están en el margen — haz clic en uno para practicar esa parte. Al imprimir, desactiva «Encabezados y pies de página» en el diálogo del navegador para una página limpia.",
  readWholeCall: "Leer la llamada completa",
  pause: "Pausa",
  resume: "Continuar",
  stop: "Detener",
  segmentsRecorded: "segmentos grabados",
  readFromHere: "Leer desde aquí hasta el final",
  playOnlyThis: "Reproducir solo este segmento",
  nothingRecorded: "Todavía no se ha grabado nada de este guion.",
  couldNotLoad: "No se pudieron cargar las grabaciones.",
};

export function copyFor(lang: Lang): Copy {
  return lang === "es" ? ES : EN;
}
