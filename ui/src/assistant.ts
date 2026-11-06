export interface AssistFlags {
  summarize: boolean;
  draft: boolean;
  replies: boolean;
  search: boolean;
  triage: boolean;
  triageLlm: boolean;
  chat: boolean;
  alerts: boolean;
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
    chat: on(admin, settings, providers, "chat", "chat"),
    alerts: on(admin, settings, providers, "alerts"),
    provider: "",
    providerName: String(providers.default?.name || ""),
    noticeAck: Boolean(settings.notice_ack)
  };
  const label = providers.default;
  flags.provider = label ? `${label.local ? "LOKAL" : String(label.name || "").toUpperCase()}${label.model ? " · " + label.model : ""}` : "";
  const active = flags.summarize || flags.draft || flags.replies || flags.search || flags.triage || flags.triageLlm || flags.chat || flags.alerts;
  if (!active) return null;
  return flags;
}
