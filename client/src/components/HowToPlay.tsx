import { useEffect, useRef, useState } from "react";
import type { GameModeId } from "@inkwave/shared";
import drawoffJpg from "../assets/tutorials/drawoff.jpg";
import drawoffMp4 from "../assets/tutorials/drawoff.mp4";
import guessingJpg from "../assets/tutorials/guessing.jpg";
import guessingMp4 from "../assets/tutorials/guessing.mp4";
import { music } from "../lib/music";

const VIDEOS: Partial<Record<GameModeId, { label: string; src: string; poster: string; blurb: string }>> = {
  guess: {
    label: "Guessing",
    // Imported, so the file name changes with the content and browsers never play a stale copy.
    src: guessingMp4,
    poster: guessingJpg,
    blurb: "One player draws a word. Everyone else types guesses. Faster guesses score more!",
  },
  drawoff: {
    label: "Draw-Off",
    src: drawoffMp4,
    poster: drawoffJpg,
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
  const [tab, setTab] = useState<GameModeId>(VIDEOS[initial] ? initial : "guess");
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** True when the browser only let the video start muted. */
  const [silent, setSilent] = useState(false);
  const v = VIDEOS[tab]!;

  // The videos have their own music, so pause the game's while one is open.
  useEffect(() => {
    music.setPaused(true);
    return () => music.setPaused(false);
  }, []);

  // Start with sound; if the browser blocks that, start muted (the controls can unmute).
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    setSilent(false);
    el.play().catch(() => {
      el.muted = true;
      setSilent(true);
      void el.play().catch(() => {});
    });
  }, [tab]);

  const unmute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    if (el.volume === 0) el.volume = 1;
    void el.play().catch(() => {});
    setSilent(false);
  };

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
              {VIDEOS[id]!.label}
            </button>
          ))}
        </div>
        <p className="howto-blurb">{v.blurb}</p>
        {/* key: switching tabs loads the other video from the start. */}
        <div className="howto-stage">
          <video
            ref={videoRef}
            key={tab}
            className="howto-video"
            src={v.src}
            poster={v.poster}
            controls
            playsInline
            preload="auto"
            onVolumeChange={(e) => setSilent(e.currentTarget.muted)}
          >
            Your browser can't play this video.
          </video>
          {silent && (
            <button type="button" className="btn primary sound-btn" onClick={unmute}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
                <path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Tap for sound
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
