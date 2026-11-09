import {
  LIMITS,
  TIMING,
  reactionsFor,
  sanitizeText,
  type ChatKind,
  type ChatMessage,
  type DrawAction,
  type Phase,
  type PlayerView,
  type PodiumEntry,
  type RevealInfo,
  type RoomSettings,
  type RoomView,
} from "@inkwave/shared";
import type { GameMode, NewPlayer, Player, RemovalReason, RoomContext, RoomTransport } from "./GameMode";
import { DrawOffMode } from "./DrawOffMode";
import { GuessMode } from "./GuessMode";
import { PerimeterMode } from "./PerimeterMode";
import { maskProfanity } from "./profanity";
import { TokenBucket } from "./rateLimit";
import { rankScores } from "./scoring";
import { applySettingsPatch } from "./settings";

export type { NewPlayer, Player, RemovalReason, RoomTransport } from "./GameMode";

const GHOST_MS = 60_000;

/**
 * A room: the part every game mode shares. Players, host, settings,
 * moderation, chat, timers, state sync, the final podium and the return to
 * the lobby live here; the rules of play live in the active GameMode.
 */
export class Room implements RoomContext {
  readonly players = new Map<string, Player>();
  hostId: string | null = null;
  settings: RoomSettings;

  phase: Phase = "lobby";
  round = 0;
  phaseEndsAt: number | null = null;
  podium: PodiumEntry[] | null = null;

  private readonly guess: GuessMode;
  readonly drawOff: DrawOffMode;
  readonly perimeter: PerimeterMode;
  readonly area: PerimeterMode;
  private mode: GameMode;

  private timers: ReturnType<typeof setTimeout>[] = [];
  private autoStartTimer: ReturnType<typeof setTimeout> | null = null;
  private bannedClients = new Set<string>();
  private bannedIps = new Set<string>();
  private kickVotes = new Map<string, Set<string>>();
  /** Players who dropped mid-game, restored if they come back quickly. */
  private ghosts = new Map<string, { score: number; until: number; oldId: string; data: unknown }>();
  private msgId = 0;
  private disposed = false;

  constructor(
    readonly code: string,
    readonly isPublic: boolean,
    settings: RoomSettings,
    readonly io: RoomTransport,
    private readonly onEmpty: (room: Room) => void = () => {},
    readonly rand: () => number = Math.random,
  ) {
    this.settings = { ...settings };
    this.guess = new GuessMode(this);
    this.drawOff = new DrawOffMode(this);
    this.perimeter = new PerimeterMode(this);
    this.area = new PerimeterMode(this, "area");
    this.mode = this.guess;
  }

  /* ---------------------------------------------------------------- */
  /* Guessing-mode state, kept on the room for callers and tests        */
  /* ---------------------------------------------------------------- */

  get drawerId(): string | null {
    return this.guess.drawerId;
  }
  get word(): string | null {
    return this.guess.word;
  }
  get choices(): string[] {
    return this.guess.choices;
  }
  get reveal(): RevealInfo | null {
    return this.guess.reveal;
  }
  /** Canvas actions so far (for tests and diagnostics). */
  get canvasActions(): readonly DrawAction[] {
    return this.guess.canvasActions;
  }

  chooseWord(byId: string, index: unknown): void {
    if (this.mode === this.guess) this.guess.chooseWord(byId, index);
  }

  /* ---------------------------------------------------------------- */
  /* Membership                                                        */
  /* ---------------------------------------------------------------- */

  get inGame(): boolean {
    return this.phase !== "lobby" && this.phase !== "podium";
  }

  isBanned(clientId: string, ip: string): boolean {
    return this.bannedClients.has(clientId) || (ip !== "" && this.bannedIps.has(ip));
  }

  isFull(): boolean {
    return this.players.size >= this.settings.maxPlayers;
  }

  addPlayer(np: NewPlayer): Player {
    const ghost = this.ghosts.get(np.clientId);
    this.ghosts.delete(np.clientId);
    const restore = ghost && ghost.until > Date.now() && this.phase !== "lobby" ? ghost : undefined;
    const p: Player = {
      ...np,
      score: restore?.score ?? 0,
      guessed: false,
      chatLimit: new TokenBucket(6, 1.5),
      drawLimit: new TokenBucket(80, 45),
      reactLimit: new TokenBucket(4, 1),
    };
    this.players.set(p.id, p);
    if (!this.isPublic && !this.hostId) this.hostId = p.id;

    this.system(`${p.name} joined the room`);
    this.mode.onJoin(p, restore ? { oldId: restore.oldId, data: restore.data } : undefined);
    this.maybeAutoStart();
    this.sync();
    return p;
  }

  removePlayer(id: string, reason: RemovalReason = "left"): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.kickVotes.delete(id);
    for (const voters of this.kickVotes.values()) voters.delete(id);
    if (this.inGame && reason === "left") {
      const data = this.mode.ghostData(p);
      if (p.score > 0 || data !== null) this.ghosts.set(p.clientId, { score: p.score, until: Date.now() + GHOST_MS, oldId: p.id, data });
    }

    if (reason !== "left") this.io.removed(id, reason);
    const verb = reason === "left" ? "left the room" : reason === "votekicked" ? "was vote-kicked" : `was ${reason} by the host`;
    this.system(`${p.name} ${verb}`);

    if (this.players.size === 0) {
      this.dispose();
      this.onEmpty(this);
      return;
    }
    if (this.hostId === id) {
      this.hostId = this.players.keys().next().value ?? null;
      const host = this.hostId ? this.players.get(this.hostId) : null;
      if (host) this.system(`${host.name} is now the host`);
    }

    if (this.inGame && this.players.size < this.mode.minPlayers) {
      this.stopGame("Not enough players left. Back to the lobby.");
    } else if (this.inGame && this.mode.onLeave(id)) {
      // The mode moved the game on and synced.
    } else {
      this.checkKickVotes();
      this.maybeAutoStart();
      this.sync();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Lobby                                                             */
  /* ---------------------------------------------------------------- */

  updateSettings(byId: string, patch: unknown): void {
    if (this.isPublic || byId !== this.hostId || this.phase !== "lobby") return;
    this.settings = applySettingsPatch(this.settings, patch, this.players.size);
    this.sync();
  }

  /** The mode the current settings ask for. Public rooms always play guessing. */
  private modeForSettings(): GameMode {
    if (this.isPublic) return this.guess;
    if (this.settings.mode === "drawoff") return this.drawOff;
    if (this.settings.mode === "perimeter") return this.perimeter;
    if (this.settings.mode === "area") return this.area;
    return this.guess;
  }

  requestStart(byId: string): void {
    if (this.isPublic || byId !== this.hostId) return;
    if (this.phase !== "lobby" && this.phase !== "podium") return;
    const next = this.modeForSettings();
    if (this.players.size < next.minPlayers) {
      this.io.send(byId, "notice", next.tooFewPlayersMessage);
      return;
    }
    this.startGame();
  }

  private maybeAutoStart(): void {
    if (!this.isPublic || this.phase !== "lobby") return;
    if (this.players.size >= 2 && !this.autoStartTimer) {
      this.phaseEndsAt = Date.now() + TIMING.publicAutoStartSeconds * 1000;
      this.autoStartTimer = setTimeout(() => {
        this.autoStartTimer = null;
        if (this.phase === "lobby" && this.players.size >= 2) this.startGame();
      }, TIMING.publicAutoStartSeconds * 1000);
    } else if (this.players.size < 2 && this.autoStartTimer) {
      clearTimeout(this.autoStartTimer);
      this.autoStartTimer = null;
      this.phaseEndsAt = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Game lifecycle                                                    */
  /* ---------------------------------------------------------------- */

  startGame(): void {
    this.clearTimers();
    for (const p of this.players.values()) {
      p.score = 0;
      p.guessed = false;
    }
    this.ghosts.clear();
    this.podium = null;
    this.round = 1;
    this.mode = this.modeForSettings();
    this.system("The game is starting!");
    this.mode.start();
  }

  setPhase(phase: Phase, endsAt: number | null): void {
    this.phase = phase;
    this.phaseEndsAt = endsAt;
  }

  endGame(): void {
    this.clearTimers();
    this.mode.reset();
    const ranked = rankScores([...this.players.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score })));
    this.podium = ranked.filter((r) => r.rank <= 3).slice(0, 5);
    this.setPhase("podium", Date.now() + TIMING.podiumSeconds * 1000);
    const winner = ranked[0];
    if (winner) this.system(`${winner.name} wins with ${winner.score} points!`);
    this.later(TIMING.podiumSeconds * 1000, () => this.toLobby());
    this.sync();
  }

  private toLobby(): void {
    this.clearTimers();
    this.setPhase("lobby", null);
    this.round = 0;
    this.mode.reset();
    this.io.broadcast("draw:replay", [[]]);
    this.maybeAutoStart();
    this.sync();
  }

  private stopGame(message: string): void {
    this.clearTimers();
    this.system(message);
    this.podium = null;
    this.toLobby();
  }

  /* ---------------------------------------------------------------- */
  /* Drawing and chat                                                  */
  /* ---------------------------------------------------------------- */

  handleDraw(byId: string, raw: unknown): void {
    if (!this.inGame || !Array.isArray(raw)) return;
    this.mode.handleDraw(byId, raw);
  }

  /** Draw-Off: a star rating for the drawing on screen. */
  vote(byId: string, entryId: unknown, stars: unknown): void {
    if (this.inGame) this.mode.vote?.(byId, entryId, stars);
  }

  /** Perimeter: the drawer's finished shape. */
  submitShape(byId: string, shape: unknown): void {
    if (this.inGame) this.mode.submitShape?.(byId, shape);
  }

  /** Perimeter: a player's answer. */
  answer(byId: string, value: unknown): void {
    if (this.inGame) this.mode.answer?.(byId, value);
  }

  /** Draw-Off: the host ends the gallery early. */
  hostContinue(byId: string): void {
    if (this.inGame && byId === this.hostId) this.mode.hostContinue?.();
  }

  handleChat(byId: string, raw: unknown): void {
    const p = this.players.get(byId);
    if (!p) return;
    const text = sanitizeText(raw, LIMITS.message);
    if (!text) return;
    if (!p.chatLimit.take()) {
      this.io.send(byId, "chat", this.msg("warn", "Slow down! You're sending messages too fast."));
      return;
    }
    if (this.inGame && this.mode.handleChat(p, text)) return;
    this.io.broadcast("chat", [this.msg("chat", maskProfanity(text), p)]);
  }

  /** An emoji reaction: only from the mode's set, a few a second at most, and only during a game (podium included). */
  react(byId: string, emoji: unknown): void {
    const p = this.players.get(byId);
    if (!p || this.phase === "lobby" || typeof emoji !== "string") return;
    if (!reactionsFor(this.settings.mode, this.isPublic).includes(emoji)) return;
    if (!p.reactLimit.take()) return; // spam is dropped quietly
    this.io.broadcast("fx:react", [{ playerId: byId, emoji }]);
  }

  /* ---------------------------------------------------------------- */
  /* Moderation                                                        */
  /* ---------------------------------------------------------------- */

  kick(byId: string, targetId: string, ban = false): void {
    if (this.isPublic || byId !== this.hostId || byId === targetId) return;
    const t = this.players.get(targetId);
    if (!t) return;
    if (ban) {
      this.bannedClients.add(t.clientId);
      if (t.ip) this.bannedIps.add(t.ip);
    }
    this.removePlayer(targetId, ban ? "banned" : "kicked");
  }

  /** Majority of the other players; needs at least 3 players so nobody is kicked by a single vote. */
  votesNeeded(): number {
    return Math.floor((this.players.size - 1) / 2) + 1;
  }

  voteKick(byId: string, targetId: string): void {
    if (byId === targetId || !this.players.has(byId) || !this.players.has(targetId)) return;
    if (this.players.size < 3) {
      this.io.send(byId, "notice", "Vote-kick needs at least 3 players in the room.");
      return;
    }
    const voters = this.kickVotes.get(targetId) ?? new Set<string>();
    if (voters.has(byId)) return;
    voters.add(byId);
    this.kickVotes.set(targetId, voters);
    const voter = this.players.get(byId)!;
    const target = this.players.get(targetId)!;
    this.system(`${voter.name} voted to kick ${target.name} (${voters.size}/${this.votesNeeded()})`);
    if (!this.checkKickVotes()) this.sync();
  }

  forgiveKickVotes(playerId: string): void {
    this.kickVotes.delete(playerId);
  }

  /** Kicks anyone whose votes now reach a majority. Returns true when someone was removed. */
  private checkKickVotes(): boolean {
    if (this.players.size < 3) return false;
    for (const [targetId, voters] of this.kickVotes) {
      if (voters.size >= this.votesNeeded()) {
        const t = this.players.get(targetId);
        if (t) {
          this.bannedClients.add(t.clientId);
          this.removePlayer(targetId, "votekicked");
          return true;
        }
      }
    }
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Views                                                             */
  /* ---------------------------------------------------------------- */

  viewFor(playerId: string): RoomView {
    const players: PlayerView[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      guessed: p.guessed,
      isHost: p.id === this.hostId,
      kickVotes: this.kickVotes.get(p.id)?.size ?? 0,
    }));
    return {
      code: this.code,
      isPublic: this.isPublic,
      you: playerId,
      hostId: this.hostId,
      settings: this.settings,
      players,
      phase: this.phase,
      round: this.round,
      ...this.mode.view(playerId),
      phaseEndsAt: this.phaseEndsAt,
      serverNow: Date.now(),
      podium: this.phase === "podium" ? this.podium : null,
      yourKickVotes: [...this.kickVotes].filter(([, v]) => v.has(playerId)).map(([k]) => k),
    };
  }

  sync(): void {
    if (this.disposed) return;
    for (const id of this.players.keys()) this.io.send(id, "room:state", this.viewFor(id));
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  msg(kind: ChatKind, text: string, from?: Player): ChatMessage {
    return { id: ++this.msgId, kind, text, playerId: from?.id, name: from?.name };
  }

  system(text: string): void {
    this.io.broadcast("chat", [this.msg("system", text)]);
  }

  later(ms: number, fn: () => void): void {
    this.timers.push(
      setTimeout(() => {
        if (!this.disposed) fn();
      }, ms),
    );
  }

  clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.autoStartTimer) {
      clearTimeout(this.autoStartTimer);
      this.autoStartTimer = null;
    }
  }

  dispose(): void {
    this.clearTimers();
    this.disposed = true;
  }
}
