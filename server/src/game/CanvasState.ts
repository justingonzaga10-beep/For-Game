import { CANVAS_H, CANVAS_W, LIMITS, isBrushKind, type BrushKind, type DrawAction, type DrawOp } from "@inkwave/shared";

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, min: number, max: number, fallback = 0) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One canvas as the server sees it: validates untrusted draw ops, keeps the
 * completed actions (for undo and replay) and the stroke in progress.
 * Mirrors the client's DrawingEngine so replays match what players saw.
 */
export class CanvasState {
  private actionsList: DrawAction[] = [];
  private stroke: { id: number; color: string; size: number; pts: number[]; brush?: BrushKind } | null = null;
  private points = 0;

  constructor(private readonly maxPoints: number = LIMITS.pointsPerTurn) {}

  get actions(): readonly DrawAction[] {
    return this.actionsList;
  }

  /** Completed actions plus the stroke in progress, as one list (for submitting a drawing). */
  snapshot(): DrawAction[] {
    const out = [...this.actionsList];
    if (this.stroke) out.push(this.strokeAction({ ...this.stroke, pts: [...this.stroke.pts] }));
    return out;
  }

  /** Starts from saved actions (a player coming back after a reload). */
  load(actions: readonly DrawAction[]): void {
    this.reset();
    this.actionsList = actions.map((a) => (a.t === "stroke" ? { ...a, pts: [...a.pts] } : { ...a }));
    for (const a of this.actionsList) if (a.t === "stroke") this.points += a.pts.length / 3;
  }

  reset(): void {
    this.actionsList = [];
    this.stroke = null;
    this.points = 0;
  }

  /** Drops the stroke in progress without saving it (end of turn). */
  dropStroke(): void {
    this.stroke = null;
  }

  /** Ops that recreate the stroke in progress on a freshly replayed canvas, if any. */
  liveStrokeOps(): DrawOp[] {
    if (!this.stroke || this.stroke.pts.length < 3) return [];
    const [x, y, p, ...rest] = this.stroke.pts;
    const { id, color, size, brush } = this.stroke;
    return [
      { k: "begin", id, color, size, x, y, p, ...(brush ? { brush } : {}) },
      { k: "pts", id, pts: rest },
    ];
  }

  /** Validates and applies one batch from a client; returns the clean ops to relay. */
  ingest(raw: unknown[]): DrawOp[] {
    const clean: DrawOp[] = [];
    let batchPoints = 0;
    for (const op of raw.slice(0, LIMITS.opsPerBatch)) {
      const c = this.sanitizeOp(op, LIMITS.pointsPerBatch - batchPoints);
      if (!c) continue;
      if (c.k === "pts") batchPoints += c.pts.length / 3;
      this.applyOp(c);
      clean.push(c);
    }
    return clean;
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
        return {
          k: "begin",
          id,
          color: o.color,
          size: num(o.size, 1, 60, 8),
          x: x(o.x),
          y: y(o.y),
          p: pr(o.p),
          // A texture other than the plain pen; anything unknown draws as a pen.
          ...(isBrushKind(o.brush) && o.brush !== "pen" ? { brush: o.brush } : {}),
        };
      case "pts": {
        if (id < 0 || !Array.isArray(o.pts)) return null;
        const room = Math.min(pointBudget, this.maxPoints - this.points);
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

  private strokeAction(s: { color: string; size: number; pts: number[]; brush?: BrushKind }): DrawAction {
    return { t: "stroke", color: s.color, size: s.size, pts: s.pts, ...(s.brush ? { brush: s.brush } : {}) };
  }

  private finishStroke(): void {
    if (this.stroke) {
      this.actionsList.push(this.strokeAction(this.stroke));
      this.stroke = null;
    }
  }

  private applyOp(op: DrawOp): void {
    switch (op.k) {
      case "begin":
        this.finishStroke();
        this.stroke = { id: op.id, color: op.color, size: op.size, pts: [op.x, op.y, op.p], ...(op.brush ? { brush: op.brush } : {}) };
        this.points++;
        break;
      case "pts":
        if (this.stroke && this.stroke.id === op.id) {
          this.stroke.pts.push(...op.pts);
          this.points += op.pts.length / 3;
        }
        break;
      case "end":
        if (this.stroke && this.stroke.id === op.id) this.finishStroke();
        break;
      case "fill":
        this.finishStroke();
        this.actionsList.push({ t: "fill", x: op.x, y: op.y, color: op.color });
        break;
      case "undo":
        this.finishStroke();
        this.actionsList.pop();
        break;
      case "clear":
        this.finishStroke();
        this.actionsList.push({ t: "clear" });
        break;
    }
  }
}
