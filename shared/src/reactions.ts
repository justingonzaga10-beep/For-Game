import type { GameModeId } from "./constants";

/**
 * Emoji reactions players can tap during a game. Each mode has its own set;
 * the server only relays emojis from the current mode's list, so nobody can
 * send anything else.
 */
export const REACTIONS: Record<GameModeId, readonly string[]> = {
  guess: ["👍", "😂", "😮", "🤔", "🔥", "👏", "🎨", "🎉"],
  drawoff: ["😍", "😂", "😮", "🌟", "🔥", "👏", "🎨", "🎉"],
  perimeter: ["👍", "🤔", "🤯", "💡", "🔥", "👏", "📏", "🎉"],
  area: ["👍", "🤔", "🤯", "💡", "🔥", "👏", "🟨", "🎉"],
};

/** Paint colours players can throw at each other. */
export const THROW_COLORS = ["#ff4d8d", "#d1004f", "#ff8a1f", "#ffd500", "#5ce01f", "#18d9f0", "#2f5bff", "#9b3dff"] as const;

/** Public rooms always play Guessing. */
export const reactionsFor = (mode: GameModeId, isPublic: boolean): readonly string[] => REACTIONS[isPublic ? "guess" : mode];
