import { mountIcons } from "./icons";

export type Appearance = "system" | "light" | "dark";
export type Design = "mistral" | "office";

const KEY = "sm-appearance";
const DESIGN_KEY = "sm-design";

export function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* private mode */
  }
  return "system";
}

export function applyAppearance(mode: Appearance): void {
  const dark = mode === "dark" || (mode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.appearance = mode;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  window.dispatchEvent(new CustomEvent("sm-appearance", { detail: { dark } }));
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode */
  }
}

export function watchSystemTheme(onChange: () => void): void {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onChange);
}

function isDesign(value: unknown): value is Design {
  return value === "mistral" || value === "office";
}

/** The user's own choice, or null while they follow the administrator's default. */
export function storedDesign(): Design | null {
  try {
    const value = localStorage.getItem(DESIGN_KEY);
    if (isDesign(value)) return value;
  } catch {
    /* private mode */
  }
  return null;
}

export function readDesign(): Design {
  const fallback = document.documentElement.dataset.designDefault;
  return storedDesign() ?? (isDesign(fallback) ? fallback : "mistral");
}

/** Shows a design. Only a choice the user made is stored; the default stays the administrator's. */
export function applyDesign(design: Design, remember = false): void {
  document.documentElement.dataset.design = design;
  mountIcons(design);
  if (!remember) return;
  try {
    localStorage.setItem(DESIGN_KEY, design);
  } catch {
    /* private mode */
  }
}
