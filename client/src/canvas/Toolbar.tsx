import { BRUSH_KINDS, BRUSH_SIZES, PALETTE, type BrushKind } from "@inkwave/shared";
import type { Tool, ToolState } from "./DrawCanvas";

interface Props {
  tools: ToolState;
  setTools: (t: ToolState) => void;
  onUndo: () => void;
  onClear: () => void;
}

const TOOL_INFO: { id: Tool; label: string; key: string; icon: JSX.Element }[] = [
  {
    id: "brush",
    label: "Brush",
    key: "B",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 4l6 6-9 9H5v-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 6l6 6" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  {
    id: "eraser",
    label: "Eraser",
    key: "E",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 15l9-9 8 8-6 6H8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M8 10l7 7M8 20h13" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  {
    id: "fill",
    label: "Fill",
    key: "F",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12l7-7 8 8-7 7z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M20 16c1.5 2 1.5 4 0 4s-1.5-2 0-4z" fill="currentColor" />
      </svg>
    ),
  },
];

/** Little previews of each texture, drawn in the current colour. */
function BrushIcon({ kind, color }: { kind: BrushKind; color: string }) {
  const id = `bi-${kind}`;
  switch (kind) {
    case "pen":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 17c4-8 8 2 16-8" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case "soft":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <radialGradient id={id}>
              <stop offset="0" stopColor={color} stopOpacity="0.75" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="12" cy="12" r="10" fill={`url(#${id})`} />
        </svg>
      );
    case "spray":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill={color}>
          {[
            [12, 12], [8, 9], [15, 8], [16, 14], [9, 15], [12, 5], [5, 12], [19, 11], [12, 19], [7, 6], [17, 18], [6, 17], [13, 15], [10, 11],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i < 5 ? 1.4 : 1} />
          ))}
        </svg>
      );
    case "hatch":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <clipPath id={id}>
              <circle cx="12" cy="12" r="9.5" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${id})`} stroke={color} strokeWidth="2">
            {[-12, -6, 0, 6, 12].map((o) => (
              <line key={o} x1={o} y1="24" x2={24 + o} y2="0" />
            ))}
          </g>
        </svg>
      );
    case "crayon":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 17c4-8 8 2 16-8" fill="none" stroke={color} strokeWidth="7" strokeDasharray="1.1 0.9" opacity="0.85" />
          <path d="M4 17c4-8 8 2 16-8" fill="none" stroke={color} strokeWidth="3" strokeDasharray="0.8 1.6" />
        </svg>
      );
  }
}

export function Toolbar({ tools, setTools, onUndo, onClear }: Props) {
  const set = (patch: Partial<ToolState>) => setTools({ ...tools, ...patch });
  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="tool-colors">
        <div className="current-colors" title="Left click uses the primary colour, right click the secondary">
          <button
            type="button"
            className="swap"
            aria-label="Swap primary and secondary colours"
            onClick={() => set({ primary: tools.secondary, secondary: tools.primary })}
          >
            <span className="cc secondary" style={{ background: tools.secondary }} />
            <span className="cc primary" style={{ background: tools.primary }} />
          </button>
        </div>
        <div className="palette">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${tools.primary === c ? "on" : ""} ${tools.secondary === c ? "on2" : ""}`}
              style={{ background: c }}
              aria-label={`Colour ${c}`}
              aria-pressed={tools.primary === c}
              onClick={() => set({ primary: c, tool: tools.tool === "eraser" ? "brush" : tools.tool })}
              onContextMenu={(e) => {
                e.preventDefault();
                set({ secondary: c });
              }}
            />
          ))}
        </div>
      </div>

      <div className="tool-group sizes" aria-label="Brush size">
        {BRUSH_SIZES.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`tbtn size ${tools.size === s ? "on" : ""}`}
            aria-label={`Brush size ${i + 1}`}
            aria-pressed={tools.size === s}
            title={`Size ${i + 1} (${i + 1})`}
            onClick={() => set({ size: s })}
          >
            <span style={{ width: Math.min(26, 4 + s * 0.55), height: Math.min(26, 4 + s * 0.55) }} />
          </button>
        ))}
      </div>

      <div className="tool-group brushes" role="radiogroup" aria-label="Brush texture">
        {BRUSH_KINDS.map((b) => {
          const on = tools.tool === "brush" && (tools.brush ?? "pen") === b.id;
          return (
            <button
              key={b.id}
              type="button"
              role="radio"
              className={`tbtn brush-kind ${on ? "on" : ""}`}
              aria-checked={on}
              aria-label={b.label}
              title={b.label}
              onClick={() => set({ brush: b.id, tool: "brush" })}
            >
              <BrushIcon kind={b.id} color={tools.primary === "#ffffff" ? "#9a96a0" : tools.primary} />
            </button>
          );
        })}
      </div>

      <div className="tool-group">
        {TOOL_INFO.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tbtn ${tools.tool === t.id ? "on" : ""}`}
            aria-pressed={tools.tool === t.id}
            title={`${t.label} (${t.key})`}
            aria-label={t.label}
            onClick={() => set({ tool: t.id })}
          >
            {t.icon}
          </button>
        ))}
        <button type="button" className="tbtn" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={onUndo}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 7L4 12l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 12h9a6 6 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" transform="translate(0 -5)" />
          </svg>
        </button>
        <button type="button" className="tbtn danger" title="Clear canvas" aria-label="Clear canvas" onClick={onClear}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
