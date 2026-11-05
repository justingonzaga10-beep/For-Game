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

function pickFrom(pool: string[], exclude: Set<string>, rand: Rand): string | null {
  const fresh = pool.filter((w) => !exclude.has(w));
  const src = fresh.length > 0 ? fresh : pool;
  if (src.length === 0) return null;
  return src[Math.floor(rand() * src.length)];
}

/**
 * Picks `count` distinct word options. Built-in words rotate through easy,
 * medium and hard so the drawer gets a spread of difficulty. Custom words
 * join the pool, or replace it with "custom words only". Combination mode
 * joins two words with a space. Words in `used` are avoided while fresh
 * ones remain.
 */
export function pickWordChoices(settings: RoomSettings, count: number, used: Set<string>, rand: Rand = Math.random): string[] {
  const list = WORD_LISTS[settings.language] ?? WORD_LISTS.en;
  const custom = parseCustomWords(settings.customWords);
  const customOnly = settings.customOnly && custom.length > 0;
  const tiers = customOnly ? [custom] : [list.easy, list.medium, list.hard];

  const choices: string[] = [];
  const taken = new Set(used);
  const single = (slot: number): string | null => {
    // Custom words get roughly a one-in-three share when mixed with built-ins.
    if (!customOnly && custom.length > 0 && rand() < 1 / 3) {
      const c = pickFrom(custom, taken, rand);
      if (c) return c;
    }
    return pickFrom(tiers[slot % tiers.length], taken, rand);
  };

  for (let slot = 0; slot < count; slot++) {
    let word: string | null = null;
    for (let attempt = 0; attempt < 8 && (!word || choices.includes(word)); attempt++) {
      if (settings.wordMode === "combination") {
        const a = single(slot);
        if (a) taken.add(a);
        const b = single(slot + 1);
        if (a) taken.delete(a);
        word = a && b && a !== b ? `${a} ${b}` : a;
      } else {
        word = single(slot);
      }
    }
    if (word && !choices.includes(word)) {
      choices.push(word);
      for (const part of word.split(" ")) taken.add(part);
      taken.add(word);
    }
  }
  return choices.length > 0 ? choices : ["star"];
}
