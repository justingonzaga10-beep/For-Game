import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, REACTIONS, reactionsFor, type GameModeId } from "@inkwave/shared";
import { Room, type RoomTransport } from "../src/game/Room";

const AV = { head: 0, color: 0, eyes: 0, mouth: 0, top: 0 };

class Recorder implements RoomTransport {
  reacts = new Map<string, { playerId: string; emoji: string }[]>();
  members: () => string[] = () => [];
  send: RoomTransport["send"] = (to, event, ...args) => {
    if (event === "fx:react") this.reacts.set(to, [...(this.reacts.get(to) ?? []), args[0] as { playerId: string; emoji: string }]);
  };
  broadcast: RoomTransport["broadcast"] = (event, args, except) => {
    for (const id of this.members()) if (id !== except) (this.send as (to: string, e: string, ...a: unknown[]) => void)(id, event, ...args);
  };
  removed: RoomTransport["removed"] = () => {};
}

function setup(mode: GameModeId, isPublic = false) {
  const io = new Recorder();
  const room = new Room("REACT2", isPublic, { ...DEFAULT_SETTINGS, mode }, io, () => {}, () => 0);
  io.members = () => [...room.players.keys()];
  for (let i = 0; i < 3; i++) room.addPlayer({ id: `p${i}`, clientId: `c${i}`, ip: "", name: `P${i}`, avatar: AV });
  return { io, room };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("emoji reactions", () => {
  it("each mode has its own set of 8", () => {
    for (const list of Object.values(REACTIONS)) {
      expect(list).toHaveLength(8);
      expect(new Set(list).size).toBe(8);
    }
    expect(reactionsFor("area", true)).toBe(REACTIONS.guess); // public rooms play Guessing
  });

  it("relays a reaction to everyone, including the sender", () => {
    const { io, room } = setup("perimeter");
    room.requestStart("p0");
    room.react("p1", "📏");
    for (const id of ["p0", "p1", "p2"]) expect(io.reacts.get(id)).toEqual([{ playerId: "p1", emoji: "📏" }]);
  });

  it("only allows the mode's emojis, and not in the lobby", () => {
    const { io, room } = setup("guess");
    room.react("p1", "👍"); // still in the lobby
    room.requestStart("p0");
    room.react("p1", "📏"); // a Perimeter emoji
    room.react("p1", "<b>hi</b>");
    room.react("p1", 42);
    room.react("nobody", "👍");
    expect(io.reacts.get("p0")).toBeUndefined();
    room.react("p1", "👍");
    expect(io.reacts.get("p0")).toHaveLength(1);
  });

  it("drops spam: 4 in a row, then about one a second", () => {
    const { io, room } = setup("drawoff");
    room.requestStart("p0");
    for (let i = 0; i < 10; i++) room.react("p1", "🔥");
    expect(io.reacts.get("p0")).toHaveLength(4);
    vi.advanceTimersByTime(1000);
    room.react("p1", "🔥");
    room.react("p1", "🔥");
    expect(io.reacts.get("p0")).toHaveLength(5);
    room.react("p2", "🔥"); // each player has their own limit
    expect(io.reacts.get("p0")).toHaveLength(6);
  });
});
