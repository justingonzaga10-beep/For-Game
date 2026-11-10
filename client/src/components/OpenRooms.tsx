import { useEffect, useState } from "react";
import type { OpenRoom } from "@inkwave/shared";
import { useGame } from "../lib/game";
import { Avatar } from "./Avatar";

const MODE_NAMES = { guess: "Guessing", drawoff: "Draw-Off", perimeter: "Perimeter", area: "Area" } as const;
/** How often the list refreshes while the page is open and on screen. */
const REFRESH_MS = 6000;

function ago(seconds: number): string {
  if (seconds < 60) return "just now";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ago`;
}

/**
 * Private rooms waiting to start, newest first, so students can tap their
 * teacher's room instead of typing a code. Refreshes only while the page is
 * visible, so an idle tab doesn't keep asking the server.
 */
export function OpenRooms({ onJoin, busy }: { onJoin: (code: string) => void; busy: string }) {
  const g = useGame();
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null);

  useEffect(() => {
    if (!g.connected) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") {
        const list = await g.listRooms();
        if (alive) setRooms(list);
      }
      if (alive) timer = setTimeout(refresh, REFRESH_MS);
    };
    const onVisible = () => document.visibilityState === "visible" && refresh();
    refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [g.connected, g]);

  return (
    <section className="panel cabinet open-rooms" aria-label="Open rooms">
      <div className="open-rooms-head">
        <h2 className="side-h">Open rooms</h2>
        <small className="muted">Rooms waiting to start. Tap one to join.</small>
      </div>
      {rooms === null ? (
        <p className="muted open-empty">Looking for rooms…</p>
      ) : rooms.length === 0 ? (
        <p className="muted open-empty">No open rooms right now. Create one and it will show up here.</p>
      ) : (
        <ul className="open-list">
          {rooms.map((r) => (
            <li key={r.code} data-code={r.code}>
              <Avatar avatar={r.hostAvatar} size={36} />
              <span className="open-who">
                <b>{r.hostName}'s room</b>
                <small>
                  {MODE_NAMES[r.mode]} · {r.players}/{r.maxPlayers} players · {ago(r.age)}
                </small>
              </span>
              <span className="open-code">{r.code}</span>
              <button type="button" className="btn primary small" disabled={!!busy || !g.connected} aria-label={`Join ${r.hostName}'s room`} onClick={() => onJoin(r.code)}>
                {busy === r.code ? "Joining…" : "Join"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
