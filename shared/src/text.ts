/**
 * Strips control and formatting characters (including bidi overrides and
 * zero-width joiners used to sneak words past filters), collapses
 * whitespace, and caps the length. React escapes HTML on render, so markup
 * is harmless; this keeps text tidy and bounded.
 */
export function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== "string") return "";
  return Array.from(
    input
      .normalize("NFC")
      .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, maxLength)
    .join("")
    .trim();
}

/** Room codes: 6 characters from an alphabet without look-alikes (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function normalizeRoomCode(input: unknown): string {
  return typeof input === "string" ? input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) : "";
}
