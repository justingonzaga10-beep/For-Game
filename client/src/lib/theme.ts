import { useEffect, useSyncExternalStore } from "react";
import { load, save } from "./storage";

export type Theme = "light" | "dark";
const META_COLOR: Record<Theme, string> = { dark: "#2a2a2e", light: "#e9e9ed" };

const systemTheme = (): Theme => (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");

/** The player's saved choice, or null to follow the device setting. */
let chosen: Theme | null = load<Theme | null>("theme", null);
let current: Theme = chosen ?? systemTheme();
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.dataset.theme = current;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[current]);
  listeners.forEach((l) => l());
}

/** Night mode (dark) or light mode; remembered once the player picks one. */
export function setTheme(t: Theme) {
  chosen = t;
  current = t;
  save("theme", t);
  apply();
}

export function useTheme(): Theme {
  const theme = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  // Until the player picks, follow the device if it switches (e.g. at sunset).
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!m) return;
    const on = () => {
      if (chosen) return;
      current = systemTheme();
      apply();
    };
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return theme;
}

apply();
