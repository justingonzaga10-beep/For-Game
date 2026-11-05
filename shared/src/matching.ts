/**
 * Word matching shared by server (authoritative) and client (UI hints).
 * Case-insensitive, whitespace-trimmed, accent-insensitive. Spaces, hyphens
 * and punctuation inside the word are ignored, so "ice-cream" = "Ice Cream".
 */
export function normalizeGuess(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isCorrectGuess(guess: string, word: string): boolean {
  const g = normalizeGuess(guess);
  return g.length > 0 && g === normalizeGuess(word);
}

/** Classic Levenshtein distance with an early exit once `max` is exceeded. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** A wrong guess that is one edit away from the word. */
export function isCloseGuess(guess: string, word: string): boolean {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(word);
  if (!g || g === w || w.length < 3) return false;
  return editDistance(g, w, 1) === 1;
}

/** True when a message would give the word away (used to block the drawer). */
export function containsWord(message: string, word: string): boolean {
  const w = normalizeGuess(word);
  return w.length > 0 && normalizeGuess(message).includes(w);
}
