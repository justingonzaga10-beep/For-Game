import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LIMITS } from "@inkwave/shared";
import { useGame } from "../lib/game";
import { useMuted } from "../lib/muted";

export function Chat({ autoFocus = false }: { autoFocus?: boolean }) {
  const g = useGame();
  const view = g.view;
  const muted = useMuted();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const me = view?.players.find((p) => p.id === view.you);
  const drawing = view?.phase === "drawing";
  const isDrawer = drawing && view?.drawerId === view?.you;
  const placeholder = !drawing
    ? "Say something…"
    : isDrawer
      ? "Chat with players who guessed"
      : me?.guessed
        ? "Chat with the drawer and other guessers"
        : "Type your guess here…";

  // Keep the newest message in view unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [g.chat]);

  useEffect(() => {
    if (autoFocus && drawing && !isDrawer) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus, drawing, isDrawer]);

  const visible = g.chat.filter((m) => !m.playerId || !muted.has(m.playerId) || m.kind === "correct");

  return (
    <div className="chat-box">
      <ol
        className="chat-log"
        ref={listRef}
        aria-live="polite"
        aria-label="Chat messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {visible.length === 0 && <li className="msg system">Chat and guesses appear here.</li>}
        {visible.map((m) => (
          <li key={m.id} className={`msg ${m.kind}`}>
            {(m.kind === "chat" || m.kind === "guessed") && m.name && <b className="who">{m.name}: </b>}
            <span>{m.text}</span>
          </li>
        ))}
      </ol>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          g.sendChat(t);
          setText("");
          stick.current = true;
        }}
      >
        <input
          id="chat-input"
          ref={inputRef}
          value={text}
          maxLength={LIMITS.message}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="send"
          aria-label={placeholder}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn small primary" aria-label="Send">
          ➤
        </button>
      </form>
    </div>
  );
}
