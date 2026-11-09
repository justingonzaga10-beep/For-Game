import { useEffect, useRef, useState } from "react";
import { useGame } from "../lib/game";
import { useMuted } from "../lib/muted";
import { sfx } from "../lib/sound";

/** How long the blob takes to fly from the thrower to the target. */
export const FLIGHT_MS = 450;

/** A paint splat shape: a wobbly blob with droplets around it, different for each seed. */
export function Splat({ color, seed, className, drips = false }: { color: string; seed: number; className?: string; drips?: boolean }) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
  // A smooth, lumpy blob: a curve through the midpoints of points at random distances.
  const n = 14;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 31 + rnd() * 9 + (i % 4 === 0 ? 6 + rnd() * 8 : 0);
    pts.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
  }
  const mid = (i: number) => {
    const [ax, ay] = pts[i % n];
    const [bx, by] = pts[(i + 1) % n];
    return `${((ax + bx) / 2).toFixed(1)},${((ay + by) / 2).toFixed(1)}`;
  };
  const blob = `M${mid(0)} ` + pts.map((_, i) => `Q${pts[(i + 1) % n][0].toFixed(1)},${pts[(i + 1) % n][1].toFixed(1)} ${mid(i + 1)}`).join(" ") + "Z";
  const drops = Array.from({ length: 6 }, () => {
    const a = rnd() * Math.PI * 2;
    const d = 46 + rnd() * 6;
    return { x: 50 + Math.cos(a) * d, y: 50 + Math.sin(a) * d, r: 2 + rnd() * 4 };
  });
  return (
    <svg className={className} viewBox="-10 -10 120 140" aria-hidden="true">
      <path d={blob} fill={color} />
      {drops.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={color} />
      ))}
      {drips &&
        [32, 50, 63].map((x, i) => (
          <rect key={i} className="drip" x={x - 3} y={70} width={6 + (i % 2) * 2} height={34} rx={4} fill={color} style={{ animationDelay: `${0.3 + i * 0.25}s` }} />
        ))}
    </svg>
  );
}

interface Flight {
  id: number;
  color: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
}
interface ScreenSplat {
  id: number;
  color: string;
  name: string;
  left: string;
  top: string;
}

/** Where a player's avatar is on screen, if their row is showing. */
function avatarPoint(id: string): { x: number; y: number } | null {
  const el = document.querySelector(`.scoreboard li[data-player-id="${CSS.escape(id)}"] .avatar-slot`);
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

/**
 * Paint flying between players' rows, and the big splat on your own screen
 * when someone throws paint at you. Splats sit at the edge of the screen,
 * never block clicks, and fade in a few seconds.
 */
export function PaintLayer() {
  const g = useGame();
  const muted = useMuted();
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const players = useRef(g.view?.players ?? []);
  players.current = g.view?.players ?? players.current;
  const me = g.view?.you;
  const meRef = useRef(me);
  meRef.current = me;
  const [flights, setFlights] = useState<Flight[]>([]);
  const [splats, setSplats] = useState<ScreenSplat[]>([]);
  const next = useRef(0);

  useEffect(
    () =>
      g.onPaint(({ from, to, color }) => {
        if (mutedRef.current.has(from)) return;
        const a = avatarPoint(from);
        const b = avatarPoint(to);
        if (a && b) {
          const f: Flight = { id: next.current++, color, x: a.x, y: a.y, dx: b.x - a.x, dy: b.y - a.y };
          setFlights((l) => [...l.slice(-7), f]);
          setTimeout(() => setFlights((l) => l.filter((x) => x.id !== f.id)), FLIGHT_MS + 50);
        }
        if (to !== meRef.current && from !== meRef.current) return;
        setTimeout(() => {
          sfx.splat();
          if (to !== meRef.current) return;
          // Splat on my screen, near an edge so the canvas stays clear.
          const side = next.current % 2 === 0;
          const s: ScreenSplat = {
            id: next.current++,
            color,
            name: players.current.find((p) => p.id === from)?.name ?? "Someone",
            left: side ? `${Math.random() * 6 - 4}%` : `calc(${74 + Math.random() * 6}% - 40px)`,
            top: `${12 + Math.random() * 55}%`,
          };
          setSplats((l) => [...l.slice(-2), s]);
          setTimeout(() => setSplats((l) => l.filter((x) => x.id !== s.id)), 4200);
        }, a && b ? FLIGHT_MS : 0);
      }),
    [g],
  );

  return (
    <div className="paint-layer" aria-live="polite">
      {flights.map((f) => (
        <span
          key={f.id}
          className="paint-blob"
          style={{ left: f.x, top: f.y, background: f.color, ["--dx" as string]: `${f.dx}px`, ["--dy" as string]: `${f.dy}px` }}
        />
      ))}
      {splats.map((s) => (
        <div key={s.id} className="screen-splat" style={{ left: s.left, top: s.top }}>
          <Splat color={s.color} seed={s.id * 7919 + 13} drips />
          <p className="splat-note">{s.name} threw paint at you!</p>
        </div>
      ))}
    </div>
  );
}
