import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, TIMING, type ChatMessage, type DrawAction, type RoomView } from "@inkwave/shared";
import { Room, type RoomTransport } from "../src/game/Room";

/** Records everything the room sends so tests can inspect per-player views. */
class Recorder implements RoomTransport {
  views = new Map<string, RoomView>();
  chats = new Map<string, ChatMessage[]>();
  replays = new Map<string, DrawAction[][]>();
  draws: { except?: string; ops: unknown[] }[] = [];
  removedLog: [string, string][] = [];
  notices: [string, string][] = [];
  members: () => string[] = () => [];

  private addChat(to: string, m: ChatMessage) {
    const list = this.chats.get(to) ?? [];
    list.push(m);
    this.chats.set(to, list);
  }
  send: RoomTransport["send"] = (to, event, ...args) => {
    if (event === "room:state") this.views.set(to, args[0] as RoomView);
    if (event === "chat") this.addChat(to, args[0] as ChatMessage);
    if (event === "draw:replay") this.replays.set(to, [...(this.replays.get(to) ?? []), args[0] as DrawAction[]]);
    if (event === "notice") this.notices.push([to, args[0] as string]);
  };
  broadcast: RoomTransport["broadcast"] = (event, args, except) => {
    if (event === "draw") this.draws.push({ except, ops: args[0] as unknown[] });
    for (const id of this.members()) {
      if (id === except) continue;
      if (event === "chat") this.addChat(id, args[0] as ChatMessage);
      if (event === "draw:replay") this.replays.set(id, [...(this.replays.get(id) ?? []), args[0] as DrawAction[]]);
    }
  };
  removed: RoomTransport["removed"] = (id, reason) => {
    this.removedLog.push([id, reason]);
  };
  view(id: string) {
    return this.views.get(id)!;
  }
  chat(id: string) {
    return this.chats.get(id) ?? [];
  }
}

function setup(opts: { players?: number; isPublic?: boolean; settings?: Partial<typeof DEFAULT_SETTINGS> } = {}) {
  const io = new Recorder();
  let emptied = false;
  const room = new Room(
    "ABC234",
    opts.isPublic ?? false,
    { ...DEFAULT_SETTINGS, customWords: "giraffe, rocket, pancake, volcano, lantern", customOnly: true, ...opts.settings },
    io,
    () => (emptied = true),
    () => 0, // deterministic: always the first option / first letter
  );
  io.members = () => [...room.players.keys()];
  const ids: string[] = [];
  for (let i = 0; i < (opts.players ?? 3); i++) {
    const id = `p${i}`;
    room.addPlayer({ id, clientId: `c${i}`, ip: `10.0.0.${i}`, name: `Player${i}`, avatar: { head: 0, color: 0, eyes: 0, mouth: 0, top: 0 } });
    ids.push(id);
  }
  return { io, room, ids, isEmpty: () => emptied };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("lobby", () => {
  it("makes the first player host and only lets the host start with 2+ players", () => {
    const { room, io } = setup({ players: 1 });
    expect(room.hostId).toBe("p0");
    room.requestStart("p0");
    expect(room.phase).toBe("lobby");
    expect(io.notices[0][1]).toMatch(/at least 2/);

    room.addPlayer({ id: "p1", clientId: "c1", ip: "", name: "B", avatar: { head: 0, color: 0, eyes: 0, mouth: 0, top: 0 } });
    room.requestStart("p1"); // not host
    expect(room.phase).toBe("lobby");
    room.requestStart("p0");
    expect(room.phase).toBe("choosing");
  });

  it("only the host changes settings, and only in the lobby", () => {
    const { room } = setup();
    room.updateSettings("p1", { rounds: 7 });
    expect(room.settings.rounds).toBe(3);
    room.updateSettings("p0", { rounds: 7, drawTime: 9999 });
    expect(room.settings.rounds).toBe(7);
    expect(room.settings.drawTime).toBe(240);
    room.requestStart("p0");
    room.updateSettings("p0", { rounds: 2 });
    expect(room.settings.rounds).toBe(7);
  });

  it("auto-starts public rooms once two players are in", () => {
    const { room } = setup({ isPublic: true, players: 2 });
    expect(room.hostId).toBeNull();
    expect(room.phase).toBe("lobby");
    vi.advanceTimersByTime(TIMING.publicAutoStartSeconds * 1000);
    expect(room.phase).toBe("choosing");
  });
});

describe("turn state machine", () => {
  it("gives only the drawer the word choices, and auto-picks after 15 s", () => {
    const { room, io } = setup({ settings: { wordChoices: 3 } });
    room.requestStart("p0");
    expect(room.drawerId).toBe("p0");
    expect(io.view("p0").choices).toHaveLength(3);
    expect(io.view("p1").choices).toBeNull();
    vi.advanceTimersByTime(TIMING.chooseSeconds * 1000);
    expect(room.phase).toBe("drawing");
    expect(room.word).toBe(io.view("p0").word);
  });

  it("shows guessers blanks, the drawer the word, and reveals hints on schedule", () => {
    const { room, io } = setup({ settings: { drawTime: 60, hints: 2 } });
    room.requestStart("p0");
    room.chooseWord("p0", 0);
    expect(room.word).toBe("giraffe");
    expect(io.view("p0").word).toBe("giraffe");
    expect(io.view("p1").word).toBeNull();
    expect(io.view("p1").pattern).toBe("_______");

    vi.advanceTimersByTime(20_000);
    expect(io.view("p1").pattern).toBe("g______");
    vi.advanceTimersByTime(20_000);
    expect(io.view("p1").pattern!.replace(/_/g, "").length).toBe(2);
  });

  it("hides the blanks in hidden mode", () => {
    const { room, io } = setup({ settings: { wordMode: "hidden" } });
    room.requestStart("p0");
    room.chooseWord("p0", 0);
    expect(io.view("p1").pattern).toBeNull();
    expect(io.view("p0").word).toBe("giraffe");
  });

  it("ends the turn on time, reveals for 5 s, then moves to the next drawer", () => {
    const { room, io } = setup({ settings: { drawTime: 30 } });
    room.requestStart("p0");
    room.chooseWord("p0", 0);
    vi.advanceTimersByTime(30_000);
    expect(room.phase).toBe("reveal");
    expect(io.view("p1").reveal).toMatchObject({ word: "giraffe", reason: "time" });
    expect(io.view("p1").reveal!.gains.p0).toBe(0);
    vi.advanceTimersByTime(TIMING.revealSeconds * 1000);
    expect(room.phase).toBe("choosing");
    expect(room.drawerId).toBe("p1");
  });

  it("plays every player once per round, then shows the podium and returns to the lobby with the same settings", () => {
    const { room } = setup({ players: 3, settings: { rounds: 2, drawTime: 15 } });
    room.updateSettings("p0", { rounds: 2, drawTime: 15, hints: 1 });
    room.requestStart("p0");
    const drawers: string[] = [];
    for (let turn = 0; turn < 6; turn++) {
      expect(room.phase).toBe("choosing");
      drawers.push(room.drawerId!);
      room.chooseWord(room.drawerId!, 0);
      vi.advanceTimersByTime(15_000 + TIMING.revealSeconds * 1000);
    }
    expect(drawers).toEqual(["p0", "p1", "p2", "p0", "p1", "p2"]);
    expect(room.phase).toBe("podium");
    vi.advanceTimersByTime(TIMING.podiumSeconds * 1000);
    expect(room.phase).toBe("lobby");
    expect(room.settings).toMatchObject({ rounds: 2, drawTime: 15, hints: 1 });
  });
});

describe("guessing and chat", () => {
  function drawing() {
    const ctx = setup({ players: 4, settings: { drawTime: 60 } });
    ctx.room.requestStart("p0");
    ctx.room.chooseWord("p0", 0); // giraffe
    return ctx;
  }

  it("scores a correct guess without leaking the word", () => {
    const { room, io } = drawing();
    vi.advanceTimersByTime(10_000);
    room.handleChat("p1", "  GIRAFFE ");
    const p1 = room.players.get("p1")!;
    expect(p1.guessed).toBe(true);
    expect(p1.score).toBeGreaterThan(0);
    const seenByP2 = io.chat("p2").map((m) => m.text).join("\n");
    expect(seenByP2).toContain("Player1 guessed the word!");
    expect(seenByP2.toLowerCase()).not.toContain("giraffe");
    expect(io.view("p1").word).toBe("giraffe");
    expect(io.view("p2").word).toBeNull();
  });

  it("gives earlier guessers more points", () => {
    const { room } = drawing();
    vi.advanceTimersByTime(5_000);
    room.handleChat("p1", "giraffe");
    vi.advanceTimersByTime(5_000);
    room.handleChat("p2", "giraffe");
    expect(room.players.get("p1")!.score).toBeGreaterThan(room.players.get("p2")!.score);
  });

  it("tells only the guesser when they are close", () => {
    const { room, io } = drawing();
    room.handleChat("p1", "girafe");
    expect(io.chat("p1").some((m) => m.kind === "close")).toBe(true);
    expect(io.chat("p2").some((m) => m.kind === "close")).toBe(false);
    expect(io.chat("p2").some((m) => m.kind === "chat" && m.text === "girafe")).toBe(true);
  });

  it("blocks the drawer from saying the word", () => {
    const { room, io } = drawing();
    room.handleChat("p0", "it's a Giraffe!");
    expect(io.chat("p0").at(-1)!.kind).toBe("warn");
    expect(io.chat("p1").some((m) => m.text.includes("Giraffe"))).toBe(false);
  });

  it("keeps guessed-player chat between the drawer and those who guessed", () => {
    const { room, io } = drawing();
    room.handleChat("p1", "giraffe");
    room.handleChat("p1", "long neck lol");
    room.handleChat("p0", "thanks");
    const guessedMsgs = (id: string) => io.chat(id).filter((m) => m.kind === "guessed").map((m) => m.text);
    expect(guessedMsgs("p0")).toEqual(["long neck lol", "thanks"]);
    expect(guessedMsgs("p1")).toEqual(["long neck lol", "thanks"]);
    expect(guessedMsgs("p2")).toEqual([]);
  });

  it("ends the turn when everyone has guessed and pays the drawer", () => {
    const { room, io } = drawing();
    room.handleChat("p1", "giraffe");
    room.handleChat("p2", "giraffe");
    expect(room.phase).toBe("drawing");
    room.handleChat("p3", "giraffe");
    expect(room.phase).toBe("reveal");
    expect(io.view("p0").reveal!.reason).toBe("all_guessed");
    expect(io.view("p0").reveal!.gains.p0).toBe(250);
  });

  it("masks profanity and rate-limits chat", () => {
    const { room, io } = drawing();
    room.handleChat("p1", "what the shit");
    expect(io.chat("p2").at(-1)!.text).toBe("what the ****");
    for (let i = 0; i < 20; i++) room.handleChat("p2", `spam ${i}`);
    expect(io.chat("p2").some((m) => m.kind === "warn")).toBe(true);
  });
});

describe("drawing", () => {
  it("accepts ops only from the drawer, supports undo, and replays to late joiners", () => {
    const { room, io } = setup({ players: 2 });
    room.requestStart("p0");
    room.chooseWord("p0", 0);
    room.handleDraw("p1", [{ k: "clear" }]); // not the drawer
    expect(io.draws).toHaveLength(0);

    room.handleDraw("p0", [
      { k: "begin", id: 1, color: "#ff0000", size: 8, x: 10, y: 10, p: 1 },
      { k: "pts", id: 1, pts: [20, 20, 1, 30, 30, 0.5] },
      { k: "end", id: 1 },
      { k: "fill", x: 400, y: 300, color: "#00ff00" },
      { k: "begin", id: 2, color: "#0000ff", size: 4, x: 1, y: 1, p: 1 },
      { k: "end", id: 2 },
      { k: "undo" },
      { k: "bogus" },
      { k: "begin", id: 3, color: "javascript:alert(1)", size: 4, x: 1, y: 1, p: 1 },
    ]);
    expect(io.draws[0].except).toBe("p0");
    expect(io.draws[0].ops).toHaveLength(7); // the two bad ops are dropped
    expect(room.canvasActions.map((a) => a.t)).toEqual(["stroke", "fill"]);

    room.addPlayer({ id: "late", clientId: "cl", ip: "", name: "Late", avatar: { head: 0, color: 0, eyes: 0, mouth: 0, top: 0 } });
    expect(io.replays.get("late")!.at(-1)).toEqual(room.canvasActions);
  });

  it("clamps coordinates and sizes", () => {
    const { room } = setup({ players: 2 });
    room.requestStart("p0");
    room.chooseWord("p0", 0);
    room.handleDraw("p0", [
      { k: "begin", id: 1, color: "#123456", size: 500, x: -9999, y: 9999, p: 7 },
      { k: "end", id: 1 },
    ]);
    const s = room.canvasActions[0] as Extract<DrawAction, { t: "stroke" }>;
    expect(s.size).toBe(60);
    expect(s.pts).toEqual([-40, 640, 1]);
  });
});

describe("disconnects and moderation", () => {
  it("ends the turn early when the drawer leaves", () => {
    const { room } = setup({ players: 3 });
    room.requestStart("p0");
    room.chooseWord("p0", 0);
    room.removePlayer("p0");
    expect(room.phase).toBe("reveal");
    expect(room.reveal!.reason).toBe("drawer_left");
  });

  it("skips straight to the next drawer if the drawer leaves while choosing", () => {
    const { room } = setup({ players: 3 });
    room.requestStart("p0");
    room.removePlayer("p0");
    expect(room.phase).toBe("choosing");
    expect(room.drawerId).toBe("p1");
  });

  it("passes host to the next player", () => {
    const { room } = setup({ players: 3 });
    room.removePlayer("p0");
    expect(room.hostId).toBe("p1");
  });

  it("returns to the lobby when fewer than two players remain", () => {
    const { room } = setup({ players: 2 });
    room.requestStart("p0");
    room.chooseWord("p0", 0);
    room.removePlayer("p1");
    expect(room.phase).toBe("lobby");
  });

  it("cleans up when the last player leaves", () => {
    const { room, isEmpty } = setup({ players: 1 });
    room.removePlayer("p0");
    expect(isEmpty()).toBe(true);
  });

  it("ends the turn if the last guesser who hadn't guessed leaves", () => {
    const { room } = setup({ players: 3 });
    room.requestStart("p0");
    room.chooseWord("p0", 0);
    room.handleChat("p1", "giraffe");
    room.removePlayer("p2");
    expect(room.phase).toBe("reveal");
    expect(room.reveal!.reason).toBe("all_guessed");
  });

  it("lets the host kick and ban; bans stick", () => {
    const { room, io } = setup({ players: 3 });
    room.kick("p1", "p2"); // not host
    expect(room.players.has("p2")).toBe(true);
    room.kick("p0", "p1");
    expect(io.removedLog).toContainEqual(["p1", "kicked"]);
    expect(room.isBanned("c1", "10.0.0.1")).toBe(false);
    room.kick("p0", "p2", true);
    expect(io.removedLog).toContainEqual(["p2", "banned"]);
    expect(room.isBanned("c2", "")).toBe(true);
    expect(room.isBanned("other", "10.0.0.2")).toBe(true);
  });

  it("vote-kicks with a majority of the other players", () => {
    const { room, io } = setup({ players: 4 }); // majority of 3 others = 2
    room.voteKick("p1", "p3");
    room.voteKick("p1", "p3"); // duplicate vote ignored
    expect(room.players.has("p3")).toBe(true);
    expect(io.view("p0").players.find((p) => p.id === "p3")!.kickVotes).toBe(1);
    room.voteKick("p2", "p3");
    expect(room.players.has("p3")).toBe(false);
    expect(io.removedLog).toContainEqual(["p3", "votekicked"]);
    expect(room.isBanned("c3", "")).toBe(true);
  });

  it("refuses vote-kicks with only two players", () => {
    const { room } = setup({ players: 2 });
    room.voteKick("p0", "p1");
    expect(room.players.has("p1")).toBe(true);
  });

  it("restores a returning player's score mid-game", () => {
    const { room } = setup({ players: 3 });
    room.requestStart("p0");
    room.chooseWord("p0", 0);
    room.handleChat("p1", "giraffe");
    const score = room.players.get("p1")!.score;
    room.removePlayer("p1");
    const back = room.addPlayer({ id: "p1b", clientId: "c1", ip: "", name: "Player1", avatar: { head: 0, color: 0, eyes: 0, mouth: 0, top: 0 } });
    expect(back.score).toBe(score);
    // Same turn: still counts as guessed, so guessing again scores nothing.
    expect(back.guessed).toBe(true);
    room.handleChat("p1b", "giraffe");
    expect(back.score).toBe(score);
    // Drawer still gets credit for that guess.
    room.handleChat("p2", "giraffe");
    expect(room.reveal!.gains.p0).toBe(250);
  });
});
