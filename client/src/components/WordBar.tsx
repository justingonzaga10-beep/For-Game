import { TIMING } from "@inkwave/shared";
import { useCountdown, useGame } from "../lib/game";

/** Letter cells for the masked word; spaces split words, hyphens show as-is. */
function Blanks({ pattern }: { pattern: string }) {
  const words = pattern.split(" ");
  const counts = words.map((w) => Array.from(w).filter((c) => c !== "-").length);
  return (
    <div className="blanks" aria-label={`Word with ${counts.join(" and ")} letters`}>
      <div className="blank-words">
        {words.map((w, wi) => (
          <span className="blank-word" key={wi}>
            {Array.from(w).map((ch, i) =>
              ch === "-" ? (
                <span key={i} className="cell sep">
                  -
                </span>
              ) : (
                <span key={i} className={`cell ${ch === "_" ? "" : "shown"}`}>
                  {ch === "_" ? "" : ch}
                </span>
              ),
            )}
          </span>
        ))}
      </div>
      <span className="letter-count">{counts.join(" ")}</span>
    </div>
  );
}

export function WordBar() {
  const { view } = useGame();
  if (!view) return null;
  const drawer = view.players.find((p) => p.id === view.drawerId);
  const isDrawer = view.drawerId === view.you;

  let center: JSX.Element;
  if (view.phase === "choosing") {
    center = <span className="word-status">{isDrawer ? "Choose a word to draw" : `${drawer?.name ?? "Someone"} is choosing a word…`}</span>;
  } else if (view.phase === "drawing") {
    if (view.word) {
      center = (
        <span className={`word-real ${isDrawer ? "drawer" : "guessed"}`}>
          <small>{isDrawer ? "Draw this" : "You got it"}</small>
          {view.word}
        </span>
      );
    } else if (view.pattern) {
      center = <Blanks pattern={view.pattern} />;
    } else {
      center = (
        <span className="word-status">
          Hidden word <small>no blanks this game</small>
        </span>
      );
    }
  } else if (view.phase === "reveal") {
    center = (
      <span className="word-real">
        <small>The word was</small>
        {view.reveal?.word}
      </span>
    );
  } else {
    center = <span className="word-status">Game over</span>;
  }

  return (
    <div className="wordbar panel">
      <div className="round-tag">
        {view.phase === "podium" ? (
          "Final"
        ) : (
          <>
            Round
            <b>
              {Math.min(view.round, view.settings.rounds)}/{view.settings.rounds}
            </b>
          </>
        )}
      </div>
      <div className="word-center" aria-live="polite">
        {center}
      </div>
      <TimerRing urgent={view.phase === "drawing"} />
    </div>
  );
}

export function TimerRing({ urgent }: { urgent: boolean }) {
  const { view } = useGame();
  const left = useCountdown();
  if (!view) return null;
  const totals: Partial<Record<typeof view.phase, number>> = {
    drawing: view.settings.drawTime,
    choosing: TIMING.chooseSeconds,
    reveal: TIMING.revealSeconds,
    podium: TIMING.podiumSeconds,
    drawoff_drawing: view.settings.drawOffTime,
    drawoff_voting: TIMING.drawOffVoteSeconds,
    drawoff_results: TIMING.drawOffResultsSeconds,
    drawoff_gallery: TIMING.drawOffGallerySeconds,
    perim_build: TIMING.perimeterBuildSeconds,
    perim_solve: view.settings.perimeterTime,
    perim_reveal: TIMING.perimeterRevealSeconds,
  };
  const total = totals[view.phase] ?? TIMING.publicAutoStartSeconds;
  const frac = left === null ? 0 : Math.min(1, left / total);
  const R = 26;
  const C = 2 * Math.PI * R;
  const hurry = urgent && left !== null && left <= 10;
  return (
    <div className={`timer-ring ${hurry ? "hurry" : ""}`} role="timer" aria-label={left === null ? "No timer" : `${left} seconds left`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="ring-bg" cx="32" cy="32" r={R} />
        <circle className="ring-fg" cx="32" cy="32" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 32 32)" />
      </svg>
      <span className="ring-num">{left ?? "–"}</span>
    </div>
  );
}
