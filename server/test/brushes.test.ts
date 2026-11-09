import { describe, expect, it } from "vitest";
import { BRUSH_KINDS } from "@inkwave/shared";
import { CanvasState } from "../src/game/CanvasState";

const begin = (brush?: unknown) => ({ k: "begin", id: 1, color: "#123456", size: 14, x: 10, y: 10, p: 1, brush });

describe("brush textures", () => {
  it("offers a plain pen and four textures", () => {
    expect(BRUSH_KINDS.map((b) => b.id)).toEqual(["pen", "soft", "spray", "hatch", "crayon"]);
  });

  it("keeps a texture with the stroke, for replays and late joiners", () => {
    const c = new CanvasState();
    const ops = c.ingest([begin("hatch"), { k: "pts", id: 1, pts: [20, 20, 1] }]);
    expect(ops[0]).toMatchObject({ k: "begin", brush: "hatch" });
    expect(c.liveStrokeOps()[0]).toMatchObject({ brush: "hatch" });
    expect(c.snapshot()[0]).toMatchObject({ t: "stroke", brush: "hatch" });
    c.ingest([{ k: "end", id: 1 }]);
    expect(c.actions[0]).toEqual({ t: "stroke", color: "#123456", size: 14, pts: [10, 10, 1, 20, 20, 1], brush: "hatch" });
  });

  it("draws unknown textures, and the pen, as a plain line", () => {
    for (const b of ["pen", "glitter", 7, undefined, { evil: true }]) {
      const c = new CanvasState();
      const [op] = c.ingest([begin(b), { k: "end", id: 1 }]);
      expect(op).not.toHaveProperty("brush");
      expect(c.actions[0]).not.toHaveProperty("brush");
    }
  });
});
