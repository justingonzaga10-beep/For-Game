import { useSyncExternalStore } from "react";

/** Locally muted player ids. Only affects this browser's chat. */
const muted = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();

export function toggleMute(id: string) {
  if (muted.has(id)) muted.delete(id);
  else muted.add(id);
  snapshot = new Set(muted);
  listeners.forEach((l) => l());
}

export function useMuted(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}
