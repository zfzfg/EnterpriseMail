import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "../snappymail/v/0.0.0/static/fonts");
mkdirSync(out, { recursive: true });

const files = [
  ["@fontsource/inter/files/inter-latin-400-normal.woff2", "inter-latin-400-normal.woff2"],
  ["@fontsource/inter/files/inter-latin-500-normal.woff2", "inter-latin-500-normal.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-400-normal.woff2", "space-mono-latin-400-normal.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-700-normal.woff2", "space-mono-latin-700-normal.woff2"]
];

for (const [src, name] of files) {
  copyFileSync(resolve(root, "node_modules", src), resolve(out, name));
}
