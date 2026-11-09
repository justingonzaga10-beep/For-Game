import { useEffect, useRef } from "react";
import { useCountdown, useGame } from "./game";
import { sfx } from "./sound";

/** Maps game events to sound effects: turn start, ticks, guesses, game end. */
export function useGameSounds() {
  const g = useGame();
  const view = g.view;
  const left = useCountdown();
  const prevPhase = useRef(view?.phase);
  const lastTick = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = view?.phase;
    if (!view || prev === view.phase) return;
    if (view.phase === "drawing" || view.phase === "drawoff_drawing" || view.phase === "perim_solve") sfx.turnStart();
    if (view.phase === "drawoff_results") sfx.otherCorrect();
    if (view.phase === "podium") sfx.gameEnd();
  }, [view?.phase, view]);

  useEffect(() => {
    const drawingPhase = view?.phase === "drawing" || view?.phase === "drawoff_drawing" || view?.phase === "perim_solve";
    if (!drawingPhase || left === null || left > 10 || left === 0) {
      lastTick.current = null;
      return;
    }
    if (lastTick.current === left) return;
    lastTick.current = left;
    if (left <= 3) sfx.tickLast();
    else sfx.tick();
  }, [left, view?.phase]);

  useEffect(
    () =>
      g.onFx(({ playerId }) => {
        if (playerId === g.view?.you) sfx.correct();
        else sfx.otherCorrect();
      }),
    [g],
  );

  const lastChat = g.chat[g.chat.length - 1];
  useEffect(() => {
    if (lastChat?.kind === "close") sfx.close();
  }, [lastChat]);
}
