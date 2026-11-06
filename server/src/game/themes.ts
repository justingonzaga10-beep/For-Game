import en from "../themes/en.json";

/** Draw-Off themes. Edit server/src/themes/en.json to change them. */
export const THEMES: string[] = en.themes.map((t) => t.trim()).filter(Boolean);

/** A random theme not used yet this game, or any theme once all have been used. */
export function pickTheme(used: Set<string>, rand: () => number = Math.random, list: string[] = THEMES): string {
  const fresh = list.filter((t) => !used.has(t));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(rand() * pool.length)] ?? "anything you like";
}
