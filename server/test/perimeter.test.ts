import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_H,
  CANVAS_W,
  DEFAULT_SETTINGS,
  TIMING,
  cleanShape,
  edgeLengths,
  isTriangle,
  parseAnswer,
  perimeterEquation,
  perimeterOf,
  randomShape,
  shapeGeometry,
  shapeOutline,
  shapeProblem,
  type ChatMessage,
  type PerimeterShape,
  type RoomView,
} from "@inkwave/shared";
import { Room, type RoomTransport } from "../src/game/Room";
import { isCloseAnswer } from "../src/game/PerimeterMode";
import { applySettingsPatch } from "../src/game/settings";

const AV = { head: 0, color: 0, eyes: 0, mouth: 0, top: 0 };
const rect = (l: number, w: number, hidden: number | null = null): PerimeterShape => ({ kind: "rect", sides: [l, w], hidden });

describe("shapes", () => {
  it("adds up every side", () => {
    expect(perimeterOf(rect(8, 3))).toBe(22);
    expect(perimeterOf({ kind: "square", sides: [5], hidden: null })).toBe(20);
    expect(perimeterOf({ kind: "triangle", sides: [6, 5, 4], hidden: null })).toBe(15);
    const L: PerimeterShape = { kind: "lshape", sides: [8, 6, 3, 2], hidden: null };
    expect(edgeLengths(L)).toEqual([8, 4, 3, 2, 5, 6]);
    expect(perimeterOf(L)).toBe(28); // same as 2 × (8 + 6)
  });

  it("writes out the working", () => {
    expect(perimeterEquation(rect(8, 3), "cm")).toEqual({ sum: "8 + 3 + 8 + 3 = 22 cm", shortcut: "2 × (8 + 3) = 22 cm" });
    expect(perimeterEquation({ kind: "square", sides: [5], hidden: null }, "m")).toEqual({ sum: "5 + 5 + 5 + 5 = 20 m", shortcut: "4 × 5 = 20 m" });
    expect(perimeterEquation({ kind: "triangle", sides: [6, 5, 4], hidden: null }, "cm").shortcut).toBeNull();
  });

  it("only accepts real triangles and L-shapes", () => {
    expect(isTriangle(3, 4, 5)).toBe(true);
    expect(isTriangle(1, 2, 3)).toBe(false); // flat
    expect(shapeProblem("triangle", [1, 2, 8], 20)).toMatch(/can't make a triangle/);
    expect(shapeProblem("lshape", [5, 5, 5, 2], 20)).toMatch(/cut/);
    expect(shapeProblem("rect", [21, 3], 20)).toMatch(/1 to 20/);
    expect(shapeProblem("rect", [2.5, 3], 20)).toMatch(/whole numbers/);
    expect(shapeProblem("rect", [8, 3], 20)).toBeNull();
  });

  it("cleans untrusted shapes against the room's settings", () => {
    const opts = { kinds: ["rect", "triangle"] as PerimeterShape["kind"][], max: 20, challenge: false };
    expect(cleanShape({ kind: "rect", sides: [8, 3] }, opts)).toEqual(rect(8, 3));
    expect(cleanShape({ kind: "square", sides: [4] }, opts)).toBeNull(); // not allowed in this room
    expect(cleanShape({ kind: "rect", sides: [8, 3], hidden: 1 }, opts)).toBeNull(); // hiding needs the challenge option
    expect(cleanShape({ kind: "rect", sides: [8, 3], hidden: 1 }, { ...opts, challenge: true })).toEqual(rect(8, 3, 1));
    expect(cleanShape({ kind: "triangle", sides: [5, 4, 3], hidden: 0 }, { ...opts, challenge: true })).toBeNull(); // can't be worked out
    expect(cleanShape({ kind: "rect", sides: ["8", "x"] }, opts)).toBeNull();
    expect(cleanShape("rect", opts)).toBeNull();
  });

  it("always makes valid random shapes", () => {
    for (const max of [10, 20, 50]) {
      for (let i = 0; i < 400; i++) {
        const s = randomShape(["rect", "square", "triangle", "lshape"], max);
        expect(cleanShape(s, { kinds: ["rect", "square", "triangle", "lshape"], max, challenge: false }), JSON.stringify(s)).not.toBeNull();
      }
    }
  });

  it("draws every shape to scale inside the canvas, with labels on screen", () => {
    for (let i = 0; i < 200; i++) {
      const s = randomShape(["rect", "square", "triangle", "lshape"], 50);
      const edges = shapeGeometry(s);
      expect(edges).toHaveLength(edgeLengths(s).length);
      for (const e of edges) {
        for (const [x, y] of [e.from, e.to, e.label]) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(CANVAS_W);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(CANVAS_H);
        }
      }
      // Drawn to scale: screen length / real length is the same for every edge.
      const ratios = edges.map((e) => Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) / e.length);
      for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 3);
      // Closed: each edge starts where the last one ended.
      edges.forEach((e, j) => expect(e.from).toEqual(edges[(j + edges.length - 1) % edges.length].to));
    }
  });

  it("outlines with straight strokes, and equal-side ticks on squares", () => {
    expect(shapeOutline(rect(8, 3))).toHaveLength(4);
    expect(shapeOutline({ kind: "square", sides: [5], hidden: null })).toHaveLength(8);
  });

  it("reads typed answers", () => {
    expect(parseAnswer("22")).toBe(22);
    expect(parseAnswer(" 22 cm ")).toBe(22);
    expect(parseAnswer("22cm.")).toBe(22);
    expect(parseAnswer("22 meters")).toBe(22);
    expect(parseAnswer("22 apples")).toBeNull();
    expect(parseAnswer("is it 22?")).toBeNull();
  });

  it("knows a close answer", () => {
    expect(isCloseAnswer(21, 22)).toBe(true);
    expect(isCloseAnswer(20, 22)).toBe(true);
    expect(isCloseAnswer(11, 22)).toBe(false); // added only half the sides
    expect(isCloseAnswer(45, 50)).toBe(true); // within 10%
    expect(isCloseAnswer(22, 22)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

class Recorder implements RoomTransport {
  views = new Map<string, RoomView>();
  chats = new Map<string, ChatMessage[]>();
  feedback = new Map<string, string[]>();
  notices: string[] = [];
  relayedDraws = 0;
  members: () => string[] = () => [];
  send: RoomTransport["send"] = (to, event, ...args) => {
    if (event === "room:state") this.views.set(to, args[0] as RoomView);
    if (event === "chat") this.chats.set(to, [...(this.chats.get(to) ?? []), args[0] as ChatMessage]);
    if (event === "perim:feedback") this.feedback.set(to, [...(this.feedback.get(to) ?? []), (args[0] as { result: string }).result]);
    if (event === "notice") this.notices.push(args[0] as string);
  };
  broadcast: RoomTransport["broadcast"] = (event, args, except) => {
    if (event === "draw") this.relayedDraws++;
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

const SOLVE_MS = 40_000;
function setup(players = 3, settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const io = new Recorder();
  const room = new Room("PERI23", false, { ...DEFAULT_SETTINGS, mode: "perimeter", perimeterTime: SOLVE_MS / 1000, rounds: 2, ...settings }, io, () => {}, () => 0);
  io.members = () => [...room.players.keys()];
  for (let i = 0; i < players; i++) room.addPlayer({ id: `p${i}`, clientId: `c${i}`, ip: "", name: `P${i}`, avatar: AV });
  return { io, room };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Perimeter mode", () => {
  function solving(settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
    const ctx = setup(3, settings);
    ctx.room.requestStart("p0");
    ctx.room.submitShape("p0", rect(8, 3));
    return ctx;
  }

  it("lets the drawer make a shape, which nobody sees until it's done", () => {
    const { room, io } = setup();
    room.requestStart("p0");
    expect(room.phase).toBe("perim_build");
    expect(io.views.get("p1")!.drawerId).toBe("p0");
    expect(io.p("p1").shape).toBeNull();
    room.submitShape("p1", rect(8, 3)); // not the drawer
    expect(room.phase).toBe("perim_build");
    room.submitShape("p0", { kind: "triangle", sides: [1, 2, 9] }); // impossible triangle
    expect(io.notices.at(-1)).toMatch(/doesn't work/);
    room.submitShape("p0", rect(8, 3));
    expect(room.phase).toBe("perim_solve");
    expect(io.p("p1").shape).toEqual(rect(8, 3));
    expect(io.p("p1").answer).toBeNull();
    expect(io.p("p0").answer).toBe(22);
  });

  it("uses a random shape if the drawer runs out of time", () => {
    const { room, io } = setup();
    room.requestStart("p0");
    vi.advanceTimersByTime(TIMING.perimeterBuildSeconds * 1000);
    expect(room.phase).toBe("perim_solve");
    expect(io.p("p1").shape).not.toBeNull();
  });

  it("gives private feedback: correct, close or wrong", () => {
    const { room, io } = solving();
    room.answer("p1", 11);
    room.answer("p1", 21);
    expect(io.feedback.get("p1")).toEqual(["wrong", "close"]);
    expect(io.feedback.get("p2")).toBeUndefined();
    vi.advanceTimersByTime(5000);
    room.answer("p1", 22);
    expect(io.feedback.get("p1")!.at(-1)).toBe("correct");
    expect(room.players.get("p1")!.score).toBeGreaterThan(0);
    expect(io.p("p1").answer).toBe(22);
    expect(io.p("p2").answer).toBeNull();
    const seen = io.chat("p2").map((m) => m.text).join("\n");
    expect(seen).toContain("P1 found the perimeter!");
    expect(seen).not.toMatch(/\b22\b/);
  });

  it("treats a number typed in chat as a private answer", () => {
    const { room, io } = solving();
    room.handleChat("p1", "20 cm");
    expect(io.feedback.get("p1")).toEqual(["close"]);
    expect(io.chat("p2").some((m) => m.text.includes("20"))).toBe(false);
    room.handleChat("p1", "is it a fence?");
    expect(io.chat("p2").some((m) => m.text === "is it a fence?")).toBe(true);
  });

  it("stops the drawer from giving the answer away", () => {
    const { room, io } = solving();
    room.handleChat("p0", "it's 22 cm!");
    expect(io.chat("p0").at(-1)!.kind).toBe("warn");
    room.handleChat("p0", "count all four sides");
    expect(io.chat("p0").at(-1)!.text).toBe("count all four sides");
  });

  it("ends the turn when everyone has solved it, and shows the working", () => {
    const { room, io } = solving();
    room.answer("p1", 22);
    room.answer("p2", 22);
    expect(room.phase).toBe("perim_reveal");
    expect(io.p("p1").equation).toEqual({ sum: "8 + 3 + 8 + 3 = 22 cm", shortcut: "2 × (8 + 3) = 22 cm" });
    expect(io.views.get("p0")!.reveal!.gains.p0).toBe(250);
    vi.advanceTimersByTime(TIMING.perimeterRevealSeconds * 1000);
    expect(room.phase).toBe("perim_build");
    expect(io.views.get("p0")!.drawerId).toBe("p1");
  });

  it("ends on time and uses the room's unit", () => {
    const { room, io } = solving({ perimeterUnit: "m" });
    vi.advanceTimersByTime(SOLVE_MS);
    expect(room.phase).toBe("perim_reveal");
    expect(io.views.get("p1")!.reveal!.reason).toBe("time");
    expect(io.p("p1").equation!.sum).toBe("8 + 3 + 8 + 3 = 22 m");
  });

  it("lets only the drawer decorate, and only while others solve", () => {
    const { room, io } = solving();
    const stroke = [{ k: "begin", id: 1, color: "#ff0000", size: 8, x: 10, y: 10, p: 1 }, { k: "end", id: 1 }];
    room.handleDraw("p1", stroke);
    expect(io.relayedDraws).toBe(0);
    room.handleDraw("p0", stroke);
    expect(io.relayedDraws).toBe(1);
  });

  it("everyone makes a shape once per round, then the podium", () => {
    const { room } = setup(2, { rounds: 2 });
    room.requestStart("p0");
    const drawers: string[] = [];
    for (let t = 0; t < 4; t++) {
      drawers.push(room.perimeter.drawerId!);
      room.submitShape(room.perimeter.drawerId!, rect(4, 2));
      vi.advanceTimersByTime(SOLVE_MS + TIMING.perimeterRevealSeconds * 1000);
    }
    expect(drawers).toEqual(["p0", "p1", "p0", "p1"]);
    expect(room.phase).toBe("podium");
  });

  it("moves on if the drawer leaves while making the shape", () => {
    const { room } = setup(3);
    room.requestStart("p0");
    room.removePlayer("p0");
    expect(room.phase).toBe("perim_build");
    expect(room.perimeter.drawerId).toBe("p1");
  });

  it("keeps hidden measurements hidden in the challenge option", () => {
    const { room, io } = setup(2, { perimeterChallenge: true });
    room.requestStart("p0");
    room.submitShape("p0", rect(8, 3, 2));
    expect(io.p("p1").shape!.hidden).toBe(2);
  });

  it("validates the teacher's settings", () => {
    let s = applySettingsPatch(DEFAULT_SETTINGS, { mode: "perimeter", perimeterMax: 37, perimeterUnit: "km", perimeterShapes: [], perimeterTime: 5 }, 1);
    expect(s).toMatchObject({ mode: "perimeter", perimeterMax: 20, perimeterUnit: "cm", perimeterTime: 20 });
    expect(s.perimeterShapes).toHaveLength(4); // can't switch every shape off
    s = applySettingsPatch(s, { perimeterMax: 50, perimeterUnit: "m", perimeterShapes: ["square", "oval"], perimeterChallenge: true }, 1);
    expect(s).toMatchObject({ perimeterMax: 50, perimeterUnit: "m", perimeterShapes: ["square"], perimeterChallenge: true });
  });
});
