type Bag = Record<string, unknown>;

function dig(bag: Bag | undefined, path: string): string | undefined {
  let cur: unknown = bag;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object" || !(part in (cur as Bag))) return undefined;
    cur = (cur as Bag)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function t(path: string, fallback: string): string {
  const bag = (window as Window & { rl?: { I18N?: Bag } }).rl?.I18N;
  return dig(bag, path) ?? fallback;
}

/** Dates and numbers follow the chosen UI language, not the browser's. */
export function uiLocale(): string {
  return document.documentElement.lang === "en" ? "en-US" : "de-DE";
}
