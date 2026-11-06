import shield from "../assets/quantum-kids-shield.webp";

/** The Quantum Kids Education shield. Original artwork: brand/quantum-kids-education-logo.png. */
export function BrandShield({ small = false }: { small?: boolean }) {
  return (
    <img
      className={`brand-shield ${small ? "small" : ""}`}
      src={shield}
      alt="Quantum Kids Education"
      width={336}
      height={360}
      decoding="async"
      draggable={false}
    />
  );
}
