import { useEffect, useRef, useState } from "react";
import { BRUSH_SIZES, type DrawOp } from "@inkwave/shared";
import { DrawCanvas, type ToolState } from "../canvas/DrawCanvas";
import { Toolbar } from "../canvas/Toolbar";
import type { DrawingEngine } from "../canvas/engine";
import { useGame } from "../lib/game";
import { load, save } from "../lib/storage";
import { Chat } from "./Chat";
import { Overlays } from "./Overlays";
import { Scoreboard } from "./Scoreboard";
import { WordBar } from "./WordBar";

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

export function GameScreen() {
  const g = useGame();
  const view = g.view!;
  const engineRef = useRef<DrawingEngine | null>(null);
  const emitRef = useRef<((ops: DrawOp[]) => void) | null>(null);
  const narrow = useIsNarrow();
  const [tab, setTab] = useState<"chat" | "players">("chat");
  const [unread, setUnread] = useState(0);
  const lastSeen = useRef(g.chat.length);
  const [tools, setToolsState] = useState<ToolState>(() =>
    load("tools", { tool: "brush", size: BRUSH_SIZES[1], primary: "#000000", secondary: "#ffffff", pressure: true } as ToolState),
  );
  const setTools = (t: ToolState) => {
    setToolsState(t);
    save("tools", t);
  };

  const isDrawer = view.phase === "drawing" && view.drawerId === view.you;
  const undo = () => {
    if (isDrawer && engineRef.current && engineRef.current.actionCount > 0) emitRef.current?.([{ k: "undo" }]);
  };
  const clear = () => {
    if (isDrawer) emitRef.current?.([{ k: "clear" }]);
  };

  // Unread badge for the chat tab on phones.
  useEffect(() => {
    if (!narrow || tab === "chat") {
      lastSeen.current = g.chat.length;
      setUnread(0);
    } else setUnread(Math.max(0, g.chat.length - lastSeen.current));
  }, [g.chat.length, narrow, tab]);

  // Keyboard shortcuts for the drawer: B brush, E eraser, F fill, 1-5 sizes, Ctrl+Z undo.
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  useEffect(() => {
    if (!isDrawer) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const t = toolsRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "b") setTools({ ...t, tool: "brush" });
      else if (k === "e") setTools({ ...t, tool: "eraser" });
      else if (k === "f") setTools({ ...t, tool: "fill" });
      else if (/^[1-5]$/.test(k)) setTools({ ...t, size: BRUSH_SIZES[Number(k) - 1] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const board = (
    <section className="board" aria-label="Drawing board">
      <WordBar />
      <div className="canvas-frame">
        <DrawCanvas canDraw={isDrawer} tools={tools} engineRef={engineRef} emitRef={emitRef} />
        <Overlays />
      </div>
      {isDrawer && <Toolbar tools={tools} setTools={setTools} onUndo={undo} onClear={clear} />}
    </section>
  );

  if (narrow) {
    return (
      <div className="game narrow">
        {board}
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
        <Chat autoFocus />
      </aside>
    </div>
  );
}
