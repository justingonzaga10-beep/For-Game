import { CANVAS_H, CANVAS_W } from "./constants";
import type { DrawAction } from "./types";

/**
 * Perimeter mode shapes. All lengths are whole numbers in the room's unit.
 *  - rect:     [length, width]
 *  - square:   [side]
 *  - triangle: [bottom, left, right]
 *  - lshape:   [width, height, cutWidth, cutHeight] (a rectangle with its top-right corner cut out)
 */
export type ShapeKind = "rect" | "square" | "triangle" | "lshape";
export const SHAPE_KINDS: ShapeKind[] = ["rect", "square", "triangle", "lshape"];
export const SHAPE_LABELS: Record<ShapeKind, string> = { rect: "Rectangle", square: "Square", triangle: "Triangle", lshape: "L-shape" };
/** Names of each number the drawer sets, in order. */
export const SHAPE_PARAMS: Record<ShapeKind, string[]> = {
  rect: ["Length", "Width"],
  square: ["Side"],
  triangle: ["Bottom", "Left side", "Right side"],
  lshape: ["Width", "Height", "Cut width", "Cut height"],
};
/** Shapes where the drawer may hide one measurement (it can be worked out from the others). */
export const HIDEABLE: ShapeKind[] = ["rect", "lshape"];
export type PerimeterUnit = "cm" | "m";
export const PERIMETER_MAXES = [10, 20, 50] as const;

export interface PerimeterShape {
  kind: ShapeKind;
  sides: number[];
  /** Index of an edge whose label is hidden ("?"), or null. */
  hidden: number | null;
}

/** Edge lengths in drawing order (counter-clockwise from the bottom). */
export function edgeLengths(s: PerimeterShape): number[] {
  const [a, b, c, d] = s.sides;
  switch (s.kind) {
    case "rect":
      return [a, b, a, b];
    case "square":
      return [a, a, a, a];
    case "triangle":
      return [a, c, b]; // bottom, right, left
    case "lshape":
      return [a, b - d, c, d, a - c, b]; // bottom, right, cut bottom, cut side, top, left
  }
}

export const perimeterOf = (s: PerimeterShape) => edgeLengths(s).reduce((x, y) => x + y, 0);

/** Which edges show a measurement: a square shows one (all sides are equal); the rest show all. */
export function labelledEdges(s: PerimeterShape): boolean[] {
  return edgeLengths(s).map((_, i) => (s.kind === "square" ? i === 0 : true));
}

/** "8 + 3 + 8 + 3 = 22 cm", plus a shortcut where there is one ("2 × (8 + 3) = 22 cm"). */
export function perimeterEquation(s: PerimeterShape, unit: PerimeterUnit): { sum: string; shortcut: string | null } {
  const p = perimeterOf(s);
  const sum = `${edgeLengths(s).join(" + ")} = ${p} ${unit}`;
  const shortcut =
    s.kind === "rect" ? `2 × (${s.sides[0]} + ${s.sides[1]}) = ${p} ${unit}` : s.kind === "square" ? `4 × ${s.sides[0]} = ${p} ${unit}` : null;
  return { sum, shortcut };
}

/** True if three lengths can make a real triangle (the two shorter add up to more than the longest). */
export function isTriangle(a: number, b: number, c: number): boolean {
  return a + b > c && a + c > b && b + c > a;
}

/** Explains what is wrong with a shape, or null if it's fine. */
export function shapeProblem(kind: ShapeKind, sides: number[], max: number): string | null {
  const need = SHAPE_PARAMS[kind].length;
  if (sides.length !== need || sides.some((n) => !Number.isInteger(n) || n < 1 || n > max)) return `Use whole numbers from 1 to ${max}.`;
  if (kind === "triangle" && !isTriangle(sides[0], sides[1], sides[2])) {
    return "These sides can't make a triangle. The two shorter sides must add up to more than the longest one.";
  }
  if (kind === "lshape" && (sides[2] >= sides[0] || sides[3] >= sides[1])) return "The cut must be smaller than the width and the height.";
  return null;
}

/** Turns untrusted input into a valid shape for the room's settings, or null. */
export function cleanShape(input: unknown, opts: { kinds: ShapeKind[]; max: number; challenge: boolean }): PerimeterShape | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const kind = o.kind as ShapeKind;
  if (!SHAPE_KINDS.includes(kind) || !opts.kinds.includes(kind)) return null;
  const sides = Array.isArray(o.sides) ? o.sides.map((n) => Number(n)) : [];
  if (shapeProblem(kind, sides, opts.max)) return null;
  const shape: PerimeterShape = { kind, sides, hidden: null };
  const h = o.hidden;
  if (h !== null && h !== undefined) {
    const i = Number(h);
    if (!opts.challenge || !HIDEABLE.includes(kind) || !Number.isInteger(i) || i < 0 || i >= edgeLengths(shape).length) return null;
    shape.hidden = i;
  }
  return shape;
}

/** A random valid shape (for the dice button and when the drawer runs out of time). */
export function randomShape(kinds: ShapeKind[], max: number, rand: () => number = Math.random): PerimeterShape {
  const pool = kinds.length ? kinds : SHAPE_KINDS;
  const kind = pool[Math.floor(rand() * pool.length)];
  const n = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const top = Math.max(2, max);
  switch (kind) {
    case "rect": {
      const l = n(2, top);
      let w = n(1, top);
      if (w === l) w = w > 1 ? w - 1 : w + 1; // a rectangle that isn't a square
      return { kind, sides: [l, Math.min(w, top)], hidden: null };
    }
    case "square":
      return { kind, sides: [n(1, top)], hidden: null };
    case "triangle": {
      for (;;) {
        const a = n(2, top);
        const b = n(2, top);
        const lo = Math.abs(a - b) + 1;
        const hi = Math.min(top, a + b - 1);
        if (lo <= hi) return { kind, sides: [a, b, n(lo, hi)], hidden: null };
      }
    }
    case "lshape": {
      const W = n(2, top);
      const H = n(2, top);
      return { kind, sides: [W, H, n(1, W - 1), n(1, H - 1)], hidden: null };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Geometry on the 800×600 canvas                                      */
/* ------------------------------------------------------------------ */

export interface ShapeEdge {
  from: [number, number];
  to: [number, number];
  length: number;
  /** Where its label goes, just outside the shape. */
  label: [number, number];
  labelled: boolean;
  hidden: boolean;
}

/** Corner points in "maths" coordinates (y up), counter-clockwise from the bottom-left. */
function corners(s: PerimeterShape): [number, number][] {
  const [a, b, c, d] = s.sides;
  switch (s.kind) {
    case "rect":
      return [[0, 0], [a, 0], [a, b], [0, b]];
    case "square":
      return [[0, 0], [a, 0], [a, a], [0, a]];
    case "triangle": {
      // Bottom a, left b (from the bottom-left corner), right c.
      const x = (a * a + b * b - c * c) / (2 * a);
      const y = Math.sqrt(Math.max(0, b * b - x * x));
      return [[0, 0], [a, 0], [x, y]];
    }
    case "lshape":
      return [[0, 0], [a, 0], [a, b - d], [a - c, b - d], [a - c, b], [0, b]];
  }
}

/** The shape drawn to scale and centred on the canvas, with room around it for labels. */
export function shapeGeometry(s: PerimeterShape): ShapeEdge[] {
  const pts = corners(s);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const MX = 130;
  const MY = 95;
  const k = Math.min((CANVAS_W - 2 * MX) / Math.max(1e-6, maxX - minX), (CANVAS_H - 2 * MY) / Math.max(1e-6, maxY - minY));
  const ox = (CANVAS_W - (maxX - minX) * k) / 2;
  const oy = (CANVAS_H - (maxY - minY) * k) / 2;
  const toScreen = ([x, y]: [number, number]): [number, number] => [ox + (x - minX) * k, oy + (maxY - y) * k];
  const lengths = edgeLengths(s);
  const labelled = labelledEdges(s);
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    // Outward normal of a counter-clockwise edge is (dy, -dx); flip y for the screen.
    const nx = dy / len;
    const ny = -(-dx / len);
    const a = toScreen(p);
    const b = toScreen(q);
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return { from: a, to: b, length: lengths[i], label: [mid[0] + nx * 40, mid[1] + ny * 40], labelled: labelled[i], hidden: s.hidden === i };
  });
}

/** The outline as canvas strokes: each edge straight, plus equal-side ticks on a square. */
export function shapeOutline(s: PerimeterShape): DrawAction[] {
  const color = "#2b2b30";
  const edges = shapeGeometry(s);
  const out: DrawAction[] = edges.map((e) => ({ t: "stroke", color, size: 5, pts: [e.from[0], e.from[1], 1, e.to[0], e.to[1], 1] }));
  if (s.kind === "square") {
    for (const e of edges) {
      const mx = (e.from[0] + e.to[0]) / 2;
      const my = (e.from[1] + e.to[1]) / 2;
      const dx = e.to[0] - e.from[0];
      const dy = e.to[1] - e.from[1];
      const len = Math.hypot(dx, dy) || 1;
      const [px, py] = [(-dy / len) * 10, (dx / len) * 10];
      out.push({ t: "stroke", color, size: 3, pts: [mx - px, my - py, 1, mx + px, my + py, 1] });
    }
  }
  return out;
}

/** Reads a typed answer like "22", "22cm" or "22 m"; null if it isn't one. */
export function parseAnswer(text: string): number | null {
  const m = text.trim().match(/^(\d{1,4})\s*(cm|m|centimet(?:er|re)s?|met(?:er|re)s?|units?)?\.?$/i);
  return m ? Number(m[1]) : null;
}
