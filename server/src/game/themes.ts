import { readFileSync } from "node:fs";
import en from "../themes/en.json";

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
