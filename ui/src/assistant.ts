import { t } from "./i18n";

export interface AssistFlags {
  summarize: boolean;
  draft: boolean;
  replies: boolean;
  search: boolean;
  triage: boolean;
  triageLlm: boolean;
  /** Category tabs filter on stored IMAP keywords, so they need keyword storage. */
  tabs: boolean;
  tone: string;
  chat: boolean;
  alerts: boolean;
  /** Reading deadlines needs the model; the alert counts themselves are rule-based. */
  alertsLlm: boolean;
  provider: string;
  providerName: string;
  noticeAck: boolean;
}

interface Provider { name?: string; model?: string; local?: boolean; ready?: boolean }
interface Settings {
  enabled?: boolean;
  features?: Record<string, boolean>;
  notice_ack?: boolean;
  tone?: string;
}

function on(admin: Record<string, boolean>, user: Settings, providers: Record<string, Provider>, name: string, route = "default"): boolean {
  if (!admin[name]) return false;
  if (user.features && user.features[name] === false) return false;
  const provider = providers[route] || providers.default;
  if (provider && provider.ready === false && name !== "triage" && name !== "alerts") return false;
  return true;
}

export async function readAssist(app: Record<string, unknown>, load: () => Promise<Settings>): Promise<AssistFlags | null> {
  const plugins = app.Plugins as Record<string, Record<string, unknown>> | undefined;
  const section = plugins?.["ai-copilot"];
  if (!section) return null;
  const admin = (section.features || {}) as Record<string, boolean>;
  const providers = (section.providers || {}) as Record<string, Provider>;
  let settings: Settings = { enabled: true, notice_ack: false };
  try {
    settings = await load();
  } catch {
    return null;
  }
  if (settings.enabled === false) return null;
  const flags: AssistFlags = {
    summarize: on(admin, settings, providers, "summarize"),
    draft: on(admin, settings, providers, "draft"),
    replies: on(admin, settings, providers, "quick_replies"),
    search: on(admin, settings, providers, "search", "search"),
    triage: on(admin, settings, providers, "triage"),
    triageLlm: Boolean(admin.triage) && settings.features?.triage !== false && on(admin, settings, providers, "triage_llm", "triage"),
    tabs: section.storeKeywords !== false,
    tone: String(settings.tone || "professional"),
    chat: on(admin, settings, providers, "chat", "chat"),
    alerts: on(admin, settings, providers, "alerts"),
    alertsLlm: on(admin, settings, providers, "alerts") && providers.default?.ready !== false,
    provider: "",
    // Consent covers every routed provider, so the notice has to name all of them.
    providerName: [...new Set(["default", "triage", "search", "chat"].map((route) => String(providers[route]?.name || "")).filter(Boolean))].join(" / "),
    noticeAck: Boolean(settings.notice_ack)
  };
  const label = providers.default;
  flags.provider = label ? `${label.local ? t("AI_COPILOT.LOCAL", "LOKAL") : String(label.name || "").toUpperCase()}${label.model ? " · " + label.model : ""}` : "";
  const active = flags.summarize || flags.draft || flags.replies || flags.search || flags.triage || flags.triageLlm || flags.chat || flags.alerts;
  if (!active) return null;
  return flags;
}
