/** Avatars are built from layered vector parts, picked by index. */
export interface Avatar {
  /** Head shape: robot box, round alien, tall capsule, hex bot, bulb alien. */
  head: number;
  /** Neon hue index into AVATAR_COLORS. */
  color: number;
  eyes: number;
  mouth: number;
  /** Antenna / ear / crest topper. */
  top: number;
}

export const AVATAR_COLORS = ["#ff2bd6", "#18e7ff", "#9dff3a", "#ffe14d", "#ff7a1a", "#a46bff", "#ff4d6d", "#4dffc3"] as const;
export const AVATAR_PARTS = { head: 5, color: AVATAR_COLORS.length, eyes: 6, mouth: 6, top: 5 } as const;

export function randomAvatar(rand: () => number = Math.random): Avatar {
  const pick = (n: number) => Math.floor(rand() * n);
  return {
    head: pick(AVATAR_PARTS.head),
    color: pick(AVATAR_PARTS.color),
    eyes: pick(AVATAR_PARTS.eyes),
    mouth: pick(AVATAR_PARTS.mouth),
    top: pick(AVATAR_PARTS.top),
  };
}

/** Coerces untrusted input into a valid avatar. */
export function sanitizeAvatar(input: unknown): Avatar {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const part = (key: keyof Avatar) => {
    const n = Number(src[key]);
    const max = AVATAR_PARTS[key];
    return Number.isInteger(n) && n >= 0 && n < max ? n : 0;
  };
  return { head: part("head"), color: part("color"), eyes: part("eyes"), mouth: part("mouth"), top: part("top") };
}
