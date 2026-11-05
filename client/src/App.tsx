import { useEffect, useRef, useState } from "react";
import { randomAvatar } from "@inkwave/shared";
import { GameScreen } from "./components/GameScreen";
import { useGame } from "./lib/game";

/** Stage 2 harness: join a room straight from /room/CODE and draw. Replaced by the real landing and lobby next. */
export function App() {
  const g = useGame();
  const [error, setError] = useState("");
  const code = location.pathname.match(/^\/room\/([A-Za-z0-9]+)/)?.[1];

  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const profile = { name: `Tester${Math.floor(Math.random() * 99)}`, avatar: randomAvatar(), language: "en" as const };
    const p = code ? g.join(code, profile) : g.create(profile);
    p.then((r) => {
      if (!r.ok) setError(r.error);
      else if (!code) history.replaceState(null, "", `/room/${r.code}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const v = g.view;
  return (
    <main style={{ padding: 16 }}>
      {error && <p>{error}</p>}
      {v && (
        <p>
          Room {v.code} · {v.phase} · players {v.players.length} · word {v.word ?? v.pattern}
          {v.phase === "lobby" && v.hostId === v.you && <button onClick={g.start}>Start</button>}
          {v.choices?.map((c, i) => (
            <button key={c} onClick={() => g.choose(i)}>
              {c}
            </button>
          ))}
        </p>
      )}
      <GameScreen />
    </main>
  );
}
