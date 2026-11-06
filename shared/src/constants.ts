/** Logical canvas size. Every client draws in these coordinates and scales the view. */
export const CANVAS_W = 800;
export const CANVAS_H = 600;

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "tl", label: "Tagalog" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const isLanguage = (v: unknown): v is LanguageCode =>
  typeof v === "string" && LANGUAGES.some((l) => l.code === v);

export const LIMITS = {
  nickname: 20,
  message: 120,
  customWords: 2000, // characters in the comma-separated list
  customWordLength: 32,
  maxCustomWords: 300,
  roomCodeLength: 6,
  /** Points one draw batch may carry (x, y, pressure triplets). */
  pointsPerBatch: 600,
  /** Ops one draw batch may carry. */
  opsPerBatch: 40,
  /** Points one turn may carry in total, to cap memory and replay size. */
  pointsPerTurn: 60000,
} as const;

export const TIMING = {
  chooseSeconds: 15,
  revealSeconds: 5,
  podiumSeconds: 9,
  publicAutoStartSeconds: 8,
  /** Draw-Off: how long each drawing is on screen for voting. */
  drawOffVoteSeconds: 10,
  /** Draw-Off: reveal of who drew what. */
  drawOffResultsSeconds: 10,
  /** Draw-Off: browsing the round's drawings (the host can skip ahead). */
  drawOffGallerySeconds: 20,
} as const;

/** "guess": one draws, the rest guess. "drawoff": everyone draws the same theme, then rates each other. */
export type GameModeId = "guess" | "drawoff";
export const GAME_MODES: { id: GameModeId; label: string }[] = [
  { id: "guess", label: "Guessing" },
  { id: "drawoff", label: "Draw-Off" },
];
/** Draw-Off needs three players so everyone has at least two drawings to rate. */
export const DRAWOFF_MIN_PLAYERS = 3;

export type WordMode = "normal" | "hidden" | "combination";

export interface RoomSettings {
  mode: GameModeId;
  maxPlayers: number;
  rounds: number;
  drawTime: number;
  wordChoices: number;
  hints: number;
  wordMode: WordMode;
  language: LanguageCode;
  customWords: string;
  customOnly: boolean;
  /** Draw-Off drawing time in seconds. */
  drawOffTime: number;
}

export const SETTING_BOUNDS = {
  maxPlayers: [2, 20],
  rounds: [2, 10],
  drawTime: [15, 240],
  wordChoices: [1, 5],
  hints: [0, 5],
  drawOffTime: [30, 240],
} as const;

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: "guess",
  maxPlayers: 10,
  rounds: 3,
  drawTime: 80,
  wordChoices: 3,
  hints: 2,
  wordMode: "normal",
  language: "en",
  customWords: "",
  customOnly: false,
  drawOffTime: 90,
};

/** Brush sizes in logical pixels, selected with keys 1-5. */
export const BRUSH_SIZES = [4, 8, 14, 24, 40] as const;

/** 28-colour palette: neutrals, then hue ramps light to dark. */
export const PALETTE = [
  "#ffffff", "#c8c8d0", "#7a7a88", "#3a3a46", "#000000",
  "#ffb3c7", "#ff4d8d", "#d1004f", "#7a0030",
  "#ffcfa3", "#ff8a1f", "#c45200",
  "#fff38a", "#ffd500", "#b39200",
  "#c9ff8a", "#5ce01f", "#1f8a2e",
  "#9ff5ff", "#18d9f0", "#007a99",
  "#a8c2ff", "#2f5bff", "#152f8f",
  "#d9b3ff", "#9b3dff", "#4f1a8f",
  "#8b5a2b",
] as const;
