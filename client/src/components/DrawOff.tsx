import { useEffect, useState } from "react";
import type { DrawOffResult } from "@inkwave/shared";
import { DrawCanvas } from "../canvas/DrawCanvas";
import { DrawingView, Thumbnail } from "../canvas/DrawingView";
import { Toolbar } from "../canvas/Toolbar";
import { useDrawingTools } from "../canvas/useDrawingTools";
import { useCountdown, useGame } from "../lib/game";
import { sfx } from "../lib/sound";
import { Avatar } from "./Avatar";
import { GameLayout } from "./GameLayout";
import { Overlays } from "./Overlays";
import { TimerRing } from "./WordBar";

/** Draw-Off mode: everyone draws the same theme privately, then rates each other's drawings. */
export function DrawOffScreen() {
  const g = useGame();
  const view = g.view!;
  const d = view.drawOff;
  const phase = view.phase;
  const canDraw = phase === "drawoff_drawing" && !!d && !d.spectating;
  const { tools, setTools, engineRef, emitRef, undo, clear } = useDrawingTools(canDraw);

  let body: JSX.Element;
  if (phase === "drawoff_drawing") {
    body = (
      <>
        <div className="canvas-frame">
          <DrawCanvas source={{ log: g.drawOffLog, send: g.sendPrivateDraw }} canDraw={canDraw} tools={tools} engineRef={engineRef} emitRef={emitRef} />
          {d?.spectating && (
            <div className="overlay" role="status">
              <h3>Everyone is drawing</h3>
              <p className="muted">You joined mid-round, so you'll draw from the next round. Hang tight!</p>
            </div>
          )}
        </div>
        {canDraw && <Toolbar tools={tools} setTools={setTools} onUndo={undo} onClear={clear} />}
      </>
    );
  } else if (phase === "drawoff_voting") {
    body = <Voting />;
  } else if (phase === "drawoff_results") {
    body = <Results />;
  } else if (phase === "drawoff_gallery") {
    body = <Gallery />;
  } else {
    // Final podium.
    body = (
      <div className="canvas-frame">
        <div className="paper" />
        <Overlays />
      </div>
    );
  }

  return (
    <GameLayout
      board={
        <section className={`board drawoff ${phase}`} aria-label="Draw-Off">
          <DrawOffBar />
          {body}
        </section>
      }
    />
  );
}

function DrawOffBar() {
  const view = useGame().view!;
  const d = view.drawOff;
  const theme = d?.theme ?? "";
  let center: JSX.Element;
  switch (view.phase) {
    case "drawoff_drawing":
      center = (
        <span className="word-real drawer theme">
          <small>{d?.spectating ? "Everyone is drawing" : "Draw this"}</small>
          {theme}
        </span>
      );
      break;
    case "drawoff_voting":
      center = (
        <span className="word-real theme">
          <small>
            Rate drawing {d?.current?.index ?? 0} of {d?.current?.total ?? 0}
          </small>
          {theme}
        </span>
      );
      break;
    case "drawoff_results":
      center = (
        <span className="word-real theme">
          <small>Results</small>
          {theme}
        </span>
      );
      break;
    case "drawoff_gallery":
      center = (
        <span className="word-real theme">
          <small>Gallery</small>
          {theme}
        </span>
      );
      break;
    default:
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
      <TimerRing urgent={view.phase === "drawoff_drawing"} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Voting                                                              */
/* ------------------------------------------------------------------ */

function Voting() {
  const g = useGame();
  const cur = g.view!.drawOff?.current;

  // Number keys 1-5 vote, like tapping a star.
  useEffect(() => {
    if (!cur?.canVote) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (/^[1-5]$/.test(e.key)) {
        g.vote(cur.entryId, Number(e.key));
        sfx.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur?.canVote, cur?.entryId, g]);

  if (!cur) return null;
  const actions = g.drawOffEntries[cur.entryId];
  return (
    <>
      <div className="canvas-frame">
        <DrawingView actions={actions} label={`Drawing ${cur.index} of ${cur.total}`} />
        {actions && actions.length === 0 && <span className="empty-tag">Blank canvas</span>}
      </div>
      <div className="vote-panel panel" key={cur.entryId}>
        {cur.isYours ? (
          <p className="vote-note">This one is yours! Everyone else is rating it.</p>
        ) : !cur.canVote ? (
          <p className="vote-note">You're watching this round. You'll vote from the next round.</p>
        ) : (
          <>
            <p className="vote-label" id="vote-label">
              How good is it?
            </p>
            <div className="stars" role="radiogroup" aria-labelledby="vote-label">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={cur.yourStars === n}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  className={`star ${cur.yourStars !== null && n <= cur.yourStars ? "on" : ""}`}
                  onClick={() => {
                    g.vote(cur.entryId, n);
                    sfx.click();
                  }}
                >
                  ★
                </button>
              ))}
            </div>
          </>
        )}
        <p className="vote-count muted">
          {cur.votesIn}/{cur.votersNeeded} votes in
        </p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Results and gallery                                                 */
/* ------------------------------------------------------------------ */

function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span className="star-row" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= full ? "on" : ""} aria-hidden="true">
          ★
        </span>
      ))}
      <b>{value.toFixed(1)}</b>
    </span>
  );
}

function Results() {
  const g = useGame();
  const res = g.view!.drawOff?.results ?? [];
  const top = res.filter((r) => r.rank <= 3).slice(0, 3);
  const rest = res.filter((r) => !top.includes(r));
  return (
    <div className="do-results panel cabinet" role="status">
      <ol className="do-podium">
        {top.map((r) => (
          <li key={r.entryId} className={`rank-${r.rank}`}>
            <span className="medal">#{r.rank}</span>
            <Thumbnail entryId={r.entryId} actions={g.drawOffEntries[r.entryId]} label={`Drawing by ${r.name}`} />
            <ResultLine r={r} />
          </li>
        ))}
      </ol>
      {rest.length > 0 && (
        <ul className="do-rest">
          {rest.map((r) => (
            <li key={r.entryId}>
              <span className="medal small">#{r.rank}</span>
              <ResultLine r={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultLine({ r }: { r: DrawOffResult }) {
  const me = useGame().view!.you === r.playerId;
  return (
    <div className="result-line">
      <Avatar avatar={r.avatar} size={30} />
      <span className="pname">
        {r.name}
        {me && <em> (you)</em>}
      </span>
      <Stars value={r.rating} />
      <span className="plus">+{r.points}</span>
    </div>
  );
}

function Gallery() {
  const g = useGame();
  const view = g.view!;
  const res = view.drawOff?.results ?? [];
  const left = useCountdown();
  const [open, setOpen] = useState<DrawOffResult | null>(null);
  const isHost = view.hostId === view.you;
  const last = view.round >= view.settings.rounds;

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  return (
    <div className="do-gallery panel cabinet">
      <div className="gallery-grid">
        {res.map((r) => (
          <button key={r.entryId} type="button" className="gallery-card" onClick={() => setOpen(r)} aria-label={`Open drawing by ${r.name}`}>
            <Thumbnail entryId={r.entryId} actions={g.drawOffEntries[r.entryId]} label={`Drawing by ${r.name}`} />
            <span className="gallery-meta">
              <span className="pname">{r.name}</span>
              <span className="rating">★ {r.rating.toFixed(1)}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="gallery-foot">
        {isHost ? (
          <button type="button" className="btn primary" onClick={g.drawOffContinue}>
            {last ? "See final scores" : "Next round"}
          </button>
        ) : (
          <p className="muted">
            {last ? "Final scores" : "Next round"} in {left ?? 0} s
          </p>
        )}
      </div>

      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Drawing by ${open.name}`} onClick={() => setOpen(null)}>
          <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
            <DrawingView actions={g.drawOffEntries[open.entryId]} label={`Drawing by ${open.name}`} />
            <div className="lightbox-meta">
              <ResultLine r={open} />
              <button type="button" className="btn small ghost" onClick={() => setOpen(null)} autoFocus>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
