import {
  TIMING,
  containsWord,
  isCloseGuess,
  isCorrectGuess,
  type DrawAction,
  type RevealInfo,
  type TurnEndReason,
} from "@inkwave/shared";
import { CanvasState } from "./CanvasState";
import type { GameMode, ModeView, Player, RoomContext } from "./GameMode";
import { hintCount, hintSchedule, maskWord, pickHintIndex } from "./hints";
import { maskProfanity } from "./profanity";
import { drawerPoints, guesserPoints } from "./scoring";
import { pickWordChoices } from "./words";

/**
 * The classic mode: each round, every player draws once while the others
 * guess the word in chat. Faster guesses score more.
 */
export class GuessMode implements GameMode {
  readonly minPlayers = 2;
  readonly tooFewPlayersMessage = "You need at least 2 players to start.";

  drawerId: string | null = null;
  word: string | null = null;
  choices: string[] = [];
  reveal: RevealInfo | null = null;

  /** Drawing order for the current round. */
  private order: string[] = [];
  private orderIndex = -1;
  private revealed = new Set<number>();
  private guessOrder: string[] = [];
  private gains = new Map<string, number>();
  private usedWords = new Set<string>();
  private canvas = new CanvasState();
  /** Increments every turn, so a returning player's "already guessed" only applies to the same turn. */
  private turnId = 0;

  constructor(private readonly room: RoomContext) {}

  get canvasActions(): readonly DrawAction[] {
    return this.canvas.actions;
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  start(): void {
    this.usedWords.clear();
    this.order = [...this.room.players.keys()];
    this.orderIndex = -1;
    this.nextTurn();
  }

  reset(): void {
    this.drawerId = null;
    this.word = null;
    this.choices = [];
    this.reveal = null;
    this.canvas.reset();
  }

  onJoin(p: Player, rejoin?: { oldId: string; data: unknown }): void {
    const phase = this.room.phase;
    const saved = rejoin?.data as { guessedTurn: number | null } | undefined;
    // Coming back in the same turn you already guessed in: no second guess.
    if (rejoin && saved && saved.guessedTurn === this.turnId && phase === "drawing") {
      p.guessed = true;
      this.guessOrder = this.guessOrder.map((id) => (id === rejoin.oldId ? p.id : id));
      const gained = this.gains.get(rejoin.oldId);
      if (gained !== undefined) this.gains.set(p.id, gained);
    }
    const inGame = phase === "choosing" || phase === "drawing" || phase === "reveal";
    if (inGame && !this.order.includes(p.id)) this.order.push(p.id);

    // Bring the newcomer's canvas up to date.
    this.room.io.send(p.id, "draw:replay", phase === "drawing" || phase === "reveal" ? [...this.canvas.actions] : []);
    if (phase === "drawing") {
      const live = this.canvas.liveStrokeOps();
      if (live.length) this.room.io.send(p.id, "draw", live);
    }
  }

  ghostData(p: Player): unknown {
    return p.guessed ? { guessedTurn: this.turnId } : null;
  }

  onLeave(playerId: string): boolean {
    const phase = this.room.phase;
    if (this.drawerId === playerId && (phase === "choosing" || phase === "drawing")) {
      this.endTurn("drawer_left");
      return true;
    }
    if (phase === "drawing" && this.allGuessed()) {
      this.endTurn("all_guessed");
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Turns                                                             */
  /* ---------------------------------------------------------------- */

  private nextTurn(): void {
    const room = this.room;
    room.clearTimers();
    this.turnId++;
    this.reveal = null;
    this.word = null;
    this.choices = [];
    this.revealed = new Set();
    this.guessOrder = [];
    this.gains = new Map();
    this.canvas.reset();
    for (const p of room.players.values()) p.guessed = false;

    // Next drawer still in the room, moving to the next round when this one is done.
    let next: string | undefined;
    while (!next) {
      this.orderIndex++;
      if (this.orderIndex >= this.order.length) {
        room.round++;
        if (room.round > room.settings.rounds) return room.endGame();
        this.order = [...room.players.keys()];
        this.orderIndex = 0;
        room.system(`Round ${room.round} of ${room.settings.rounds}`);
      }
      const candidate = this.order[this.orderIndex];
      if (candidate && room.players.has(candidate)) next = candidate;
    }

    this.drawerId = next;
    this.choices = pickWordChoices(room.settings, room.settings.wordChoices, this.usedWords, room.rand);
    room.setPhase("choosing", Date.now() + TIMING.chooseSeconds * 1000);
    room.io.broadcast("draw:replay", [[]]);
    room.system(`${room.players.get(next)!.name} is choosing a word`);
    room.later(TIMING.chooseSeconds * 1000, () => {
      if (room.phase === "choosing") this.beginDrawing(this.choices[Math.floor(room.rand() * this.choices.length)]);
    });
    room.sync();
  }

  chooseWord(byId: string, index: unknown): void {
    if (this.room.phase !== "choosing" || byId !== this.drawerId) return;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= this.choices.length) return;
    this.beginDrawing(this.choices[i]);
  }

  private beginDrawing(word: string): void {
    const room = this.room;
    room.clearTimers();
    this.word = word;
    this.usedWords.add(word);
    const drawMs = room.settings.drawTime * 1000;
    room.setPhase("drawing", Date.now() + drawMs);

    if (room.settings.wordMode !== "hidden") {
      const count = hintCount(word, room.settings.hints);
      for (const at of hintSchedule(drawMs, count)) room.later(at, () => this.revealHint());
    }
    room.later(drawMs, () => this.endTurn("time"));
    room.sync();
  }

  private revealHint(): void {
    if (this.room.phase !== "drawing" || !this.word) return;
    const idx = pickHintIndex(this.word, this.revealed, this.room.rand);
    if (idx === null) return;
    this.revealed.add(idx);
    this.room.sync();
  }

  private allGuessed(): boolean {
    const guessers = [...this.room.players.values()].filter((p) => p.id !== this.drawerId);
    return guessers.length > 0 && guessers.every((p) => p.guessed);
  }

  private endTurn(reason: TurnEndReason): void {
    const room = this.room;
    if (room.phase !== "choosing" && room.phase !== "drawing") return;
    room.clearTimers();
    const drawer = this.drawerId ? room.players.get(this.drawerId) : undefined;

    if (!this.word) {
      // The drawer left before picking: nothing to reveal.
      room.system("The drawer left before choosing a word.");
      return this.nextTurn();
    }

    if (drawer && reason !== "drawer_left") {
      const guessers = room.players.size - 1;
      const pts = drawerPoints(this.guessOrder.filter((id) => room.players.has(id)).length, guessers);
      drawer.score += pts;
      this.gains.set(drawer.id, pts);
    }
    const gains: Record<string, number> = {};
    for (const p of room.players.values()) gains[p.id] = this.gains.get(p.id) ?? 0;

    this.reveal = { word: this.word, reason, gains };
    room.setPhase("reveal", Date.now() + TIMING.revealSeconds * 1000);
    this.canvas.dropStroke();
    room.system(`The word was "${this.word}"`);
    room.later(TIMING.revealSeconds * 1000, () => this.nextTurn());
    room.sync();
  }

  /* ---------------------------------------------------------------- */
  /* Drawing and guessing                                              */
  /* ---------------------------------------------------------------- */

  handleDraw(byId: string, ops: unknown[]): void {
    if (this.room.phase !== "drawing" || byId !== this.drawerId) return;
    const p = this.room.players.get(byId);
    if (!p || !p.drawLimit.take()) return;
    const clean = this.canvas.ingest(ops);
    if (clean.length) this.room.io.broadcast("draw", [clean], byId);
  }

  handleChat(p: Player, text: string): boolean {
    const room = this.room;
    if (room.phase !== "drawing" || !this.word) return false;
    const isDrawer = p.id === this.drawerId;
    if (isDrawer && containsWord(text, this.word)) {
      room.io.send(p.id, "chat", room.msg("warn", "You can't say the word while drawing."));
      return true;
    }
    if (isDrawer || p.guessed) {
      const m = room.msg("guessed", maskProfanity(text), p);
      for (const other of room.players.values()) {
        if (other.id === this.drawerId || other.guessed) room.io.send(other.id, "chat", m);
      }
      return true;
    }
    if (isCorrectGuess(text, this.word)) {
      this.correctGuess(p);
      return true;
    }
    room.io.broadcast("chat", [room.msg("chat", maskProfanity(text), p)]);
    if (isCloseGuess(text, this.word)) room.io.send(p.id, "chat", room.msg("close", `"${text}" is so close!`));
    return true;
  }

  private correctGuess(p: Player): void {
    const room = this.room;
    const order = this.guessOrder.length;
    const remaining = (room.phaseEndsAt ?? 0) - Date.now();
    const pts = guesserPoints(remaining, room.settings.drawTime * 1000, order);
    p.guessed = true;
    p.score += pts;
    this.guessOrder.push(p.id);
    this.gains.set(p.id, pts);
    room.forgiveKickVotes(p.id);
    room.io.broadcast("chat", [room.msg("correct", `${p.name} guessed the word!`, p)]);
    room.io.broadcast("fx:guessed", [{ playerId: p.id, points: pts }]);
    if (this.allGuessed()) this.endTurn("all_guessed");
    else room.sync();
  }

  /* ---------------------------------------------------------------- */
  /* View                                                              */
  /* ---------------------------------------------------------------- */

  view(playerId: string): ModeView {
    const phase = this.room.phase;
    const me = this.room.players.get(playerId);
    const seesWord = playerId === this.drawerId || !!me?.guessed;
    const drawing = phase === "drawing" && !!this.word;
    return {
      drawerId: this.drawerId,
      pattern: drawing && this.room.settings.wordMode !== "hidden" ? maskWord(this.word!, this.revealed) : null,
      word: drawing && seesWord ? this.word : phase === "reveal" ? this.reveal?.word ?? null : null,
      choices: phase === "choosing" && playerId === this.drawerId ? this.choices : null,
      reveal: phase === "reveal" ? this.reveal : null,
      drawOff: null,
    };
  }
}
