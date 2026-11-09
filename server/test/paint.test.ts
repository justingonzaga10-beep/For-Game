import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@inkwave/shared";
import { Room, type RoomTransport } from "../src/game/Room";
import { applySettingsPatch } from "../src/game/settings";

const AV = { head: 0, color: 0, eyes: 0, mouth: 0, top: 0 };
const PINK = "#ff4d8d";

class Recorder implements RoomTransport {
  paints = new Map<string, { from: string; to: string; color: string }[]>();
  notices = new Map<string, string[]>();
  members: () => string[] = () => [];
  send: RoomTransport["send"] = (to, event, ...args) => {
    if (event === "fx:paint") this.paints.set(to, [...(this.paints.get(to) ?? []), args[0] as { from: string; to: string; color: string }]);
    if (event === "notice") this.notices.set(to, [...(this.notices.get(to) ?? []), args[0] as string]);
  };
  broadcast: RoomTransport["broadcast"] = (event, args, except) => {
    for (const id of this.members()) if (id !== except) (this.send as (to: string, e: string, ...a: unknown[]) => void)(id, event, ...args);
  };
  removed: RoomTransport["removed"] = () => {};
  count(id = "p0") {
    return this.paints.get(id)?.length ?? 0;
  }
}

function setup(settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const io = new Recorder();
  const room = new Room("PAINT2", false, { ...DEFAULT_SETTINGS, ...settings }, io, () => {}, () => 0);
  io.members = () => [...room.players.keys()];
  for (let i = 0; i < 4; i++) room.addPlayer({ id: `p${i}`, clientId: `c${i}`, ip: "", name: `P${i}`, avatar: AV });
  return { io, room };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("paint throwing", () => {
  it("everyone sees who threw which colour at whom", () => {
    const { io, room } = setup();
    room.requestStart("p0");
    room.throwPaint("p1", "p2", PINK);
    for (const id of ["p0", "p1", "p2", "p3"]) expect(io.paints.get(id)).toEqual([{ from: "p1", to: "p2", color: PINK }]);
  });

  it("only during a game, at someone else, in a paint colour", () => {
    const { io, room } = setup();
    room.throwPaint("p1", "p2", PINK); // lobby
    room.requestStart("p0");
    room.throwPaint("p1", "p1", PINK); // yourself
    room.throwPaint("p1", "nobody", PINK);
    room.throwPaint("p1", "p2", "#000000"); // not a paint colour
    room.throwPaint("p1", "p2", "url(javascript:x)");
    room.throwPaint("ghost", "p2", PINK);
    expect(io.count()).toBe(0);
  });

  it("the host can turn it off", () => {
    const { io, room } = setup();
    expect(DEFAULT_SETTINGS.paintThrow).toBe(true);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { paintThrow: false }, 2).paintThrow).toBe(false);
    room.updateSettings("p0", { paintThrow: false });
    room.requestStart("p0");
    room.throwPaint("p1", "p2", PINK);
    expect(io.count()).toBe(0);
  });

  it("nobody gets buried: one hit per player every 2.5 s, and two quick throws then one every 3 s", () => {
    const { io, room } = setup();
    room.requestStart("p0");
    room.throwPaint("p1", "p2", PINK);
    room.throwPaint("p3", "p2", PINK); // p2 was just hit
    expect(io.count()).toBe(1);
    expect(io.notices.get("p3")!.at(-1)).toMatch(/just got splatted/);
    room.throwPaint("p1", "p3", PINK); // p1's second quick throw
    room.throwPaint("p1", "p0", PINK); // p1 is out of paint
    expect(io.count()).toBe(2);
    expect(io.notices.get("p1")!.at(-1)).toMatch(/drying/);
    vi.advanceTimersByTime(3000);
    room.throwPaint("p1", "p2", PINK);
    expect(io.count()).toBe(3);
  });
});
