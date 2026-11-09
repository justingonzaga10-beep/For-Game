import { CANVAS_H, CANVAS_W } from "./constants";
import type { DrawAction } from "./types";

/**
 * Perimeter mode shapes. All lengths are whole numbers in the room's unit.
 *
 * Basic:
 *  - rect:     [length, width]
 *  - square:   [side]
 *  - triangle: [bottom, left, right]
 * Composite (simple shapes joined together):
 *  - lshape:   [width, height, cutWidth, cutHeight]   a rectangle with its top-right corner cut out
 *  - tshape:   [ledge, stemWidth, topHeight, stemHeight]   a bar on a centred stem; top width = 2 × ledge + stem
 *  - ushape:   [armWidth, gapWidth, height, baseHeight]   two arms on a base; total width = 2 × arm + gap
 *  - house:    [width, wallHeight, roofSide]   a rectangle with a triangle roof (both roof sides equal)
 * Area mode uses height instead of slanted sides:
 *  - righttri: [base, height]   a right triangle
 *  - househ:   [width, wallHeight, roofHeight]   a house whose roof is given by its height
 */
export type ShapeKind = "rect" | "square" | "triangle" | "lshape" | "tshape" | "ushape" | "house" | "righttri" | "househ";
export type Measure = "perimeter" | "area";
/** Shapes offered in each mode, grouped as the lobby and builder show them. */
export const MEASURE_SHAPES: Record<Measure, { basic: ShapeKind[]; composite: ShapeKind[] }> = {
  perimeter: { basic: ["rect", "square", "triangle"], composite: ["lshape", "tshape", "ushape", "house"] },
  area: { basic: ["rect", "square", "righttri"], composite: ["lshape", "tshape", "ushape", "househ"] },
};
export const kindsFor = (m: Measure): ShapeKind[] => [...MEASURE_SHAPES[m].basic, ...MEASURE_SHAPES[m].composite];
export const BASIC_SHAPES: ShapeKind[] = MEASURE_SHAPES.perimeter.basic;
export const COMPOSITE_SHAPES: ShapeKind[] = MEASURE_SHAPES.perimeter.composite;
export const SHAPE_KINDS: ShapeKind[] = ["rect", "square", "triangle", "lshape", "tshape", "ushape", "house", "righttri", "househ"];
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: "Rectangle",
  square: "Square",
  triangle: "Triangle",
  lshape: "L-shape",
  tshape: "T-shape",
  ushape: "U-shape",
  house: "House",
  righttri: "Right triangle",
  househ: "House",
};
/** Names of each number the drawer sets, in order. */
export const SHAPE_PARAMS: Record<ShapeKind, string[]> = {
  rect: ["Length", "Width"],
  square: ["Side"],
  triangle: ["Bottom", "Left side", "Right side"],
  lshape: ["Width", "Height", "Cut width", "Cut height"],
  tshape: ["Ledge (each side)", "Stem width", "Top height", "Stem height"],
  ushape: ["Arm width", "Gap width", "Height", "Base height"],
  house: ["Width", "Wall height", "Roof side"],
  righttri: ["Base", "Height"],
  househ: ["Width", "Wall height", "Roof height"],
};
/** Shapes where the drawer may hide one measurement (it can be worked out from the others). */
export const HIDEABLE: ShapeKind[] = ["rect", "lshape", "tshape", "ushape"];
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
    case "tshape": {
      const top = 2 * a + b;
      return [b, d, a, c, top, c, a, d]; // stem bottom, stem right, right ledge, bar right, top, bar left, left ledge, stem left
    }
    case "ushape": {
      const width = 2 * a + b;
      return [width, c, a, c - d, b, c - d, a, c]; // bottom, right, right arm top, inner right, gap bottom, inner left, left arm top, left
    }
    case "house":
      return [a, b, c, c, b]; // bottom, right wall, right roof, left roof, left wall
    case "righttri":
      return [a, Math.hypot(a, b), b]; // base, slanted side, height
    case "househ": {
      const roof = Math.hypot(a / 2, c);
      return [a, b, roof, roof, b];
    }
  }
}

export const perimeterOf = (s: PerimeterShape) => edgeLengths(s).reduce((x, y) => x + y, 0);

/** Which edges show a measurement: a square shows one (all sides are equal); the rest show all. */
export function labelledEdges(s: PerimeterShape): boolean[] {
  return edgeLengths(s).map((_, i) => {
    if (s.kind === "square") return i === 0;
    if (s.kind === "righttri") return i !== 1; // the slanted side isn't needed for area
    if (s.kind === "househ") return i !== 2 && i !== 3; // nor are the roof's slanted sides
    return true;
  });
}

/** Width and height of the whole shape, for the "rectangle around it" shortcut. */
function outerSize(s: PerimeterShape): [number, number] | null {
  const [a, b, c, d] = s.sides;
  if (s.kind === "lshape") return [a, b];
  if (s.kind === "tshape") return [2 * a + b, c + d];
  return null;
}

/**
 * The working: "8 + 3 + 8 + 3 = 22 cm", a shortcut where there is one
 * ("2 × (8 + 3) = 22 cm"), and a note for composite shapes with an inside line.
 */
export function perimeterEquation(s: PerimeterShape, unit: PerimeterUnit): { sum: string; shortcut: string | null; note: string | null } {
  const p = perimeterOf(s);
  const sum = `${edgeLengths(s).join(" + ")} = ${p} ${unit}`;
  const outer = outerSize(s);
  const shortcut =
    s.kind === "rect"
      ? `2 × (${s.sides[0]} + ${s.sides[1]}) = ${p} ${unit}`
      : s.kind === "square"
        ? `4 × ${s.sides[0]} = ${p} ${unit}`
        : outer
          ? `2 × (${outer[0]} + ${outer[1]}) = ${p} ${unit}, the same as the rectangle around it`
          : null;
  const note = s.kind === "house" || s.kind === "tshape" ? "The dashed line is inside the shape, so it isn't part of the perimeter." : null;
  return { sum, shortcut, note };
}

/** True if three lengths can make a real triangle (the two shorter add up to more than the longest). */
export function isTriangle(a: number, b: number, c: number): boolean {
  return a + b > c && a + c > b && b + c > a;
}

/** Explains what is wrong with a shape, or null if it's fine. */
export function shapeProblem(kind: ShapeKind, sides: number[], max: number): string | null {
  const need = SHAPE_PARAMS[kind].length;
  if (sides.length !== need || sides.some((n) => !Number.isInteger(n) || n < 1 || n > max)) return `Use whole numbers from 1 to ${max}.`;
  const [a, b, c, d] = sides;
  if (kind === "triangle" && !isTriangle(a, b, c)) {
    return "These sides can't make a triangle. The two shorter sides must add up to more than the longest one.";
  }
  if (kind === "lshape" && (c >= a || d >= b)) return "The cut must be smaller than the width and the height.";
  if (kind === "tshape" && 2 * a + b > max) return `The top would be ${2 * a + b} long. Make the ledges or the stem smaller (the top can be at most ${max}).`;
  if (kind === "ushape") {
    if (2 * a + b > max) return `The shape would be ${2 * a + b} wide. Make the arms or the gap smaller (at most ${max}).`;
    if (d >= c) return "The base must be shorter than the height, so the gap has some depth.";
  }
  if (kind === "house" && 2 * c <= a) return "The roof sides are too short to meet. Each roof side must be more than half the width.";
  if (kind === "househ" && a < 2) return "Make the house at least 2 wide.";
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
  const top = Math.max(4, max);
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
    case "tshape": {
      const stem = n(1, top - 2);
      const ledge = n(1, Math.floor((top - stem) / 2));
      return { kind, sides: [ledge, stem, n(1, top), n(1, top)], hidden: null };
    }
    case "ushape": {
      const arm = n(1, Math.floor((top - 1) / 2));
      const gap = n(1, top - 2 * arm);
      const height = n(2, top);
      return { kind, sides: [arm, gap, height, n(1, height - 1)], hidden: null };
    }
    case "house": {
      const width = n(2, top);
      return { kind, sides: [width, n(1, top), n(Math.floor(width / 2) + 1, top)], hidden: null };
    }
    case "righttri":
      return { kind, sides: [n(1, top), n(1, top)], hidden: null };
    case "househ":
      return { kind, sides: [n(2, top), n(1, top), n(1, top)], hidden: null };
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

type Pt = [number, number];

/** Corner points in "maths" coordinates (y up), counter-clockwise from the bottom-left. */
function corners(s: PerimeterShape): Pt[] {
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
    case "tshape": {
      const w = 2 * a + b;
      return [[a, 0], [a + b, 0], [a + b, d], [w, d], [w, d + c], [0, d + c], [0, d], [a, d]];
    }
    case "ushape": {
      const w = 2 * a + b;
      return [[0, 0], [w, 0], [w, c], [w - a, c], [w - a, d], [a, d], [a, c], [0, c]];
    }
    case "house": {
      const h = Math.sqrt(Math.max(0, c * c - (a / 2) ** 2));
      return [[0, 0], [a, 0], [a, b], [a / 2, b + h], [0, b]];
    }
    case "righttri":
      return [[0, 0], [a, 0], [0, b]];
    case "househ":
      return [[0, 0], [a, 0], [a, b], [a / 2, b + c], [0, b]];
  }
}

/** Lines inside a composite shape where its parts join (not part of the perimeter). */
function insideLines(s: PerimeterShape): [Pt, Pt][] {
  const [a, b, c, d] = s.sides;
  if (s.kind === "house") return [[[0, b], [a, b]]];
  if (s.kind === "househ") return [[[0, b], [a, b]], [[a / 2, b], [a / 2, b + c]]]; // roof base, roof height
  if (s.kind === "tshape") return [[[a, d], [a + b, d]]];
  return [];
}

/** Extra measurements that aren't sides (a house roof's height), placed beside their line. */
export function shapeExtraLabels(s: PerimeterShape): { at: Pt; length: number }[] {
  if (s.kind !== "househ") return [];
  const toScreen = layout(s);
  const [a, b, c] = s.sides;
  const mid = toScreen([a / 2, b + c / 2]);
  return [{ at: [mid[0] + 48, mid[1]], length: c }];
}

/** A small square marking the right angle of a right triangle. */
export function shapeRightAngle(s: PerimeterShape): Pt[] | null {
  if (s.kind !== "righttri") return null;
  const toScreen = layout(s);
  const o = toScreen([0, 0]);
  const k = 16;
  return [[o[0], o[1] - k], [o[0] + k, o[1] - k], [o[0] + k, o[1]]];
}

/** Scales maths coordinates to the canvas, centred, with room around the shape for labels. */
function layout(s: PerimeterShape): (p: Pt) => Pt {
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
  return ([x, y]) => [ox + (x - minX) * k, oy + (maxY - y) * k];
}

/** The shape drawn to scale and centred on the canvas, with room around it for labels. */
export function shapeGeometry(s: PerimeterShape): ShapeEdge[] {
  const pts = corners(s);
  const toScreen = layout(s);
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
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // Labels are wider than tall, so sit further out beside upright sides.
    const gap = 36 + 24 * Math.abs(nx);
    return { from: a, to: b, length: lengths[i], label: [mid[0] + nx * gap, mid[1] + ny * gap], labelled: labelled[i], hidden: s.hidden === i };
  });
}

/** Inside (joining) lines on the canvas, for composite shapes. */
export function shapeInsideLines(s: PerimeterShape): [Pt, Pt][] {
  const toScreen = layout(s);
  return insideLines(s).map(([p, q]) => [toScreen(p), toScreen(q)]);
}

/**
 * The outline as canvas strokes: each edge straight, equal-side ticks on a
 * square and on a house's roof, and dashed joining lines inside composites.
 */
export function shapeOutline(s: PerimeterShape): DrawAction[] {
  const color = "#2b2b30";
  const edges = shapeGeometry(s);
  const out: DrawAction[] = edges.map((e) => ({ t: "stroke", color, size: 5, pts: [e.from[0], e.from[1], 1, e.to[0], e.to[1], 1] }));
  const tick = (e: ShapeEdge) => {
    const mx = (e.from[0] + e.to[0]) / 2;
    const my = (e.from[1] + e.to[1]) / 2;
    const dx = e.to[0] - e.from[0];
    const dy = e.to[1] - e.from[1];
    const len = Math.hypot(dx, dy) || 1;
    const [px, py] = [(-dy / len) * 10, (dx / len) * 10];
    out.push({ t: "stroke", color, size: 3, pts: [mx - px, my - py, 1, mx + px, my + py, 1] });
  };
  if (s.kind === "square") edges.forEach(tick);
  if (s.kind === "house") [edges[2], edges[3]].forEach(tick); // the two equal roof sides
  const corner = shapeRightAngle(s);
  if (corner) out.push({ t: "stroke", color, size: 3, pts: corner.flatMap(([x, y]) => [x, y, 1]) });
  for (const [p, q] of shapeInsideLines(s)) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const dash = 14;
    const space = 10;
    for (let at = 0; at < len; at += dash + space) {
      const t0 = at / len;
      const t1 = Math.min(1, (at + dash) / len);
      out.push({
        t: "stroke",
        color: "#9a96a0",
        size: 3,
        pts: [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0, 1, p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1, 1],
      });
    }
  }
  return out;
}

/** Reads a typed answer like "22", "22cm", "12.5 cm²" or "40 square m"; null if it isn't one. */
export function parseAnswer(text: string): number | null {
  const m = text
    .trim()
    .match(/^(\d{1,5}(?:[.,]\d)?)\s*(?:(?:sq(?:uare)?\.?\s*)?(?:cm|m|centimet(?:er|re)s?|met(?:er|re)s?|units?)(?:\s*(?:²|2|sq(?:uared)?))?|²)?\.?$/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/* ------------------------------------------------------------------ */
/* Area                                                                */
/* ------------------------------------------------------------------ */

/** Area in square units; may end in .5 for triangles. */
export function areaOf(s: PerimeterShape): number {
  const [a, b, c, d] = s.sides;
  switch (s.kind) {
    case "rect":
      return a * b;
    case "square":
      return a * a;
    case "righttri":
      return (a * b) / 2;
    case "lshape":
      return a * b - c * d;
    case "tshape":
      return (2 * a + b) * c + b * d;
    case "ushape":
      return (2 * a + b) * c - b * (c - d);
    case "househ":
      return a * b + (a * c) / 2;
    case "triangle": {
      const p = (a + b + c) / 2; // Heron's formula (not offered in Area mode)
      return Math.sqrt(Math.max(0, p * (p - a) * (p - b) * (p - c)));
    }
    case "house":
      return a * b + (a * Math.sqrt(Math.max(0, c * c - (a / 2) ** 2))) / 2;
  }
}

/** The correct answer for a mode. */
export const measureOf = (s: PerimeterShape, m: Measure) => (m === "area" ? areaOf(s) : perimeterOf(s));

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The working for an area: "8 × 6 − 3 × 2 = 48 − 6 = 42 cm²", plus a note on how the shape was split. */
export function areaEquation(s: PerimeterShape, unit: PerimeterUnit): { sum: string; shortcut: string | null; note: string | null } {
  const [a, b, c, d] = s.sides;
  const u = `${unit}²`;
  const A = fmt(areaOf(s));
  switch (s.kind) {
    case "rect":
      return { sum: `${a} × ${b} = ${A} ${u}`, shortcut: null, note: "Area of a rectangle = length × width." };
    case "square":
      return { sum: `${a} × ${a} = ${A} ${u}`, shortcut: null, note: "Area of a square = side × side." };
    case "righttri":
      return { sum: `½ × ${a} × ${b} = ${A} ${u}`, shortcut: null, note: "A right triangle is half of a rectangle: ½ × base × height." };
    case "lshape":
      return { sum: `${a} × ${b} − ${c} × ${d} = ${a * b} − ${c * d} = ${A} ${u}`, shortcut: null, note: "Take the cut-out corner away from the whole rectangle." };
    case "tshape": {
      const w = 2 * a + b;
      return { sum: `${w} × ${c} + ${b} × ${d} = ${w * c} + ${b * d} = ${A} ${u}`, shortcut: null, note: "Split it into the top bar and the stem, then add them." };
    }
    case "ushape": {
      const w = 2 * a + b;
      return { sum: `${w} × ${c} − ${b} × ${c - d} = ${w * c} − ${b * (c - d)} = ${A} ${u}`, shortcut: null, note: "Take the gap away from the whole rectangle." };
    }
    case "househ":
      return { sum: `${a} × ${b} + ½ × ${a} × ${c} = ${a * b} + ${fmt((a * c) / 2)} = ${A} ${u}`, shortcut: null, note: "Add the rectangle and the triangle roof (½ × width × height)." };
    default:
      return { sum: `${A} ${u}`, shortcut: null, note: null };
  }
}

/** The parts the reveal shades: added parts (+1) and taken-away parts (−1), on the canvas. */
export function shapeAreaParts(s: PerimeterShape): { pts: Pt[]; sign: 1 | -1 }[] {
  const toScreen = layout(s);
  const [a, b, c, d] = s.sides;
  const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const parts: { pts: Pt[]; sign: 1 | -1 }[] = [];
  switch (s.kind) {
    case "lshape":
      parts.push({ pts: box(0, 0, a, b), sign: 1 }, { pts: box(a - c, b - d, a, b), sign: -1 });
      break;
    case "tshape":
      parts.push({ pts: box(0, d, 2 * a + b, d + c), sign: 1 }, { pts: box(a, 0, a + b, d), sign: 1 });
      break;
    case "ushape":
      parts.push({ pts: box(0, 0, 2 * a + b, c), sign: 1 }, { pts: box(a, d, a + b, c), sign: -1 });
      break;
    case "househ":
      parts.push({ pts: box(0, 0, a, b), sign: 1 }, { pts: [[0, b], [a, b], [a / 2, b + c]], sign: 1 });
      break;
    default:
      parts.push({ pts: corners(s), sign: 1 });
  }
  return parts.map((p) => ({ sign: p.sign, pts: p.pts.map(toScreen) }));
}
