import { DrawCanvas } from "../canvas/DrawCanvas";
import { Toolbar } from "../canvas/Toolbar";
import { useDrawingTools } from "../canvas/useDrawingTools";
import { useGame } from "../lib/game";
import { GameLayout } from "./GameLayout";
import { Overlays } from "./Overlays";
import { WordBar } from "./WordBar";

/** Guessing mode: one player draws on the shared canvas while the rest guess. */
export function GameScreen() {
  const g = useGame();
  const view = g.view!;
  const isDrawer = view.phase === "drawing" && view.drawerId === view.you;
  const { tools, setTools, engineRef, emitRef, undo, clear } = useDrawingTools(isDrawer);

  return (
    <GameLayout
      board={
        <section className="board" aria-label="Drawing board">
          <WordBar />
          <div className="canvas-frame">
            <DrawCanvas source={{ log: g.canvasLog, send: g.sendDraw }} canDraw={isDrawer} tools={tools} engineRef={engineRef} emitRef={emitRef} />
            <Overlays />
          </div>
          {isDrawer && <Toolbar tools={tools} setTools={setTools} onUndo={undo} onClear={clear} />}
        </section>
      }
    />
  );
}
