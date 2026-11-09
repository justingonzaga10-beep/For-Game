import { useEffect, useRef, type ReactNode } from "react";
import { CANVAS_H, CANVAS_W, PAPER, type BrushKind, type DrawAction, type DrawOp } from "@inkwave/shared";
import type { CanvasLogEvent, CanvasSource } from "./canvasLog";
import { DrawingEngine } from "./engine";

export type Tool = "brush" | "eraser" | "fill";
export interface ToolState {
  tool: Tool;
  size: number;
  primary: string;
  secondary: string;
  pressure: boolean;
  /** Brush texture; missing in tool settings saved before textures existed (= pen). */
  brush?: BrushKind;
}

interface Props {
  /** The picture to show and where the local player's ops go: the shared room canvas, or a private one. */
  source: CanvasSource;
  canDraw: boolean;
  tools: ToolState;
  /** Hands the engine to the parent for undo/clear buttons. */
  engineRef: React.MutableRefObject<DrawingEngine | null>;
  /** Called with ops the local player makes, already applied locally. */
  emitRef: React.MutableRefObject<((ops: DrawOp[]) => void) | null>;
  /** A fixed picture under the drawing that undo and clear keep (Perimeter mode's shape). */
  base?: DrawAction[];
  /** Shown on top of the paper, not drawn into it (Perimeter mode's measurements). */
  overlay?: ReactNode;
}
const NO_BASE: DrawAction[] = [];

const FLUSH_MS = 30;

export function DrawCanvas({ source, canDraw, tools, engineRef, emitRef, base = NO_BASE, overlay }: Props) {
  const canvasLog = source.log;
  const sendRef = useRef(source.send);
  sendRef.current = source.send;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const canDrawRef = useRef(canDraw);
  canDrawRef.current = canDraw;

  // Engine lifetime + following the server's canvas log.
  useEffect(() => {
    const engine = new DrawingEngine(canvasRef.current!);
    engineRef.current = engine;
    const sync = () => {
      engine.load(canvasLog.base);
      for (const op of canvasLog.ops) engine.apply(op);
    };
    sync();
    const listener = (ev: CanvasLogEvent) => {
      if (ev.type === "replay") sync();
      else for (const op of ev.ops) engine.apply(op);
    };
    canvasLog.listeners.add(listener);
    return () => {
      canvasLog.listeners.delete(listener);
      engineRef.current = null;
    };
  }, [canvasLog, engineRef]);

  // The base layer; runs after the engine exists, and again whenever the shape changes.
  useEffect(() => {
    engineRef.current?.setBase(base);
  }, [base, engineRef]);

  // Outgoing ops: applied locally at once, sent in ~30 ms batches.
  useEffect(() => {
    let queue: DrawOp[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (!queue.length) return;
      // Merge consecutive point ops for the same stroke into one.
      const merged: DrawOp[] = [];
      for (const op of queue) {
        const last = merged[merged.length - 1];
        if (op.k === "pts" && last?.k === "pts" && last.id === op.id) last.pts.push(...op.pts);
        else merged.push(op.k === "pts" ? { ...op, pts: [...op.pts] } : op);
      }
      queue = [];
      // Respect the server's per-batch caps by splitting large batches.
      for (let i = 0; i < merged.length; i += 30) sendRef.current(merged.slice(i, i + 30));
    };
    emitRef.current = (ops) => {
      for (const op of ops) engineRef.current?.apply(op);
      queue.push(...ops);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    };
    return () => {
      flush();
      if (timer) clearTimeout(timer);
      emitRef.current = null;
    };
  }, [emitRef, engineRef]);

  // Pointer input.
  useEffect(() => {
    const el = canvasRef.current!;
    let strokeId = Math.floor(Math.random() * 1e6);
    let active: { id: number; pointer: number; lx: number; ly: number; n: number } | null = null;

    const toLogical = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * CANVAS_W, y: ((e.clientY - r.top) / r.height) * CANVAS_H };
    };
    const pressureOf = (e: PointerEvent) =>
      toolsRef.current.pressure && e.pointerType === "pen" && e.pressure > 0 ? Math.min(1, Math.max(0.15, e.pressure)) : 1;
    const emit = (ops: DrawOp[]) => emitRef.current?.(ops);

    const moveCursor = (e: PointerEvent) => {
      const c = cursorRef.current;
      if (!c) return;
      const r = el.getBoundingClientRect();
      const t = toolsRef.current;
      const show = canDrawRef.current && e.pointerType !== "touch" && t.tool !== "fill";
      c.style.display = show ? "block" : "none";
      if (!show) return;
      const d = Math.max(4, (t.size * r.width) / CANVAS_W);
      c.style.width = c.style.height = `${d}px`;
      c.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
    };

    const down = (e: PointerEvent) => {
      if (!canDrawRef.current || active) return;
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      const t = toolsRef.current;
      const color = e.button === 2 ? t.secondary : t.primary;
      const { x, y } = toLogical(e);
      if (t.tool === "fill") {
        if (x >= 0 && y >= 0 && x < CANVAS_W && y < CANVAS_H) emit([{ k: "fill", x: Math.floor(x), y: Math.floor(y), color }]);
        return;
      }
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      const id = ++strokeId;
      active = { id, pointer: e.pointerId, lx: x, ly: y, n: 1 };
      const brush = t.tool === "brush" && t.brush && t.brush !== "pen" ? t.brush : undefined; // the eraser is always solid
      emit([{ k: "begin", id, color: t.tool === "eraser" ? PAPER : color, size: t.size, x: round(x), y: round(y), p: pressureOf(e), ...(brush ? { brush } : {}) }]);
    };

    const move = (e: PointerEvent) => {
      moveCursor(e);
      if (!active || e.pointerId !== active.pointer) return;
      const events = e.getCoalescedEvents?.() ?? [];
      const pts: number[] = [];
      for (const ev of events.length ? events : [e]) {
        const { x, y } = toLogical(ev);
        // Skip sub-pixel jitter to keep traffic low.
        if (Math.hypot(x - active.lx, y - active.ly) < 1.2) continue;
        active.lx = x;
        active.ly = y;
        active.n++;
        pts.push(round(x), round(y), pressureOf(ev));
      }
      if (pts.length) emit([{ k: "pts", id: active.id, pts }]);
    };

    const up = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointer) return;
      emit([{ k: "end", id: active.id }]);
      active = null;
    };
    const leave = () => {
      if (cursorRef.current) cursorRef.current.style.display = "none";
    };
    const noMenu = (e: Event) => e.preventDefault();

    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("contextmenu", noMenu);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("contextmenu", noMenu);
    };
  }, [emitRef]);

  return (
    <div className={`paper ${canDraw ? `can-draw tool-${tools.tool}` : ""}`}>
      <canvas ref={canvasRef} aria-label={canDraw ? "Drawing canvas: draw here" : "The drawing"} />
      {overlay}
      <div ref={cursorRef} className="brush-cursor" aria-hidden="true" />
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
