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

/** Public rooms always play Guessing. */
export const reactionsFor = (mode: GameModeId, isPublic: boolean): readonly string[] => REACTIONS[isPublic ? "guess" : mode];
