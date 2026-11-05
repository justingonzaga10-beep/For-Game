/**
 * Guessers: a 50-point floor, up to 250 more for speed (linear in the time
 * left), and an order bonus of 50/40/30/20/10 for the first five guessers.
 */
export function guesserPoints(remainingMs: number, totalMs: number, order: number): number {
  const frac = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  const speed = Math.round(250 * frac);
  const orderBonus = Math.max(0, 50 - order * 10);
  return 50 + speed + orderBonus;
}

/** Drawer: up to 250 points, proportional to the share of guessers who got it. */
export function drawerPoints(guessedCount: number, guesserCount: number): number {
  if (guesserCount <= 0 || guessedCount <= 0) return 0;
  return Math.round((250 * Math.min(guessedCount, guesserCount)) / guesserCount);
}

/** Standard competition ranking: ties share a rank (1, 1, 3). */
export function rankScores<T extends { score: number }>(players: T[]): (T & { rank: number })[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  let rank = 0;
  return sorted.map((p, i) => {
    if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1;
    return { ...p, rank };
  });
}
