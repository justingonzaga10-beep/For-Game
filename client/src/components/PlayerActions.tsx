import { useEffect, useRef, useState } from "react";
import { THROW_COLORS, type PlayerView, type RoomView } from "@inkwave/shared";
import { useGame } from "../lib/game";
import { toggleMute, useMuted } from "../lib/muted";

/** The "⋯" menu next to another player: throw paint, mute, vote-kick, and host kick/ban. */
export function PlayerActions({ player, view }: { player: PlayerView; view: RoomView }) {
  const g = useGame();
  const muted = useMuted();
  const [open, setOpen] = useState(false);
  const [confirmBan, setConfirmBan] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (player.id === view.you) return null;
  const isHost = view.hostId === view.you && !view.isPublic;
  const voted = view.yourKickVotes.includes(player.id);
  const canVote = view.players.length >= 3;
  const canThrow = view.settings.paintThrow && view.phase !== "lobby";

  return (
    <div className="pmenu" ref={ref}>
      <button
        type="button"
        className="pmenu-btn"
        aria-label={`Actions for ${player.name}`}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setConfirmBan(false);
        }}
      >
        ⋯
      </button>
      {open && (
        <div className="pmenu-list" role="menu">
          {canThrow && (
            <div className="throw-paint">
              <span>Throw paint 🎨</span>
              <div className="throw-colors">
                {THROW_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="menuitem"
                    className="throw-color"
                    style={{ background: c }}
                    aria-label={`Throw ${c} paint at ${player.name}`}
                    onClick={() => {
                      g.throwPaint(player.id, c);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <button role="menuitem" type="button" onClick={() => toggleMute(player.id)}>
            {muted.has(player.id) ? "Unmute chat" : "Mute chat"}
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={voted || !canVote}
            title={canVote ? undefined : "Needs at least 3 players"}
            onClick={() => {
              g.voteKick(player.id);
              setOpen(false);
            }}
          >
            {voted ? "You voted to kick" : "Vote to kick"}
          </button>
          {isHost && (
            <>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  g.kick(player.id);
                  setOpen(false);
                }}
              >
                Kick
              </button>
              {confirmBan ? (
                <button
                  role="menuitem"
                  type="button"
                  className="danger"
                  onClick={() => {
                    g.ban(player.id);
                    setOpen(false);
                  }}
                >
                  Confirm ban
                </button>
              ) : (
                <button role="menuitem" type="button" className="danger" onClick={() => setConfirmBan(true)}>
                  Ban…
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
