import { useState } from "react";
import {
  AVATAR_COLORS,
  AVATAR_PARTS,
  LANGUAGES,
  LIMITS,
  randomAvatar,
  sanitizeAvatar,
  type Avatar as AvatarData,
  type JoinResult,
  type LanguageCode,
  type Profile,
} from "@inkwave/shared";
import { useGame, type Removal } from "../lib/game";
import { load, save } from "../lib/storage";
import { Avatar } from "./Avatar";
import { BrandShield } from "./BrandShield";
import { Logo } from "./Logo";

const PARTS: { key: Exclude<keyof AvatarData, "color">; label: string }[] = [
  { key: "head", label: "Head" },
  { key: "eyes", label: "Eyes" },
  { key: "mouth", label: "Mouth" },
  { key: "top", label: "Topper" },
];

const REMOVED_COPY: Record<Removal, string> = {
  kicked: "The host removed you from the room.",
  banned: "The host banned you from that room.",
  votekicked: "The other players voted to remove you from that room.",
};

export function loadProfile(): Profile {
  const p = load<Partial<Profile>>("profile", {});
  return {
    name: typeof p.name === "string" ? p.name : "",
    // Sanitize so avatars saved before a part was removed still load cleanly.
    avatar: p.avatar ? sanitizeAvatar(p.avatar) : randomAvatar(),
    language: p.language === "tl" ? "tl" : "en",
  };
}

export function Landing({ joinCode, onEntered }: { joinCode?: string; onEntered: (code: string) => void }) {
  const g = useGame();
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [busy, setBusy] = useState<"" | "play" | "create" | "join">("");
  const [error, setError] = useState("");

  const update = (patch: Partial<Profile>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    save("profile", next);
  };
  const cycle = (key: keyof AvatarData, dir: number) => {
    const n = AVATAR_PARTS[key];
    update({ avatar: { ...profile.avatar, [key]: (profile.avatar[key] + dir + n) % n } });
  };

  const go = async (kind: "play" | "create" | "join") => {
    if (busy) return;
    setBusy(kind);
    setError("");
    g.clearRemoved();
    const p = { ...profile, name: profile.name.trim() };
    const res: JoinResult = kind === "play" ? await g.quickplay(p) : kind === "create" ? await g.create(p) : await g.join(joinCode!, p);
    setBusy("");
    if (res.ok) onEntered(res.code);
    else setError(res.error);
  };

  return (
    <div className="landing">
      <header className="landing-head">
        <BrandShield />
        <Logo />
        <p className="tagline">Draw it. Guess it. Glow.</p>
      </header>

      <form
        className="panel cabinet landing-card"
        onSubmit={(e) => {
          e.preventDefault();
          go(joinCode ? "join" : "play");
        }}
      >
        {g.removed && <p className="banner warn">{REMOVED_COPY[g.removed]}</p>}
        {!g.connected && <p className="banner">Connecting to the arcade…</p>}

        <div className="profile-row">
          <div className="avatar-editor">
            <div className="avatar-stage">
              <Avatar avatar={profile.avatar} size={132} title="Your avatar" />
            </div>
            <div className="avatar-colors" role="radiogroup" aria-label="Avatar colour">
              {AVATAR_COLORS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={profile.avatar.color === i}
                  aria-label={`Colour ${i + 1}`}
                  className={`dot ${profile.avatar.color === i ? "on" : ""}`}
                  style={{ background: c, color: c }}
                  onClick={() => update({ avatar: { ...profile.avatar, color: i } })}
                />
              ))}
            </div>
            <div className="avatar-parts">
              {PARTS.map((p) => (
                <div className="part" key={p.key}>
                  <button type="button" className="arrow" aria-label={`Previous ${p.label.toLowerCase()}`} onClick={() => cycle(p.key, -1)}>
                    ‹
                  </button>
                  <span>{p.label}</span>
                  <button type="button" className="arrow" aria-label={`Next ${p.label.toLowerCase()}`} onClick={() => cycle(p.key, 1)}>
                    ›
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn ghost small" onClick={() => update({ avatar: randomAvatar() })}>
              🎲 Randomize
            </button>
          </div>

          <div className="profile-fields">
            <label className="field">
              <span>Nickname</span>
              <input
                id="nickname"
                value={profile.name}
                maxLength={LIMITS.nickname}
                placeholder="Your name"
                autoComplete="nickname"
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Language</span>
              <select id="language" value={profile.language} onChange={(e) => update({ language: e.target.value as LanguageCode })}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="cta">
              {joinCode ? (
                <>
                  <button className="btn primary big" type="submit" disabled={!!busy || !g.connected}>
                    {busy === "join" ? "Joining…" : `Join room ${joinCode}`}
                  </button>
                  <a className="text-link" href="/">
                    Or play in a public room instead
                  </a>
                </>
              ) : (
                <>
                  <button className="btn primary big" type="submit" disabled={!!busy || !g.connected}>
                    {busy === "play" ? "Finding a room…" : "Play"}
                  </button>
                  <button className="btn secondary" type="button" disabled={!!busy || !g.connected} onClick={() => go("create")}>
                    {busy === "create" ? "Creating…" : "Create private room"}
                  </button>
                </>
              )}
            </div>
            {error && (
              <p className="banner warn" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </form>

      <section className="how" aria-label="How to play">
        <div>
          <b>1. Draw</b>
          <span>Pick a word and sketch it before the ring runs out.</span>
        </div>
        <div>
          <b>2. Guess</b>
          <span>Type guesses in chat. Faster guesses score more.</span>
        </div>
        <div>
          <b>3. Win</b>
          <span>Most points after the last round takes the podium.</span>
        </div>
      </section>
    </div>
  );
}
