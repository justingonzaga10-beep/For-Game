import type { Avatar } from "./avatar";
import type { LanguageCode, RoomSettings } from "./constants";

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

export type Phase = "lobby" | "choosing" | "drawing" | "reveal" | "podium";

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
}

export interface SocketData {
  clientId: string;
  ip: string;
  roomCode?: string;
}
