import { randomBytes } from "node:crypto";
import { DRAWOFF_MIN_PLAYERS, TIMING, type Avatar, type DrawAction, type DrawOffResult, type DrawOffView } from "@inkwave/shared";
import { CanvasState } from "./CanvasState";
import type { GameMode, ModeView, Player, RoomContext } from "./GameMode";
import { pickTheme } from "./themes";

/** Each player's drawing is capped lower than a guessing turn, since every drawing is sent to everyone. */
const MAX_POINTS_PER_DRAWING = 30_000;
/** After the last eligible vote, wait this long so the voter sees their stars land. */
const LAST_VOTE_PAUSE_MS = 800;

interface Entry {
  entryId: string;
  playerId: string;
  name: string;
  avatar: Avatar;
  actions: DrawAction[];
}

/** Average stars, or 1 when nobody voted, so a drawing never scores below the 1-star floor. */
export function drawOffRating(stars: number[]): number {
  if (stars.length === 0) return 1;
  const avg = stars.reduce((a, b) => a + b, 0) / stars.length;
  return Math.round(avg * 100) / 100;
}

/** Points for a round: rating × 100 (100 to 500). */
export const drawOffPoints = (rating: number) => Math.round(rating * 100);

/**
 * Draw-Off: every round, everyone draws the same theme on a private canvas.
 * Drawings are submitted automatically when time runs out, shown one at a
 * time without names for 1-5 star ratings, then revealed with points and a
 * gallery.
 */
export class DrawOffMode implements GameMode {
  readonly minPlayers = DRAWOFF_MIN_PLAYERS;
  readonly tooFewPlayersMessage = `Draw-Off needs at least ${DRAWOFF_MIN_PLAYERS} players.`;

  theme: string | null = null;
  private usedThemes = new Set<string>();
  /** Players drawing this round (joiners wait for the next round). */
  private participants = new Set<string>();
  private canvases = new Map<string, CanvasState>();
  /** Submitted drawings, in voting order. */
  private entries: Entry[] = [];
  private voteIndex = 0;
  /** entryId → voterId → stars. */
  private votes = new Map<string, Map<string, number>>();
  private results: DrawOffResult[] | null = null;
  /** Changes whenever the drawing on screen changes, so delayed timers know if they're stale. */
  private step = 0;

  constructor(private readonly room: RoomContext) {}

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  start(): void {
    this.usedThemes.clear();
    this.beginRound();
  }

  reset(): void {
    this.theme = null;
    this.participants.clear();
    this.canvases.clear();
    this.entries = [];
    this.votes.clear();
    this.results = null;
    this.voteIndex = 0;
    this.step++;
  }

  private beginRound(): void {
    const room = this.room;
    room.clearTimers();
    this.theme = pickTheme(this.usedThemes, room.rand);
    this.usedThemes.add(this.theme);
    this.participants = new Set(room.players.keys());
    this.canvases = new Map([...this.participants].map((id) => [id, new CanvasState(MAX_POINTS_PER_DRAWING)]));
    this.entries = [];
    this.votes = new Map();
    this.results = null;
    this.voteIndex = 0;
    this.step++;

    const ms = room.settings.drawOffTime * 1000;
    room.setPhase("drawoff_drawing", Date.now() + ms);
    room.io.broadcast("drawoff:canvas", [[]]);
    room.system(`Round ${room.round} of ${room.settings.rounds}: draw "${this.theme}"`);
    room.later(ms, () => this.submitAll());
    room.sync();
  }

  /** Time's up: everyone's canvas becomes an entry, empty ones included. */
  private submitAll(): void {
    const room = this.room;
    room.clearTimers();
    this.entries = [...this.participants]
      .map((id) => room.players.get(id))
      .filter((p): p is Player => !!p)
      .map((p) => ({
        entryId: randomBytes(6).toString("hex"),
        playerId: p.id,
        name: p.name,
        avatar: p.avatar,
        actions: this.canvases.get(p.id)?.snapshot() ?? [],
      }));
    // Shuffle so the order doesn't give away who drew what.
    for (let i = this.entries.length - 1; i > 0; i--) {
      const j = Math.floor(room.rand() * (i + 1));
      [this.entries[i], this.entries[j]] = [this.entries[j], this.entries[i]];
    }
    this.canvases.clear();
    room.io.broadcast("drawoff:entries", [this.entries.map(({ entryId, actions }) => ({ entryId, actions }))]);
    room.system("Time's up! Rate each drawing from 1 to 5 stars.");
    this.voteIndex = 0;
    this.showEntry();
  }

  private eligibleVoters(entry: Entry): string[] {
    return [...this.participants].filter((id) => id !== entry.playerId && this.room.players.has(id));
  }

  private allVoted(entry: Entry): boolean {
    const got = this.votes.get(entry.entryId);
    return this.eligibleVoters(entry).every((id) => got?.has(id));
  }

  /** Puts entries[voteIndex] on screen, skipping any nobody can rate; ends voting after the last. */
  private showEntry(): void {
    const room = this.room;
    room.clearTimers();
    while (this.voteIndex < this.entries.length && this.eligibleVoters(this.entries[this.voteIndex]).length === 0) this.voteIndex++;
    if (this.voteIndex >= this.entries.length) return this.finishVoting();
    const step = ++this.step;
    const ms = TIMING.drawOffVoteSeconds * 1000;
    room.setPhase("drawoff_voting", Date.now() + ms);
    room.later(ms, () => step === this.step && this.advance());
    room.sync();
  }

  private advance(): void {
    this.voteIndex++;
    this.showEntry();
  }

  /** Moves on shortly once everyone who can rate the drawing on screen has. */
  private advanceIfAllVoted(): void {
    const entry = this.entries[this.voteIndex];
    if (!entry || !this.allVoted(entry)) return;
    const step = this.step;
    const room = this.room;
    room.setPhase("drawoff_voting", Math.min(room.phaseEndsAt ?? Infinity, Date.now() + LAST_VOTE_PAUSE_MS));
    room.later(LAST_VOTE_PAUSE_MS, () => step === this.step && this.advance());
  }

  vote(byId: string, entryId: unknown, stars: unknown): void {
    if (this.room.phase !== "drawoff_voting") return;
    const entry = this.entries[this.voteIndex];
    // Late votes (for a drawing that has moved on) and votes on your own drawing don't count.
    if (!entry || entry.entryId !== entryId || byId === entry.playerId) return;
    if (!this.participants.has(byId) || !this.room.players.has(byId)) return;
    const n = Number(stars);
    if (!Number.isInteger(n) || n < 1 || n > 5) return;
    const got = this.votes.get(entry.entryId) ?? new Map<string, number>();
    got.set(byId, n); // a repeat vote replaces the earlier one
    this.votes.set(entry.entryId, got);
    this.advanceIfAllVoted();
    this.room.sync();
  }

  private finishVoting(): void {
    const room = this.room;
    room.clearTimers();
    const scored = this.entries.map((e) => {
      const rating = drawOffRating([...(this.votes.get(e.entryId)?.values() ?? [])]);
      const points = drawOffPoints(rating);
      const p = room.players.get(e.playerId);
      if (p) p.score += points;
      return { entryId: e.entryId, playerId: e.playerId, name: e.name, avatar: e.avatar, rating, votes: this.votes.get(e.entryId)?.size ?? 0, points, rank: 0 };
    });
    scored.sort((a, b) => b.rating - a.rating || b.votes - a.votes);
    scored.forEach((r, i) => (r.rank = i > 0 && r.rating === scored[i - 1].rating ? scored[i - 1].rank : i + 1));
    this.results = scored;
    if (scored[0]) room.system(`${scored[0].name} drew the top-rated "${this.theme}" (${scored[0].rating.toFixed(1)} stars)!`);
    room.setPhase("drawoff_results", Date.now() + TIMING.drawOffResultsSeconds * 1000);
    room.later(TIMING.drawOffResultsSeconds * 1000, () => this.showGallery());
    room.sync();
  }

  private showGallery(): void {
    const room = this.room;
    room.clearTimers();
    room.setPhase("drawoff_gallery", Date.now() + TIMING.drawOffGallerySeconds * 1000);
    room.later(TIMING.drawOffGallerySeconds * 1000, () => this.finishRound());
    room.sync();
  }

  hostContinue(): void {
    if (this.room.phase === "drawoff_gallery") this.finishRound();
  }

  private finishRound(): void {
    const room = this.room;
    room.clearTimers();
    if (room.round >= room.settings.rounds) return room.endGame();
    room.round++;
    this.beginRound();
  }

  /* ---------------------------------------------------------------- */
  /* Players coming and going                                          */
  /* ---------------------------------------------------------------- */

  onJoin(p: Player, rejoin?: { oldId: string; data: unknown }): void {
    const room = this.room;
    const phase = room.phase;
    const saved = rejoin?.data as { actions: DrawAction[] } | undefined;
    if (phase === "drawoff_drawing" && rejoin && saved?.actions) {
      // Back after a reload while drawing: same seat, same picture.
      this.participants.delete(rejoin.oldId);
      this.participants.add(p.id);
      const c = new CanvasState(MAX_POINTS_PER_DRAWING);
      c.load(saved.actions);
      this.canvases.set(p.id, c);
      room.io.send(p.id, "drawoff:canvas", c.snapshot());
    } else {
      // Everyone else joining mid-round watches and plays from the next round.
      room.io.send(p.id, "drawoff:canvas", []);
    }
    if (phase === "drawoff_voting" || phase === "drawoff_results" || phase === "drawoff_gallery") {
      room.io.send(p.id, "drawoff:entries", this.entries.map(({ entryId, actions }) => ({ entryId, actions })));
    }
  }

  ghostData(p: Player): unknown {
    if (this.room.phase === "drawoff_drawing" && this.participants.has(p.id)) {
      return { actions: this.canvases.get(p.id)?.snapshot() ?? [] };
    }
    return null;
  }

  onLeave(playerId: string): boolean {
    const phase = this.room.phase;
    this.participants.delete(playerId);
    this.canvases.delete(playerId);
    if (phase !== "drawoff_voting") return false;

    // Drop their drawing from the vote. Votes they already cast still count.
    const idx = this.entries.findIndex((e) => e.playerId === playerId);
    if (idx >= 0) {
      this.votes.delete(this.entries[idx].entryId);
      this.entries.splice(idx, 1);
      if (idx < this.voteIndex) this.voteIndex--;
      else if (idx === this.voteIndex) {
        // Their drawing was on screen: show the next one.
        this.showEntry();
        return true;
      }
    }
    // They may have been the last vote the drawing on screen was waiting for.
    this.advanceIfAllVoted();
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Drawing, chat and view                                            */
  /* ---------------------------------------------------------------- */

  handleDraw(byId: string, ops: unknown[]): void {
    if (this.room.phase !== "drawoff_drawing") return;
    const canvas = this.canvases.get(byId);
    const p = this.room.players.get(byId);
    if (!canvas || !p || !p.drawLimit.take()) return;
    // Private: kept on the server, never relayed to other players.
    canvas.ingest(ops);
  }

  handleChat(): boolean {
    return false; // plain chat in Draw-Off
  }

  /** The drawing a player has made so far this round (for tests). */
  canvasOf(playerId: string): readonly DrawAction[] {
    return this.canvases.get(playerId)?.actions ?? [];
  }

  view(playerId: string): ModeView {
    const phase = this.room.phase;
    const active = phase.startsWith("drawoff_");
    let current: DrawOffView["current"] = null;
    if (phase === "drawoff_voting") {
      const entry = this.entries[this.voteIndex];
      if (entry) {
        const voters = this.eligibleVoters(entry);
        const got = this.votes.get(entry.entryId);
        current = {
          entryId: entry.entryId,
          index: this.voteIndex + 1,
          total: this.entries.length,
          isYours: entry.playerId === playerId,
          canVote: voters.includes(playerId),
          yourStars: got?.get(playerId) ?? null,
          votesIn: voters.filter((v) => got?.has(v)).length,
          votersNeeded: voters.length,
        };
      }
    }
    return {
      drawerId: null,
      pattern: null,
      word: null,
      choices: null,
      reveal: null,
      drawOff: active
        ? {
            theme: this.theme,
            spectating: !this.participants.has(playerId),
            participantIds: [...this.participants],
            current,
            results: phase === "drawoff_results" || phase === "drawoff_gallery" ? this.results : null,
          }
        : null,
    };
  }
}
