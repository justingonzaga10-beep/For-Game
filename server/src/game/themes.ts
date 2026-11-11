import { readFileSync } from "node:fs";
import { LIMITS, sanitizeText } from "@inkwave/shared";
import en from "../themes/en.json";
import { containsProfanity } from "./profanity";

/**
 * Draw-Off themes: server/src/themes/en.json, or a JSON file named by the
 * THEMES_FILE environment variable (a plain array, or { "themes": [...] })
 * to use a different list without editing the code.
 */
function loadThemes(): string[] {
  const file = process.env.THEMES_FILE;
  if (file) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
      const list = Array.isArray(raw) ? raw : (raw as { themes?: unknown }).themes;
      const clean = Array.isArray(list) ? list.map((t) => String(t).trim()).filter(Boolean) : [];
      if (clean.length) return clean;
      console.warn(`THEMES_FILE ${file} has no themes; using the built-in list.`);
    } catch (err) {
      console.warn(`Couldn't read THEMES_FILE ${file}; using the built-in list.`, err);
    }
  }
  return en.themes.map((t) => t.trim()).filter(Boolean);
}

export const THEMES: string[] = loadThemes();

/** A random theme not used yet this game, or any theme once all have been used. */
export function pickTheme(used: Set<string>, rand: () => number = Math.random, list: string[] = THEMES): string {
  const fresh = list.filter((t) => !used.has(t));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(rand() * pool.length)] ?? "anything you like";
}

/**
 * The host's own themes from the lobby box: split on commas or new lines,
 * tidied, capped in length, duplicates and anything the profanity filter
 * catches dropped. Keeps the host's capitals ("Dream House").
 */
export function parseCustomThemes(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const t = sanitizeText(part, LIMITS.customThemeLength);
    const key = t.toLowerCase();
    if (!t || seen.has(key) || containsProfanity(t)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= LIMITS.maxCustomThemes) break;
  }
  return out;
}

/**
 * The theme for a Draw-Off round: one of the host's themes not used yet this
 * game (in random order), then the built-in themes once the host's run out.
 */
export function pickDrawOffTheme(used: Set<string>, custom: string[], rand: () => number = Math.random): string {
  const fresh = custom.filter((t) => !used.has(t));
  if (fresh.length) return fresh[Math.floor(rand() * fresh.length)];
  return pickTheme(used, rand);
}
