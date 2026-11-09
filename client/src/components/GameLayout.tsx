import { useEffect, useRef, useState, type ReactNode } from "react";
import { useGame } from "../lib/game";
import { Chat } from "./Chat";
import { PaintLayer } from "./Paint";
import { ReactionBar, ReactionLayer } from "./Reactions";
import { Scoreboard } from "./Scoreboard";

function useIsNarrow(px = 900) {
  const q = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return narrow;
}

/**
 * The in-game frame every mode shares: players on the left, the board in
 * the middle, chat on the right. On phones the board sits on top with
 * chat and players in tabs below.
 */
export function GameLayout({ board }: { board: ReactNode }) {
  const g = useGame();
  const view = g.view!;
  const narrow = useIsNarrow();
  const [tab, setTab] = useState<"chat" | "players">("chat");
  const [unread, setUnread] = useState(0);
  const lastSeen = useRef(g.chat.length);

  // Unread badge for the chat tab on phones.
  useEffect(() => {
    if (!narrow || tab === "chat") {
      lastSeen.current = g.chat.length;
      setUnread(0);
    } else setUnread(Math.max(0, g.chat.length - lastSeen.current));
  }, [g.chat.length, narrow, tab]);

  if (narrow) {
    return (
      <div className="game narrow">
        {board}
        <ReactionBar />
        <ReactionLayer />
        <PaintLayer />
        <div className="tabs" role="tablist">
          <button role="tab" type="button" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
            Chat {unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
          </button>
          <button role="tab" type="button" aria-selected={tab === "players"} className={tab === "players" ? "on" : ""} onClick={() => setTab("players")}>
            Players <span className="muted">{view.players.length}</span>
          </button>
        </div>
        <div className="panel cabinet tab-panel" role="tabpanel">
          {tab === "chat" ? <Chat /> : <Scoreboard />}
        </div>
      </div>
    );
  }

  return (
    <div className="game">
      <aside className="panel cabinet side-scores" aria-label="Players">
        <h2 className="side-h">Players</h2>
        <Scoreboard />
      </aside>
      {board}
      <aside className="panel cabinet side-chat" aria-label="Chat">
        <h2 className="side-h">Chat</h2>
        <ReactionBar />
        <Chat autoFocus />
      </aside>
      <ReactionLayer />
      <PaintLayer />
    </div>
  );
}
