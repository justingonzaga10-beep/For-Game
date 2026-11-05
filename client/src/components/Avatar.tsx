import { AVATAR_COLORS, type Avatar as AvatarData } from "@inkwave/shared";

/** Head outlines, all centred on (50, 56) inside a 100x100 box. */
const HEADS = [
  <rect key="h0" x="17" y="27" width="66" height="58" rx="12" />,
  <ellipse key="h1" cx="50" cy="57" rx="35" ry="31" />,
  <rect key="h2" x="24" y="18" width="52" height="70" rx="26" />,
  <polygon key="h3" points="50,20 84,38 84,74 50,92 16,74 16,38" />,
  <path key="h4" d="M50 20C83 20 91 47 79 67C71 81 61 89 50 89C39 89 29 81 21 67C9 47 17 20 50 20Z" />,
];

function Eyes({ kind, c }: { kind: number; c: string }) {
  switch (kind) {
    case 1: // visor
      return <rect x="27" y="45" width="46" height="12" rx="6" fill={c} />;
    case 2: // cyclops
      return (
        <>
          <circle cx="50" cy="51" r="11" fill="none" stroke={c} strokeWidth="4" />
          <circle cx="50" cy="51" r="4" fill={c} />
        </>
      );
    case 3: // x eyes
      return <path d="M32 44l10 10M42 44L32 54M58 44l10 10M68 44L58 54" stroke={c} strokeWidth="4" strokeLinecap="round" />;
    case 4: // happy arcs
      return <path d="M31 53q6-9 12 0M57 53q6-9 12 0" fill="none" stroke={c} strokeWidth="4" strokeLinecap="round" />;
    case 5: // big ovals with pupils
      return (
        <>
          <ellipse cx="38" cy="50" rx="8" ry="10" fill="none" stroke={c} strokeWidth="3.5" />
          <ellipse cx="62" cy="50" rx="8" ry="10" fill="none" stroke={c} strokeWidth="3.5" />
          <circle cx="40" cy="52" r="3" fill={c} />
          <circle cx="64" cy="52" r="3" fill={c} />
        </>
      );
    default: // dots
      return (
        <>
          <circle cx="38" cy="50" r="5.5" fill={c} />
          <circle cx="62" cy="50" r="5.5" fill={c} />
        </>
      );
  }
}

function Mouth({ kind, c }: { kind: number; c: string }) {
  const s = { stroke: c, strokeWidth: 4, strokeLinecap: "round" as const, fill: "none" };
  switch (kind) {
    case 1: // flat
      return <path d="M40 72h20" {...s} />;
    case 2: // grille
      return (
        <>
          <rect x="35" y="66" width="30" height="12" rx="3" {...s} strokeWidth={3} />
          <path d="M42.5 66v12M50 66v12M57.5 66v12" {...s} strokeWidth={2.5} />
        </>
      );
    case 3: // surprised
      return <circle cx="50" cy="72" r="5.5" {...s} strokeWidth={3.5} />;
    case 4: // zigzag
      return <path d="M36 72l5-4 5 4 5-4 5 4 5-4" {...s} strokeWidth={3} strokeLinejoin="round" />;
    case 5: // cat mouth
      return <path d="M38 69q6 7 12 0q6 7 12 0" {...s} strokeWidth={3.5} />;
    default: // smile
      return <path d="M38 68q12 12 24 0" {...s} />;
  }
}

function Top({ kind, c, head }: { kind: number; c: string; head: number }) {
  const y = head === 2 || head === 3 || head === 4 ? 20 : 27;
  const s = { stroke: c, strokeWidth: 4, strokeLinecap: "round" as const, fill: "none" };
  switch (kind) {
    case 1: // antenna
      return (
        <>
          <path d={`M50 ${y}V${y - 13}`} {...s} />
          <circle cx="50" cy={y - 16} r="5" fill={c} />
        </>
      );
    case 2: // twin antennae
      return (
        <>
          <path d={`M38 ${y + 2}L30 ${y - 12}M62 ${y + 2}L70 ${y - 12}`} {...s} />
          <circle cx="29" cy={y - 14} r="4" fill={c} />
          <circle cx="71" cy={y - 14} r="4" fill={c} />
        </>
      );
    case 3: // ears
      return <path d={`M26 ${y + 10}L22 ${y - 10}L40 ${y + 2}M74 ${y + 10}L78 ${y - 10}L60 ${y + 2}`} {...s} strokeLinejoin="round" />;
    case 4: // crest
      return <path d={`M36 ${y + 1}l5-12 5 10 4-13 4 13 5-10 5 12`} {...s} strokeWidth={3.5} strokeLinejoin="round" />;
    default:
      return null;
  }
}

export function Avatar({ avatar, size = 48, className = "", title }: { avatar: AvatarData; size?: number; className?: string; title?: string }) {
  const c = AVATAR_COLORS[avatar.color] ?? AVATAR_COLORS[0];
  return (
    <svg
      className={`avatar ${className}`}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      style={{ color: c }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g className="avatar-glow">
        <Top kind={avatar.top} c={c} head={avatar.head} />
        <g fill="#140a2e" stroke={c} strokeWidth="4" strokeLinejoin="round">
          {HEADS[avatar.head] ?? HEADS[0]}
        </g>
        <Eyes kind={avatar.eyes} c={c} />
        <Mouth kind={avatar.mouth} c={c} />
      </g>
    </svg>
  );
}
