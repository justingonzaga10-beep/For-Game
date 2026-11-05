import {
  CANVAS_H,
  CANVAS_W,
  LIMITS,
  TIMING,
  containsWord,
  isCloseGuess,
  isCorrectGuess,
  sanitizeText,
  type Avatar,
  type ChatKind,
  type ChatMessage,
  type DrawAction,
  type DrawOp,
  type Phase,
  type PlayerView,
  type PodiumEntry,
  type RevealInfo,
  type RoomSettings,
  type RoomView,
  type ServerToClientEvents,
  type TurnEndReason,
} from "@inkwave/shared";
import { hintCount, hintSchedule, maskWord, pickHintIndex } from "./hints";
import { maskProfanity } from "./profanity";
import { TokenBucket } from "./rateLimit";
import { drawerPoints, guesserPoints, rankScores } from "./scoring";
import { applySettingsPatch } from "./settings";
import { pickWordChoices } from "./words";

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
  guessed: boolean;
  chatLimit: TokenBucket;
  drawLimit: TokenBucket;
}

export interface NewPlayer {
  id: string;
  clientId: string;
  ip: string;
  name: string;
  avatar: Avatar;
}

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, min: number, max: number, fallback = 0) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const GHOST_MS = 60_000;

export class Room {
  readonly players = new Map<string, Player>();
  hostId: string | null = null;
  settings: RoomSettings;

  phase: Phase = "lobby";
  round = 0;
  drawerId: string | null = null;
  word: string | null = null;
  choices: string[] = [];
  phaseEndsAt: number | null = null;
  reveal: RevealInfo | null = null;
  podium: PodiumEntry[] | null = null;

  /** Drawing order for the current round. */
  private order: string[] = [];
  private orderIndex = -1;
  private revealed = new Set<number>();
  private turnStartedAt = 0;
  private guessOrder: string[] = [];
  private gains = new Map<string, number>();
  private usedWords = new Set<string>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private autoStartTimer: ReturnType<typeof setTimeout> | null = null;

  private actions: DrawAction[] = [];
  private stroke: { id: number; color: string; size: number; pts: number[] } | null = null;
  private pointsThisTurn = 0;

  private bannedClients = new Set<string>();
  private bannedIps = new Set<string>();
  private kickVotes = new Map<string, Set<string>>();
  /** Scores of players who dropped mid-game, restored if they come back quickly. */
  private ghosts = new Map<string, { score: number; until: number }>();
  private msgId = 0;
  private disposed = false;

  constructor(
    readonly code: string,
    readonly isPublic: boolean,
    settings: RoomSettings,
    private readonly io: RoomTransport,
    private readonly onEmpty: (room: Room) => void = () => {},
    private readonly rand: () => number = Math.random,
  ) {
    this.settings = { ...settings };
  }

  /* ---------------------------------------------------------------- */
  /* Membership                                                        */
  /* ---------------------------------------------------------------- */

  get inGame(): boolean {
    return this.phase === "choosing" || this.phase === "drawing" || this.phase === "reveal";
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
    const p: Player = {
      ...np,
      score: ghost && ghost.until > Date.now() && this.phase !== "lobby" ? ghost.score : 0,
      guessed: false,
      chatLimit: new TokenBucket(6, 1.5),
      drawLimit: new TokenBucket(80, 45),
    };
    this.players.set(p.id, p);
    if (!this.isPublic && !this.hostId) this.hostId = p.id;
    if (this.inGame && !this.order.includes(p.id)) this.order.push(p.id);

    this.system(`${p.name} joined the room`);
    // Bring the newcomer's canvas up to date.
    this.io.send(p.id, "draw:replay", this.phase === "drawing" || this.phase === "reveal" ? [...this.actions] : []);
    if (this.phase === "drawing" && this.stroke && this.stroke.pts.length >= 3) {
      const [x, y, pr, ...rest] = this.stroke.pts;
      const { id, color, size } = this.stroke;
      this.io.send(p.id, "draw", [{ k: "begin", id, color, size, x, y, p: pr }, { k: "pts", id, pts: rest }]);
    }
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
    if (this.inGame && reason === "left" && p.score > 0) this.ghosts.set(p.clientId, { score: p.score, until: Date.now() + GHOST_MS });

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

    if (this.inGame && this.players.size < 2) {
      this.stopGame("Not enough players left. Back to the lobby.");
    } else if (this.drawerId === id && (this.phase === "choosing" || this.phase === "drawing")) {
      this.endTurn("drawer_left");
    } else if (this.phase === "drawing" && this.allGuessed()) {
      this.endTurn("all_guessed");
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

  requestStart(byId: string): void {
    if (this.isPublic || byId !== this.hostId) return;
    if (this.phase !== "lobby" && this.phase !== "podium") return;
    if (this.players.size < 2) {
      this.io.send(byId, "notice", "You need at least 2 players to start.");
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
  /* Game loop                                                         */
  /* ---------------------------------------------------------------- */

  startGame(): void {
    this.clearTimers();
    for (const p of this.players.values()) {
      p.score = 0;
      p.guessed = false;
    }
    this.ghosts.clear();
    this.usedWords.clear();
    this.podium = null;
    this.round = 1;
    this.order = [...this.players.keys()];
    this.orderIndex = -1;
    this.system("The game is starting!");
    this.nextTurn();
  }

  private nextTurn(): void {
    this.clearTimers();
    this.reveal = null;
    this.word = null;
    this.choices = [];
    this.revealed = new Set();
    this.guessOrder = [];
    this.gains = new Map();
    this.actions = [];
    this.stroke = null;
    this.pointsThisTurn = 0;
    for (const p of this.players.values()) p.guessed = false;

    // Next drawer still in the room, moving to the next round when this one is done.
    let next: string | undefined;
    while (!next) {
      this.orderIndex++;
      if (this.orderIndex >= this.order.length) {
        this.round++;
        if (this.round > this.settings.rounds) return this.endGame();
        this.order = [...this.players.keys()];
        this.orderIndex = 0;
        this.system(`Round ${this.round} of ${this.settings.rounds}`);
      }
      const candidate = this.order[this.orderIndex];
      if (candidate && this.players.has(candidate)) next = candidate;
    }

    this.drawerId = next;
    this.choices = pickWordChoices(this.settings, this.settings.wordChoices, this.usedWords, this.rand);
    this.phase = "choosing";
    this.phaseEndsAt = Date.now() + TIMING.chooseSeconds * 1000;
    this.io.broadcast("draw:replay", [[]]);
    this.system(`${this.players.get(next)!.name} is choosing a word`);
    this.later(TIMING.chooseSeconds * 1000, () => {
      if (this.phase === "choosing") this.beginDrawing(this.choices[Math.floor(this.rand() * this.choices.length)]);
    });
    this.sync();
  }

  chooseWord(byId: string, index: unknown): void {
    if (this.phase !== "choosing" || byId !== this.drawerId) return;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= this.choices.length) return;
    this.beginDrawing(this.choices[i]);
  }

  private beginDrawing(word: string): void {
    this.clearTimers();
    this.word = word;
    this.usedWords.add(word);
    this.phase = "drawing";
    this.turnStartedAt = Date.now();
    const drawMs = this.settings.drawTime * 1000;
    this.phaseEndsAt = this.turnStartedAt + drawMs;

    if (this.settings.wordMode !== "hidden") {
      const count = hintCount(word, this.settings.hints);
      for (const at of hintSchedule(drawMs, count)) this.later(at, () => this.revealHint());
    }
    this.later(drawMs, () => this.endTurn("time"));
    this.sync();
  }

  private revealHint(): void {
    if (this.phase !== "drawing" || !this.word) return;
    const idx = pickHintIndex(this.word, this.revealed, this.rand);
    if (idx === null) return;
    this.revealed.add(idx);
    this.sync();
  }

  private allGuessed(): boolean {
    const guessers = [...this.players.values()].filter((p) => p.id !== this.drawerId);
    return guessers.length > 0 && guessers.every((p) => p.guessed);
  }

  private endTurn(reason: TurnEndReason): void {
    if (this.phase !== "choosing" && this.phase !== "drawing") return;
    this.clearTimers();
    const drawer = this.drawerId ? this.players.get(this.drawerId) : undefined;

    if (!this.word) {
      // The drawer left before picking: nothing to reveal.
      this.system("The drawer left before choosing a word.");
      return this.nextTurn();
    }

    if (drawer && reason !== "drawer_left") {
      const guessers = this.players.size - 1;
      const pts = drawerPoints(this.guessOrder.filter((id) => this.players.has(id)).length, guessers);
      drawer.score += pts;
      this.gains.set(drawer.id, pts);
    }
    const gains: Record<string, number> = {};
    for (const p of this.players.values()) gains[p.id] = this.gains.get(p.id) ?? 0;

    this.reveal = { word: this.word, reason, gains };
    this.phase = "reveal";
    this.phaseEndsAt = Date.now() + TIMING.revealSeconds * 1000;
    this.stroke = null;
    this.system(`The word was "${this.word}"`);
    this.later(TIMING.revealSeconds * 1000, () => this.nextTurn());
    this.sync();
  }

  private endGame(): void {
    this.clearTimers();
    this.phase = "podium";
    this.drawerId = null;
    this.word = null;
    this.reveal = null;
    const ranked = rankScores([...this.players.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score })));
    this.podium = ranked.filter((r) => r.rank <= 3).slice(0, 5);
    this.phaseEndsAt = Date.now() + TIMING.podiumSeconds * 1000;
    const winner = ranked[0];
    if (winner) this.system(`${winner.name} wins with ${winner.score} points!`);
    this.later(TIMING.podiumSeconds * 1000, () => this.toLobby());
    this.sync();
  }

  private toLobby(): void {
    this.clearTimers();
    this.phase = "lobby";
    this.round = 0;
    this.drawerId = null;
    this.word = null;
    this.choices = [];
    this.reveal = null;
    this.phaseEndsAt = null;
    this.actions = [];
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
  /* Drawing                                                           */
  /* ---------------------------------------------------------------- */

  handleDraw(byId: string, raw: unknown): void {
    if (this.phase !== "drawing" || byId !== this.drawerId || !Array.isArray(raw)) return;
    const p = this.players.get(byId);
    if (!p || !p.drawLimit.take()) return;
    const clean: DrawOp[] = [];
    let points = 0;
    for (const op of raw.slice(0, LIMITS.opsPerBatch)) {
      const c = this.sanitizeOp(op, LIMITS.pointsPerBatch - points);
      if (!c) continue;
      if (c.k === "pts") points += c.pts.length / 3;
      this.applyOp(c);
      clean.push(c);
    }
    if (clean.length) this.io.broadcast("draw", [clean], byId);
  }

  private sanitizeOp(op: unknown, pointBudget: number): DrawOp | null {
    if (!op || typeof op !== "object") return null;
    const o = op as Record<string, unknown>;
    const id = Number.isInteger(o.id) ? (o.id as number) : -1;
    const x = (v: unknown) => round1(num(v, -40, CANVAS_W + 40));
    const y = (v: unknown) => round1(num(v, -40, CANVAS_H + 40));
    const pr = (v: unknown) => Math.round(num(v, 0.05, 1, 1) * 100) / 100;
    switch (o.k) {
      case "begin":
        if (id < 0 || typeof o.color !== "string" || !HEX.test(o.color)) return null;
        return { k: "begin", id, color: o.color, size: num(o.size, 1, 60, 8), x: x(o.x), y: y(o.y), p: pr(o.p) };
      case "pts": {
        if (id < 0 || !Array.isArray(o.pts)) return null;
        const room = Math.min(pointBudget, LIMITS.pointsPerTurn - this.pointsThisTurn);
        const n = Math.min(Math.floor(o.pts.length / 3), Math.max(0, room));
        if (n <= 0) return null;
        const pts: number[] = [];
        for (let i = 0; i < n; i++) pts.push(x(o.pts[i * 3]), y(o.pts[i * 3 + 1]), pr(o.pts[i * 3 + 2]));
        return { k: "pts", id, pts };
      }
      case "end":
        return id >= 0 ? { k: "end", id } : null;
      case "fill":
        if (typeof o.color !== "string" || !HEX.test(o.color)) return null;
        return { k: "fill", x: Math.round(num(o.x, 0, CANVAS_W - 1)), y: Math.round(num(o.y, 0, CANVAS_H - 1)), color: o.color };
      case "undo":
        return { k: "undo" };
      case "clear":
        return { k: "clear" };
      default:
        return null;
    }
  }

  private finishStroke(): void {
    if (this.stroke) {
      const { color, size, pts } = this.stroke;
      this.actions.push({ t: "stroke", color, size, pts });
      this.stroke = null;
    }
  }

  /** Mirrors the client's DrawingEngine so replays match what everyone saw. */
  private applyOp(op: DrawOp): void {
    switch (op.k) {
      case "begin":
        this.finishStroke();
        this.stroke = { id: op.id, color: op.color, size: op.size, pts: [op.x, op.y, op.p] };
        this.pointsThisTurn++;
        break;
      case "pts":
        if (this.stroke && this.stroke.id === op.id) {
          this.stroke.pts.push(...op.pts);
          this.pointsThisTurn += op.pts.length / 3;
        }
        break;
      case "end":
        if (this.stroke && this.stroke.id === op.id) this.finishStroke();
        break;
      case "fill":
        this.finishStroke();
        this.actions.push({ t: "fill", x: op.x, y: op.y, color: op.color });
        break;
      case "undo":
        this.finishStroke();
        this.actions.pop();
        break;
      case "clear":
        this.finishStroke();
        this.actions.push({ t: "clear" });
        break;
    }
  }

  /** Canvas actions so far (for tests and diagnostics). */
  get canvasActions(): readonly DrawAction[] {
    return this.actions;
  }

  /* ---------------------------------------------------------------- */
  /* Chat and guessing                                                 */
  /* ---------------------------------------------------------------- */

  handleChat(byId: string, raw: unknown): void {
    const p = this.players.get(byId);
    if (!p) return;
    const text = sanitizeText(raw, LIMITS.message);
    if (!text) return;
    if (!p.chatLimit.take()) {
      this.io.send(byId, "chat", this.msg("warn", "Slow down! You're sending messages too fast."));
      return;
    }

    if (this.phase === "drawing" && this.word) {
      const isDrawer = byId === this.drawerId;
      if (isDrawer && containsWord(text, this.word)) {
        this.io.send(byId, "chat", this.msg("warn", "You can't say the word while drawing."));
        return;
      }
      if (isDrawer || p.guessed) {
        const m = this.msg("guessed", maskProfanity(text), p);
        for (const other of this.players.values()) {
          if (other.id === this.drawerId || other.guessed) this.io.send(other.id, "chat", m);
        }
        return;
      }
      if (isCorrectGuess(text, this.word)) return this.correctGuess(p);
      this.io.broadcast("chat", [this.msg("chat", maskProfanity(text), p)]);
      if (isCloseGuess(text, this.word)) this.io.send(byId, "chat", this.msg("close", `"${text}" is so close!`));
      return;
    }
    this.io.broadcast("chat", [this.msg("chat", maskProfanity(text), p)]);
  }

  private correctGuess(p: Player): void {
    const order = this.guessOrder.length;
    const remaining = (this.phaseEndsAt ?? 0) - Date.now();
    const pts = guesserPoints(remaining, this.settings.drawTime * 1000, order);
    p.guessed = true;
    p.score += pts;
    this.guessOrder.push(p.id);
    this.gains.set(p.id, pts);
    this.kickVotes.delete(p.id);
    this.io.broadcast("chat", [this.msg("correct", `${p.name} guessed the word!`, p)]);
    this.io.broadcast("fx:guessed", [{ playerId: p.id, points: pts }]);
    if (this.allGuessed()) this.endTurn("all_guessed");
    else this.sync();
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
    const me = this.players.get(playerId);
    const seesWord = playerId === this.drawerId || !!me?.guessed;
    const players: PlayerView[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      guessed: p.guessed,
      isHost: p.id === this.hostId,
      kickVotes: this.kickVotes.get(p.id)?.size ?? 0,
    }));
    const drawing = this.phase === "drawing" && !!this.word;
    return {
      code: this.code,
      isPublic: this.isPublic,
      you: playerId,
      hostId: this.hostId,
      settings: this.settings,
      players,
      phase: this.phase,
      round: this.round,
      drawerId: this.drawerId,
      pattern: drawing && this.settings.wordMode !== "hidden" ? maskWord(this.word!, this.revealed) : null,
      word: drawing && seesWord ? this.word : this.phase === "reveal" ? this.reveal?.word ?? null : null,
      choices: this.phase === "choosing" && playerId === this.drawerId ? this.choices : null,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: Date.now(),
      reveal: this.phase === "reveal" ? this.reveal : null,
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

  private msg(kind: ChatKind, text: string, from?: Player): ChatMessage {
    return { id: ++this.msgId, kind, text, playerId: from?.id, name: from?.name };
  }

  private system(text: string): void {
    this.io.broadcast("chat", [this.msg("system", text)]);
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(
      setTimeout(() => {
        if (!this.disposed) fn();
      }, ms),
    );
  }

  private clearTimers(): void {
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
