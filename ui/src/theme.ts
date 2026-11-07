export type Appearance = "system" | "light" | "dark";

const KEY = "sm-appearance";

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
