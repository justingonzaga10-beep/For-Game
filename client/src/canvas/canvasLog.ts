import type { DrawAction, DrawOp } from "@inkwave/shared";

export type CanvasLogEvent = { type: "replay" } | { type: "ops"; ops: DrawOp[] };

/**
 * A canvas's history: the last full replay plus every op since. The canvas
 * component replays this whenever it mounts (layout switches, tab changes),
 * so nothing is lost if it isn't on screen.
 */
export class CanvasLog {
  base: DrawAction[] = [];
  ops: DrawOp[] = [];
  listeners = new Set<(ev: CanvasLogEvent) => void>();
  replay(actions: DrawAction[]) {
    this.base = actions;
    this.ops = [];
    this.listeners.forEach((l) => l({ type: "replay" }));
  }
  push(ops: DrawOp[], notify: boolean) {
    this.ops.push(...ops);
    if (notify) this.listeners.forEach((l) => l({ type: "ops", ops }));
  }
}

/** Where a canvas reads its picture from, and where the local player's ops go. */
export interface CanvasSource {
  log: CanvasLog;
  /** Sends a batch of the local player's ops (already drawn locally). */
  send: (ops: DrawOp[]) => void;
}
