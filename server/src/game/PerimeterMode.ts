import {
  TIMING,
  areaEquation,
  cleanShape,
  kindsFor,
  measureOf,
  parseAnswer,
  perimeterEquation,
  perimeterOf,
  randomShape,
  type DrawAction,
  type Measure,
  type ShapeKind,
  type PerimeterShape,
  type RevealInfo,
  type TurnEndReason,
} from "@inkwave/shared";
import { CanvasState } from "./CanvasState";
import type { GameMode, ModeView, Player, RoomContext } from "./GameMode";
import { maskProfanity } from "./profanity";
import { TokenBucket } from "./rateLimit";
import { drawerPoints, guesserPoints } from "./scoring";

/** An answer this close (or within 10%) gets a private "Close!" instead of "Not quite". */
export function isCloseAnswer(value: number, answer: number): boolean {
  return value !== answer && Math.abs(value - answer) <= Math.max(2, Math.round(answer * 0.1));
}

/** How an answer is written: "42", or "12.5" for half squares. */
export const formatAnswer = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Perimeter (and Area, with measure "area"): each turn one player makes a shape with measurements (a
 * rectangle 8 cm by 3 cm, a triangle, an L-shape…) and decorates it, while
 * everyone else works out its perimeter. Faster correct answers score more;
 * the reveal shows the working, side by side.
 */
export class PerimeterMode implements GameMode {
  readonly minPlayers = 2;
  readonly tooFewPlayersMessage = "You need at least 2 players to start.";

  drawerId: string | null = null;
  shape: PerimeterShape | null = null;
  reveal: RevealInfo | null = null;

  /** Drawing order for the current round. */
  private order: string[] = [];
  private orderIndex = -1;
  private solveOrder: string[] = [];
  private gains = new Map<string, number>();
  private canvas = new CanvasState();
  private answerLimits = new Map<string, TokenBucket>();
  /** Increments every turn, so a returning player's "already solved" only applies to the same turn. */
  private turnId = 0;

  constructor(
    private readonly room: RoomContext,
    readonly measure: Measure = "perimeter",
  ) {}

  get correctAnswer(): number | null {
    return this.shape ? measureOf(this.shape, this.measure) : null;
  }

  /** "perimeter" or "area", for messages. */
  private get noun(): string {
    return this.measure;
  }

  /** The room's chosen shapes that this mode offers (all of them if none are chosen). */
  get kinds(): ShapeKind[] {
    const mine = kindsFor(this.measure);
    const chosen = mine.filter((k) => this.room.settings.perimeterShapes.includes(k));
    return chosen.length ? chosen : mine;
  }

  private unitLabel(): string {
    const u = this.room.settings.perimeterUnit;
    return this.measure === "area" ? `${u}²` : u;
  }

  private equation(shape: PerimeterShape) {
    const u = this.room.settings.perimeterUnit;
    return this.measure === "area" ? areaEquation(shape, u) : perimeterEquation(shape, u);
  }

  get canvasActions(): readonly DrawAction[] {
    return this.canvas.actions;
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  start(): void {
    this.order = [...this.room.players.keys()];
    this.orderIndex = -1;
    this.nextTurn();
  }

  reset(): void {
    this.drawerId = null;
    this.shape = null;
    this.reveal = null;
    this.canvas.reset();
  }

  private inTurn(): boolean {
    const p = this.room.phase;
    return p === "perim_build" || p === "perim_solve" || p === "perim_reveal";
  }

  onJoin(p: Player, rejoin?: { oldId: string; data: unknown }): void {
    const phase = this.room.phase;
    const saved = rejoin?.data as { solvedTurn: number | null } | undefined;
    // Back in the same turn they already solved: no second answer.
    if (rejoin && saved && saved.solvedTurn === this.turnId && phase === "perim_solve") {
      p.guessed = true;
      this.solveOrder = this.solveOrder.map((id) => (id === rejoin.oldId ? p.id : id));
      const gained = this.gains.get(rejoin.oldId);
      if (gained !== undefined) this.gains.set(p.id, gained);
    }
    if (this.inTurn() && !this.order.includes(p.id)) this.order.push(p.id);
    this.room.io.send(p.id, "draw:replay", phase === "perim_solve" || phase === "perim_reveal" ? [...this.canvas.actions] : []);
    if (phase === "perim_solve") {
      const live = this.canvas.liveStrokeOps();
      if (live.length) this.room.io.send(p.id, "draw", live);
    }
  }

  ghostData(p: Player): unknown {
    return p.guessed ? { solvedTurn: this.turnId } : null;
  }

  onLeave(playerId: string): boolean {
    const phase = this.room.phase;
    this.answerLimits.delete(playerId);
    if (this.drawerId === playerId && (phase === "perim_build" || phase === "perim_solve")) {
      this.endTurn("drawer_left");
      return true;
    }
    if (phase === "perim_solve" && this.allSolved()) {
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
    this.shape = null;
    this.reveal = null;
    this.solveOrder = [];
    this.gains = new Map();
    this.canvas.reset();
    for (const p of room.players.values()) p.guessed = false;

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
    room.setPhase("perim_build", Date.now() + TIMING.perimeterBuildSeconds * 1000);
    room.io.broadcast("draw:replay", [[]]);
    room.system(`${room.players.get(next)!.name} is making a shape`);
    room.later(TIMING.perimeterBuildSeconds * 1000, () => {
      // Out of time: use a random shape so the turn goes on.
      if (room.phase === "perim_build") this.beginSolve(randomShape(this.kinds, room.settings.perimeterMax, room.rand));
    });
    room.sync();
  }

  submitShape(byId: string, input: unknown): void {
    const room = this.room;
    if (room.phase !== "perim_build" || byId !== this.drawerId) return;
    const shape = cleanShape(input, { kinds: this.kinds, max: room.settings.perimeterMax, challenge: room.settings.perimeterChallenge });
    if (!shape) {
      room.io.send(byId, "notice", "That shape doesn't work. Check the numbers and try again.");
      return;
    }
    this.beginSolve(shape);
  }

  private beginSolve(shape: PerimeterShape): void {
    const room = this.room;
    room.clearTimers();
    this.shape = shape;
    const ms = room.settings.perimeterTime * 1000;
    room.setPhase("perim_solve", Date.now() + ms);
    room.system(`Find the ${this.noun}!`);
    room.later(ms, () => this.endTurn("time"));
    room.sync();
  }

  private allSolved(): boolean {
    const solvers = [...this.room.players.values()].filter((p) => p.id !== this.drawerId);
    return solvers.length > 0 && solvers.every((p) => p.guessed);
  }

  private endTurn(reason: TurnEndReason): void {
    const room = this.room;
    if (room.phase !== "perim_build" && room.phase !== "perim_solve") return;
    room.clearTimers();
    if (!this.shape) {
      room.system("The drawer left before making a shape.");
      return this.nextTurn();
    }
    const drawer = this.drawerId ? room.players.get(this.drawerId) : undefined;
    if (drawer && reason !== "drawer_left") {
      const pts = drawerPoints(this.solveOrder.filter((id) => room.players.has(id)).length, room.players.size - 1);
      drawer.score += pts;
      this.gains.set(drawer.id, pts);
    }
    const gains: Record<string, number> = {};
    for (const p of room.players.values()) gains[p.id] = this.gains.get(p.id) ?? 0;
    this.reveal = { word: `${formatAnswer(this.correctAnswer ?? 0)} ${this.unitLabel()}`, reason, gains };
    this.canvas.dropStroke();
    room.setPhase("perim_reveal", Date.now() + TIMING.perimeterRevealSeconds * 1000);
    room.system(`The ${this.noun} was ${this.equation(this.shape).sum}`);
    room.later(TIMING.perimeterRevealSeconds * 1000, () => this.nextTurn());
    room.sync();
  }

  /* ---------------------------------------------------------------- */
  /* Answers, drawing and chat                                         */
  /* ---------------------------------------------------------------- */

  answer(byId: string, value: unknown): void {
    const room = this.room;
    const p = room.players.get(byId);
    if (room.phase !== "perim_solve" || !this.shape || !p || byId === this.drawerId || p.guessed) return;
    const n = Number(value);
    // Whole numbers, or halves for area (a triangle can be 12.5 cm²).
    if (!Number.isFinite(n) || n < 0 || n > 100000 || !Number.isInteger(this.measure === "area" ? n * 2 : n)) return;
    let limit = this.answerLimits.get(byId);
    if (!limit) this.answerLimits.set(byId, (limit = new TokenBucket(4, 0.8)));
    if (!limit.take()) {
      room.io.send(byId, "chat", room.msg("warn", `Slow down! Take a moment to check your ${this.measure === "area" ? "multiplying" : "adding"}.`));
      return;
    }
    const answer = measureOf(this.shape, this.measure);
    if (n === answer) return this.solved(p);
    // A common slip in Area: working out the perimeter instead.
    const mixup = this.measure === "area" && n === perimeterOf(this.shape);
    room.io.send(byId, "perim:feedback", { result: mixup ? "mixup" : isCloseAnswer(n, answer) ? "close" : "wrong", value: n });
  }

  private solved(p: Player): void {
    const room = this.room;
    const pts = guesserPoints((room.phaseEndsAt ?? 0) - Date.now(), room.settings.perimeterTime * 1000, this.solveOrder.length);
    p.guessed = true;
    p.score += pts;
    this.solveOrder.push(p.id);
    this.gains.set(p.id, pts);
    room.forgiveKickVotes(p.id);
    room.io.send(p.id, "perim:feedback", { result: "correct", value: this.correctAnswer ?? 0 });
    room.io.broadcast("chat", [room.msg("correct", `${p.name} found the ${this.noun}!`, p)]);
    room.io.broadcast("fx:guessed", [{ playerId: p.id, points: pts }]);
    if (this.allSolved()) this.endTurn("all_guessed");
    else room.sync();
  }

  handleDraw(byId: string, ops: unknown[]): void {
    // The drawer decorates their shape while the others solve.
    if (this.room.phase !== "perim_solve" || byId !== this.drawerId) return;
    const p = this.room.players.get(byId);
    if (!p || !p.drawLimit.take()) return;
    const clean = this.canvas.ingest(ops);
    if (clean.length) this.room.io.broadcast("draw", [clean], byId);
  }

  handleChat(p: Player, text: string): boolean {
    const room = this.room;
    if (room.phase !== "perim_solve" || !this.shape) return false;
    const answer = formatAnswer(measureOf(this.shape, this.measure)).replace(".", "[.,]");
    const isDrawer = p.id === this.drawerId;
    if (isDrawer && new RegExp(`(^|[^\\d.,])${answer}(?![.,]?\\d)`).test(text)) {
      room.io.send(p.id, "chat", room.msg("warn", "You can't give away the answer."));
      return true;
    }
    if (isDrawer || p.guessed) {
      // Players who know the answer chat among themselves, like in Guessing.
      const m = room.msg("guessed", maskProfanity(text), p);
      for (const other of room.players.values()) if (other.id === this.drawerId || other.guessed) room.io.send(other.id, "chat", m);
      return true;
    }
    const n = parseAnswer(text);
    if (n !== null) {
      // A number typed in chat counts as an answer, and stays private.
      this.answer(p.id, n);
      return true;
    }
    return false;
  }

  view(playerId: string): ModeView {
    const phase = this.room.phase;
    const me = this.room.players.get(playerId);
    const knows = playerId === this.drawerId || !!me?.guessed || phase === "perim_reveal";
    const unit = this.room.settings.perimeterUnit;
    const measure = this.measure;
    return {
      drawerId: this.drawerId,
      pattern: null,
      word: null,
      choices: null,
      reveal: phase === "perim_reveal" ? this.reveal : null,
      drawOff: null,
      perimeter: this.inTurn()
        ? {
            measure,
            shape: phase === "perim_build" ? null : this.shape,
            unit,
            answer: knows ? this.correctAnswer : null,
            equation: phase === "perim_reveal" && this.shape ? this.equation(this.shape) : null,
          }
        : null,
    };
  }
}
