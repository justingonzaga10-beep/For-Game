import { useEffect, useState } from "react";
import { normalizeRoomCode } from "@inkwave/shared";
import { DrawOffScreen } from "./components/DrawOff";
import { GameScreen } from "./components/GameScreen";
import { PerimeterScreen } from "./components/Perimeter";
import { Landing } from "./components/Landing";
import { Lobby } from "./components/Lobby";
import { ArcadeControls, TopBar } from "./components/TopBar";
import { useGame } from "./lib/game";
import { music } from "./lib/music";
import { useSoundPrefs } from "./lib/sound";
import { useGameSounds } from "./lib/useGameSounds";

/** Synthwave backdrop: horizon sun and a scrolling perspective grid. */
function Backdrop() {
  return (
    <div className="synth-bg" aria-hidden="true">
      <div className="sun" />
      <div className="grid" />
    </div>
  );
}

function usePath(): [string, (p: string, replace?: boolean) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (p: string, replace = false) => {
    if (p === location.pathname) return;
    if (replace) history.replaceState(null, "", p);
    else history.pushState(null, "", p);
    setPath(p);
  };
  return [path, navigate];
}

export function App() {
  const g = useGame();
  const [path, navigate] = usePath();
  const linkCode = normalizeRoomCode(path.match(/^\/room\/([^/]+)/)?.[1] ?? "");
  const view = g.view;
  useGameSounds();
  const { music: musicOn } = useSoundPrefs();

  // Quiet background music while in a room (lobby and games), if it's switched on.
  const inRoom = !!view;
  useEffect(() => {
    if (inRoom && musicOn) music.start();
    else music.stop();
  }, [inRoom, musicOn]);

  // Keep the address bar on the room you're in, so it can be shared or reloaded.
  useEffect(() => {
    if (view && linkCode !== view.code) navigate(`/room/${view.code}`, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.code]);

  // Leaving with the browser's back button leaves the room.
  useEffect(() => {
    if (view && linkCode && linkCode !== view.code) g.leave();
    if (view && !linkCode) g.leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    document.title = view ? `Quantum Doodle · ${view.isPublic ? "Public room" : `Room ${view.code}`}` : "Quantum Doodle";
  }, [view?.code, view?.isPublic]);

  // Draw-Off phases, plus the final podium of a Draw-Off game.
  const isDrawOff = !!view && (view.phase.startsWith("drawoff_") || (view.phase === "podium" && view.settings.mode === "drawoff" && !view.isPublic));
  const isPerimeter = !!view && (view.phase.startsWith("perim_") || (view.phase === "podium" && view.settings.mode === "perimeter" && !view.isPublic));

  if (!view) {
    return (
      <div className="app">
        <Backdrop />
        {g.notice && (
          <div className="toast" role="status">
            {g.notice}
          </div>
        )}
        <div className="landing-controls">
          <ArcadeControls />
        </div>
        <Landing joinCode={linkCode || undefined} onEntered={(code) => navigate(`/room/${code}`)} />
      </div>
    );
  }

  return (
    <div className="app in-room">
      <Backdrop />
      {g.notice && (
        <div className="toast" role="status">
          {g.notice}
        </div>
      )}
      <TopBar
        onLeave={() => {
          g.leave();
          navigate("/");
        }}
      />
      {view.phase === "lobby" ? <Lobby /> : isDrawOff ? <DrawOffScreen /> : isPerimeter ? <PerimeterScreen /> : <GameScreen />}
    </div>
  );
}
