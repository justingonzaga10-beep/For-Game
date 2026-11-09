import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, DrawAction, DrawOffEntry, DrawOp, JoinResult, PerimeterShape, Profile, RoomSettings, RoomView } from "@inkwave/shared";
import { CanvasLog } from "../canvas/canvasLog";
import { socket } from "./socket";

export type FxListener = (fx: { playerId: string; points: number }) => void;
/** Perimeter: the server's private verdict on your last answer. `n` counts answers so repeats re-render. */
export interface PerimFeedback {
  result: "correct" | "close" | "wrong";
  value: number;
  n: number;
}
export type Removal = "kicked" | "banned" | "votekicked";

interface GameApi {
  view: RoomView | null;
  chat: ChatMessage[];
  connected: boolean;
  removed: Removal | null;
  notice: string | null;
  canvasLog: CanvasLog;
  /** Draw-Off: your private canvas for this round. */
  drawOffLog: CanvasLog;
  /** Draw-Off: this round's drawings by entry id, received when voting starts. */
  drawOffEntries: Record<string, DrawAction[]>;
  /** Server time now, corrected for this device's clock. */
  serverNow: () => number;
  quickplay: (p: Profile) => Promise<JoinResult>;
  create: (p: Profile) => Promise<JoinResult>;
  join: (code: string, p: Profile) => Promise<JoinResult>;
  leave: () => void;
  updateSettings: (patch: Partial<RoomSettings>) => void;
  start: () => void;
  choose: (i: number) => void;
  sendDraw: (ops: DrawOp[]) => void;
  /** Draw-Off: ops for your private canvas (only the server sees them). */
  sendPrivateDraw: (ops: DrawOp[]) => void;
  vote: (entryId: string, stars: number) => void;
  /** Perimeter: feedback on your last answer this turn. */
  perimFeedback: PerimFeedback | null;
  submitShape: (shape: PerimeterShape) => void;
  answerPerimeter: (value: number) => void;
  drawOffContinue: () => void;
  sendChat: (text: string) => void;
  kick: (id: string) => void;
  ban: (id: string) => void;
  voteKick: (id: string) => void;
  onFx: (l: FxListener) => () => void;
  clearRemoved: () => void;
}

const Ctx = createContext<GameApi | null>(null);
const MAX_CHAT = 150;

export function GameProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<RoomView | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(socket.connected);
  const [removed, setRemoved] = useState<Removal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const offset = useRef(0);
  const canvasLog = useMemo(() => new CanvasLog(), []);
  const drawOffLog = useMemo(() => new CanvasLog(), []);
  const [drawOffEntries, setDrawOffEntries] = useState<Record<string, DrawAction[]>>({});
  const [perimFeedback, setPerimFeedback] = useState<PerimFeedback | null>(null);
  const lastView = useRef<RoomView | null>(null);
  const fx = useRef(new Set<FxListener>());
  const roomCode = useRef<string | null>(null);
  /** Where to rejoin after a dropped connection (wifi blip, server restart). */
  const lastRoom = useRef<{ code: string; profile: Profile } | null>(null);

  useEffect(() => {
    const onState = (v: RoomView) => {
      // Smooth the clock offset so one slow packet doesn't make the timer jump.
      const sample = v.serverNow - Date.now();
      offset.current = offset.current === 0 ? sample : offset.current * 0.7 + sample * 0.3;
      roomCode.current = v.code;
      // A new turn or phase clears the last answer's feedback.
      const old = lastView.current;
      if (old && (old.phase !== v.phase || old.drawerId !== v.drawerId) && v.phase !== "perim_solve") setPerimFeedback(null);
      lastView.current = v;
      setView(v);
    };
    const onChat = (m: ChatMessage) => setChat((c) => (c.length >= MAX_CHAT ? [...c.slice(-MAX_CHAT + 1), m] : [...c, m]));
    const onDraw = (ops: DrawOp[]) => canvasLog.push(ops, true);
    const onReplay = (a: DrawAction[]) => canvasLog.replay(a);
    const onDrawOffCanvas = (a: DrawAction[]) => drawOffLog.replay(a);
    const onDrawOffEntries = (list: DrawOffEntry[]) => setDrawOffEntries(Object.fromEntries(list.map((e) => [e.entryId, e.actions])));
    const onPerimFeedback = (f: { result: PerimFeedback["result"]; value: number }) => setPerimFeedback((old) => ({ ...f, n: (old?.n ?? 0) + 1 }));
    const onFx = (f: { playerId: string; points: number }) => fx.current.forEach((l) => l(f));
    const onRemoved = ({ reason }: { reason: Removal }) => {
      roomCode.current = null;
      lastRoom.current = null;
      setView(null);
      setRemoved(reason);
    };
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    const onNotice = (t: string) => {
      setNotice(t);
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => setNotice(null), 4000);
    };
    const onConnect = () => {
      setConnected(true);
      const last = lastRoom.current;
      if (!last) return;
      socket.emit("room:join", last.code, last.profile, (r) => {
        if (!r.ok) {
          lastRoom.current = null;
          roomCode.current = null;
          setView(null);
          onNotice(`You were disconnected and couldn't rejoin: ${r.error}`);
        }
      });
    };
    const onDisconnect = () => setConnected(false);

    socket.on("room:state", onState);
    socket.on("chat", onChat);
    socket.on("draw", onDraw);
    socket.on("draw:replay", onReplay);
    socket.on("fx:guessed", onFx);
    socket.on("room:removed", onRemoved);
    socket.on("notice", onNotice);
    socket.on("drawoff:canvas", onDrawOffCanvas);
    socket.on("drawoff:entries", onDrawOffEntries);
    socket.on("perim:feedback", onPerimFeedback);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("room:state", onState);
      socket.off("chat", onChat);
      socket.off("draw", onDraw);
      socket.off("draw:replay", onReplay);
      socket.off("fx:guessed", onFx);
      socket.off("room:removed", onRemoved);
      socket.off("notice", onNotice);
      socket.off("drawoff:canvas", onDrawOffCanvas);
      socket.off("drawoff:entries", onDrawOffEntries);
      socket.off("perim:feedback", onPerimFeedback);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      clearTimeout(noticeTimer);
    };
  }, [canvasLog, drawOffLog]);

  const enter = useCallback(
    (p: Promise<JoinResult>, profile: Profile) =>
      p.then((r) => {
        if (r.ok) {
          lastRoom.current = { code: r.code, profile };
          setRemoved(null);
        }
        return r;
      }),
    [],
  );

  const ack = <T,>(fn: (cb: (r: T) => void) => void, timeoutMs = 8000) =>
    new Promise<T>((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, error: "The server didn't answer. Check your connection." } as T), timeoutMs);
      fn((r) => {
        clearTimeout(t);
        resolve(r);
      });
    });

  const api: GameApi = {
    view,
    chat,
    connected,
    removed,
    notice,
    canvasLog,
    drawOffLog,
    drawOffEntries,
    serverNow: () => Date.now() + offset.current,
    quickplay: (p) => {
      setChat([]);
      return enter(ack<JoinResult>((cb) => socket.emit("room:quickplay", p, cb)), p);
    },
    create: (p) => {
      setChat([]);
      return enter(ack<JoinResult>((cb) => socket.emit("room:create", p, cb)), p);
    },
    join: (code, p) => {
      setChat([]);
      return enter(ack<JoinResult>((cb) => socket.emit("room:join", code, p, cb)), p);
    },
    leave: () => {
      socket.emit("room:leave");
      lastRoom.current = null;
      roomCode.current = null;
      setView(null);
      setChat([]);
      canvasLog.replay([]);
      drawOffLog.replay([]);
      setDrawOffEntries({});
    },
    updateSettings: (patch) => socket.emit("room:settings", patch),
    start: () => socket.emit("game:start"),
    choose: (i) => socket.emit("turn:choose", i),
    sendDraw: (ops) => {
      canvasLog.push(ops, false);
      socket.emit("draw", ops);
    },
    sendPrivateDraw: (ops) => {
      drawOffLog.push(ops, false);
      socket.emit("draw", ops);
    },
    vote: (entryId, stars) => socket.emit("drawoff:vote", entryId, stars),
    drawOffContinue: () => socket.emit("drawoff:continue"),
    perimFeedback,
    submitShape: (shape) => socket.emit("perim:shape", shape),
    answerPerimeter: (value) => socket.emit("perim:answer", value),
    sendChat: (text) => socket.emit("chat", text),
    kick: (id) => socket.emit("mod:kick", id),
    ban: (id) => socket.emit("mod:ban", id),
    voteKick: (id) => socket.emit("mod:votekick", id),
    onFx: (l) => {
      fx.current.add(l);
      return () => fx.current.delete(l);
    },
    clearRemoved: () => setRemoved(null),
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useGame(): GameApi {
  const g = useContext(Ctx);
  if (!g) throw new Error("useGame must be used inside GameProvider");
  return g;
}

/** Seconds left in the current phase, ticking a few times a second. */
export function useCountdown(): number | null {
  const { view, serverNow } = useGame();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!view?.phaseEndsAt) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [view?.phaseEndsAt]);
  if (!view?.phaseEndsAt) return null;
  // A small grace keeps a fresh 30 s turn from flashing 31 when clocks differ by a few ms.
  return Math.max(0, Math.ceil((view.phaseEndsAt - serverNow() - 150) / 1000));
}
