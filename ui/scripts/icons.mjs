// Erzeugt ui/src/icons.ts und die Vorschau ui/icons.html aus zwei Quellen:
//   src/icons/icons.txt         Pixel-Symbole (Design "mistral"), Raster 9x9, Block 3, Ursprung 1.5 in viewBox 30:
//                               bei 20 px liegt jede Kante auf ganzen Pixeln.
//   src/icons/icons-office.txt  Linien-Symbole (Design "office"), Raster 20x20, Strich 1.5.
// Beide Dateien müssen dieselben Namen führen. Die Seite hält genau einen Satz als <symbol>-Sprite;
// icon() verweist per <use> darauf, deshalb tauscht ein Design-Wechsel alle Symbole ohne neues Rendern.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pixelSource = resolve(here, "../src/icons/icons.txt");
const lineSource = resolve(here, "../src/icons/icons-office.txt");
const target = resolve(here, "../src/icons.ts");
const preview = resolve(here, "../icons.html");

const SIZE = 9;
const BLOCK = 3;
const ORIGIN = 1.5;

/** Symbole mit Animation auf Kindelementen. <use> reicht CSS nicht in den Schattenbaum, also stehen sie inline. */
const INLINE = ["loading"];

const FRAMES = {
  mistral: { box: "0 0 30 30", paint: `fill="currentColor" shape-rendering="crispEdges"` },
  office: { box: "0 0 20 20", paint: `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"` }
};

const num = (value) => String(Math.round(value * 100) / 100);

function pixelBody(rows) {
  const rects = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < SIZE) {
      if (row[x] !== "#") { x += 1; continue; }
      let end = x;
      while (end < SIZE && row[end] === "#") end += 1;
      rects.push(`<rect x="${num(ORIGIN + x * BLOCK)}" y="${num(ORIGIN + y * BLOCK)}" width="${num((end - x) * BLOCK)}" height="${BLOCK}"/>`);
      x = end;
    }
  });
  return rects.join("");
}

function withAliases(file, bodies, aliases) {
  for (const [name, base] of aliases) {
    if (!bodies[base]) throw new Error(`${file}: Alias ${name} zeigt auf unbekanntes ${base}`);
    if (bodies[name]) throw new Error(`${file}: Alias ${name} überdeckt ein Symbol`);
    bodies[name] = bodies[base];
  }
  return bodies;
}

function readPixels() {
  const lines = readFileSync(pixelSource, "utf8").split(/\r?\n/);
  const bodies = {};
  const aliases = new Map();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    i += 1;
    if (!line || line.startsWith("#")) continue;
    const alias = line.match(/^([a-z0-9-]+)\s*=\s*([a-z0-9-]+)$/);
    if (alias) {
      aliases.set(alias[1], alias[2]);
      continue;
    }
    const head = line.match(/^([a-z0-9-]+):$/);
    if (!head) throw new Error(`icons.txt Zeile ${i}: unerwartet "${line}"`);
    const name = head[1];
    if (bodies[name]) throw new Error(`Symbol doppelt: ${name}`);
    const rows = lines.slice(i, i + SIZE).map((row) => row.trim());
    i += SIZE;
    rows.forEach((row, index) => {
      if (!new RegExp(`^[#.]{${SIZE}}$`).test(row)) throw new Error(`${name}, Zeile ${index + 1}: "${row}" hat nicht ${SIZE} Zeichen aus # und .`);
    });
    if (!rows.some((row) => row.includes("#"))) throw new Error(`${name} ist leer`);
    bodies[name] = pixelBody(rows);
  }
  return withAliases("icons.txt", bodies, aliases);
}

const GEOMETRY = { path: ["d"], circle: ["cx", "cy", "r"], rect: ["x", "y", "width", "height", "rx"] };
const FILLS = { f: ` fill="currentColor" stroke="none"`, fs: ` fill="currentColor"` };
/** Nachgestellte Nullen kosten nur Bytes: "5.500" wird "5.5", "4.0" wird "4". */
const trim = (value) => value.replace(/(\.\d*?)0+(?![0-9])/g, "$1").replace(/\.(?![0-9])/g, "");

/** Lässt nur Geometrie durch. Die Quelle landet als innerHTML in der Seite, also gilt eine feste Erlaubnisliste. */
function lineBody(name, fragment) {
  const out = [];
  let rest = fragment.trim();
  while (rest) {
    const element = rest.match(/^<(path|circle|rect)((?:\s+[a-z]+="[^"<>]*")+)\s*\/>\s*/);
    if (!element) throw new Error(`icons-office.txt, ${name}: unerwartet "${rest.slice(0, 40)}"`);
    rest = rest.slice(element[0].length);
    const [, tag, raw] = element;
    let fill = "";
    const attrs = [];
    for (const [, key, value] of raw.matchAll(/([a-z]+)="([^"]*)"/g)) {
      if (key === "class") {
        if (!(value in FILLS)) throw new Error(`icons-office.txt, ${name}: Klasse "${value}" gibt es nicht`);
        fill = FILLS[value];
      } else if (!GEOMETRY[tag].includes(key)) {
        throw new Error(`icons-office.txt, ${name}: Attribut ${key} ist an <${tag}> nicht erlaubt`);
      } else if (!(key === "d" ? /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/ : /^[0-9.]+$/).test(value)) {
        throw new Error(`icons-office.txt, ${name}: ${key}="${value}" ist keine Geometrie`);
      } else {
        attrs.push(`${key}="${trim(value)}"`);
      }
    }
    for (const key of GEOMETRY[tag]) {
      if (key !== "rx" && !attrs.some((attr) => attr.startsWith(`${key}="`))) throw new Error(`icons-office.txt, ${name}: <${tag}> ohne ${key}`);
    }
    out.push(`<${tag} ${attrs.join(" ")}${fill}/>`);
  }
  if (!out.length) throw new Error(`icons-office.txt, ${name} ist leer`);
  return out.join("");
}

function readLines() {
  const bodies = {};
  const aliases = new Map();
  readFileSync(lineSource, "utf8").split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const alias = line.match(/^([a-z0-9-]+)\s*=\s*([a-z0-9-]+)$/);
    if (alias) {
      aliases.set(alias[1], alias[2]);
      return;
    }
    const entry = line.match(/^([a-z0-9-]+):\s*(<.+)$/);
    if (!entry) throw new Error(`icons-office.txt Zeile ${index + 1}: unerwartet "${line.slice(0, 40)}"`);
    if (bodies[entry[1]]) throw new Error(`icons-office.txt: Symbol doppelt: ${entry[1]}`);
    bodies[entry[1]] = lineBody(entry[1], entry[2]);
  });
  return withAliases("icons-office.txt", bodies, aliases);
}

const sets = { mistral: readPixels(), office: readLines() };
const names = Object.keys(sets.mistral).sort();
const missing = names.filter((name) => !sets.office[name]);
const extra = Object.keys(sets.office).filter((name) => !sets.mistral[name]);
if (missing.length) throw new Error(`icons-office.txt fehlt: ${missing.join(", ")}`);
if (extra.length) throw new Error(`icons-office.txt kennt Namen, die icons.txt nicht führt: ${extra.join(", ")}`);
for (const name of INLINE) if (!sets.mistral[name]) throw new Error(`Inline-Symbol ${name} fehlt`);

const table = (set) => [
  "  {",
  ...names.map((name) => `    ${JSON.stringify(name)}: ${JSON.stringify(sets[set][name])},`),
  "  }"
].join("\n");

const out = `// Erzeugt von scripts/icons.mjs aus src/icons/icons.txt und src/icons/icons-office.txt. Nicht von Hand ändern.

export type IconSet = "mistral" | "office";

const frames: Record<IconSet, { box: string; paint: string }> = ${JSON.stringify(FRAMES)};

const mistral =
${table("mistral")} as const;

const office: Record<keyof typeof mistral, string> =
${table("office")};

const sets: Record<IconSet, Record<keyof typeof mistral, string>> = { mistral, office };

export type IconName = keyof typeof mistral;

export const iconNames = Object.keys(mistral) as IconName[];

const inline: ReadonlySet<string> = new Set(${JSON.stringify(INLINE)});

const part = (set: IconSet, name: IconName): string =>
  \`<svg class="icon-part icon-part-\${set}" viewBox="\${frames[set].box}" \${frames[set].paint}><g>\${sets[set][name]}</g></svg>\`;

/**
 * Symbol als SVG-String. Ohne Label dekorativ (aria-hidden), mit Label als Bild mit Namen.
 * Die Form kommt aus dem Sprite, das mountIcons() für das aktive Design in die Seite legt.
 */
export function icon(name: IconName, label = ""): string {
  const a11y = label
    ? \` role="img" aria-label="\${label.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;" }[c] ?? c))}"\`
    : \` aria-hidden="true"\`;
  const body = inline.has(name) ? part("mistral", name) + part("office", name) : \`<use href="#i-\${name}"/>\`;
  return \`<svg class="icon icon-\${name}" xmlns="http://www.w3.org/2000/svg" focusable="false"\${a11y}>\${body}</svg>\`;
}

/** Legt das Sprite für ein Design an oder tauscht seinen Inhalt. Alle <use>-Verweise folgen sofort. */
export function mountIcons(set: IconSet): void {
  const NS = "http://www.w3.org/2000/svg";
  let sprite = document.getElementById("icon-sprite");
  if (!sprite) {
    sprite = document.createElementNS(NS, "svg") as unknown as HTMLElement;
    sprite.id = "icon-sprite";
    sprite.setAttribute("aria-hidden", "true");
    sprite.setAttribute("focusable", "false");
    sprite.setAttribute("width", "0");
    sprite.setAttribute("height", "0");
    sprite.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    document.body.prepend(sprite);
  }
  if (sprite.dataset.set === set) return;
  const { box, paint } = frames[set];
  sprite.innerHTML = iconNames
    .map((name) => \`<symbol id="i-\${name}" viewBox="\${box}"><g \${paint}>\${sets[set][name]}</g></symbol>\`)
    .join("");
  sprite.dataset.set = set;
}
`;
writeFileSync(target, out);

const draw = (set, name, size) =>
  `<svg viewBox="${FRAMES[set].box}" width="${size}" height="${size}" ${FRAMES[set].paint}>${sets[set][name]}</svg>`;
const tile = (name) =>
  `<figure><div>${draw("mistral", name, 20)}${draw("office", name, 20)}</div><div>${draw("mistral", name, 40)}${draw("office", name, 40)}</div><figcaption>${name}</figcaption></figure>`;
const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Symbole</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 16px; font: 12px/1.4 ui-monospace, monospace; }
  section { padding: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 1px; }
  section.light { background: #ffffff; color: #1b1f22; }
  section.dark { background: #1b1d1f; color: #eceef0; }
  figure { margin: 0; padding: 12px 8px; display: flex; flex-direction: column; align-items: center; gap: 8px; outline: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
  figure div { display: flex; align-items: center; gap: 16px; }
  figcaption { opacity: .7; text-align: center; word-break: break-all; }
  h1 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
</style>
</head>
<body>
<h1>${names.length} Symbole · links Pixel (mistral), rechts Linie (office) · 20 px und 40 px · nur zur Sichtprüfung, wird nicht ausgeliefert</h1>
<section class="light">${names.map(tile).join("")}</section>
<section class="dark">${names.map(tile).join("")}</section>
</body>
</html>
`;
writeFileSync(preview, html);
console.log(`icons: ${names.length} Symbole in 2 Sätzen → src/icons.ts, icons.html`);
