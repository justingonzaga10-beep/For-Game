/** Quantum Doodle wordmark: a pen nib riding a neon wave, then the name in the pixel face. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`logo ${compact ? "compact" : ""}`} aria-label="Quantum Doodle">
      <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M6 42c9-15 15-15 24 0s15 15 24 0" fill="none" stroke="var(--gold)" strokeWidth="6" strokeLinecap="round" />
        <path d="M44 6l12 12-19 19-14 3 3-14z" fill="var(--pink)" />
        <circle cx="41" cy="22" r="3" fill="var(--bg-deep)" />
      </svg>
      <span className="logo-word" aria-hidden="true">
        QUANTUM<span>DOODLE</span>
      </span>
    </div>
  );
}
