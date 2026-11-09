import type { Avatar, ChatKind, ChatMessage, Phase, RoomSettings, RoomView, ServerToClientEvents } from "@inkwave/shared";
import type { TokenBucket } from "./rateLimit";

type Events = ServerToClientEvents;
export type RemovalReason = "left" | "kicked" | "banned" | "votekicked";

/** How the room talks to the outside world. Socket.IO in production, a recorder in tests. */
export interface RoomTransport {
  send<E extends keyof Events>(playerId: string, event: E, ...args: Parameters<Events[E]>): void;
  broadcast<E extends keyof Events>(event: E, args: Parameters<Events[E]>, exceptPlayerId?: string): void;
  /** Called when the room removes a player for moderation, so the socket can leave the channel. */
  removed(playerId: string, reason: Exclude<RemovalReason, "left">): void;
}

export interface Player {
  id: string;
  clientId: string;
  ip: string;
  name: string;
  avatar: Avatar;
  score: number;
  /** Guessing mode: guessed the word this turn. */
  guessed: boolean;
  chatLimit: TokenBucket;
  drawLimit: TokenBucket;
  reactLimit: TokenBucket;
}

export interface NewPlayer {
  id: string;
  clientId: string;
  ip: string;
  name: string;
  avatar: Avatar;
}

/**
 * What a game mode can see and do in its room. The room keeps everything
 * the modes share: players, host, settings, moderation, chat, timers,
 * state sync, the final podium and the return to the lobby.
 */
export interface RoomContext {
  readonly players: ReadonlyMap<string, Player>;
  readonly settings: RoomSettings;
  readonly io: RoomTransport;
  readonly rand: () => number;
  readonly phase: Phase;
  /** Server time the current phase's countdown ends, or null. */
  readonly phaseEndsAt: number | null;
  round: number;
  /** Moves to a phase; `endsAt` is the server time the phase's countdown ends, or null. */
  setPhase(phase: Phase, endsAt: number | null): void;
  /** A timer that is cancelled by clearTimers() and when the room closes. */
  later(ms: number, fn: () => void): void;
  clearTimers(): void;
  system(text: string): void;
  msg(kind: ChatKind, text: string, from?: Player): ChatMessage;
  /** Sends every player their view of the room. */
  sync(): void;
  /** The mode played its last round: show the final podium. */
  endGame(): void;
  /** Drops any open vote-kick against this player. */
  forgiveKickVotes(playerId: string): void;
}

/** The parts of a player's view that depend on the mode. */
export type ModeView = Pick<RoomView, "drawerId" | "pattern" | "word" | "choices" | "reveal" | "drawOff" | "perimeter">;

export interface GameMode {
  /** Fewest players the mode can run with; below this a running game returns to the lobby. */
  readonly minPlayers: number;
  /** Message for the host when there are too few players to start. */
  readonly tooFewPlayersMessage: string;
  /** Starts the first round. Scores are already reset and round is 1. */
  start(): void;
  /** A player was added. `rejoin` carries what ghostData() saved if they left this game moments ago. */
  onJoin(p: Player, rejoin?: { oldId: string; data: unknown }): void;
  /** What to remember about a player who drops mid-game, or null for nothing. */
  ghostData(p: Player): unknown;
  /** A player was removed during a game. Return true if the mode already synced the room. */
  onLeave(playerId: string): boolean;
  handleDraw(byId: string, ops: unknown[]): void;
  /** Draw-Off only: a star rating for the drawing on screen. */
  vote?(byId: string, entryId: unknown, stars: unknown): void;
  /** Draw-Off only: the host ends the gallery early. */
  hostContinue?(): void;
  /** Perimeter only: the drawer's finished shape. */
  submitShape?(byId: string, shape: unknown): void;
  /** Perimeter only: a player's answer. */
  answer?(byId: string, value: unknown): void;
  /** Return true if the mode handled the message; otherwise it is broadcast as normal chat. */
  handleChat(p: Player, text: string): boolean;
  view(playerId: string): ModeView;
  /** Forget the finished game (podium, or back to the lobby). */
  reset(): void;
}
