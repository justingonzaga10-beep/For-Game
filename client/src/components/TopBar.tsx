import { useGame } from "../lib/game";
import { Logo } from "./Logo";

export function TopBar({ onLeave }: { onLeave: () => void }) {
  const { view, connected } = useGame();
  if (!view) return null;
  return (
    <header className="topbar">
      <Logo compact />
      <div className="room-tag">
        {view.isPublic ? "Public room" : <>Room <b className="code">{view.code}</b></>}
        {!connected && <span className="offline">Reconnecting…</span>}
      </div>
      <div className="topbar-actions">
        <button type="button" className="btn small ghost" onClick={onLeave}>
          Leave
        </button>
      </div>
    </header>
  );
}
