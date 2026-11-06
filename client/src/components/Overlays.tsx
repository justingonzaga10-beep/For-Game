import { useEffect, useRef } from "react";
import { useCountdown, useGame } from "../lib/game";
import { Avatar } from "./Avatar";

const REASONS = {
  time: "Time's up!",
  all_guessed: "Everyone guessed it!",
  drawer_left: "The drawer left.",
  skipped: "Turn skipped.",
} as const;

export function Overlays() {
  const { view } = useGame();
  if (!view) return null;
  if (view.phase === "choosing") return <ChooseOverlay />;
  if (view.phase === "reveal") return <RevealOverlay />;
  if (view.phase === "podium") return <Podium />;
  return null;
}

function ChooseOverlay() {
  const g = useGame();
  const view = g.view!;
  const left = useCountdown();
  const drawer = view.players.find((p) => p.id === view.drawerId);
  if (view.choices) {
    return (
      <div className="overlay" role="dialog" aria-label="Choose a word">
        <h3>Choose a word</h3>
        <div className="choices">
          {view.choices.map((w, i) => (
            <button key={w} type="button" className="btn choice" autoFocus={i === 0} onClick={() => g.choose(i)}>
              {w}
            </button>
          ))}
        </div>
        <p className="muted">Auto-pick in {left ?? 0} s</p>
      </div>
    );
  }
  return (
    <div className="overlay">
      {drawer && <Avatar avatar={drawer.avatar} size={84} className="bob" />}
      <h3>{drawer?.name ?? "Someone"} is choosing a word…</h3>
    </div>
  );
}

function RevealOverlay() {
  const { view } = useGame();
  const r = view!.reveal;
  if (!r) return null;
  const rows = view!.players
    .map((p) => ({ p, pts: r.gains[p.id] ?? 0 }))
    .sort((a, b) => b.pts - a.pts);
  return (
    <div className="overlay reveal" role="status">
      <p className="reason">{REASONS[r.reason]}</p>
      <h3>
        The word was <span className="the-word">{r.word}</span>
      </h3>
      <ul className="gains">
        {rows.map(({ p, pts }) => (
          <li key={p.id} className={pts > 0 ? "plus" : ""}>
            <Avatar avatar={p.avatar} size={26} />
            <span className="pname">
              {p.name}
              {p.id === view!.drawerId && <small> (drew)</small>}
            </span>
            <b>{pts > 0 ? `+${pts}` : "0"}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Podium() {
  const { view } = useGame();
  const left = useCountdown();
  const top = view!.podium ?? [];
  // Visual order: 2nd, 1st, 3rd.
  const slots = [top.find((t) => t.rank === 2) ?? top[1], top[0], top.find((t) => t.rank === 3) ?? top[2]];
  return (
    <div className="overlay podium-wrap" role="dialog" aria-label="Final results">
      <Confetti />
      <h3 className="podium-title">Final scores</h3>
      <div className="podium">
        {slots.map((e, i) =>
          e ? (
            <div key={e.id} className={`step step-${e.rank}`} style={{ animationDelay: `${[0.35, 0.7, 0][i]}s` }}>
              <Avatar avatar={e.avatar} size={i === 1 ? 86 : 64} />
              <span className="pname">{e.name}</span>
              <span className="score">{e.score}</span>
              <div className="block">{e.rank}</div>
            </div>
          ) : (
            <div key={i} className="step empty" />
          ),
        )}
      </div>
      <p className="muted">Back to the lobby in {left ?? 0} s</p>
    </div>
  );
}

/** Lightweight confetti on a canvas; skipped for reduced motion. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const colors = ["#e8399a", "#f5c42c", "#ffffff", "#ffdc6b", "#f07ab5"];
    let w = 0;
    let h = 0;
    const resize = () => {
      w = c.width = c.offsetWidth * devicePixelRatio;
      h = c.height = c.offsetHeight * devicePixelRatio;
    };
    resize();
    const bits = Array.from({ length: 140 }, () => ({
      x: Math.random() * w,
      y: -Math.random() * h,
      vx: (Math.random() - 0.5) * 2,
      vy: 2 + Math.random() * 3,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      s: (4 + Math.random() * 6) * devicePixelRatio,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0;
    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.x += b.vx;
        b.y += b.vy * devicePixelRatio;
        b.r += b.vr;
        if (b.y > h + 20) {
          b.y = -20;
          b.x = Math.random() * w;
        }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}
