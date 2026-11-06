import { boot } from "./mail";
import { applyAppearance, readAppearance, watchSystemTheme } from "./theme";

applyAppearance(readAppearance());
watchSystemTheme(() => applyAppearance(readAppearance()));

const root = document.getElementById("app");
if (root) void boot(root);
