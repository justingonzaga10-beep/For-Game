import { useEffect, useRef, useState } from "react";
import type { GameModeId } from "@inkwave/shared";

const VIDEOS: Record<GameModeId, { label: string; src: string; poster: string; blurb: string }> = {
  guess: {
    label: "Guessing",
    src: "/tutorials/guessing.mp4",
    poster: "/tutorials/guessing.jpg",
    blurb: "One player draws a word. Everyone else types guesses. Faster guesses score more!",
  },
  drawoff: {
    label: "Draw-Off",
    src: "/tutorials/drawoff.mp4",
    poster: "/tutorials/drawoff.jpg",
    blurb: "Everyone draws the same theme, then rates each other's drawings from 1 to 5 stars.",
  },
};

/** A "How to play" button that opens short video tutorials for both modes. */
export function HowToPlayButton({ mode = "guess", className = "btn ghost small", label = "How to play" }: { mode?: GameModeId; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <svg className="play-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M10 8l6 4-6 4z" fill="currentColor" />
        </svg>
        {label}
      </button>
      {open && <HowToPlay initial={mode} onClose={() => setOpen(false)} />}
    </>
  );
}

function HowToPlay({ initial, onClose }: { initial: GameModeId; onClose: () => void }) {
  const [tab, setTab] = useState<GameModeId>(initial);
  const closeRef = useRef<HTMLButtonElement>(null);
  const v = VIDEOS[tab];

  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="howto" role="dialog" aria-modal="true" aria-labelledby="howto-h" onClick={onClose}>
      <div className="howto-body panel cabinet" onClick={(e) => e.stopPropagation()}>
        <div className="howto-head">
          <h2 id="howto-h">How to play</h2>
          <button ref={closeRef} type="button" className="btn small ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="segmented" role="tablist" aria-label="Game mode">
          {(Object.keys(VIDEOS) as GameModeId[]).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {VIDEOS[id].label}
            </button>
          ))}
        </div>
        <p className="howto-blurb">{v.blurb}</p>
        {/* key: switching tabs loads the other video from the start. Videos have no sound. */}
        <video key={tab} className="howto-video" src={v.src} poster={v.poster} controls playsInline muted autoPlay preload="metadata">
          Your browser can't play this video.
        </video>
      </div>
    </div>
  );
}
