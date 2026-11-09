import { useEffect, useRef, useState } from "react";
import { reactionsFor } from "@inkwave/shared";
import { useGame } from "../lib/game";
import { useMuted } from "../lib/muted";
import { sfx } from "../lib/sound";

/** Same limit as the server (4 in a row, then one a second), so taps never vanish silently. */
function useBucket(capacity: number, perSecond: number) {
  const state = useRef({ tokens: capacity, at: Date.now() });
  return () => {
    const s = state.current;
    const now = Date.now();
    s.tokens = Math.min(capacity, s.tokens + ((now - s.at) / 1000) * perSecond);
    s.at = now;
    if (s.tokens < 1) return false;
    s.tokens -= 1;
    return true;
  };
}

/** A row of emoji buttons for the current game mode. */
export function ReactionBar() {
  const g = useGame();
  const view = g.view!;
  const take = useBucket(4, 1);
  const [cool, setCool] = useState(false);
  const emojis = reactionsFor(view.settings.mode, view.isPublic);
  const send = (e: string) => {
    if (!take()) {
      setCool(true);
      setTimeout(() => setCool(false), 700);
      return;
    }
    g.react(e);
  };
  return (
    <div className={`reaction-bar ${cool ? "cool" : ""}`} role="group" aria-label="Send a reaction">
      {emojis.map((e) => (
        <button key={e} type="button" className="react-btn" aria-label={`React ${e}`} onClick={() => send(e)}>
          {e}
        </button>
      ))}
    </div>
  );
}

interface Floater {
  id: number;
  emoji: string;
  name: string;
  x: number;
  y: number;
  drift: number;
}

/**
 * Everyone's reactions float up over the board with the sender's name.
 * Reactions from players you muted are hidden.
 */
export function ReactionLayer() {
  const g = useGame();
  const muted = useMuted();
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const next = useRef(0);
  const lastSound = useRef(0);
  const players = useRef(g.view?.players ?? []);
  players.current = g.view?.players ?? players.current;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(
    () =>
      g.onReact(({ playerId, emoji }) => {
        if (mutedRef.current.has(playerId)) return;
        const frame = (document.querySelector(".board .canvas-frame") ?? document.querySelector(".board")) as HTMLElement | null;
        const r = frame?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        const f: Floater = {
          id: next.current++,
          emoji,
          name: players.current.find((p) => p.id === playerId)?.name ?? "",
          x: r.left + r.width * (0.12 + Math.random() * 0.76),
          y: r.top + r.height * 0.85,
          drift: Math.round((Math.random() - 0.5) * 60),
        };
        setFloaters((list) => [...list.slice(-23), f]); // at most 24 on screen
        setTimeout(() => setFloaters((list) => list.filter((x) => x.id !== f.id)), 2600);
        if (Date.now() - lastSound.current > 180) {
          lastSound.current = Date.now();
          sfx.react();
        }
      }),
    [g],
  );

  return (
    <div className="reaction-layer" aria-live="polite">
      {floaters.map((f) => (
        <div key={f.id} className="floater" style={{ left: f.x, top: f.y, ["--drift" as string]: `${f.drift}px` }}>
          <span className="f-emoji">{f.emoji}</span>
          {f.name && <span className="f-name">{f.name}</span>}
        </div>
      ))}
    </div>
  );
}
