/**
 * Light/dark theme: UI via `data-theme` on <html>, canvas colors via getFigurePalette().
 */

import type { Rgb } from "./lineGradient";

const STORAGE_KEY = "contact-theme";

export interface FigurePalette {
  selfStroke: Rgb;
  peerStroke: Rgb;
  thread: Rgb;
  trailSelf: Rgb;
  trailPeer: Rgb;
}

const LIGHT: FigurePalette = {
  selfStroke: [0, 0, 0],
  peerStroke: [178, 178, 182],
  thread: [100, 100, 105],
  trailSelf: [0, 0, 0],
  trailPeer: [200, 200, 204],
};

const DARK: FigurePalette = {
  selfStroke: [255, 255, 255],
  peerStroke: [110, 110, 118],
  thread: [165, 165, 172],
  trailSelf: [255, 255, 255],
  trailPeer: [72, 72, 78],
};

export function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

export function getFigurePalette(): FigurePalette {
  return isDarkMode() ? DARK : LIGHT;
}

export function initTheme(): void {
  if (typeof document === "undefined") return;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light") {
      document.documentElement.setAttribute("data-theme", v);
      return;
    }
  } catch {
    /* ignore */
  }
  if (!document.documentElement.getAttribute("data-theme")) {
    document.documentElement.setAttribute("data-theme", "light");
  }
}

export function toggleTheme(): void {
  const next = isDarkMode() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  syncThemeToggleButton();
}

function syncThemeToggleButton(): void {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const dark = isDarkMode();
  btn.textContent = dark ? "light" : "dark";
  btn.setAttribute("aria-pressed", String(dark));
  btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

export function wireThemeToggle(): void {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  syncThemeToggleButton();
  btn.addEventListener("click", () => toggleTheme());
}
