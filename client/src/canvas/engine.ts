import { CANVAS_H, CANVAS_W, PAPER, type DrawAction, type DrawOp } from "@inkwave/shared";

/**
 * Every client renders at the same fixed bitmap size (2x the logical
 * 800x600), so strokes and flood fills come out pixel-identical everywhere.
 * CSS scales the element to fit the screen.
 */
export const SCALE = 2;

interface LiveStroke {
  color: string;
  size: number;
  pts: number[];
}

export class DrawingEngine {
  private ctx: CanvasRenderingContext2D;
  private actions: DrawAction[] = [];
  private live = new Map<number, LiveStroke>();
  /** Bumped on every change, so React can subscribe cheaply. */
  version = 0;
  onChange: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = CANVAS_W * SCALE;
    canvas.height = CANVAS_H * SCALE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D is not supported in this browser");
    this.ctx = ctx;
    this.paper();
  }

  get actionCount(): number {
    return this.actions.length;
  }

  /** Replace everything with a list of completed actions (late join, new turn). */
  load(actions: DrawAction[]): void {
    this.actions = actions.slice();
    this.live.clear();
    this.redraw();
  }

  apply(op: DrawOp): void {
    switch (op.k) {
      case "begin": {
        this.finishAll();
        const s: LiveStroke = { color: op.color, size: op.size, pts: [op.x, op.y, op.p] };
        this.live.set(op.id, s);
        this.dot(s);
        break;
      }
      case "pts": {
        const s = this.live.get(op.id);
        if (!s) return;
        for (let i = 0; i + 2 < op.pts.length; i += 3) {
          s.pts.push(op.pts[i], op.pts[i + 1], op.pts[i + 2]);
          this.segment(s, s.pts.length / 3 - 1);
        }
        break;
      }
      case "end":
        this.finish(op.id);
        break;
      case "fill":
        this.finishAll();
        this.actions.push({ t: "fill", x: op.x, y: op.y, color: op.color });
        this.fill(op.x, op.y, op.color);
        break;
      case "undo":
        this.finishAll();
        this.actions.pop();
        this.redraw();
        break;
      case "clear":
        this.finishAll();
        this.actions.push({ t: "clear" });
        this.paper();
        break;
    }
    this.changed();
  }

  /* -------------------------------------------------------------- */

  private changed() {
    this.version++;
    this.onChange?.();
  }

  private finish(id: number) {
    const s = this.live.get(id);
    if (!s) return;
    this.tail(s);
    this.live.delete(id);
    this.actions.push({ t: "stroke", color: s.color, size: s.size, pts: s.pts });
  }

  private finishAll() {
    for (const id of [...this.live.keys()]) this.finish(id);
  }

  private paper() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = PAPER;
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  }

  private redraw() {
    this.paper();
    for (const a of this.actions) {
      if (a.t === "clear") this.paper();
      else if (a.t === "fill") this.fill(a.x, a.y, a.color);
      else this.renderStroke(a);
    }
    for (const s of this.live.values()) {
      this.dot(s);
      for (let i = 1; i < s.pts.length / 3; i++) this.segment(s, i);
    }
  }

  private renderStroke(s: LiveStroke) {
    this.dot(s);
    const n = s.pts.length / 3;
    for (let i = 1; i < n; i++) this.segment(s, i);
    this.tail(s);
  }

  /* Smoothing: quadratic curves through the midpoints of consecutive points. */

  private pt(s: LiveStroke, i: number) {
    return { x: s.pts[i * 3], y: s.pts[i * 3 + 1], p: s.pts[i * 3 + 2] };
  }

  private style(s: LiveStroke, pressure: number) {
    const c = this.ctx;
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = Math.max(1, s.size * pressure);
  }

  private dot(s: LiveStroke) {
    const p0 = this.pt(s, 0);
    this.style(s, p0.p);
    const c = this.ctx;
    c.beginPath();
    c.arc(p0.x, p0.y, Math.max(0.5, (s.size * p0.p) / 2), 0, Math.PI * 2);
    c.fill();
  }

  /** Draws the piece of the stroke that point i completes. */
  private segment(s: LiveStroke, i: number) {
    const c = this.ctx;
    const a = this.pt(s, i - 1);
    const b = this.pt(s, i);
    this.style(s, (a.p + b.p) / 2);
    c.beginPath();
    if (i === 1) {
      c.moveTo(a.x, a.y);
      c.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2);
    } else {
      const z = this.pt(s, i - 2);
      c.moveTo((z.x + a.x) / 2, (z.y + a.y) / 2);
      c.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    c.stroke();
  }

  /** Closes the gap between the last midpoint and the final point. */
  private tail(s: LiveStroke) {
    const n = s.pts.length / 3;
    if (n < 2) return;
    const a = this.pt(s, n - 2);
    const b = this.pt(s, n - 1);
    const c = this.ctx;
    this.style(s, b.p);
    c.beginPath();
    c.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
    c.lineTo(b.x, b.y);
    c.stroke();
  }

  /* Scanline flood fill with a tolerance, so anti-aliased edges fill cleanly. */

  private fill(lx: number, ly: number, color: string) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const sx = Math.min(W - 1, Math.max(0, Math.floor(lx * SCALE)));
    const sy = Math.min(H - 1, Math.max(0, Math.floor(ly * SCALE)));
    const img = this.ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const [fr, fg, fb] = hexToRgb(color);
    const at = (sy * W + sx) * 4;
    const tr = d[at], tg = d[at + 1], tb = d[at + 2];
    if (tr === fr && tg === fg && tb === fb) return;

    const TOL = 70;
    const seen = new Uint8Array(W * H);
    const match = (i: number) => {
      const o = i * 4;
      return Math.abs(d[o] - tr) <= TOL && Math.abs(d[o + 1] - tg) <= TOL && Math.abs(d[o + 2] - tb) <= TOL;
    };
    const paint = (i: number) => {
      const o = i * 4;
      d[o] = fr;
      d[o + 1] = fg;
      d[o + 2] = fb;
      d[o + 3] = 255;
      seen[i] = 1;
    };

    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop()!;
      let x = stack.pop()!;
      let i = y * W + x;
      while (x >= 0 && !seen[i] && match(i)) {
        x--;
        i--;
      }
      x++;
      i++;
      let up = false;
      let down = false;
      while (x < W && !seen[i] && match(i)) {
        paint(i);
        if (y > 0) {
          const u = i - W;
          if (!seen[u] && match(u)) {
            if (!up) {
              stack.push(x, y - 1);
              up = true;
            }
          } else up = false;
        }
        if (y < H - 1) {
          const dn = i + W;
          if (!seen[dn] && match(dn)) {
            if (!down) {
              stack.push(x, y + 1);
              down = true;
            }
          } else down = false;
        }
        x++;
        i++;
      }
    }
    // Grow the fill by one pixel to swallow the anti-aliasing fringe next to lines.
    const grown = new Uint8Array(seen);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (seen[i]) continue;
        if (seen[i - 1] || seen[i + 1] || seen[i - W] || seen[i + W]) {
          const o = i * 4;
          // Only bleed into pixels that are lighter blends, not into solid line cores.
          const diff = Math.abs(d[o] - tr) + Math.abs(d[o + 1] - tg) + Math.abs(d[o + 2] - tb);
          if (diff < 380) grown[i] = 2;
        }
      }
    }
    for (let i = 0; i < grown.length; i++) if (grown[i] === 2) paint(i);
    this.ctx.putImageData(img, 0, 0);
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
