import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@inkwave/shared";
import type { RoomTransport } from "../src/game/Room";
import { RoomManager } from "../src/game/RoomManager";
import { applySettingsPatch } from "../src/game/settings";

const AV = { head: 0, color: 0, eyes: 0, mouth: 0, top: 0 };
const quiet = (): RoomTransport => ({ send: () => {}, broadcast: () => {}, removed: () => {}, members: () => [] }) as unknown as RoomTransport;

function host(m: RoomManager, name: string, n = 1) {
  const room = m.create(false, "en");
  for (let i = 0; i < n; i++) room.addPlayer({ id: `${name}${i}`, clientId: `${name}c${i}`, ip: "", name: i ? `${name}-${i}` : name, avatar: AV });
  return room;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("open rooms list", () => {
  it("lists private lobbies, newest first, with host, mode and players", () => {
    const m = new RoomManager(quiet);
    const a = host(m, "Ana", 2);
    vi.advanceTimersByTime(90_000);
    const b = host(m, "Ben");
    b.updateSettings("Ben0", { mode: "area" });
    const list = m.listOpen();
    expect(list.map((r) => r.code)).toEqual([b.code, a.code]);
    expect(list[0]).toMatchObject({ hostName: "Ben", mode: "area", players: 1, maxPlayers: DEFAULT_SETTINGS.maxPlayers, age: 0 });
    expect(list[1]).toMatchObject({ hostName: "Ana", mode: "guess", players: 2, age: 90 });
  });

  it("leaves out public rooms, games in progress, full rooms and hidden rooms", () => {
    const m = new RoomManager(quiet);
    m.findPublic("en", "x", "").addPlayer({ id: "pub", clientId: "pubc", ip: "", name: "Pub", avatar: AV });
    const playing = host(m, "Cai", 2);
    playing.requestStart("Cai0");
    const full = host(m, "Dee", 2);
    full.updateSettings("Dee0", { maxPlayers: 2 });
    const hidden = host(m, "Eve");
    hidden.updateSettings("Eve0", { listed: false });
    const open = host(m, "Fay");
    expect(m.listOpen().map((r) => r.hostName)).toEqual(["Fay"]);
    void full;
    void open;
  });

  it("the host can hide it, and it's shown by default", () => {
    expect(DEFAULT_SETTINGS.listed).toBe(true);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { listed: false }, 2).listed).toBe(false);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { listed: "no" }, 2).listed).toBe(false);
  });

  it("shows at most 20", () => {
    const m = new RoomManager(quiet);
    for (let i = 0; i < 25; i++) host(m, `P${i}x`);
    expect(m.listOpen()).toHaveLength(20);
  });
});
