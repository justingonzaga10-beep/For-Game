const LETTER = /[\p{L}\p{N}]/u;

/** Indices of characters a guesser has to work out (letters and digits). */
export function letterIndices(word: string): number[] {
  const out: number[] = [];
  Array.from(word).forEach((ch, i) => {
    if (LETTER.test(ch)) out.push(i);
  });
  return out;
}

/** "_" for each hidden letter; spaces, hyphens and revealed letters show as-is. */
export function maskWord(word: string, revealed: ReadonlySet<number>): string {
  return Array.from(word)
    .map((ch, i) => (LETTER.test(ch) && !revealed.has(i) ? "_" : ch))
    .join("");
}

/** Hints never give away more than half the letters. */
export function hintCount(word: string, requested: number): number {
  const letters = letterIndices(word).length;
  return Math.max(0, Math.min(requested, Math.floor(letters / 2)));
}

/** Offsets (ms from turn start) at which hints fire, evenly spaced through the turn. */
export function hintSchedule(drawMs: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((drawMs * (i + 1)) / (count + 1)));
}

/** Picks a random unrevealed letter index, or null when none are left. */
export function pickHintIndex(word: string, revealed: ReadonlySet<number>, rand: () => number = Math.random): number | null {
  const options = letterIndices(word).filter((i) => !revealed.has(i));
  if (options.length === 0) return null;
  return options[Math.floor(rand() * options.length)];
}
