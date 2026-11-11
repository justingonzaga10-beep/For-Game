import { DEFAULT_SETTINGS, LIMITS, PERIMETER_MAXES, SETTING_BOUNDS, SHAPE_KINDS, isLanguage, type GameModeId, type RoomSettings, type ShapeKind, type WordMode } from "@inkwave/shared";

const MODES: WordMode[] = ["normal", "hidden", "combination"];
const GAME_MODE_IDS: GameModeId[] = ["guess", "drawoff", "perimeter", "area"];

function clampInt(v: unknown, [min, max]: readonly [number, number], fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Applies an untrusted patch onto current settings, clamping every field. */
export function applySettingsPatch(current: RoomSettings, patch: unknown, minPlayers: number): RoomSettings {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const next: RoomSettings = { ...current };
  if ("maxPlayers" in p) next.maxPlayers = Math.max(clampInt(p.maxPlayers, SETTING_BOUNDS.maxPlayers, current.maxPlayers), Math.min(minPlayers, 20));
  if ("rounds" in p) next.rounds = clampInt(p.rounds, SETTING_BOUNDS.rounds, current.rounds);
  if ("drawTime" in p) next.drawTime = clampInt(p.drawTime, SETTING_BOUNDS.drawTime, current.drawTime);
  if ("wordChoices" in p) next.wordChoices = clampInt(p.wordChoices, SETTING_BOUNDS.wordChoices, current.wordChoices);
  if ("hints" in p) next.hints = clampInt(p.hints, SETTING_BOUNDS.hints, current.hints);
  if ("wordMode" in p && MODES.includes(p.wordMode as WordMode)) next.wordMode = p.wordMode as WordMode;
  if ("language" in p && isLanguage(p.language)) next.language = p.language;
  if ("customWords" in p && typeof p.customWords === "string") {
    // Keep commas and spaces; strip control characters; cap the length.
    next.customWords = p.customWords.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, LIMITS.customWords);
  }
  if ("customThemes" in p && typeof p.customThemes === "string") {
    // Keep commas and line breaks (both separate themes); strip other control characters; cap the length.
    next.customThemes = p.customThemes.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? "\n" : " ")).slice(0, LIMITS.customThemes);
  }
  if ("customOnly" in p) next.customOnly = p.customOnly === true;
  if ("paintThrow" in p) next.paintThrow = p.paintThrow === true;
  if ("listed" in p) next.listed = p.listed === true;
  if ("mode" in p && GAME_MODE_IDS.includes(p.mode as GameModeId)) next.mode = p.mode as GameModeId;
  if ("drawOffTime" in p) next.drawOffTime = clampInt(p.drawOffTime, SETTING_BOUNDS.drawOffTime, current.drawOffTime);
  if ("perimeterTime" in p) next.perimeterTime = clampInt(p.perimeterTime, SETTING_BOUNDS.perimeterTime, current.perimeterTime);
  if (p.perimeterUnit === "cm" || p.perimeterUnit === "m") next.perimeterUnit = p.perimeterUnit;
  if ("perimeterMax" in p && (PERIMETER_MAXES as readonly number[]).includes(Number(p.perimeterMax))) next.perimeterMax = Number(p.perimeterMax);
  if ("perimeterShapes" in p && Array.isArray(p.perimeterShapes)) {
    const kinds = SHAPE_KINDS.filter((k) => (p.perimeterShapes as unknown[]).includes(k)) as ShapeKind[];
    if (kinds.length) next.perimeterShapes = kinds; // at least one shape must stay on
  }
  if ("perimeterChallenge" in p) next.perimeterChallenge = p.perimeterChallenge === true;
  return next;
}

export const publicSettings = (language: RoomSettings["language"]): RoomSettings => ({ ...DEFAULT_SETTINGS, language, maxPlayers: 12 });
