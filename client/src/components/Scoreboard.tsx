import { useEffect, useState } from "react";
import { useGame } from "../lib/game";
import { useMuted } from "../lib/muted";
import { Avatar } from "./Avatar";
import { PlayerActions } from "./PlayerActions";

/** Live ranking with drawing/guessed state and "+points" pops. */
export function Scoreboard() {
  const g = useGame();
  const view = g.view!;
  const muted = useMuted();
  const [pops, setPops] = useState<Record<string, { pts: number; key: number }>>({});

  useEffect(
    () =>
      g.onFx(({ playerId, points }) => {
        const key = Date.now() + Math.random();
        setPops((p) => ({ ...p, [playerId]: { pts: points, key } }));
        setTimeout(() => setPops((p) => (p[playerId]?.key === key ? (({ [playerId]: _, ...rest }) => rest)(p) : p)), 1700);
      }),
    [g],
  );

  // Drawer's points arrive at reveal; pop those too.
  useEffect(() => {
    if (view.phase !== "reveal" || !view.reveal || !view.drawerId) return;
    const pts = view.reveal.gains[view.drawerId];
    if (!pts) return;
    const id = view.drawerId;
    const key = Date.now();
    setPops((p) => ({ ...p, [id]: { pts, key } }));
    const t = setTimeout(() => setPops((p) => (p[id]?.key === key ? (({ [id]: _, ...rest }) => rest)(p) : p)), 1700);
    return () => clearTimeout(t);
  }, [view.phase, view.reveal, view.drawerId]);

  const sorted = [...view.players].sort((a, b) => b.score - a.score);
  let rank = 0;
  return (
    <ol className="scoreboard" aria-label="Scoreboard">
      {sorted.map((p, i) => {
        if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1;
        const drawing = p.id === view.drawerId && (view.phase === "drawing" || view.phase === "choosing");
        return (
          <li key={p.id} className={`${p.id === view.you ? "me" : ""} ${p.guessed ? "guessed" : ""} ${drawing ? "drawing" : ""}`}>
            <span className="rank">#{rank}</span>
            <Avatar avatar={p.avatar} size={38} />
            <span className="who">
              <span className="pname">
                {p.name}
                {p.id === view.you && <em> (you)</em>}
                {p.isHost && (
                  <span className="crown" title="Host">
                    {" "}
                    ♛
                  </span>
                )}
              </span>
              <span className="score">{p.score} pts</span>
            </span>
            <span className="state" aria-label={drawing ? "Drawing" : p.guessed ? "Guessed" : undefined}>
              {drawing ? "✎" : p.guessed ? "✓" : muted.has(p.id) ? "🔇" : ""}
            </span>
            {p.kickVotes > 0 && <span className="votes">kick {p.kickVotes}</span>}
            <PlayerActions player={p} view={view} />
            {pops[p.id] && (
              <span className="pop" key={pops[p.id].key}>
                +{pops[p.id].pts}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
