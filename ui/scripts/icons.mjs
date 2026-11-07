// Erzeugt ui/src/icons.ts und die Vorschau ui/icons.html aus ui/src/icons/icons.txt.
// Raster 9x9, Block 3, Ursprung 1.5 in viewBox 30: bei 20 px liegt jede Kante auf ganzen Pixeln.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../src/icons/icons.txt");
const target = resolve(here, "../src/icons.ts");
const preview = resolve(here, "../icons.html");

const SIZE = 9;
const BLOCK = 3;
const ORIGIN = 1.5;

const lines = readFileSync(source, "utf8").split(/\r?\n/);
const grids = new Map();
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
  if (!head) throw new Error(`Zeile ${i}: unerwartet "${line}"`);
  const name = head[1];
  if (grids.has(name)) throw new Error(`Symbol doppelt: ${name}`);
  const rows = lines.slice(i, i + SIZE).map((row) => row.trim());
  i += SIZE;
  rows.forEach((row, index) => {
    if (!new RegExp(`^[#.]{${SIZE}}$`).test(row)) throw new Error(`${name}, Zeile ${index + 1}: "${row}" hat nicht ${SIZE} Zeichen aus # und .`);
  });
  if (!rows.some((row) => row.includes("#"))) throw new Error(`${name} ist leer`);
  grids.set(name, rows);
}

const num = (value) => String(Math.round(value * 100) / 100);

function svg(rows) {
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

const bodies = {};
for (const [name, rows] of grids) bodies[name] = svg(rows);
for (const [name, base] of aliases) {
  if (!bodies[base]) throw new Error(`Alias ${name} zeigt auf unbekanntes ${base}`);
  if (bodies[name]) throw new Error(`Alias ${name} überdeckt ein Symbol`);
  bodies[name] = bodies[base];
}

const names = Object.keys(bodies).sort();
const out = [
  "// Erzeugt von scripts/icons.mjs aus src/icons/icons.txt. Nicht von Hand ändern.",
  "",
  "const bodies = {",
  ...names.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(bodies[name])},`),
  "} as const;",
  "",
  "export type IconName = keyof typeof bodies;",
  "",
  "export const iconNames = Object.keys(bodies) as IconName[];",
  "",
  "/** Pixel-Symbol als SVG-String. Ohne Label dekorativ (aria-hidden), mit Label als Bild mit Namen. */",
  "export function icon(name: IconName, label = \"\"): string {",
  "  const a11y = label",
  "    ? ` role=\"img\" aria-label=\"${label.replace(/[&<>\"]/g, (c) => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", \"\\\"\": \"&quot;\" }[c] ?? c))}\"`",
  "    : ` aria-hidden=\"true\"`;",
  "  return `<svg class=\"icon icon-${name}\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 30 30\" fill=\"currentColor\" shape-rendering=\"crispEdges\" focusable=\"false\"${a11y}>${bodies[name]}</svg>`;",
  "}",
  ""
].join("\n");
writeFileSync(target, out);

const tile = (name) => {
  const body = bodies[name];
  const one = (size) => `<svg viewBox="0 0 30 30" width="${size}" height="${size}" fill="currentColor" shape-rendering="crispEdges">${body}</svg>`;
  return `<figure>${one(20)}${one(40)}<figcaption>${name}</figcaption></figure>`;
};
const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Symbole</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 16px; font: 12px/1.4 "Space Mono", ui-monospace, monospace; }
  section { padding: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 1px; }
  section.light { background: #fffaeb; color: #1e1e1e; }
  section.dark { background: #1e1e1e; color: #fffaeb; }
  figure { margin: 0; padding: 12px 8px; display: flex; flex-direction: column; align-items: center; gap: 8px; outline: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
  figure svg + svg { margin-top: 4px; }
  figcaption { text-transform: uppercase; letter-spacing: .04em; opacity: .7; text-align: center; word-break: break-all; }
  h1 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
</style>
</head>
<body>
<h1>${names.length} Symbole · 20 px und 40 px · nur zur Sichtprüfung, wird nicht ausgeliefert</h1>
<section class="light">${names.map(tile).join("")}</section>
<section class="dark">${names.map(tile).join("")}</section>
</body>
</html>
`;
writeFileSync(preview, html);
console.log(`icons: ${grids.size} Symbole, ${aliases.size} Aliase → src/icons.ts, icons.html`);
