import { useEffect, useState } from "react";
import { BASIC_SHAPES, COMPOSITE_SHAPES, DRAWOFF_MIN_PLAYERS, LANGUAGES, PERIMETER_MAXES, SETTING_BOUNDS, SHAPE_LABELS, type GameModeId, type RoomSettings, type ShapeKind, type WordMode } from "@inkwave/shared";
import { useCountdown, useGame } from "../lib/game";
import { useMuted } from "../lib/muted";
import { Avatar } from "./Avatar";
import { Chat } from "./Chat";
import { HowToPlayButton } from "./HowToPlay";
import { PlayerActions } from "./PlayerActions";

const DRAW_TIMES = [15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 180, 210, 240];
const DRAWOFF_TIMES = [30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240];
const GAME_MODE_CARDS: { id: GameModeId; title: string; blurb: string }[] = [
  { id: "guess", title: "Guessing", blurb: "One player draws, everyone else races to guess the word." },
  { id: "drawoff", title: "Draw-Off", blurb: "Everyone draws the same theme, then rates each other's art." },
  { id: "perimeter", title: "Perimeter", blurb: "Make a shape with measurements. Everyone finds its perimeter." },
];
const PERIM_TIMES = [20, 30, 45, 60, 75, 90, 120, 150, 180];
/** Keeps the current value selectable even if it isn't one of the presets. */
const withValue = (list: number[], v: number) => (list.includes(v) ? list : [...list, v].sort((a, b) => a - b));
const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const MODES: { id: WordMode; label: string; hint: string }[] = [
  { id: "normal", label: "Normal", hint: "Blanks show the letter count" },
  { id: "hidden", label: "Hidden", hint: "No blanks, no hints" },
  { id: "combination", label: "Combo", hint: "Two words joined together" },
];

export function Lobby() {
  const g = useGame();
  const view = g.view!;
  const muted = useMuted();
  const isHost = view.hostId === view.you && !view.isPublic;
  const s = view.settings;
  const set = (patch: Partial<RoomSettings>) => g.updateSettings(patch);
  const countdown = useCountdown();

  // Custom words are typed freely and sent after a short pause.
  const [words, setWords] = useState(s.customWords);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setWords(s.customWords);
  }, [s.customWords, editing]);
  useEffect(() => {
    if (!editing || words === s.customWords) return;
    const t = setTimeout(() => set({ customWords: words }), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, editing]);

  const link = `${location.origin}/room/${view.code}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const el = document.getElementById("invite-link") as HTMLInputElement | null;
      el?.select();
    }
  };

  const isDrawOff = s.mode === "drawoff" && !view.isPublic;
  const isPerimeter = s.mode === "perimeter" && !view.isPublic;
  const isGuess = !isDrawOff && !isPerimeter;
  const toggleShape = (k: ShapeKind) => {
    const on = s.perimeterShapes.includes(k);
    if (on && s.perimeterShapes.length === 1) return; // keep at least one
    set({ perimeterShapes: on ? s.perimeterShapes.filter((x) => x !== k) : [...s.perimeterShapes, k] });
  };
  const minPlayers = isDrawOff ? DRAWOFF_MIN_PLAYERS : 2;
  const enough = view.players.length >= minPlayers;
  const customCount = s.customWords.split(",").filter((w) => w.trim()).length;

  return (
    <div className="lobby">
      <section className="panel cabinet lobby-players" aria-labelledby="players-h">
        <div className="panel-head">
          <h2 id="players-h">Players</h2>
          <span className="count">
            {view.players.length}/{s.maxPlayers}
          </span>
        </div>

        {!view.isPublic && (
          <div className="invite">
            <label htmlFor="invite-link">Invite link</label>
            <div className="invite-row">
              <input id="invite-link" readOnly value={link} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn small secondary" onClick={copy}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="muted">
              Room code <b className="code">{view.code}</b>
            </p>
          </div>
        )}

        <ul className="lobby-list">
          {view.players.map((p) => (
            <li key={p.id} className={p.id === view.you ? "me" : ""}>
              <Avatar avatar={p.avatar} size={40} />
              <span className="pname">
                {p.name}
                {p.id === view.you && <em> (you)</em>}
                {muted.has(p.id) && <em className="muted-tag"> muted</em>}
              </span>
              {p.isHost && (
                <span className="crown" title="Host">
                  ♛
                </span>
              )}
              {p.kickVotes > 0 && <span className="votes">kick {p.kickVotes}</span>}
              <PlayerActions player={p} view={view} />
            </li>
          ))}
        </ul>
      </section>

      <section className="panel cabinet lobby-settings" aria-labelledby="settings-h">
        <div className="panel-head">
          <h2 id="settings-h">{view.isPublic ? "Public room" : "Room settings"}</h2>
          {!isHost && !view.isPublic && <span className="muted">Only the host can change these</span>}
          {/* Outside the settings fieldset, so guests can use it too. */}
          <HowToPlayButton key={s.mode} mode={isDrawOff ? "drawoff" : "guess"} />
        </div>

        <fieldset className="settings-grid" disabled={!isHost}>
          {!view.isPublic && (
            <div className="field wide">
              <span>Game mode</span>
              <div className="mode-cards" role="radiogroup" aria-label="Game mode">
                {GAME_MODE_CARDS.map((m) => (
                  <button
                    key={m.id}
                    id={`mode-${m.id}`}
                    type="button"
                    role="radio"
                    aria-checked={s.mode === m.id}
                    className={`mode-card ${s.mode === m.id ? "on" : ""}`}
                    onClick={() => set({ mode: m.id })}
                  >
                    <b>{m.title}</b>
                    <span>{m.blurb}</span>
                  </button>
                ))}
              </div>
              {isDrawOff && <small className="muted">Needs at least {DRAWOFF_MIN_PLAYERS} players. Themes are in English.</small>}
              {isPerimeter && <small className="muted">Each player makes a shape with measurements; the others work out its perimeter.</small>}
            </div>
          )}
          {isGuess && (
          <Field label="Language">
            <select id="set-language" value={s.language} onChange={(e) => set({ language: e.target.value as RoomSettings["language"] })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          )}
          <Field label="Players">
            <select id="set-max" value={s.maxPlayers} onChange={(e) => set({ maxPlayers: +e.target.value })}>
              {range(...SETTING_BOUNDS.maxPlayers).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rounds">
            <select id="set-rounds" value={s.rounds} onChange={(e) => set({ rounds: +e.target.value })}>
              {range(...SETTING_BOUNDS.rounds).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          {isDrawOff && (
            <Field label="Draw time">
              <select id="set-drawoff-time" value={s.drawOffTime} onChange={(e) => set({ drawOffTime: +e.target.value })}>
                {withValue(DRAWOFF_TIMES, s.drawOffTime).map((n) => (
                  <option key={n} value={n}>
                    {n} s
                  </option>
                ))}
              </select>
            </Field>
          )}
          {isPerimeter && (
            <>
              <Field label="Answer time">
                <select id="set-perim-time" value={s.perimeterTime} onChange={(e) => set({ perimeterTime: +e.target.value })}>
                  {withValue(PERIM_TIMES, s.perimeterTime).map((n) => (
                    <option key={n} value={n}>
                      {n} s
                    </option>
                  ))}
                </select>
              </Field>
              <div className="field">
                <span>Units</span>
                <div className="segmented" role="radiogroup" aria-label="Units">
                  {(["cm", "m"] as const).map((u) => (
                    <button key={u} id={`unit-${u}`} type="button" role="radio" aria-checked={s.perimeterUnit === u} className={s.perimeterUnit === u ? "on" : ""} onClick={() => set({ perimeterUnit: u })}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field wide">
                <span>Number size</span>
                <div className="segmented" role="radiogroup" aria-label="Number size">
                  {PERIMETER_MAXES.map((m) => (
                    <button key={m} id={`max-${m}`} type="button" role="radio" aria-checked={s.perimeterMax === m} className={s.perimeterMax === m ? "on" : ""} onClick={() => set({ perimeterMax: m })}>
                      1 to {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field wide">
                <span>Shapes</span>
                {[
                  { name: "Basic", list: BASIC_SHAPES },
                  { name: "Composite", list: COMPOSITE_SHAPES },
                ].map((group) => (
                  <div className="shape-chips" key={group.name}>
                    <small className="chip-group">{group.name}</small>
                    {group.list.map((k) => (
                      <label key={k} className={`chip ${s.perimeterShapes.includes(k) ? "on" : ""}`}>
                        <input id={`shape-${k}`} type="checkbox" checked={s.perimeterShapes.includes(k)} onChange={() => toggleShape(k)} />
                        {SHAPE_LABELS[k]}
                      </label>
                    ))}
                  </div>
                ))}
                <label className="check">
                  <input id="set-perim-challenge" type="checkbox" checked={s.perimeterChallenge} onChange={(e) => set({ perimeterChallenge: e.target.checked })} />
                  Challenge: the drawer may hide one measurement on a rectangle, L, T or U-shape
                </label>
              </div>
            </>
          )}
          {isGuess && (
          <>
          <Field label="Draw time">
            <select id="set-time" value={s.drawTime} onChange={(e) => set({ drawTime: +e.target.value })}>
              {withValue(DRAW_TIMES, s.drawTime).map((n) => (
                <option key={n} value={n}>
                  {n} s
                </option>
              ))}
            </select>
          </Field>
          <Field label="Word choices">
            <select id="set-choices" value={s.wordChoices} onChange={(e) => set({ wordChoices: +e.target.value })}>
              {range(...SETTING_BOUNDS.wordChoices).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hints">
            <select id="set-hints" value={s.hints} onChange={(e) => set({ hints: +e.target.value })}>
              {range(...SETTING_BOUNDS.hints).map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "None" : n}
                </option>
              ))}
            </select>
          </Field>

          <div className="field wide">
            <span>Word mode</span>
            <div className="segmented" role="radiogroup" aria-label="Word mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={s.wordMode === m.id}
                  className={s.wordMode === m.id ? "on" : ""}
                  title={m.hint}
                  onClick={() => set({ wordMode: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <small className="muted">{MODES.find((m) => m.id === s.wordMode)?.hint}</small>
          </div>

          {!view.isPublic && (
            <div className="field wide">
              <label htmlFor="set-words">
                Custom words <small className="muted">comma-separated · {customCount} added</small>
              </label>
              <textarea
                id="set-words"
                rows={3}
                value={words}
                placeholder="tarsier, jeepney, halo-halo, rubber duck"
                onFocus={() => setEditing(true)}
                onBlur={() => {
                  setEditing(false);
                  if (words !== s.customWords) set({ customWords: words });
                }}
                onChange={(e) => setWords(e.target.value)}
              />
              <label className="check">
                <input id="set-custom-only" type="checkbox" checked={s.customOnly} onChange={(e) => set({ customOnly: e.target.checked })} />
                Use custom words only
              </label>
            </div>
          )}
          </>
          )}
        </fieldset>

        <div className="start-row">
          {view.isPublic ? (
            <p className="status">
              {enough && countdown !== null ? (
                <>
                  Starting in <b>{countdown}</b>…
                </>
              ) : (
                "Waiting for one more player to join…"
              )}
            </p>
          ) : isHost ? (
            <button type="button" className="btn primary big" disabled={!enough} onClick={g.start}>
              {enough ? `Start ${isDrawOff ? "Draw-Off" : isPerimeter ? "Perimeter" : "game"}` : `Waiting for players (${view.players.length}/${minPlayers})`}
            </button>
          ) : (
            <p className="status">Waiting for the host to start the game…</p>
          )}
        </div>
      </section>

      <section className="panel cabinet lobby-chat" aria-labelledby="chat-h">
        <h2 id="chat-h" className="side-h">
          Chat
        </h2>
        <Chat />
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
