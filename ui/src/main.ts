import { mountShell } from "./shell";
import { applyAppearance, readAppearance, watchSystemTheme } from "./theme";

applyAppearance(readAppearance());
watchSystemTheme(() => applyAppearance(readAppearance()));

const root = document.getElementById("app");
if (root) mountShell(root);
