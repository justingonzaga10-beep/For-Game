import { useEffect, useMemo, useState } from "react";
import {
  HIDEABLE,
  MEASURE_SHAPES,
  SHAPE_LABELS,
  SHAPE_PARAMS,
  edgeLengths,
  kindsFor,
  perimeterOf,
  randomShape,
  shapeAreaParts,
  shapeExtraLabels,
  shapeGeometry,
  shapeInsideLines,
  shapeOutline,
  shapeProblem,
  shapeRightAngle,
  type Measure,
  type PerimeterShape,
  type RoomView,
  type ShapeKind,
} from "@inkwave/shared";
import { DrawCanvas } from "../canvas/DrawCanvas";
import { Toolbar } from "../canvas/Toolbar";
import { useDrawingTools } from "../canvas/useDrawingTools";
import { useGame } from "../lib/game";
import { sfx } from "../lib/sound";
import { Avatar } from "./Avatar";
import { GameLayout } from "./GameLayout";
import { Overlays } from "./Overlays";
import { TimerRing } from "./WordBar";

/** Perimeter or Area, from the turn (or the room's mode before a turn starts). */
export function measureOf(view: RoomView): Measure {
  return view.perimeter?.measure ?? (view.settings.mode === "area" ? "area" : "perimeter");
}
/** "22", or "12.5" for half squares. */
const num = (n: number | null | undefined) => (n == null ? "" : Number.isInteger(n) ? String(n) : n.toFixed(1));
/** The unit answers are in: cm for perimeter, cm² for area. */
const answerUnit = (unit: string, m: Measure) => (m === "area" ? `${unit}²` : unit);
const title = (m: Measure) => (m === "area" ? "Area" : "Perimeter");

const REASONS = { time: "Time's up!", all_guessed: "Everyone found it!", drawer_left: "The drawer left.", skipped: "Turn skipped." } as const;

/** Perimeter and Area: one player makes a shape with measurements; everyone else works out its perimeter or area. */
export function PerimeterScreen() {
  const g = useGame();
  const view = g.view!;
  const per = view.perimeter;
  const phase = view.phase;
  const isDrawer = view.drawerId === view.you;
  const canDraw = phase === "perim_solve" && isDrawer;
  const { tools, setTools, engineRef, emitRef, undo, clear } = useDrawingTools(canDraw);
  const shape = per?.shape ?? null;
  const shapeKey = JSON.stringify(shape);
  // The outline is drawn into the canvas (so fills stop at it) and survives undo and clear.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => (shape ? shapeOutline(shape) : []), [shapeKey]);
  const unit = per?.unit ?? view.settings.perimeterUnit;
  const measure = measureOf(view);

  let body: JSX.Element;
  if (phase === "perim_build" && isDrawer) {
    body = <ShapeBuilder />;
  } else if (phase === "podium") {
    body = (
      <div className="canvas-frame">
        <div className="paper" />
        <Overlays />
      </div>
    );
  } else {
    const drawer = view.players.find((p) => p.id === view.drawerId);
    body = (
      <>
        <div className="canvas-frame">
          <DrawCanvas
            source={{ log: g.canvasLog, send: g.sendDraw }}
            canDraw={canDraw}
            tools={tools}
            engineRef={engineRef}
            emitRef={emitRef}
            base={base}
            overlay={shape && <ShapeLabels shape={shape} unit={unit} measure={measure} reveal={phase === "perim_reveal"} />}
          />
          {phase === "perim_build" && (
            <div className="overlay">
              {drawer && <Avatar avatar={drawer.avatar} size={84} className="bob" />}
              <h3>{drawer?.name ?? "Someone"} is making a shape…</h3>
              <p className="muted">Get ready to find its {measure}!</p>
            </div>
          )}
        </div>
        {phase === "perim_solve" && isDrawer && (
          <>
            <p className="perim-tip">Decorate your shape while the others solve it!</p>
            <Toolbar tools={tools} setTools={setTools} onUndo={undo} onClear={clear} />
          </>
        )}
        {phase === "perim_solve" && !isDrawer && <NumberPad />}
        {phase === "perim_reveal" && <RevealPanel />}
      </>
    );
  }

  return (
    <GameLayout
      board={
        <section className={`board perimeter ${measure} ${phase}`} aria-label={title(measure)}>
          <PerimBar />
          {body}
        </section>
      }
    />
  );
}

function PerimBar() {
  const view = useGame().view!;
  const per = view.perimeter;
  const isDrawer = view.drawerId === view.you;
  const drawer = view.players.find((p) => p.id === view.drawerId);
  const measure = measureOf(view);
  const unit = answerUnit(per?.unit ?? view.settings.perimeterUnit, measure);
  let center: JSX.Element;
  switch (view.phase) {
    case "perim_build":
      center = isDrawer ? (
        <span className="word-real theme">
          <small>Your turn</small>Make a shape
        </span>
      ) : (
        <span className="word-status">{drawer?.name ?? "Someone"} is making a shape…</span>
      );
      break;
    case "perim_solve":
      center =
        per?.answer != null ? (
          <span className={`word-real theme ${isDrawer ? "drawer" : "guessed"}`}>
            <small>{isDrawer ? "The answer is" : "You found it"}</small>
            {num(per.answer)} {unit}
          </span>
        ) : (
          <span className="word-real theme">
            <small>Find the</small>
            {title(measure)}
          </span>
        );
      break;
    case "perim_reveal":
      center = (
        <span className="word-real theme">
          <small>The {measure} is</small>
          {num(per?.answer)} {unit}
        </span>
      );
      break;
    default:
      center = <span className="word-status">Game over</span>;
  }
  return (
    <div className="wordbar panel">
      <div className="round-tag">
        {view.phase === "podium" ? (
          "Final"
        ) : (
          <>
            Round
            <b>
              {Math.min(view.round, view.settings.rounds)}/{view.settings.rounds}
            </b>
          </>
        )}
      </div>
      <div className="word-center" aria-live="polite">
        {center}
      </div>
      <TimerRing urgent={view.phase === "perim_solve"} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The shape: measurements over the canvas                             */
/* ------------------------------------------------------------------ */

function describe(shape: PerimeterShape, unit: string): string {
  const edges = shapeGeometry(shape);
  const shown = edges.filter((e) => e.labelled).map((e) => (e.hidden ? `one side unknown` : `${e.length} ${unit}`));
  const extra = shapeExtraLabels(shape).map((x) => `, roof height ${x.length} ${unit}`).join("");
  return `${SHAPE_LABELS[shape.kind]} with sides marked ${shown.join(", ")}${extra}.`;
}

/**
 * Measurements beside each side, as an SVG over the 800×600 canvas. At the
 * reveal, each side lights up in turn and hidden measurements appear.
 * In the builder, `onPick` makes labels tappable (to hide one).
 */
export function ShapeLabels({
  shape,
  unit,
  measure = "perimeter",
  reveal = false,
  outline = false,
  onPick,
}: {
  shape: PerimeterShape;
  unit: string;
  measure?: Measure;
  reveal?: boolean;
  outline?: boolean;
  onPick?: (edge: number) => void;
}) {
  const edges = shapeGeometry(shape);
  const step = 0.55;
  const area = measure === "area";
  const corner = outline ? shapeRightAngle(shape) : null;
  return (
    <svg className={`shape-labels ${onPick ? "editable" : ""}`} viewBox="0 0 800 600" role="img" aria-label={describe(shape, unit)}>
      {outline && (
        <>
          <polygon points={edges.map((e) => e.from.join(",")).join(" ")} fill="none" stroke="#2b2b30" strokeWidth="5" strokeLinejoin="round" />
          {shapeInsideLines(shape).map(([p, q], i) => (
            <line key={`in-${i}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="#9a96a0" strokeWidth="3" strokeDasharray="14 10" />
          ))}
          {corner && <polyline points={corner.map((c) => c.join(",")).join(" ")} fill="none" stroke="#2b2b30" strokeWidth="3" />}
        </>
      )}
      {reveal &&
        area &&
        // Area: shade the parts that are added, and hatch the parts taken away.
        shapeAreaParts(shape).map((part, i) => (
          <polygon
            key={`part-${i}`}
            className={`area-part ${part.sign > 0 ? "add" : "take"}`}
            points={part.pts.map((c) => c.join(",")).join(" ")}
            style={{ animationDelay: `${i * 0.9}s` }}
          />
        ))}
      {reveal &&
        !area &&
        edges.map((e, i) => (
          <line
            key={`glow-${i}`}
            className="edge-glow"
            x1={e.from[0]}
            y1={e.from[1]}
            x2={e.to[0]}
            y2={e.to[1]}
            style={{ animationDelay: `${i * step}s` }}
          />
        ))}
      {edges.map((e, i) => {
        // At a perimeter reveal every side is named; area doesn't need the slanted sides.
        const show = e.labelled || (reveal && !area);
        if (!show) return null;
        const hiddenNow = e.hidden && !reveal;
        return (
          <text
            key={i}
            x={e.label[0]}
            y={e.label[1]}
            className={`${hiddenNow ? "unknown" : ""} ${e.hidden && reveal ? "found" : ""} ${!e.labelled && reveal ? "extra" : ""} ${reveal ? "label-pop" : ""}`}
            style={reveal ? { animationDelay: `${i * step}s` } : undefined}
            onClick={onPick ? () => onPick(i) : undefined}
          >
            {hiddenNow ? "?" : e.length} {unit}
          </text>
        );
      })}
      {shapeExtraLabels(shape).map((x, i) => (
        <text key={`x-${i}`} x={x.at[0]} y={x.at[1]} className="inner">
          {x.length} {unit}
        </text>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

function ShapeBuilder() {
  const g = useGame();
  const s = g.view!.settings;
  const measure = measureOf(g.view!);
  const mine = kindsFor(measure);
  const chosen = mine.filter((k) => s.perimeterShapes.includes(k));
  const kinds = chosen.length ? chosen : mine;
  const max = s.perimeterMax;
  const [shape, setShape] = useState<PerimeterShape>(() => randomShape(kinds, max));
  const problem = shapeProblem(shape.kind, shape.sides, max);
  const canHide = s.perimeterChallenge && HIDEABLE.includes(shape.kind);

  const setKind = (k: ShapeKind) => setShape(randomShape([k], max));
  const setSide = (i: number, raw: number) => {
    const sides = [...shape.sides];
    const lo = (shape.kind === "lshape" && i < 2) || (shape.kind === "ushape" && i === 2) || (shape.kind === "househ" && i === 0) ? 2 : 1;
    sides[i] = Math.max(lo, Math.min(max, Math.round(raw) || lo));
    if (shape.kind === "lshape") {
      // Keep the cut smaller than the shape.
      sides[2] = Math.min(sides[2], sides[0] - 1);
      sides[3] = Math.min(sides[3], sides[1] - 1);
    }
    if (shape.kind === "ushape") sides[3] = Math.min(sides[3], sides[2] - 1); // the base stays below the top
    // Other rules (a house roof that can't meet, a T-shape too wide) are explained, not silently fixed.
    setShape({ ...shape, sides });
  };
  const pick = (edge: number) => setShape({ ...shape, hidden: shape.hidden === edge ? null : edge });
  const submit = () => {
    if (problem) return;
    g.submitShape({ ...shape, hidden: canHide ? shape.hidden : null });
  };

  return (
    <>
      <div className="canvas-frame">
        <div className="paper builder-preview">
          {!problem && <ShapeLabels shape={canHide ? shape : { ...shape, hidden: null }} unit={s.perimeterUnit} measure={measure} outline onPick={canHide ? pick : undefined} />}
          {problem && <p className="builder-problem">{problem}</p>}
        </div>
      </div>
      <div className="builder-controls panel">
        <div className="shape-kinds" role="radiogroup" aria-label="Shape">
          {[
            { name: "Basic", list: MEASURE_SHAPES[measure].basic },
            { name: "Composite", list: MEASURE_SHAPES[measure].composite },
          ].map((group) => {
            const shown = group.list.filter((k) => kinds.includes(k));
            if (!shown.length) return null;
            return (
              <div className="kind-group" key={group.name}>
                <small>{group.name}</small>
                {shown.map((k) => (
                  <button key={k} id={`kind-${k}`} type="button" role="radio" aria-checked={shape.kind === k} className={`tbtn kind ${shape.kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
                    {SHAPE_LABELS[k]}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="steppers">
          {SHAPE_PARAMS[shape.kind].map((label, i) => (
            <div className="stepper" key={`${shape.kind}-${i}`}>
              <span>{label}</span>
              <div className="stepper-row">
                <button type="button" className="tbtn" aria-label={`Less ${label.toLowerCase()}`} onClick={() => setSide(i, shape.sides[i] - 1)}>
                  −
                </button>
                <input
                  id={`side-${i}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={max}
                  value={shape.sides[i]}
                  aria-label={`${label} in ${s.perimeterUnit}`}
                  onChange={(e) => setSide(i, Number(e.target.value))}
                />
                <button type="button" className="tbtn" aria-label={`More ${label.toLowerCase()}`} onClick={() => setSide(i, shape.sides[i] + 1)}>
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="builder-actions">
          <button type="button" className="btn ghost small" onClick={() => setShape(randomShape([shape.kind], max))}>
            🎲 Random numbers
          </button>
          {canHide && <small className="muted">{shape.hidden === null ? "Tap a measurement to hide it." : "Tap the ? to show it again."}</small>}
          <button type="button" id="show-shape" className="btn primary" disabled={!!problem} onClick={submit}>
            Show my shape
          </button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Answering                                                           */
/* ------------------------------------------------------------------ */

function NumberPad() {
  const g = useGame();
  const view = g.view!;
  const measure = measureOf(view);
  const area = measure === "area";
  const unit = answerUnit(view.perimeter?.unit ?? view.settings.perimeterUnit, measure);
  const me = view.players.find((p) => p.id === view.you);
  const solved = !!me?.guessed;
  const [value, setValue] = useState("");
  const fb = g.perimFeedback;

  const press = (d: string) =>
    !solved &&
    setValue((v) => {
      if (d === ".") return !area || v.includes(".") ? v : (v || "0") + "."; // halves only come up in Area
      if (v.includes(".")) return /\.\d$/.test(v) ? v : v + d; // one decimal place
      return v.length >= 5 ? v : (v + d).replace(/^0+(?=\d)/, "");
    });
  const back = () => setValue((v) => v.slice(0, -1));
  const submit = () => {
    if (solved || !value || value.endsWith(".")) return;
    g.answerPerimeter(Number(value));
    setValue("");
  };

  useEffect(() => {
    if (fb?.result === "close") sfx.close();
    else if (fb?.result === "wrong" || fb?.result === "mixup") sfx.wrong();
  }, [fb?.n, fb?.result]);

  // Typing works too: digits, Backspace and Enter (unless you're typing in chat).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (/^\d$/.test(e.key) || e.key === "." || e.key === ",") press(e.key === "," ? "." : e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Enter") submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  let note: JSX.Element | null = null;
  if (solved) note = <p className="perim-note correct">Correct! You found it. Wait for the others…</p>;
  else if (fb?.result === "mixup") note = <p className="perim-note close">{num(fb.value)} {view.perimeter?.unit} is the perimeter! The area is the space inside the shape.</p>;
  else if (fb?.result === "close") note = <p className="perim-note close">{num(fb.value)} {unit} is close! {area ? "Check your multiplying." : "Did you add all the sides?"}</p>;
  else if (fb?.result === "wrong") note = <p className="perim-note wrong">{num(fb.value)} {unit} isn't right. Try again!</p>;
  else note = <p className="perim-note">{area ? "Work out the space inside. Type the area." : "Add up all the sides. Type the total."}</p>;

  return (
    <div className="numpad panel" aria-label="Your answer">
      <div className="numpad-left">
        <output className={`numpad-display ${solved ? "solved" : ""}`} aria-live="polite">
          <span>{solved ? num(view.perimeter?.answer) : value || "?"}</span> {unit}
        </output>
        {note}
      </div>
      <div className={`numpad-keys ${area ? "area" : ""}`}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className="key" disabled={solved} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="key k-del" disabled={solved} aria-label="Delete" onClick={back}>
          ⌫
        </button>
        <button type="button" className="key k-0" disabled={solved} onClick={() => press("0")}>
          0
        </button>
        {area && (
          <button type="button" className="key k-dot" id="key-dot" disabled={solved} aria-label="Decimal point" onClick={() => press(".")}>
            .
          </button>
        )}
        <button type="button" className="key go" id="answer-submit" disabled={solved || !value || value.endsWith(".")} aria-label="Submit answer" onClick={submit}>
          ✓
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reveal                                                              */
/* ------------------------------------------------------------------ */

function RevealPanel() {
  const view = useGame().view!;
  const per = view.perimeter;
  const r = view.reveal;
  if (!per?.shape || !r) return null;
  const step = 0.55;
  // Perimeter: each side in turn. Area: each step of the working ("8 × 6 − 3 × 2", "48 − 6", "42 cm²").
  const sides = per.measure === "area" ? [] : edgeLengths(per.shape);
  const steps = per.measure === "area" ? (per.equation?.sum ?? "").split(" = ") : [];
  const total = perimeterOf(per.shape);
  const noteDelay = per.measure === "area" ? steps.length * 0.9 : (sides.length + 1) * step;
  const rows = view.players.map((p) => ({ p, pts: r.gains[p.id] ?? 0 })).sort((a, b) => b.pts - a.pts);
  return (
    <div className="reveal-panel panel" role="status">
      <p className="reason">{REASONS[r.reason]}</p>
      <p className="equation" aria-label={per.equation?.sum}>
        {steps.map((t, i) => (
          <span key={`s-${i}`} className={`term ${i === steps.length - 1 ? "total" : ""}`} style={{ animationDelay: `${i * 0.9}s` }}>
            {i > 0 && <i>{"\u00a0=\u00a0"}</i>}
            {t.replace(/−/g, "-").replace(/ /g, "\u00a0")}
          </span>
        ))}
        {sides.map((n, i) => (
          <span key={i} className="term" style={{ animationDelay: `${i * step}s` }}>
            {i > 0 && <i>{"\u00a0+\u00a0"}</i>}
            {n}
          </span>
        ))}
        {per.measure !== "area" && (
          <span className="term total" style={{ animationDelay: `${sides.length * step}s` }}>
            <i>{"\u00a0=\u00a0"}</i>
            {total} {per.unit}
          </span>
        )}
      </p>
      {per.equation?.shortcut && (
        <p className="shortcut" style={{ animationDelay: `${noteDelay}s` }}>
          Shortcut: {per.equation.shortcut}
        </p>
      )}
      {per.equation?.note && (
        <p className="shortcut note" style={{ animationDelay: `${noteDelay}s` }}>
          {per.equation.note}
        </p>
      )}
      <ul className="gains mini">
        {rows.map(({ p, pts }) => (
          <li key={p.id} className={pts > 0 ? "plus" : ""}>
            <Avatar avatar={p.avatar} size={22} />
            <span className="pname">
              {p.name}
              {p.id === view.drawerId && <small> (made it)</small>}
            </span>
            <b>{pts > 0 ? `+${pts}` : "0"}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
