import { call } from "./api";
import { boot } from "./mail";
import { applyAppearance, readAppearance, watchSystemTheme } from "./theme";

applyAppearance(readAppearance());
watchSystemTheme(() => applyAppearance(readAppearance()));

function scheduleMaintenance(): void {
  window.setTimeout(() => {
    void call<unknown>("AppDelayStart").catch(() => undefined);
  }, 0);
}

const root = document.getElementById("app");
if (root) void boot(root).then(scheduleMaintenance, scheduleMaintenance);
