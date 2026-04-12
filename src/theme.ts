/**
 * Theme: default follows `prefers-color-scheme`; user can pin light/dark via button.
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

type ThemePreference = "system" | "light" | "dark";

let preference: ThemePreference = "system";

export function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

export function getFigurePalette(): FigurePalette {
  return isDarkMode() ? DARK : LIGHT;
}

function loadPreference(): void {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "system" || v === "light" || v === "dark") preference = v;
    else preference = "system";
  } catch {
    preference = "system";
  }
}

function mediaPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveDark(): boolean {
  if (preference === "light") return false;
  if (preference === "dark") return true;
  return mediaPrefersDark();
}

function applyResolvedTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolveDark() ? "dark" : "light");
  syncThemeToggleButton();
}

function onSystemThemeChange(): void {
  if (preference === "system") applyResolvedTheme();
}

let mediaListenerAttached = false;

export function initTheme(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  loadPreference();
  applyResolvedTheme();

  if (mediaListenerAttached) return;
  mediaListenerAttached = true;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onSystemThemeChange);
}

function syncThemeToggleButton(): void {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;

  const label: Record<ThemePreference, string> = {
    system: "auto",
    light: "light",
    dark: "dark",
  };
  btn.textContent = label[preference];

  const effective = resolveDark() ? "dark" : "light";
  if (preference === "system") {
    btn.setAttribute(
      "aria-label",
      `Appearance follows device (${effective}). Click to pin light mode.`,
    );
  } else if (preference === "light") {
    btn.setAttribute("aria-label", "Light mode pinned. Click for dark mode.");
  } else {
    btn.setAttribute(
      "aria-label",
      "Dark mode pinned. Click to follow device appearance.",
    );
  }
}

let themeToggleWired = false;

export function wireThemeToggle(): void {
  if (themeToggleWired) return;
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  themeToggleWired = true;

  syncThemeToggleButton();
  btn.addEventListener("click", () => {
    if (preference === "system") preference = "light";
    else if (preference === "light") preference = "dark";
    else preference = "system";
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* ignore */
    }
    applyResolvedTheme();
  });
}
