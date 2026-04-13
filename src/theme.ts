/**
 * Theme: follows `prefers-color-scheme` until the user pins light or dark via the corner button.
 * `data-theme` on <html> drives CSS; canvas uses getFigurePalette().
 */

import type { Rgb } from "./lineGradient";

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

const STORAGE_KEY = "contact-theme-pref";

type ThemePinned = "light" | "dark";

/** `null` = follow system; otherwise user-chosen appearance. */
let pinned: ThemePinned | null = null;

export function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

export function getFigurePalette(): FigurePalette {
  return isDarkMode() ? DARK : LIGHT;
}

function loadPinned(): void {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") {
      pinned = v;
      return;
    }
    if (v === "system") localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  pinned = null;
}

function mediaPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveDark(): boolean {
  if (pinned === "light") return false;
  if (pinned === "dark") return true;
  return mediaPrefersDark();
}

function applyResolvedTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolveDark() ? "dark" : "light");
  syncThemeToggleButton();
}

function onSystemThemeChange(): void {
  if (pinned === null) applyResolvedTheme();
}

let mediaListenerAttached = false;

export function initTheme(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  loadPinned();
  applyResolvedTheme();

  if (mediaListenerAttached) return;
  mediaListenerAttached = true;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onSystemThemeChange);
}

function syncThemeToggleButton(): void {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;

  const dark = resolveDark();
  btn.textContent = dark ? "light" : "dark";
  btn.setAttribute(
    "aria-label",
    dark ? "Switch to light mode" : "Switch to dark mode",
  );
}

let themeToggleWired = false;

export function wireThemeToggle(): void {
  if (themeToggleWired) return;
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  themeToggleWired = true;

  syncThemeToggleButton();
  btn.addEventListener("click", () => {
    pinned = resolveDark() ? "light" : "dark";
    try {
      localStorage.setItem(STORAGE_KEY, pinned);
    } catch {
      /* ignore */
    }
    applyResolvedTheme();
  });
}
