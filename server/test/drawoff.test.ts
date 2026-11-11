import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, TIMING, type DrawOffEntry, type RoomView } from "@inkwave/shared";
import { Room, type RoomTransport } from "../src/game/Room";
import { drawOffPoints, drawOffRating } from "../src/game/DrawOffMode";
import { THEMES, parseCustomThemes, pickDrawOffTheme, pickTheme } from "../src/game/themes";
import { containsProfanity } from "../src/game/profanity";
import { applySettingsPatch } from "../src/game/settings";

const AV = { head: 0, color: 0, eyes: 0, mouth: 0, top: 0 };
const DRAW_MS = 60_000;
const VOTE_MS = TIMING.drawOffVoteSeconds * 1000;

/** Records what each player receives. */
class Recorder implements RoomTransport {
  views = new Map<string, RoomView>();
  entries = new Map<string, DrawOffEntry[]>();
  canvases = new Map<string, unknown[][]>();
  relayedDraws = 0;
  notices: string[] = [];
  members: () => string[] = () => [];
  send: RoomTransport["send"] = (to, event, ...args) => {
    if (event === "room:state") this.views.set(to, args[0] as RoomView);
    if (event === "drawoff:entries") this.entries.set(to, args[0] as DrawOffEntry[]);
    if (event === "drawoff:canvas") this.canvases.set(to, [...(this.canvases.get(to) ?? []), args[0] as unknown[]]);
    if (event === "notice") this.notices.push(args[0] as string);
  };
  broadcast: RoomTransport["broadcast"] = (event, args, except) => {
    if (event === "draw") this.relayedDraws++;
    for (const id of this.members()) if (id !== except) (this.send as (to: string, e: string, ...a: unknown[]) => void)(id, event, ...args);
  };
  removed: RoomTransport["removed"] = () => {};
  view(id: string) {
    return this.views.get(id)!;
  }
  d(id: string) {
    return this.view(id).drawOff!;
  }
}

function setup(players = 3, settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const io = new Recorder();
  const room = new Room("DRAW23", false, { ...DEFAULT_SETTINGS, mode: "drawoff", drawOffTime: DRAW_MS / 1000, rounds: 2, ...settings }, io, () => {}, () => 0);
  io.members = () => [...room.players.keys()];
  const ids: string[] = [];
  for (let i = 0; i < players; i++) {
    room.addPlayer({ id: `p${i}`, clientId: `c${i}`, ip: "", name: `P${i}`, avatar: AV });
    ids.push(`p${i}`);
  }
  return { io, room, ids };
}

const stroke = (id = 1) => [
  { k: "begin", id, color: "#ff0000", size: 8, x: 10, y: 10, p: 1 },
  { k: "pts", id, pts: [50, 50, 1, 90, 90, 1] },
  { k: "end", id },
];

/** Who drew the drawing on screen, according to the players' own views. */
const authorOfCurrent = (io: Recorder, ids: string[]) => ids.find((id) => io.d(id).current?.isYours);

/** Every eligible player rates the drawing on screen. */
function voteAll(room: Room, io: Recorder, ids: string[], stars: (voter: string) => number) {
  const cur = io.d(ids[0]).current!;
  for (const id of ids) if (io.d(id).current?.canVote) room.vote(id, cur.entryId, stars(id));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Draw-Off: starting", () => {
  it("needs at least 3 players", () => {
    const { room, io } = setup(2);
    room.requestStart("p0");
    expect(room.phase).toBe("lobby");
    expect(io.notices.at(-1)).toMatch(/at least 3/);
    room.addPlayer({ id: "p2", clientId: "c2", ip: "", name: "P2", avatar: AV });
    room.requestStart("p0");
    expect(room.phase).toBe("drawoff_drawing");
  });

  it("gives every player the same theme and a countdown from the host's draw time", () => {
    const { room, io, ids } = setup(3, { drawOffTime: 45 });
    room.requestStart("p0");
    const themes = ids.map((id) => io.d(id).theme);
    expect(new Set(themes).size).toBe(1);
    expect(themes[0]).toBeTruthy();
    expect(io.view("p1").phaseEndsAt! - Date.now()).toBe(45_000);
    expect(io.d("p1").spectating).toBe(false);
  });

  it("public rooms always play guessing", () => {
    const io = new Recorder();
    const room = new Room("PUB234", true, { ...DEFAULT_SETTINGS, mode: "drawoff" }, io);
    io.members = () => [...room.players.keys()];
    for (let i = 0; i < 3; i++) room.addPlayer({ id: `p${i}`, clientId: `c${i}`, ip: "", name: `P${i}`, avatar: AV });
    vi.advanceTimersByTime(TIMING.publicAutoStartSeconds * 1000);
    expect(room.phase).toBe("choosing");
  });
});

describe("Draw-Off: drawing", () => {
  it("keeps every canvas private", () => {
    const { room, io } = setup();
    room.requestStart("p0");
    room.handleDraw("p0", stroke());
    expect(io.relayedDraws).toBe(0);
    expect(room.drawOff.canvasOf("p0").length).toBe(1);
    expect(room.drawOff.canvasOf("p1").length).toBe(0);
  });

  it("submits every drawing when time runs out, empty ones included", () => {
    const { room, io, ids } = setup();
    room.requestStart("p0");
    room.handleDraw("p0", stroke());
    vi.advanceTimersByTime(DRAW_MS);
    expect(room.phase).toBe("drawoff_voting");
    const entries = io.entries.get("p1")!;
    expect(entries).toHaveLength(3);
    expect(entries.filter((e) => e.actions.length > 0)).toHaveLength(1);
    // Anonymous: entries carry no player ids.
    expect(JSON.stringify(entries)).not.toMatch(/"p[0-9]"/);
    expect(io.d("p0").current).toMatchObject({ index: 1, total: 3 });
    expect(authorOfCurrent(io, ids)).toBeDefined();
  });

  it("includes a stroke still being drawn when time runs out", () => {
    const { room, io } = setup();
    room.requestStart("p0");
    room.handleDraw("p0", stroke().slice(0, 2)); // no "end"
    vi.advanceTimersByTime(DRAW_MS);
    expect(io.entries.get("p1")!.some((e) => e.actions.length === 1)).toBe(true);
  });
});

describe("Draw-Off: voting", () => {
  function voting() {
    const ctx = setup(4);
    ctx.room.requestStart("p0");
    vi.advanceTimersByTime(DRAW_MS);
    return ctx;
  }

  it("blocks votes on your own drawing and from bad input", () => {
    const { room, io, ids } = voting();
    const author = authorOfCurrent(io, ids)!;
    const cur = io.d(author).current!;
    expect(cur.canVote).toBe(false);
    room.vote(author, cur.entryId, 5);
    const other = ids.find((id) => id !== author)!;
    room.vote(other, cur.entryId, 9);
    room.vote(other, cur.entryId, 2.5);
    room.vote(other, "nope", 4);
    expect(io.d(other).current!.votesIn).toBe(0);
  });

  it("counts one vote per player per drawing; a repeat replaces the first", () => {
    const { room, io, ids } = voting();
    const author = authorOfCurrent(io, ids)!;
    const other = ids.find((id) => id !== author)!;
    const { entryId } = io.d(other).current!;
    room.vote(other, entryId, 2);
    room.vote(other, entryId, 5);
    expect(io.d(other).current).toMatchObject({ votesIn: 1, yourStars: 5, votersNeeded: 3 });
  });

  it("rejects late votes for a drawing that has moved on", () => {
    const { room, io, ids } = voting();
    const first = io.d("p0").current!.entryId;
    vi.advanceTimersByTime(VOTE_MS);
    expect(io.d("p0").current!.index).toBe(2);
    for (const id of ids) room.vote(id, first, 5);
    vi.advanceTimersByTime(VOTE_MS * 3);
    // The first drawing got no votes, so it sits at the 1-star floor.
    const res = io.view("p0").drawOff!.results!.find((r) => r.entryId === first)!;
    expect(res).toMatchObject({ votes: 0, rating: 1, points: 100 });
  });

  it("moves on early once everyone eligible has voted", () => {
    const { room, io, ids } = voting();
    voteAll(room, io, ids, () => 4);
    expect(io.d("p0").current!.index).toBe(1);
    vi.advanceTimersByTime(800);
    expect(io.d("p0").current!.index).toBe(2);
  });

  it("scores by average stars with a 1-star floor, then reveals names and ranks", () => {
    const { room, io, ids } = voting();
    const ratings = new Map<string, number>();
    for (let i = 0; i < 4; i++) {
      const author = authorOfCurrent(io, ids)!;
      // Authors get 5, 3, 0 votes (floor), 2 stars respectively.
      const plan = [5, 3, 0, 2][i];
      if (plan) voteAll(room, io, ids, () => plan);
      ratings.set(author, plan || 1);
      vi.advanceTimersByTime(plan ? 800 : VOTE_MS);
    }
    expect(room.phase).toBe("drawoff_results");
    const results = io.view("p0").drawOff!.results!;
    expect(results.map((r) => r.rating)).toEqual([5, 3, 2, 1]);
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    for (const r of results) {
      expect(r.rating).toBe(ratings.get(r.playerId));
      expect(r.points).toBe(r.rating * 100);
      expect(room.players.get(r.playerId)!.score).toBe(r.points);
    }
  });

  it("averages mixed votes", () => {
    expect(drawOffRating([])).toBe(1);
    expect(drawOffRating([5, 4])).toBe(4.5);
    expect(drawOffRating([1, 2, 2])).toBe(1.67);
    expect(drawOffPoints(4.5)).toBe(450);
  });
});

describe("Draw-Off: rounds", () => {
  it("runs results, gallery, the next round with a new theme, then the podium and lobby", () => {
    const { room, io } = setup(3, { rounds: 2 });
    room.requestStart("p0");
    const theme1 = io.d("p0").theme;
    vi.advanceTimersByTime(DRAW_MS + VOTE_MS * 3);
    expect(room.phase).toBe("drawoff_results");
    vi.advanceTimersByTime(TIMING.drawOffResultsSeconds * 1000);
    expect(room.phase).toBe("drawoff_gallery");
    expect(io.d("p0").results).toHaveLength(3);
    room.hostContinue("p1"); // not the host
    expect(room.phase).toBe("drawoff_gallery");
    room.hostContinue("p0");
    expect(room.phase).toBe("drawoff_drawing");
    expect(room.round).toBe(2);
    expect(io.d("p0").theme).not.toBe(theme1);
    vi.advanceTimersByTime(DRAW_MS + VOTE_MS * 3 + (TIMING.drawOffResultsSeconds + TIMING.drawOffGallerySeconds) * 1000);
    expect(room.phase).toBe("podium");
    expect(io.view("p0").podium!.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(TIMING.podiumSeconds * 1000);
    expect(room.phase).toBe("lobby");
    expect(room.settings).toMatchObject({ mode: "drawoff", rounds: 2 });
  });
});

describe("Draw-Off: players coming and going", () => {
  it("drops a drawing when its artist leaves mid-drawing; voting still works", () => {
    const { room, io } = setup(4);
    room.requestStart("p0");
    room.removePlayer("p3");
    vi.advanceTimersByTime(DRAW_MS);
    expect(io.entries.get("p0")).toHaveLength(3);
    expect(io.d("p0").current!.total).toBe(3);
  });

  it("skips a drawing on screen when its artist leaves during voting, and keeps their votes", () => {
    const { room, io, ids } = setup(4);
    room.requestStart("p0");
    vi.advanceTimersByTime(DRAW_MS);
    const author = authorOfCurrent(io, ids)!;
    const leaver = ids.find((id) => id !== author)!;
    room.vote(leaver, io.d(leaver).current!.entryId, 5);
    // Advance to a drawing by the leaver, then make them leave.
    let guard = 0;
    while (authorOfCurrent(io, ids) !== leaver && guard++ < 5) vi.advanceTimersByTime(VOTE_MS);
    expect(authorOfCurrent(io, ids)).toBe(leaver);
    const watcher = ids.find((id) => id !== leaver)!;
    const before = io.d(watcher).current!;
    room.removePlayer(leaver);
    const after = io.d(watcher).current;
    // Either the next drawing is on screen, or theirs was the last and results are up.
    if (after) {
      expect(after.entryId).not.toBe(before.entryId);
      expect(after.total).toBe(3);
    } else expect(room.phase).toBe("drawoff_results");
    for (let i = 0; i < 5 && room.phase === "drawoff_voting"; i++) vi.advanceTimersByTime(VOTE_MS);
    expect(room.phase).toBe("drawoff_results");
    const results = io.view(watcher).drawOff!.results!;
    expect(results).toHaveLength(3);
    expect(results.find((r) => r.playerId === author)!.votes).toBe(1);
  });

  it("returns to the lobby if fewer than 3 players remain", () => {
    const { room } = setup(3);
    room.requestStart("p0");
    room.removePlayer("p2");
    expect(room.phase).toBe("lobby");
  });

  it("makes mid-round joiners wait for the next round", () => {
    const { room, io } = setup(3);
    room.requestStart("p0");
    room.addPlayer({ id: "late", clientId: "cl", ip: "", name: "Late", avatar: AV });
    expect(io.d("late").spectating).toBe(true);
    room.handleDraw("late", stroke());
    expect(room.drawOff.canvasOf("late")).toHaveLength(0);
    vi.advanceTimersByTime(DRAW_MS);
    expect(io.entries.get("late")).toHaveLength(3); // can watch the vote
    expect(io.d("late").current!.canVote).toBe(false);
    room.vote("late", io.d("late").current!.entryId, 5);
    expect(io.d("p0").current!.votesIn).toBe(0);
    vi.advanceTimersByTime(VOTE_MS * 3 + (TIMING.drawOffResultsSeconds + TIMING.drawOffGallerySeconds) * 1000);
    expect(room.phase).toBe("drawoff_drawing");
    expect(io.d("late").spectating).toBe(false);
  });

  it("gives a player back their drawing if they reload mid-drawing", () => {
    const { room, io } = setup(4);
    room.requestStart("p0");
    room.handleDraw("p1", stroke());
    room.removePlayer("p1");
    room.addPlayer({ id: "p1b", clientId: "c1", ip: "", name: "P1", avatar: AV });
    expect(io.d("p1b").spectating).toBe(false);
    expect(io.canvases.get("p1b")!.at(-1)).toHaveLength(1);
    vi.advanceTimersByTime(DRAW_MS);
    expect(io.entries.get("p0")!.filter((e) => e.actions.length)).toHaveLength(1);
  });
});

describe("Draw-Off: themes and settings", () => {
  it("ships 50+ unique, family-friendly themes of 1-2 words", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(50);
    for (const t of THEMES) expect(t.split(/\s+/).length, t).toBeLessThanOrEqual(2);
    expect(new Set(THEMES.map((t) => t.toLowerCase())).size).toBe(THEMES.length);
    for (const t of THEMES) expect(containsProfanity(t), t).toBe(false);
  });

  it("doesn't repeat a theme until all are used", () => {
    const used = new Set<string>();
    for (let i = 0; i < THEMES.length; i++) {
      const t = pickTheme(used);
      expect(used.has(t)).toBe(false);
      used.add(t);
    }
    expect(THEMES).toContain(pickTheme(used));
  });

  it("reads the host's themes: commas or new lines, tidy, no repeats, nothing rude, capped", () => {
    expect(containsProfanity("shit")).toBe(true);
    expect(parseCustomThemes(" Jeepney ,my family\nRainy   Day,,jeepney, shit\n")).toEqual(["Jeepney", "my family", "Rainy Day"]);
    expect(parseCustomThemes("x".repeat(100))[0]).toHaveLength(32);
    expect(parseCustomThemes(Array.from({ length: 80 }, (_, i) => `Theme ${i}`).join(","))).toHaveLength(50);
    expect(parseCustomThemes("")).toEqual([]);
  });

  it("keeps line breaks in the setting, drops other control characters, caps the length", () => {
    const s = applySettingsPatch(DEFAULT_SETTINGS, { customThemes: "Dog\nCat\u0007Bird​" }, 1);
    expect(s.customThemes).toBe("Dog\nCat Bird ");
    expect(applySettingsPatch(DEFAULT_SETTINGS, { customThemes: "a".repeat(5000) }, 1).customThemes).toHaveLength(1500);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { customThemes: 42 }, 1).customThemes).toBe("");
  });

  it("plays the host's themes first, then built-in ones, without repeats", () => {
    const { room, io } = setup(3, { rounds: 3 });
    room.updateSettings("p0", { customThemes: "Jeepney, Rainy Day" });
    room.requestStart("p0");
    const seen: string[] = [];
    for (let r = 0; r < 3; r++) {
      seen.push(io.d("p0").theme!);
      vi.advanceTimersByTime(DRAW_MS + VOTE_MS * 3 + (TIMING.drawOffResultsSeconds + TIMING.drawOffGallerySeconds) * 1000);
    }
    expect(seen.slice(0, 2).sort()).toEqual(["Jeepney", "Rainy Day"]);
    expect(THEMES).toContain(seen[2]);
    expect(room.phase).toBe("podium");
  });

  it("only the host can set themes, and only the host sees them", () => {
    const { room, io } = setup(3);
    room.updateSettings("p1", { customThemes: "Not allowed" });
    expect(room.settings.customThemes).toBe("");
    room.updateSettings("p0", { customThemes: "Jeepney, Rainy Day, shit" });
    expect(io.view("p0").settings.customThemes).toBe("Jeepney, Rainy Day, shit");
    expect(io.view("p1").settings.customThemes).toBe("");
    expect(io.view("p1").customThemeCount).toBe(2);
    expect(io.view("p0").customThemeCount).toBe(2);
  });

  it("uses a single host theme once, then built-in ones", () => {
    const used = new Set<string>();
    expect(pickDrawOffTheme(used, ["Jeepney"], () => 0)).toBe("Jeepney");
    used.add("Jeepney");
    expect(THEMES).toContain(pickDrawOffTheme(used, ["Jeepney"], () => 0));
  });

  it("validates the mode and draw time", () => {
    const s = applySettingsPatch(DEFAULT_SETTINGS, { mode: "drawoff", drawOffTime: 5 }, 1);
    expect(s).toMatchObject({ mode: "drawoff", drawOffTime: 30 });
    expect(applySettingsPatch(s, { mode: "battle-royale", drawOffTime: 999 }, 1)).toMatchObject({ mode: "drawoff", drawOffTime: 240 });
  });
});
