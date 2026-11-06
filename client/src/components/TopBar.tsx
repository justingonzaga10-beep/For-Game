import { useEffect, useState } from "react";
import { useGame } from "../lib/game";
import { setSound, sfx, useSoundPrefs } from "../lib/sound";
import { load, save } from "../lib/storage";
import { BrandShield } from "./BrandShield";
import { Logo } from "./Logo";

export function useCrt(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => load("crt", true));
  useEffect(() => {
    document.documentElement.classList.toggle("crt", on);
    save("crt", on);
  }, [on]);
  return [on, setOn];
}

/** Volume, mute and the CRT scanline toggle. Shown on the landing page and in rooms. */
export function ArcadeControls() {
  const sound = useSoundPrefs();
  const [crt, setCrt] = useCrt();
  const silent = sound.muted || sound.volume === 0;
  return (
    <div className="arcade-controls">
      <button
        type="button"
        className="icon-btn"
        aria-pressed={silent}
        aria-label={silent ? "Unmute sound" : "Mute sound"}
        title={silent ? "Unmute" : "Mute"}
        onClick={() => {
          setSound({ muted: !sound.muted, volume: sound.volume === 0 ? 0.5 : sound.volume });
          if (silent) setTimeout(sfx.click, 30);
        }}
      >
        {silent ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
            <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
            <path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <input
        id="volume"
        className="volume"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={sound.muted ? 0 : sound.volume}
        aria-label="Volume"
        onChange={(e) => setSound({ volume: Number(e.target.value), muted: false })}
        onPointerUp={() => sfx.click()}
      />
      <button
        type="button"
        className={`icon-btn crt-btn ${crt ? "on" : ""}`}
        aria-pressed={crt}
        title="CRT scanlines"
        aria-label="CRT scanlines"
        onClick={() => setCrt(!crt)}
      >
        CRT
      </button>
    </div>
  );
}

export function TopBar({ onLeave }: { onLeave: () => void }) {
  const { view, connected } = useGame();
  if (!view) return null;
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <BrandShield small />
        <Logo compact />
      </div>
      <div className="room-tag">
        {view.isPublic ? (
          "Public room"
        ) : (
          <>
            Room <b className="code">{view.code}</b>
          </>
        )}
        {!connected && <span className="offline">Reconnecting…</span>}
      </div>
      <div className="topbar-actions">
        <ArcadeControls />
        <button type="button" className="btn small ghost" onClick={onLeave}>
          Leave
        </button>
      </div>
    </header>
  );
}
