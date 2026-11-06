import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = join(dirname(fileURLToPath(import.meta.url)), "../../snappymail/v/0.0.0/static/css");
copyFileSync(join(css, "app.css"), join(css, "admin.css"));
