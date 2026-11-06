import { useEffect, useRef, useState } from "react";
import type { DrawAction } from "@inkwave/shared";
import { DrawingEngine } from "./engine";

/** A finished drawing, read-only, at full quality. */
export function DrawingView({ actions, label }: { actions: readonly DrawAction[] | undefined; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useRef<DrawingEngine | null>(null);
  useEffect(() => {
    engine.current = new DrawingEngine(ref.current!);
    return () => {
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    engine.current?.load([...(actions ?? [])]);
  }, [actions]);
  return (
    <div className="paper">
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  );
}

/* Thumbnails: one shared offscreen engine renders each drawing once into a small JPEG. */
const cache = new Map<string, string>();
let offscreen: DrawingEngine | null = null;

function renderThumbnail(actions: readonly DrawAction[]): string {
  offscreen ??= new DrawingEngine(document.createElement("canvas"));
  offscreen.load([...actions]);
  const t = document.createElement("canvas");
  t.width = 400;
  t.height = 300;
  t.getContext("2d")!.drawImage(offscreen.canvas, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.85);
}

/** A small image of a drawing, keyed by entry id so each is rendered only once. */
export function Thumbnail({ entryId, actions, label }: { entryId: string; actions: readonly DrawAction[] | undefined; label: string }) {
  const [src, setSrc] = useState(() => cache.get(entryId) ?? "");
  useEffect(() => {
    if (cache.has(entryId)) return setSrc(cache.get(entryId)!);
    if (!actions) return;
    // Render after paint so a full gallery doesn't block the first frame.
    const id = requestAnimationFrame(() => {
      const url = renderThumbnail(actions);
      if (cache.size > 120) cache.delete(cache.keys().next().value!);
      cache.set(entryId, url);
      setSrc(url);
    });
    return () => cancelAnimationFrame(id);
  }, [entryId, actions]);
  return src ? <img className="thumb" src={src} alt={label} width={400} height={300} /> : <div className="thumb blank" role="img" aria-label={label} />;
}
