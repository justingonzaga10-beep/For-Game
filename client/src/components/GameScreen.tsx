import { useEffect, useRef, useState } from "react";
import { BRUSH_SIZES, type DrawOp } from "@inkwave/shared";
import { DrawCanvas, type ToolState } from "../canvas/DrawCanvas";
import { Toolbar } from "../canvas/Toolbar";
import type { DrawingEngine } from "../canvas/engine";
import { useGame } from "../lib/game";
import { load, save } from "../lib/storage";

export function GameScreen() {
  const { view } = useGame();
  const engineRef = useRef<DrawingEngine | null>(null);
  const emitRef = useRef<((ops: DrawOp[]) => void) | null>(null);
  const [tools, setToolsState] = useState<ToolState>(() =>
    load("tools", { tool: "brush", size: BRUSH_SIZES[1], primary: "#000000", secondary: "#ffffff", pressure: true } as ToolState),
  );
  const setTools = (t: ToolState) => {
    setToolsState(t);
    save("tools", t);
  };

  const isDrawer = !!view && view.phase === "drawing" && view.drawerId === view.you;
  const undo = () => isDrawer && engineRef.current && engineRef.current.actionCount > 0 && emitRef.current?.([{ k: "undo" }]);
  const clear = () => isDrawer && emitRef.current?.([{ k: "clear" }]);

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

  return (
    <div className="board">
      <DrawCanvas canDraw={isDrawer} tools={tools} engineRef={engineRef} emitRef={emitRef} />
      {isDrawer && <Toolbar tools={tools} setTools={setTools} onUndo={undo} onClear={clear} />}
    </div>
  );
}
