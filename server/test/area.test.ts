import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  TIMING,
  areaEquation,
  areaOf,
  cleanShape,
  kindsFor,
  parseAnswer,
  perimeterOf,
  randomShape,
  shapeAreaParts,
  shapeExtraLabels,
  shapeGeometry,
  shapeInsideLines,
  shapeRightAngle,
  type ChatMessage,
  type PerimeterShape,
  type RoomView,
} from "@inkwave/shared";
import { Room, type RoomTransport } from "../src/game/Room";

const AV = { head: 0, color: 0, eyes: 0, mouth: 0, top: 0 };
const shape = (kind: PerimeterShape["kind"], ...sides: number[]): PerimeterShape => ({ kind, sides, hidden: null });

/** Shoelace area of a polygon, for checking the reveal's shaded parts. */
const polyArea = (pts: [number, number][]) => Math.abs(pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

describe("area maths", () => {
  it("works out the area of every shape", () => {
    expect(areaOf(shape("rect", 8, 3))).toBe(24);
    expect(areaOf(shape("square", 5))).toBe(25);
    expect(areaOf(shape("righttri", 6, 4))).toBe(12);
    expect(areaOf(shape("righttri", 5, 3))).toBe(7.5);
    expect(areaOf(shape("lshape", 8, 6, 3, 2))).toBe(42);
    expect(areaOf(shape("tshape", 2, 2, 2, 4))).toBe(6 * 2 + 2 * 4);
    expect(areaOf(shape("ushape", 2, 3, 5, 2))).toBe(7 * 5 - 3 * 3);
    expect(areaOf(shape("househ", 8, 5, 3))).toBe(52);
  });

  it("writes out the working, step by step", () => {
    expect(areaEquation(shape("rect", 8, 3), "cm").sum).toBe("8 × 3 = 24 cm²");
    expect(areaEquation(shape("square", 5), "m").sum).toBe("5 × 5 = 25 m²");
    expect(areaEquation(shape("righttri", 6, 4), "cm").sum).toBe("½ × 6 × 4 = 12 cm²");
    expect(areaEquation(shape("righttri", 5, 3), "cm").sum).toBe("½ × 5 × 3 = 7.5 cm²");
    expect(areaEquation(shape("lshape", 8, 6, 3, 2), "cm").sum).toBe("8 × 6 − 3 × 2 = 48 − 6 = 42 cm²");
    expect(areaEquation(shape("tshape", 2, 2, 2, 4), "cm").sum).toBe("6 × 2 + 2 × 4 = 12 + 8 = 20 cm²");
    expect(areaEquation(shape("ushape", 2, 3, 5, 2), "cm").sum).toBe("7 × 5 − 3 × 3 = 35 − 9 = 26 cm²");
    expect(areaEquation(shape("househ", 8, 5, 3), "cm")).toMatchObject({ sum: "8 × 5 + ½ × 8 × 3 = 40 + 12 = 52 cm²", note: expect.stringContaining("triangle roof") });
    expect(areaEquation(shape("lshape", 8, 6, 3, 2), "cm").note).toMatch(/cut-out corner/);
  });

  it("shades parts that add up to the area", () => {
    for (let i = 0; i < 300; i++) {
      const s = randomShape(kindsFor("area"), i % 2 ? 50 : 10);
      const edges = shapeGeometry(s);
      // Screen scale: pixels per unit, from any edge.
      const k = Math.hypot(edges[0].to[0] - edges[0].from[0], edges[0].to[1] - edges[0].from[1]) / edges[0].length;
      const shaded = shapeAreaParts(s).reduce((sum, p) => sum + p.sign * polyArea(p.pts), 0);
      expect(shaded / (k * k), JSON.stringify(s)).toBeCloseTo(areaOf(s), 3);
    }
  });

  it("hides slanted sides that area doesn't need, and marks the right angle and roof height", () => {
    expect(shapeGeometry(shape("righttri", 6, 4)).map((e) => e.labelled)).toEqual([true, false, true]);
    expect(shapeRightAngle(shape("righttri", 6, 4))).toHaveLength(3);
    expect(shapeRightAngle(shape("rect", 6, 4))).toBeNull();
    const house = shape("househ", 8, 5, 3);
    expect(shapeGeometry(house).filter((e) => e.labelled).map((e) => e.length)).toEqual([8, 5, 5]);
    expect(shapeExtraLabels(house).map((x) => x.length)).toEqual([3]);
    expect(shapeInsideLines(house)).toHaveLength(2); // roof base and roof height
  });

  it("makes valid random Area shapes, only from Area's shapes", () => {
    const kinds = kindsFor("area");
    expect(kinds).not.toContain("triangle");
    for (let i = 0; i < 500; i++) {
      const s = randomShape(kinds, 20);
      expect(kinds).toContain(s.kind);
      expect(cleanShape(s, { kinds, max: 20, challenge: false })).not.toBeNull();
    }
  });

  it("reads typed area answers", () => {
    expect(parseAnswer("42")).toBe(42);
    expect(parseAnswer("12.5")).toBe(12.5);
    expect(parseAnswer("12,5 cm²")).toBe(12.5);
    expect(parseAnswer("42 cm2")).toBe(42);
    expect(parseAnswer("42 sq m")).toBe(42);
    expect(parseAnswer("42 square cm")).toBe(42);
    expect(parseAnswer("42²")).toBe(42);
    expect(parseAnswer("42 2")).toBeNull();
    expect(parseAnswer("12.55")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

class Recorder implements RoomTransport {
  views = new Map<string, RoomView>();
  chats = new Map<string, ChatMessage[]>();
  feedback = new Map<string, string[]>();
  members: () => string[] = () => [];
  send: RoomTransport["send"] = (to, event, ...args) => {
    if (event === "room:state") this.views.set(to, args[0] as RoomView);
    if (event === "chat") this.chats.set(to, [...(this.chats.get(to) ?? []), args[0] as ChatMessage]);
    if (event === "perim:feedback") this.feedback.set(to, [...(this.feedback.get(to) ?? []), (args[0] as { result: string }).result]);
  };
  broadcast: RoomTransport["broadcast"] = (event, args, except) => {
    for (const id of this.members()) if (id !== except) (this.send as (to: string, e: string, ...a: unknown[]) => void)(id, event, ...args);
  };
  removed: RoomTransport["removed"] = () => {};
  p(id: string) {
    return this.views.get(id)!.perimeter!;
  }
  chat(id: string) {
    return this.chats.get(id) ?? [];
  }
}

function setup(settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const io = new Recorder();
  const room = new Room("AREA23", false, { ...DEFAULT_SETTINGS, mode: "area", perimeterTime: 40, rounds: 1, ...settings }, io, () => {}, () => 0);
  io.members = () => [...room.players.keys()];
  for (let i = 0; i < 3; i++) room.addPlayer({ id: `p${i}`, clientId: `c${i}`, ip: "", name: `P${i}`, avatar: AV });
  room.requestStart("p0");
  return { io, room };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Area mode", () => {
  it("plays like Perimeter, but the answer is the area", () => {
    const { room, io } = setup();
    expect(room.phase).toBe("perim_build");
    room.submitShape("p0", shape("lshape", 8, 6, 3, 2));
    expect(io.p("p1").measure).toBe("area");
    expect(io.p("p0").answer).toBe(42);
    expect(io.chat("p1").some((m) => m.text === "Find the area!")).toBe(true);
    room.answer("p1", 41);
    room.answer("p1", 28); // the perimeter by mistake
    room.answer("p1", 3);
    expect(io.feedback.get("p1")).toEqual(["close", "mixup", "wrong"]);
    room.answer("p1", 42);
    expect(io.feedback.get("p1")!.at(-1)).toBe("correct");
    expect(io.chat("p2").some((m) => m.text === "P1 found the area!")).toBe(true);
    room.answer("p2", 42);
    expect(room.phase).toBe("perim_reveal");
    expect(io.p("p2").equation!.sum).toBe("8 × 6 − 3 × 2 = 48 − 6 = 42 cm²");
    expect(io.views.get("p2")!.reveal!.word).toBe("42 cm²");
  });

  it("accepts half squares, and only from Area's shapes", () => {
    const { room, io } = setup({ perimeterUnit: "m" });
    room.submitShape("p0", shape("triangle", 3, 4, 5)); // a Perimeter shape
    expect(room.phase).toBe("perim_build");
    room.submitShape("p0", shape("righttri", 5, 3));
    expect(room.phase).toBe("perim_solve");
    room.answer("p1", 7.25); // not a half
    expect(io.feedback.get("p1")).toBeUndefined();
    room.handleChat("p1", "7.5 m²");
    expect(io.feedback.get("p1")).toEqual(["correct"]);
    vi.advanceTimersByTime(40_000);
    expect(io.views.get("p1")!.reveal!.word).toBe("7.5 m²");
  });

  it("stops the drawer from typing the area", () => {
    const { room, io } = setup();
    room.submitShape("p0", shape("righttri", 5, 3));
    room.handleChat("p0", "it is 7.5!");
    expect(io.chat("p0").at(-1)!.kind).toBe("warn");
    room.handleChat("p0", "it is 7,5");
    expect(io.chat("p0").at(-1)!.kind).toBe("warn");
    room.handleChat("p0", "7 rows of 5");
    expect(io.chat("p0").at(-1)!.text).toBe("7 rows of 5");
  });

  it("picks a random Area shape if the drawer runs out of time", () => {
    const { room, io } = setup({ perimeterShapes: ["triangle", "righttri"] });
    vi.advanceTimersByTime(TIMING.perimeterBuildSeconds * 1000);
    expect(io.p("p1").shape!.kind).toBe("righttri");
    expect(perimeterOf(io.p("p1").shape!)).toBeGreaterThan(0);
  });

  it("falls back to every Area shape if the room only chose Perimeter shapes", () => {
    const { room, io } = setup({ perimeterShapes: ["triangle"] });
    room.submitShape("p0", shape("househ", 8, 5, 3));
    expect(room.phase).toBe("perim_solve");
    expect(io.p("p0").answer).toBe(52);
  });
});
