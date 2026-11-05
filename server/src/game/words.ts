import { LIMITS, sanitizeText, type LanguageCode, type RoomSettings } from "@inkwave/shared";
import en from "../words/en.json";
import tl from "../words/tl.json";

export interface WordList {
  language: string;
  name: string;
  easy: string[];
  medium: string[];
  hard: string[];
}

/** To add a language: drop a JSON file in src/words and register it here and in shared LANGUAGES. */
export const WORD_LISTS: Record<LanguageCode, WordList> = { en, tl };

export function parseCustomWords(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const w = sanitizeText(part, LIMITS.customWordLength).toLowerCase();
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= LIMITS.maxCustomWords) break;
  }
  return out;
}

type Rand = () => number;

/** Random word from `pool`, never one in `never`, and avoiding `avoid` while fresh words remain. */
function pickFrom(pool: string[], avoid: Set<string>, rand: Rand, never: Set<string> = new Set()): string | null {
  const allowed = pool.filter((w) => !never.has(w));
  const fresh = allowed.filter((w) => !avoid.has(w));
  const src = fresh.length > 0 ? fresh : allowed;
  if (src.length === 0) return null;
  return src[Math.floor(rand() * src.length)];
}

/**
 * Picks `count` distinct word options. Built-in words rotate through easy,
 * medium and hard so the drawer gets a spread of difficulty. Custom words
 * join the pool, or replace it with "custom words only". Combination mode
 * joins two different words with a space. Words in `used` are avoided while
 * fresh ones remain.
 */
export function pickWordChoices(settings: RoomSettings, count: number, used: Set<string>, rand: Rand = Math.random): string[] {
  const list = WORD_LISTS[settings.language] ?? WORD_LISTS.en;
  const custom = parseCustomWords(settings.customWords);
  const customOnly = settings.customOnly && custom.length > 0;
  const tiers = customOnly ? [custom] : [list.easy, list.medium, list.hard];
  const taken = new Set(used);

  const single = (slot: number, never?: Set<string>): string | null => {
    // Custom words get roughly a one-in-three share when mixed with built-ins.
    if (!customOnly && custom.length > 0 && rand() < 1 / 3) {
      const c = pickFrom(custom, taken, rand, never);
      if (c) return c;
    }
    return pickFrom(tiers[slot % tiers.length], taken, rand, never);
  };

  const choices: string[] = [];
  for (let slot = 0; slot < count; slot++) {
    let word: string | null = null;
    for (let attempt = 0; attempt < 10 && (!word || choices.includes(word)); attempt++) {
      if (settings.wordMode === "combination") {
        const a = single(slot);
        const b = a ? single(slot + 1, new Set([a])) : null;
        word = a && b ? `${a} ${b}` : null;
      } else {
        word = single(slot);
      }
    }
    if (word && !choices.includes(word)) {
      choices.push(word);
      taken.add(word);
      for (const part of word.split(" ")) taken.add(part);
    }
  }
  if (choices.length > 0) return choices;
  // Only reachable with a one-word custom list in combination mode.
  return [custom[0] ?? list.easy[0]];
}
