import { useEffect, useState } from "react";
import { normalizeRoomCode } from "@inkwave/shared";
import { GameScreen } from "./components/GameScreen";
import { Landing } from "./components/Landing";
import { Lobby } from "./components/Lobby";
import { TopBar } from "./components/TopBar";
import { useGame } from "./lib/game";

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
    document.title = view ? `Inkwave · ${view.isPublic ? "Public room" : `Room ${view.code}`}` : "Inkwave";
  }, [view?.code, view?.isPublic]);

  if (!view) {
    return (
      <div className="app">
        <Landing joinCode={linkCode || undefined} onEntered={(code) => navigate(`/room/${code}`)} />
      </div>
    );
  }

  return (
    <div className="app in-room">
      <TopBar
        onLeave={() => {
          g.leave();
          navigate("/");
        }}
      />
      {view.phase === "lobby" ? <Lobby /> : <GameScreen />}
    </div>
  );
}
