/**
 * A deliberately small, basic filter for English and Tagalog. Short words
 * only match as whole tokens (so "class" or "Dickens" pass); longer ones
 * also match inside tokens. Common letter swaps (4→a, 3→e, $→s, ...) are
 * undone before matching.
 */
const SHORT = [
  // English
  "ass", "fag", "cum", "tit", "tits", "dick", "cock", "fuk", "fck", "shit", "piss", "slut", "twat", "porn", "sex", "nazi", "cunt", "jizz", "dyke", "rape", "horny",
  // Tagalog
  "puta", "gago", "gaga", "bobo", "ulol", "olol", "tite", "titi", "puke", "pota", "kupal", "burat", "tamod", "jakol", "bilat", "pekpek", "pakyu", "tanga",
];
const LONG = [
  // English
  "fuck", "bitch", "asshole", "bastard", "whore", "faggot", "nigger", "nigga", "retard", "motherfucker", "wanker", "dildo", "penis", "vagina", "pussy", "boobs", "blowjob", "handjob", "hitler",
  // Tagalog
  "putangina", "putanginamo", "tangina", "tanginamo", "punyeta", "tarantado", "kantot", "kantutan", "hindot", "pakshet", "kingina", "pucha",
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i", "8": "b" };

function deleet(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[0134578@$!]/g, (c) => LEET[c] ?? c);
}

/** Collapse runs of the same letter: "fuuuck" → "fuck". */
const squeeze = (s: string) => s.replace(/(.)\1+/g, "$1");
/** Shorten runs of 3+ to 2: "niggga" → "nigga", keeps real double letters. */
const trim3 = (s: string) => s.replace(/(.)\1{2,}/g, "$1$1");

const SHORT_SET = new Set(SHORT);
// Squeezed matching is only safe for words with no double letters of their own,
// otherwise e.g. "nigga" → "niga" would flag the dish "sinigang".
const LONG_NO_DOUBLES = LONG.filter((w) => squeeze(w) === w);

function hasLong(t: string): boolean {
  const t3 = trim3(t);
  const sq = squeeze(t);
  return LONG.some((w) => t3.includes(w)) || LONG_NO_DOUBLES.some((w) => sq.includes(w));
}

function tokenIsBad(raw: string): boolean {
  const t = deleet(raw).replace(/[^a-z]/g, "");
  if (!t) return false;
  if (SHORT_SET.has(t) || SHORT_SET.has(squeeze(t)) || SHORT_SET.has(trim3(t))) return true;
  return hasLong(t);
}

export function containsProfanity(text: string): boolean {
  if (text.split(/[\s.,;:?!'"()\-_/\\|]+/).some(tokenIsBad)) return true;
  // Catch spaced-out words like "f u c k" by also checking the squashed text.
  return hasLong(deleet(text).replace(/[^a-z]/g, ""));
}

/** Replaces offending words with asterisks, keeping everything else. */
export function maskProfanity(text: string): string {
  return text.replace(/[^\s]+/g, (tok) => {
    // Keep surrounding punctuation, test the core.
    const m = tok.match(/^([^\p{L}\p{N}@$]*)(.*?)([^\p{L}\p{N}@$]*)$/u);
    const core = m ? m[2] : tok;
    if (core && tokenIsBad(core)) return (m?.[1] ?? "") + "*".repeat(Array.from(core).length) + (m?.[3] ?? "");
    return tok;
  });
}
