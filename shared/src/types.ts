import type { Avatar } from "./avatar";
import type { LanguageCode, RoomSettings } from "./constants";
import type { PerimeterShape } from "./perimeter";

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

/** Paper colour of the canvas; the eraser paints with it. */
export const PAPER = "#fbfaf6";

/**
 * Live drawing operations, streamed in small batches by the drawer.
 * Points are flat [x, y, pressure, x, y, pressure, ...] in logical pixels.
 */
export type DrawOp =
  | { k: "begin"; id: number; color: string; size: number; x: number; y: number; p: number }
  | { k: "pts"; id: number; pts: number[] }
  | { k: "end"; id: number }
  | { k: "fill"; x: number; y: number; color: string }
  | { k: "undo" }
  | { k: "clear" };

/** Completed canvas actions, kept for undo and for replaying to late joiners. */
export type DrawAction =
  | { t: "stroke"; color: string; size: number; pts: number[] }
  | { t: "fill"; x: number; y: number; color: string }
  | { t: "clear" };

/* ------------------------------------------------------------------ */
/* Players and rooms                                                   */
/* ------------------------------------------------------------------ */

export interface Profile {
  name: string;
  avatar: Avatar;
  language: LanguageCode;
}

export interface PlayerView {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  /** Guessed the word this turn. */
  guessed: boolean;
  isHost: boolean;
  /** Votes against this player in an open vote-kick. */
  kickVotes: number;
}

export type Phase =
  | "lobby"
  // Guessing mode
  | "choosing"
  | "drawing"
  | "reveal"
  // Draw-Off mode
  | "drawoff_drawing"
  | "drawoff_voting"
  | "drawoff_results"
  | "drawoff_gallery"
  // Perimeter mode
  | "perim_build"
  | "perim_solve"
  | "perim_reveal"
  // Both: final scores
  | "podium";

/** A Draw-Off drawing, identified only by a random id until results. */
export interface DrawOffEntry {
  entryId: string;
  actions: DrawAction[];
}

export interface DrawOffResult {
  entryId: string;
  playerId: string;
  name: string;
  avatar: Avatar;
  /** Average stars received, 1 to 5; 1 when nobody voted. */
  rating: number;
  votes: number;
  points: number;
  /** 1 = best; ties share a rank. */
  rank: number;
}

/** What one player sees of a Perimeter turn. */
export interface PerimeterView {
  /** The drawer's shape, once made (null while they build it). */
  shape: PerimeterShape | null;
  unit: "cm" | "m";
  /** The correct perimeter: for the drawer, players who solved it, and at the reveal. */
  answer: number | null;
  /** Worked answer at the reveal: "8 + 3 + 8 + 3 = 22 cm", a shortcut if there is one, and a note for composites. */
  equation: { sum: string; shortcut: string | null; note: string | null } | null;
}

/** What one player sees of a Draw-Off round. */
export interface DrawOffView {
  theme: string | null;
  /** Joined mid-round: watching now, drawing from the next round. */
  spectating: boolean;
  /** Players drawing this round. */
  participantIds: string[];
  /** Voting: the drawing on screen. */
  current: {
    entryId: string;
    /** 1-based position and total, e.g. drawing 2 of 5. */
    index: number;
    total: number;
    isYours: boolean;
    canVote: boolean;
    yourStars: number | null;
    votesIn: number;
    votersNeeded: number;
  } | null;
  /** Results and gallery: every drawing with its author and rating, best first. */
  results: DrawOffResult[] | null;
}

export type TurnEndReason = "time" | "all_guessed" | "drawer_left" | "skipped";

export interface RevealInfo {
  word: string;
  reason: TurnEndReason;
  /** Points each player gained this turn, by player id (drawer included). */
  gains: Record<string, number>;
}

export interface PodiumEntry {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  rank: number;
}

/**
 * The room as one player sees it. The server personalises it: the word is
 * only present for the drawer, players who guessed it, and during reveal.
 */
export interface RoomView {
  code: string;
  isPublic: boolean;
  you: string;
  hostId: string | null;
  settings: RoomSettings;
  players: PlayerView[];
  phase: Phase;
  round: number;
  drawerId: string | null;
  /**
   * Masked word for guessers: "_" hides a letter; spaces, hyphens and
   * revealed letters are shown. Null in hidden mode or outside a turn.
   */
  pattern: string | null;
  /** The real word: for the drawer, for players who guessed it, and during reveal. */
  word: string | null;
  /** Word options, only for the drawer while choosing. */
  choices: string[] | null;
  /** Server timestamp (ms) when the current phase ends, or null. */
  phaseEndsAt: number | null;
  /** Server clock at send time, for clock-offset correction. */
  serverNow: number;
  reveal: RevealInfo | null;
  /** Draw-Off state, or null in other modes. */
  drawOff: DrawOffView | null;
  /** Perimeter state, or null in other modes. */
  perimeter: PerimeterView | null;
  podium: PodiumEntry[] | null;
  /** Ids you have voted to kick. */
  yourKickVotes: string[];
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export type ChatKind =
  /** Normal chat or a wrong guess, visible to everyone. */
  | "chat"
  /** Between the drawer and players who already guessed. */
  | "guessed"
  /** "X guessed the word!" */
  | "correct"
  /** Private "So close!" */
  | "close"
  /** Neutral system notices: joins, leaves, turn changes. */
  | "system"
  /** Warnings meant for one player. */
  | "warn";

export interface ChatMessage {
  id: number;
  kind: ChatKind;
  text: string;
  /** Sender for chat/guessed/correct messages. */
  playerId?: string;
  name?: string;
}

/* ------------------------------------------------------------------ */
/* Socket events                                                       */
/* ------------------------------------------------------------------ */

export type JoinResult = { ok: true; code: string } | { ok: false; error: string };
export type Ack<T> = (result: T) => void;

export interface ClientToServerEvents {
  "room:quickplay": (profile: Profile, ack: Ack<JoinResult>) => void;
  "room:create": (profile: Profile, ack: Ack<JoinResult>) => void;
  "room:join": (code: string, profile: Profile, ack: Ack<JoinResult>) => void;
  "room:leave": () => void;
  "room:settings": (patch: Partial<RoomSettings>) => void;
  "game:start": () => void;
  "turn:choose": (index: number) => void;
  draw: (ops: DrawOp[]) => void;
  chat: (text: string) => void;
  "mod:kick": (playerId: string) => void;
  "mod:ban": (playerId: string) => void;
  "mod:votekick": (playerId: string) => void;
  /** Draw-Off: rate the drawing on screen 1-5 stars. Changing your mind replaces your vote. */
  "drawoff:vote": (entryId: string, stars: number) => void;
  /** Draw-Off: the host ends the gallery early. */
  "drawoff:continue": () => void;
  /** Perimeter: the drawer's finished shape. */
  "perim:shape": (shape: PerimeterShape) => void;
  /** Perimeter: a player's answer. */
  "perim:answer": (value: number) => void;
}

export interface ServerToClientEvents {
  "room:state": (view: RoomView) => void;
  /** Live ops from the drawer. */
  draw: (ops: DrawOp[]) => void;
  /** Full canvas, sent on join and at turn start (empty list). */
  "draw:replay": (actions: DrawAction[]) => void;
  chat: (msg: ChatMessage) => void;
  /** A player guessed: drives the "+points" pop and the chime. */
  "fx:guessed": (info: { playerId: string; points: number }) => void;
  /** You were removed from the room. */
  "room:removed": (info: { reason: "kicked" | "banned" | "votekicked" }) => void;
  notice: (text: string) => void;
  /** Draw-Off: replaces your private canvas (empty at the start of a round). */
  "drawoff:canvas": (actions: DrawAction[]) => void;
  /** Draw-Off: every drawing of the round, sent once when voting starts. */
  "drawoff:entries": (entries: DrawOffEntry[]) => void;
  /** Perimeter: private feedback on your answer. */
  "perim:feedback": (info: { result: "correct" | "close" | "wrong"; value: number }) => void;
}

export interface SocketData {
  clientId: string;
  ip: string;
  roomCode?: string;
}
