// src/assistant.ts
function on(admin, user, providers, name, route = "default") {
  if (!admin[name]) return false;
  if (user.features && user.features[name] === false) return false;
  const provider = providers[route] || providers.default;
  if (provider && provider.ready === false && name !== "triage" && name !== "alerts") return false;
  return true;
}
async function readAssist(app, load) {
  const plugins = app.Plugins;
  const section = plugins?.["ai-copilot"];
  if (!section) return null;
  const admin = section.features || {};
  const providers = section.providers || {};
  let settings = { enabled: true, notice_ack: false };
  try {
    settings = await load();
  } catch {
    return null;
  }
  if (settings.enabled === false) return null;
  const flags = {
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
  const label2 = providers.default;
  flags.provider = label2 ? `${label2.local ? "LOKAL" : String(label2.name || "").toUpperCase()}${label2.model ? " \xB7 " + label2.model : ""}` : "";
  const active = flags.summarize || flags.draft || flags.replies || flags.search || flags.triage || flags.triageLlm || flags.chat || flags.alerts;
  if (!active) return null;
  return flags;
}

// src/api.ts
var ApiError = class extends Error {
  code;
  detail;
  constructor(code, message, detail = "") {
    super(message);
    this.code = code;
    this.detail = detail;
  }
};
var token = "";
var onExpired = null;
function watchSession(handler) {
  onExpired = handler;
}
async function loadLanguage(code) {
  const response = await fetch(`${root()}?/Lang/App/${encodeURIComponent(code)}/`, { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(1, "Die Sprache konnte nicht geladen werden.");
  const script = await response.text();
  new Function(script)();
}
function root() {
  return location.pathname.replace(/\/+$/, "") + "/";
}
function explain(error) {
  if (!(error instanceof ApiError)) return "Die Anfrage ist fehlgeschlagen.";
  const known = {
    101: "Die Sitzung ist abgelaufen. Seite neu laden.",
    102: "Anmeldung fehlgeschlagen. Adresse oder Passwort pr\xFCfen.",
    104: "Der Mailserver ist nicht erreichbar.",
    109: "Diese Domain ist nicht erlaubt.",
    110: "Dieses Konto ist nicht erlaubt.",
    201: "Die Liste konnte nicht geladen werden.",
    202: "Der Brief konnte nicht geladen werden.",
    203: "L\xF6schen ist fehlgeschlagen.",
    204: "Verschieben ist fehlgeschlagen.",
    302: "Senden ist fehlgeschlagen.",
    303: "Empf\xE4nger pr\xFCfen.",
    140: "Die Kontakte konnten nicht synchronisiert werden.",
    901: "Der Mailserver hat die Anfrage abgelehnt."
  };
  const text2 = known[error.code] || error.message || "Die Anfrage ist fehlgeschlagen.";
  return error.detail ? `${text2} ${error.detail}` : text2;
}
async function readApp(url) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(1, "Die Anwendung konnte nicht geladen werden.");
  const data = await response.json();
  const system = data.System;
  if (system?.token) token = system.token;
  return data;
}
function loadApp() {
  return readApp(`${root()}?/AppData/0/${Math.random().toString().slice(2)}/`);
}
async function postJson(url, action, params) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-SM-Token": token
    },
    body: JSON.stringify({ Action: action, ...params })
  });
  if (!response.ok) throw new ApiError(1, "Die Anfrage ist fehlgeschlagen.");
  const data = await response.json();
  if (data.System?.token) token = data.System.token;
  const result = data.Result;
  if (result && typeof result === "object" && result.System?.token) token = result.System.token;
  if (data.Result === false || data.Result == null) {
    const code = data.code || 999;
    if (code === 101) onExpired?.();
    throw new ApiError(code, data.message || "", data.messageAdditional || "");
  }
  return data.Result;
}
function call(action, params = {}) {
  return postJson(`${root()}?/Json/&q[]=/0/`, action, params);
}
function upload(file, onProgress) {
  const request = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    request.open("POST", `${root()}?/Upload/&q[]=/0/`);
    request.setRequestHeader("Accept", "application/json");
    request.setRequestHeader("X-SM-Token", token);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
    });
    request.addEventListener("error", () => reject(new ApiError(1, "Der Upload ist fehlgeschlagen.")));
    request.addEventListener("abort", () => reject(new ApiError(0, "Der Upload wurde abgebrochen.")));
    request.addEventListener("load", () => {
      try {
        const data = JSON.parse(request.responseText);
        const attachment = data.Result?.Attachment;
        if (request.status < 200 || request.status >= 300 || !attachment?.tempName) {
          reject(new ApiError(Number(data.Result?.code || data.code || 999), String(data.Result?.message || data.message || "Der Upload ist fehlgeschlagen.")));
          return;
        }
        resolve(attachment);
      } catch {
        reject(new ApiError(1, "Der Server hat den Upload nicht best\xE4tigt."));
      }
    });
    const body = new FormData();
    body.append("uploader", file, file.name);
    request.send(body);
  });
  return { promise, abort: () => request.abort() };
}
function readEnvelope(text2) {
  const lines = text2.split(/\n/).map((line2) => line2.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || "";
  try {
    return JSON.parse(last);
  } catch {
    throw new ApiError(1, "Der Server hat keine lesbare Antwort geschickt.");
  }
}
function takeToken(data) {
  if (data.System?.token) token = data.System.token;
  const result = data.Result;
  if (result && typeof result === "object" && result.System?.token) token = result.System.token;
}
async function uploadContacts(file) {
  const body = new FormData();
  body.append("uploader", file, file.name);
  const response = await fetch(`${root()}?/UploadContacts/&q[]=/0/`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "X-SM-Token": token },
    body
  });
  const data = readEnvelope(await response.text());
  takeToken(data);
  if (!response.ok || data.Result === false || data.Result == null) {
    throw new ApiError(data.code || 999, data.message || "Der Import ist fehlgeschlagen.", data.messageAdditional || "");
  }
  return Number(data.Result) || 0;
}
async function syncContacts() {
  const response = await fetch(`${root()}?/Json/&q[]=/0/`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-SM-Token": token
    },
    body: JSON.stringify({ Action: "ContactsSync" })
  });
  const data = readEnvelope(await response.text());
  takeToken(data);
  if (!response.ok || data.Result === false || data.Result == null) {
    throw new ApiError(data.code || 140, data.message || "", data.messageAdditional || "");
  }
}
function rawPath(action) {
  return `${root()}?/Raw/&q[]=/0/${encodeURIComponent(action)}/`;
}
async function plugin(action, params = {}) {
  const result = await call("Plugin" + action, params);
  if (result && typeof result === "object" && "error" in result && result.error) {
    throw new ApiError(Number(result.status) || 999, String(result.error));
  }
  return result;
}
async function streamEvents(path, params, onEvent, signal) {
  const response = await fetch(`${root()}?/${path}/`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "X-SM-Token": token
    },
    body: JSON.stringify(params),
    signal
  });
  if (!response.ok || !response.body) throw new ApiError(1, "Verbindung unterbrochen.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (; ; ) {
    const chunk = await reader.read();
    buffer += chunk.value ? decoder.decode(chunk.value, { stream: !chunk.done }) : "";
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      let event = "message";
      const data = [];
      block.split(/\n/).forEach((line2) => {
        if (line2.startsWith("event:")) event = line2.slice(6).trim();
        else if (line2.startsWith("data:")) data.push(line2.slice(5).trim());
      });
      if (data.length) onEvent(event, JSON.parse(data.join("\n")));
    }
    if (chunk.done) break;
  }
}
function b64Json(value) {
  const bytes2 = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes2.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function rawUrl(type, hash) {
  return `${root()}?/Raw/&q[]=/0/${type}/&q[]=/${hash}`;
}
function fileHash(file) {
  return b64Json(file);
}
function messageHash(folder, uid, subject, hash, accountHash) {
  return b64Json({
    folder,
    uid,
    mimeType: "message/rfc822",
    fileName: `${(subject || "message").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80)}-${hash}.eml`,
    accountHash
  });
}
function proxyUrl(url) {
  const encoded = btoa(url.replace(/ /g, "%20")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${root()}?/ProxyExternal/${encoded}`;
}
async function fetchDataUrl(url, limit = 8 * 1024 * 1024) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(1, "Datei nicht erreichbar.");
  const blob = await response.blob();
  if (blob.size > limit) throw new ApiError(1, "Datei zu gro\xDF.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new ApiError(1, "Datei nicht lesbar."));
    reader.readAsDataURL(blob);
  });
}
async function fetchText(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(1, "Datei nicht erreichbar.");
  return response.text();
}

// src/clean.ts
var ALLOWED_TAGS = [
  "blockquote",
  "br",
  "div",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hgroup",
  "hr",
  "p",
  "wbr",
  "article",
  "aside",
  "header",
  "footer",
  "main",
  "section",
  "details",
  "summary",
  "nav",
  "dd",
  "dl",
  "dt",
  "li",
  "ol",
  "ul",
  "a",
  "abbr",
  "address",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "acronym",
  "big",
  "center",
  "dir",
  "font",
  "marquee",
  "nobr",
  "plaintext",
  "rb",
  "rtc",
  "strike",
  "tt",
  "img",
  "caption",
  "col",
  "colgroup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "style",
  "xmp"
].join(",");
var ALLOWED_ATTRS = /* @__PURE__ */ new Set([
  "data-x-src",
  "name",
  "dir",
  "lang",
  "style",
  "title",
  "background",
  "bgcolor",
  "alt",
  "height",
  "width",
  "src",
  "href",
  "border",
  "bordercolor",
  "charset",
  "direction",
  "download",
  "hreflang",
  "alink",
  "bottommargin",
  "leftmargin",
  "link",
  "rightmargin",
  "text",
  "topmargin",
  "vlink",
  "align",
  "valign",
  "color",
  "face",
  "size",
  "noshade",
  "hspace",
  "vspace",
  "low",
  "high",
  "optimum",
  "value",
  "reversed",
  "start",
  "cols",
  "rows",
  "frame",
  "rules",
  "summary",
  "cellpadding",
  "cellspacing",
  "abbr",
  "scope",
  "colspan",
  "rowspan",
  "headers"
]);
var SCHEMES = /^(http|https|geo|irc|nntp|mailto|sms|tel|intent|itms-apps|msteams|slack|spotify|steam|zoommtg):/i;
var HTTP = /^(https?:)?\/\//i;
var NON_EMPTY = ["A", "B", "EM", "I", "SPAN", "STRONG"];
var TRACKERS = ["email.microsoftemail.com/open", "github.com/notifications/beacon/", "/track/open", "google-analytics.com"];
var STRIP_PARAMS = /^(utm_|ec_|fbclid|mc_eid|mkt_tok|_hsenc|vero_id|oly_enc_id|oly_anon_id|__s|Referrer|mailing|elq|bch|trc|ref|correlation_id|pd_|pf_|email_hash)/i;
var px = (value) => parseInt(value, 10) || 0;
function urlParam(url, name) {
  try {
    return new URL(url).searchParams.get(name) || url;
  } catch {
    return url;
  }
}
function base64Url(data) {
  return atob(data.replace(/_/g, "/").replace(/-/g, "+"));
}
function stripTracking(url) {
  try {
    const decode = decodeURIComponent;
    let next = url.replace(/^.+\/(https%253A[^/?&]+).*$/i, (...m) => decode(decode(String(m[1])))).replace(/^.+(awstrack\.me|redditmail\.com)\/.+(https:%2F%2F[^/]+).*/i, (...m) => decode(String(m[2]))).replace(/^.+(www\.google|safelinks\.protection\.outlook\.com|mailchimp\.com).+url=.+$/i, () => urlParam(url, "url")).replace(/^.+click\.godaddy\.com.+$/i, () => urlParam(url, "redir")).replace(/^.+delivery-status\.com.+$/i, () => urlParam(url, "fb")).replace(/^.+go\.dhlparcel\.nl.+\/([A-Za-z0-9_-]+)$/i, (...m) => base64Url(String(m[1]))).replace(/^.+sellercentral\.amazon\.com\/nms\/redirect.+$/i, () => base64Url(urlParam(url, "u"))).replace(/^.+amazon\.com\/gp\/r\.html.+$/i, () => urlParam(url, "U")).replace(/[\s<>]+/g, "");
    const parsed = new URL(next);
    [...parsed.searchParams.keys()].forEach((key) => {
      if (STRIP_PARAMS.test(key)) parsed.searchParams.delete(key);
    });
    next = parsed.toString();
    return next;
  } catch {
    return url;
  }
}
function cleanCss(source) {
  return source.trim().replace(/;\s*-[^;]+/g, "").replace(/^\s*-[^;]+(;|$)/g, "").replace(/white-space[^;]+/g, "");
}
function scopeCss(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[\s\S]*/g, "");
  const out = [];
  const rule = /(?:(\s*?@media[\s\S]*?){([\s\S]*?)}\s*?})|(?:([\s\S]*?){([\s\S]*?)})/gi;
  let match;
  while (match = rule.exec(css)) {
    if (match[2] !== void 0) {
      out.push(`${match[1].trim()} {
${scopeCss(match[2] + "\n}")}}
`);
      continue;
    }
    const selector = (match[3] || "").trim().replace(/\s+/g, " ").split(" ").map((item) => item.replace(/^(:root|html)$/, "")).join(" ").trim();
    if (!selector || selector.includes("@")) continue;
    const scoped = selector.split(",").map((item) => `.mail-body ${item.trim().replace(/\./g, ".msg-")}`.replace(/\sbody/gi, "")).join(",");
    out.push(`${scoped} {${cleanCss(match[4] || "")}}
`);
  }
  return out.join("");
}
function cleanHtml(source, options2) {
  const result = { html: "", externals: 0, tracking: false, linked: [] };
  const tmpl = document.createElement("template");
  let linkColor = "";
  tmpl.innerHTML = source.replace(/<(\/?)x-html(\s[^>]*)?>/gi, "").replace(/<(\/?)head(\s[^>]*)?>/gi, "").replace(/<body(\s[^>]*)?>/i, '<div class="mail-body"$1>').replace(/<(\/?)body(\s[^>]*)?>/gi, "<$1div$2>").replace(/<span class="preview-text"[\s\S]+?<\/span>/, "").replace(/\u2028/g, " ").replace(/<br>\s*<\/p>/gi, "</p>").trim();
  const root3 = tmpl.content;
  const comments = document.createNodeIterator(root3, NodeFilter.SHOW_COMMENT);
  const dead = [];
  while (comments.nextNode()) dead.push(comments.referenceNode);
  dead.forEach((node) => node.parentNode?.removeChild(node));
  root3.querySelectorAll("form,button,data").forEach((node) => node.replaceWith(...node.childNodes));
  const depth = options2.maxBlockquotes > 0 ? "," + new Array(options2.maxBlockquotes + 1).fill("blockquote").join(" ") : "";
  root3.querySelectorAll(`:not(${ALLOWED_TAGS}),a:empty,span:empty${depth}`).forEach((node) => node.remove());
  [...root3.querySelectorAll("*")].forEach((node) => {
    if (!node.isConnected && !root3.contains(node)) return;
    const name = node.tagName;
    const style = node.style;
    if (name === "STYLE") {
      if (options2.allowStyles) {
        let css = scopeCss(node.textContent || "");
        if (options2.removeColors) css = css.replace(/(background-)?color:[^};]+;?/g, "");
        if (css) node.textContent = css;
        else node.remove();
      } else node.remove();
      return;
    }
    if (name === "XMP") {
      const pre = document.createElement("pre");
      pre.textContent = node.innerHTML;
      node.replaceWith(pre);
      return;
    }
    if (style.display === "none" || style.visibility === "hidden") {
      node.remove();
      return;
    }
    const className = node.getAttribute("class") || "";
    const get = (attr) => (node.getAttribute(attr) || "").trim();
    const take = (attr) => {
      const value = get(attr);
      node.removeAttribute(attr);
      return value;
    };
    if (className === "mail-body") {
      if (node.hasAttribute("link")) linkColor = take("link");
      if (node.hasAttribute("text")) style.color = take("text");
      ["topmargin", "leftmargin", "bottommargin", "rightmargin"].forEach((attr) => {
        if (!node.hasAttribute(attr)) return;
        const value = px(take(attr)) + "px";
        if (attr === "topmargin") style.marginTop = value;
        if (attr === "leftmargin") style.marginLeft = value;
        if (attr === "bottommargin") style.marginBottom = value;
        if (attr === "rightmargin") style.marginRight = value;
      });
    } else if (options2.allowStyles && className) {
      node.setAttribute("class", className.replace(/(^|\s+)/g, "$1msg-"));
    }
    for (let i = node.attributes.length - 1; i >= 0; i--) {
      const attr = node.attributes[i].name.toLowerCase();
      const keepClass = attr === "class" && (className === "mail-body" || options2.allowStyles);
      if (!ALLOWED_ATTRS.has(attr) && !keepClass) node.removeAttribute(attr);
    }
    if (!style.backgroundImage && name !== "TD" && name !== "TH") {
      ["width", "height"].forEach((key) => {
        if (!node.hasAttribute(key)) return;
        const value = take(key);
        if (!style[key]) style[key] = value.includes("%") ? value : value + "px";
      });
      if (px(style.width) > 100 && !style.maxWidth) {
        style.maxWidth = style.width;
        style.width = "100%";
      }
      const height = style.getPropertyValue("height");
      if (height) {
        style.removeProperty("height");
        if (!style.maxHeight) style.maxHeight = height;
      }
    }
    if (name === "A") {
      const value = get("href");
      if (!/^([a-z]+):/i.test(value) || !SCHEMES.test(value)) {
        node.removeAttribute("href");
      } else {
        const clean = stripTracking(value);
        node.setAttribute("href", clean);
        if (clean !== value) {
          result.tracking = true;
          node.setAttribute("data-x-href-tracking", value);
        }
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (linkColor && !style.color) style.color = linkColor;
    }
    if (NON_EMPTY.includes(name) && !(node.textContent || "").trim()) {
      if (name !== "A" || !node.querySelector("img")) {
        node.replaceWith(...node.childNodes);
        return;
      }
    }
    let skipStyle = false;
    const src = take("src");
    if (src) {
      if (name === "IMG") {
        node.setAttribute("loading", "lazy");
        const cid = src.toLowerCase().startsWith("cid:") ? src.slice(4) : "";
        const local = cid ? options2.inline(cid) : options2.inline(src);
        if (local) {
          node.setAttribute("data-x-inline", local);
          result.linked.push(local);
        } else if (style.maxHeight && px(style.maxHeight) < 3 || style.maxWidth && px(style.maxWidth) < 3 || style.width && px(style.width) < 2 || TRACKERS.some((uri) => src.toLowerCase().includes(uri))) {
          skipStyle = true;
          style.display = "none";
          result.tracking = true;
        } else if (HTTP.test(src)) {
          const clean = stripTracking(src.startsWith("//") ? "https:" + src : src);
          if (clean !== src) result.tracking = true;
          node.setAttribute("data-x-src", clean);
          result.externals += 1;
          if (!node.getAttribute("alt")) node.setAttribute("alt", clean.replace(/^.+\/([^/?]+).*$/, "$1").slice(-20));
        } else if (src.startsWith("data:image/")) {
          node.setAttribute("src", src);
        }
      }
    }
    if (node.hasAttribute("background")) style.backgroundImage = `url("${take("background")}")`;
    if (node.hasAttribute("bgcolor")) style.backgroundColor = take("bgcolor");
    if (node.hasAttribute("color")) style.color = take("color");
    for (let i = style.length - 1; i >= 0; i--) {
      const property = style[i];
      if (!["background-image", "list-style-image", "content"].includes(property) && /url\s*\(/i.test(style.getPropertyValue(property))) {
        style.removeProperty(property);
      }
    }
    if (!skipStyle) {
      style.removeProperty("behavior");
      style.removeProperty("cursor");
      style.removeProperty("min-width");
      style.removeProperty("position");
      const remote = [];
      ["background-image", "list-style-image", "content"].forEach((property) => {
        const value = style.getPropertyValue(property);
        const found = value.match(/url\s*\(([^)]+)\)/i);
        if (!found) return;
        style.removeProperty(property);
        const url = found[1].replace(/^["'\s]+|["'\s]+$/g, "");
        const lower = url.toLowerCase();
        if (lower.startsWith("cid:")) {
          const local = options2.inline(url.slice(4));
          if (local) {
            node.setAttribute("data-x-style-inline", JSON.stringify([property, local]));
            result.linked.push(local);
          }
        } else if (HTTP.test(lower)) {
          result.externals += 1;
          remote.push([property, url]);
        } else if (lower.startsWith("data:image/")) {
          style.setProperty(property, value);
        }
      });
      if (remote.length) node.setAttribute("data-x-style-url", JSON.stringify(remote));
      if (style.fontSize && px(style.fontSize) < options2.minFontSize) style.fontSize = options2.minFontSize + "px";
      if (options2.removeColors) {
        style.removeProperty("background-color");
        style.removeProperty("background-image");
        style.removeProperty("color");
      }
      if (style.cssText) style.cssText = cleanCss(style.cssText);
    }
  });
  if (options2.collapseBlockquotes) {
    [...root3.querySelectorAll("blockquote")].reverse().forEach((node) => {
      const details = document.createElement("details");
      details.className = "sm-bq";
      details.innerHTML = "<summary>Zitat</summary>";
      node.replaceWith(details);
      details.append(node);
    });
  }
  result.html = tmpl.innerHTML.trim();
  return result;
}
function revealExternals(html, allow, rewrite) {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html;
  let blocked = 0;
  tmpl.content.querySelectorAll("img[data-x-src]").forEach((node) => {
    const url = node.getAttribute("data-x-src") || "";
    if (allow(url)) {
      node.setAttribute("src", rewrite(url));
      node.removeAttribute("data-x-src");
    } else blocked += 1;
  });
  tmpl.content.querySelectorAll("[data-x-style-url]").forEach((node) => {
    let list = [];
    try {
      list = JSON.parse(node.getAttribute("data-x-style-url") || "[]");
    } catch {
    }
    const rest = list.filter(([property, url]) => {
      if (!allow(url)) {
        blocked += 1;
        return true;
      }
      node.style.setProperty(property, `url("${rewrite(url)}")`);
      return false;
    });
    if (rest.length) node.setAttribute("data-x-style-url", JSON.stringify(rest));
    else node.removeAttribute("data-x-style-url");
  });
  return { html: tmpl.innerHTML, blocked };
}
function fillInline(html, urls) {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html;
  tmpl.content.querySelectorAll("[data-x-inline]").forEach((node) => {
    const url = urls.get(node.getAttribute("data-x-inline") || "");
    if (url) node.setAttribute("src", url);
    node.removeAttribute("data-x-inline");
  });
  tmpl.content.querySelectorAll("[data-x-style-inline]").forEach((node) => {
    try {
      const [property, key] = JSON.parse(node.getAttribute("data-x-style-inline") || "[]");
      const url = urls.get(key);
      if (url) node.style.setProperty(property, `url("${url}")`);
    } catch {
    }
    node.removeAttribute("data-x-style-inline");
  });
  return tmpl.innerHTML;
}
function originalLinks(html) {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html;
  tmpl.content.querySelectorAll("a[data-x-href-tracking]").forEach((node) => {
    node.setAttribute("href", node.getAttribute("data-x-href-tracking") || node.href);
  });
  return tmpl.innerHTML;
}
function externalUrls(html) {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html;
  const urls = /* @__PURE__ */ new Set();
  tmpl.content.querySelectorAll("img[data-x-src]").forEach((node) => urls.add(node.getAttribute("data-x-src") || ""));
  tmpl.content.querySelectorAll("[data-x-style-url]").forEach((node) => {
    try {
      JSON.parse(node.getAttribute("data-x-style-url") || "[]").forEach(([, url]) => urls.add(url));
    } catch {
    }
  });
  urls.delete("");
  return [...urls];
}
function plainToHtml(text2, collapse) {
  const esc10 = (value) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  const linkify = (value) => esc10(value).replace(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g, (url) => {
    const clean = stripTracking(url.replace(/&amp;/g, "&")).replace(/&/g, "&amp;");
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  const lines = text2.replace(/\r\n?/g, "\n").split("\n");
  let level = 0;
  let out = "";
  const open = () => collapse ? '<details class="sm-bq"><summary>Zitat</summary><blockquote>' : "<blockquote>";
  const close = () => collapse ? "</blockquote></details>" : "</blockquote>";
  for (const line2 of lines) {
    const match = line2.match(/^((?:>\s?)+)/);
    const depth = match ? (match[1].match(/>/g) || []).length : 0;
    while (level < depth) {
      out += open();
      level += 1;
    }
    while (level > depth) {
      out += close();
      level -= 1;
    }
    out += linkify(match ? line2.slice(match[1].length) : line2) + "\n";
  }
  while (level > 0) {
    out += close();
    level -= 1;
  }
  return out;
}

// src/letter.ts
function esc(value) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
function srcdoc(body, kind, look) {
  const img = look.remote ? "data: https: http:" : "data:";
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:; media-src 'none'; form-action 'none'`;
  const followScheme = kind === "plain" || look.removeColors;
  const scheme = followScheme ? look.dark ? "dark" : "light" : "light";
  const paper = followScheme ? "background:Canvas;color:CanvasText" : "background:#fff;color:#1c1917";
  const swap = look.swap ? "html{filter:invert(1) hue-rotate(180deg)}img,[style*='background-image']{filter:invert(1) hue-rotate(180deg)}" : "";
  const base = [
    `html{color-scheme:${scheme}}`,
    `body{margin:0;padding:16px;${paper};font:16px/1.55 Inter,ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}`,
    kind === "plain" ? "body{white-space:pre-wrap;max-width:72ch}" : "",
    "img{max-width:100%;height:auto}",
    "table{max-width:100%}",
    "a{color:inherit}",
    "a[href]{text-decoration:underline;text-underline-offset:2px}",
    "pre{white-space:pre-wrap}",
    "blockquote{margin:8px 0;padding-left:12px;border-left:2px solid color-mix(in srgb,currentColor 25%,transparent)}",
    "details.sm-bq>summary{cursor:pointer;list-style:none;display:inline-block;padding:0 6px;border-radius:4px;font:12px/18px ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;opacity:.7;background:color-mix(in srgb,currentColor 10%,transparent)}",
    "details.sm-bq>summary::-webkit-details-marker{display:none}",
    swap
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="${scheme}"><base target="_blank"><style>${base}</style></head><body>${body}</body></html>`;
}
function openLetterWindow(data, print) {
  const win = window.open("", "_blank");
  if (!win) return false;
  const files = data.attachments.length ? `<p class="files">${data.attachments.map((file) => `<a href="${esc(file.href)}">${esc(file.name)}</a>`).join(" \xB7 ")}</p>` : "";
  const content = data.kind === "plain" ? `<div style="white-space:pre-wrap">${data.body}</div>` : data.body;
  win.document.open();
  win.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(data.subject || "Mail")}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'">
<style>
  body{margin:24px;font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;color:#1c1917;background:#fff}
  header{border-bottom:1px solid #27272a33;padding-bottom:12px;margin-bottom:16px}
  h1{font-size:20px;margin:0 0 8px}
  header p{margin:2px 0;color:color-mix(in srgb,#1c1917 68%,transparent)}
  .files{margin-top:16px;border-top:1px solid #27272a33;padding-top:8px}
  img{max-width:100%;height:auto}
  details.sm-bq>summary{display:none}
  details.sm-bq{display:block}
  @media print{body{margin:0}a{color:inherit}}
</style></head><body>
<header><h1>${esc(data.subject || "(ohne Betreff)")}</h1>
<p>Von: ${esc(data.from)}</p><p>An: ${esc(data.to)}</p>${data.cc ? `<p>Cc: ${esc(data.cc)}</p>` : ""}<p>${esc(data.when)}</p></header>
${content}${files}
</body></html>`);
  win.document.close();
  win.document.querySelectorAll("details").forEach((node) => node.setAttribute("open", ""));
  if (print) setTimeout(() => {
    win.focus();
    win.print();
  }, 150);
  return true;
}
function icsDate(value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return value;
  if (!m[4]) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  }
  const args = [Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)];
  const date = m[7] ? new Date(Date.UTC(...args)) : new Date(...args);
  return date.toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function parseIcs(text2) {
  const lines = text2.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const event = { summary: "", start: "", end: "", location: "", organizer: "", method: "" };
  let inside = false;
  let found = false;
  const unescape = (value) => value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  for (const line2 of lines) {
    const index = line2.indexOf(":");
    if (index < 0) continue;
    const key = line2.slice(0, index).split(";")[0].toUpperCase();
    const value = line2.slice(index + 1);
    if (key === "METHOD") event.method = value.trim();
    if (key === "BEGIN" && value.trim() === "VEVENT") {
      inside = true;
      found = true;
      continue;
    }
    if (key === "END" && value.trim() === "VEVENT") break;
    if (!inside) continue;
    if (key === "SUMMARY") event.summary = unescape(value);
    if (key === "DTSTART") event.start = icsDate(value.trim());
    if (key === "DTEND") event.end = icsDate(value.trim());
    if (key === "LOCATION") event.location = unescape(value);
    if (key === "ORGANIZER") event.organizer = (line2.match(/CN=([^;:]+)/i)?.[1] || value.replace(/^mailto:/i, "")).replace(/^"|"$/g, "");
  }
  return found ? event : null;
}
function parseUnsubscribe(header, post) {
  if (!header) return null;
  const links = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  const mailto = links.find((link) => /^mailto:/i.test(link)) || "";
  const http = links.find((link) => /^https:/i.test(link)) || links.find((link) => /^http:/i.test(link)) || "";
  if (!mailto && !http) return null;
  return { mailto, http, oneClick: Boolean(http) && /List-Unsubscribe=One-Click/i.test(post) };
}
function parseMailto(link) {
  const [address2, query = ""] = link.replace(/^mailto:/i, "").split("?");
  const params = new URLSearchParams(query);
  return {
    to: decodeURIComponent(address2 || ""),
    cc: params.get("cc") || "",
    bcc: params.get("bcc") || "",
    subject: params.get("subject") || "",
    body: params.get("body") || ""
  };
}

// src/icons.ts
var bodies = {
  "account-add": '<rect x="7.5" y="1.5" width="9" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="9" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="19.5" y="13.5" width="9" height="3"/><rect x="1.5" y="16.5" width="12" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/>',
  "answered": '<rect x="10.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="18" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/>',
  "archive": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "assist": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="9" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="15" height="3"/><rect x="19.5" y="10.5" width="9" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="9" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/>',
  "attach": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/>',
  "attachment": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/>',
  "back": '<rect x="13.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="21" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/>',
  "bell": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="7.5" y="4.5" width="15" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/><rect x="10.5" y="25.5" width="9" height="3"/>',
  "bell-off": '<rect x="1.5" y="1.5" width="3" height="3"/><rect x="13.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="18" height="3"/><rect x="4.5" y="7.5" width="6" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="21" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="10.5" y="25.5" width="9" height="3"/><rect x="25.5" y="25.5" width="3" height="3"/>',
  "bold": '<rect x="7.5" y="4.5" width="15" height="3"/><rect x="7.5" y="7.5" width="6" height="3"/><rect x="19.5" y="7.5" width="6" height="3"/><rect x="7.5" y="10.5" width="6" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="7.5" y="13.5" width="15" height="3"/><rect x="7.5" y="16.5" width="6" height="3"/><rect x="19.5" y="16.5" width="6" height="3"/><rect x="7.5" y="19.5" width="6" height="3"/><rect x="19.5" y="19.5" width="6" height="3"/><rect x="7.5" y="22.5" width="15" height="3"/>',
  "calendar": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="19.5" y="1.5" width="3" height="3"/><rect x="1.5" y="4.5" width="27" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "certificate": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="15" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="9" height="3"/><rect x="19.5" y="13.5" width="9" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="18" height="3"/><rect x="22.5" y="19.5" width="6" height="3"/><rect x="16.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="16.5" y="25.5" width="3" height="3"/><rect x="22.5" y="25.5" width="3" height="3"/>',
  "check": '<rect x="25.5" y="4.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="6" height="3"/>',
  "checkbox": '<rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "checkbox-checked": '<rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "checkbox-mixed": '<rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "chevron-down": '<rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/>',
  "chevron-left": '<rect x="16.5" y="4.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="16.5" y="22.5" width="3" height="3"/>',
  "chevron-right": '<rect x="10.5" y="4.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/>',
  "chevron-up": '<rect x="13.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/>',
  "clock": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="9" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "close": '<rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/>',
  "code": '<rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/>',
  "compose": '<rect x="19.5" y="1.5" width="6" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="6" height="3"/>',
  "contacts": '<rect x="4.5" y="1.5" width="21" height="3"/><rect x="1.5" y="4.5" width="6" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="6" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="6" height="3"/><rect x="10.5" y="16.5" width="9" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="6" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "copy": '<rect x="1.5" y="1.5" width="18" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="18" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="12" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="10.5" y="25.5" width="18" height="3"/>',
  "database": '<rect x="4.5" y="1.5" width="21" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="6" height="3"/><rect x="22.5" y="7.5" width="6" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="7.5" y="10.5" width="15" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="6" height="3"/><rect x="22.5" y="16.5" width="6" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="7.5" y="19.5" width="15" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "delete": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="1.5" y="4.5" width="27" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "delete-forever": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="1.5" y="4.5" width="27" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="6" height="3"/><rect x="19.5" y="22.5" width="6" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "download": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="13.5" y="4.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "download-zip": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="13.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="9" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="27" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "drafts": '<rect x="4.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="6" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="6" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="9" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="9" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "edit-as-new": '<rect x="4.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="6" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="6" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "error": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "external": '<rect x="16.5" y="1.5" width="12" height="3"/><rect x="1.5" y="4.5" width="12" height="3"/><rect x="22.5" y="4.5" width="6" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="24" height="3"/>',
  "eye": '<rect x="7.5" y="7.5" width="15" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="15" height="3"/>',
  "eye-off": '<rect x="1.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="15" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="15" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="25.5" y="25.5" width="3" height="3"/>',
  "filter": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/>',
  "flag": '<rect x="4.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="21" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="3" height="3"/>',
  "flag-filled": '<rect x="4.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="7.5" width="21" height="3"/><rect x="4.5" y="10.5" width="18" height="3"/><rect x="4.5" y="13.5" width="21" height="3"/><rect x="4.5" y="16.5" width="21" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="3" height="3"/>',
  "folder": '<rect x="1.5" y="4.5" width="12" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="15" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "folder-open": '<rect x="1.5" y="4.5" width="12" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="12" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="18" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="6" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="21" height="3"/>',
  "folder-plus": '<rect x="1.5" y="4.5" width="12" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="15" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "folder-shared": '<rect x="1.5" y="4.5" width="12" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="15" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="9" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "format-clear": '<rect x="16.5" y="1.5" width="6" height="3"/><rect x="10.5" y="4.5" width="6" height="3"/><rect x="7.5" y="7.5" width="6" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="1.5" y="13.5" width="6" height="3"/><rect x="4.5" y="16.5" width="18" height="3"/>',
  "forward": '<rect x="16.5" y="4.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="18" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/>',
  "forward-attachment": '<rect x="16.5" y="1.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="24" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="15" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="15" height="3"/>',
  "forwarded": '<rect x="16.5" y="4.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="18" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/>',
  "fullscreen": '<rect x="1.5" y="1.5" width="9" height="3"/><rect x="19.5" y="1.5" width="9" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="9" height="3"/><rect x="19.5" y="25.5" width="9" height="3"/>',
  "fullscreen-exit": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="19.5" y="1.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="9" height="3"/><rect x="19.5" y="7.5" width="9" height="3"/><rect x="1.5" y="19.5" width="9" height="3"/><rect x="19.5" y="19.5" width="9" height="3"/><rect x="7.5" y="22.5" width="3" height="3"/><rect x="19.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="3" height="3"/><rect x="19.5" y="25.5" width="3" height="3"/>',
  "funnel": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/>',
  "identity": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="4.5" y="19.5" width="21" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="3" height="3"/><rect x="25.5" y="25.5" width="3" height="3"/>',
  "image": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="6" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="7.5" y="10.5" width="6" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="12" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="7.5" y="19.5" width="21" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "image-blocked": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="6" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="6" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "important": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="10.5" y="4.5" width="9" height="3"/><rect x="10.5" y="7.5" width="9" height="3"/><rect x="10.5" y="10.5" width="9" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="10.5" y="19.5" width="9" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/>',
  "inbox": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="13.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="9" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="9" height="3"/><rect x="19.5" y="19.5" width="9" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "info": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "italic": '<rect x="13.5" y="4.5" width="12" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="12" height="3"/>',
  "key": '<rect x="4.5" y="7.5" width="9" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="15" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="9" height="3"/>',
  "language": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="13.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="10.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="27" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="27" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "link": '<rect x="4.5" y="7.5" width="6" height="3"/><rect x="19.5" y="7.5" width="6" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="6" height="3"/><rect x="19.5" y="19.5" width="6" height="3"/>',
  "list-bullet": '<rect x="1.5" y="4.5" width="3" height="3"/><rect x="10.5" y="4.5" width="18" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="18" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="10.5" y="22.5" width="18" height="3"/>',
  "list-number": '<rect x="4.5" y="1.5" width="3" height="3"/><rect x="1.5" y="4.5" width="6" height="3"/><rect x="13.5" y="4.5" width="15" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="1.5" y="16.5" width="6" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="15" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="9" height="3"/>',
  "loading": '<rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/>',
  "lock": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="27" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "lock-open": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="27" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "logout": '<rect x="1.5" y="1.5" width="15" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="13.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="21" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="6" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="15" height="3"/>',
  "mark-read": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="10.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="6" height="3"/><rect x="22.5" y="13.5" width="6" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "mark-unread": '<rect x="1.5" y="4.5" width="27" height="3"/><rect x="1.5" y="7.5" width="6" height="3"/><rect x="22.5" y="7.5" width="6" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "menu": '<rect x="4.5" y="4.5" width="21" height="3"/><rect x="4.5" y="13.5" width="21" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "minimize": '<rect x="4.5" y="22.5" width="21" height="3"/>',
  "minus": '<rect x="4.5" y="13.5" width="21" height="3"/>',
  "more": '<rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/>',
  "move": '<rect x="1.5" y="4.5" width="12" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="15" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="15" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "not-spam": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "plug": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="19.5" y="1.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="15" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "plus": '<rect x="13.5" y="4.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="21" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/>',
  "print": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="15" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="9" height="3"/><rect x="19.5" y="19.5" width="9" height="3"/><rect x="7.5" y="22.5" width="3" height="3"/><rect x="19.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "quote": '<rect x="4.5" y="7.5" width="6" height="3"/><rect x="16.5" y="7.5" width="6" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="16.5" y="10.5" width="6" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/>',
  "receipt": '<rect x="4.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="6" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="6" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "refresh": '<rect x="7.5" y="1.5" width="12" height="3"/><rect x="22.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="6" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="9" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="7.5" y="22.5" width="15" height="3"/>',
  "reply": '<rect x="10.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="18" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/>',
  "reply-all": '<rect x="7.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="15" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/>',
  "restore": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="1.5" y="4.5" width="27" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="9" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "save": '<rect x="1.5" y="1.5" width="21" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="12" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="15" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="7.5" y="22.5" width="3" height="3"/><rect x="19.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "search": '<rect x="4.5" y="1.5" width="12" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="12" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/>',
  "select-all": '<rect x="1.5" y="1.5" width="18" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="10.5" y="7.5" width="18" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="6" height="3"/><rect x="1.5" y="16.5" width="15" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="10.5" y="25.5" width="18" height="3"/>',
  "send": '<rect x="22.5" y="1.5" width="6" height="3"/><rect x="16.5" y="4.5" width="6" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="6" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="6" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="6" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/>',
  "sent": '<rect x="22.5" y="1.5" width="6" height="3"/><rect x="16.5" y="4.5" width="6" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="6" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="6" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="6" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/>',
  "server": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="27" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="27" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "settings": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="10.5" y="4.5" width="9" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="9" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="9" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "shield-alert": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="7.5" y="22.5" width="3" height="3"/><rect x="19.5" y="22.5" width="3" height="3"/><rect x="10.5" y="25.5" width="9" height="3"/>',
  "shield-check": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="7.5" y="22.5" width="3" height="3"/><rect x="19.5" y="22.5" width="3" height="3"/><rect x="10.5" y="25.5" width="9" height="3"/>',
  "signature": '<rect x="4.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="6" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="22.5" width="27" height="3"/>',
  "sort": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="9" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="16.5" y="22.5" width="9" height="3"/><rect x="19.5" y="25.5" width="3" height="3"/>',
  "sound": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="10.5" y="4.5" width="6" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="9" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="9" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="19.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="6" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "source": '<rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/>',
  "spam": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "stop": '<rect x="7.5" y="7.5" width="15" height="3"/><rect x="7.5" y="10.5" width="15" height="3"/><rect x="7.5" y="13.5" width="15" height="3"/><rect x="7.5" y="16.5" width="15" height="3"/><rect x="7.5" y="19.5" width="15" height="3"/>',
  "success": '<rect x="7.5" y="1.5" width="15" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="3" height="3"/><rect x="7.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="7.5" y="25.5" width="15" height="3"/>',
  "tag": '<rect x="1.5" y="1.5" width="15" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="13.5" y="4.5" width="6" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="6" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="1.5" y="13.5" width="6" height="3"/><rect x="22.5" y="13.5" width="6" height="3"/><rect x="4.5" y="16.5" width="6" height="3"/><rect x="19.5" y="16.5" width="6" height="3"/><rect x="7.5" y="19.5" width="6" height="3"/><rect x="16.5" y="19.5" width="6" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "thread": '<rect x="1.5" y="1.5" width="18" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="10.5" y="7.5" width="18" height="3"/><rect x="1.5" y="10.5" width="12" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="25.5" y="16.5" width="3" height="3"/><rect x="10.5" y="19.5" width="18" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/>',
  "trash": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="1.5" y="4.5" width="27" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="22.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="3" height="3"/><rect x="16.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="16.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="4.5" y="25.5" width="21" height="3"/>',
  "underline": '<rect x="7.5" y="1.5" width="3" height="3"/><rect x="19.5" y="1.5" width="3" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="9" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "unsubscribe": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="6" height="3"/><rect x="22.5" y="4.5" width="6" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="10.5" y="10.5" width="3" height="3"/><rect x="16.5" y="10.5" width="3" height="3"/><rect x="25.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="1.5" y="16.5" width="27" height="3"/><rect x="7.5" y="22.5" width="15" height="3"/>',
  "upgrade": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="10.5" y="10.5" width="9" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "upload": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="10.5" y="4.5" width="9" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>',
  "user": '<rect x="10.5" y="1.5" width="9" height="3"/><rect x="7.5" y="4.5" width="3" height="3"/><rect x="19.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="4.5" y="19.5" width="21" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="3" height="3"/><rect x="25.5" y="25.5" width="3" height="3"/>',
  "users": '<rect x="4.5" y="1.5" width="6" height="3"/><rect x="19.5" y="1.5" width="6" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="10.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="3" height="3"/><rect x="10.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="25.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="6" height="3"/><rect x="19.5" y="10.5" width="6" height="3"/><rect x="1.5" y="16.5" width="12" height="3"/><rect x="16.5" y="16.5" width="12" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="10.5" y="19.5" width="3" height="3"/><rect x="16.5" y="19.5" width="3" height="3"/><rect x="25.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="10.5" y="22.5" width="3" height="3"/><rect x="16.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/>',
  "vacation": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="9" height="3"/><rect x="7.5" y="10.5" width="15" height="3"/><rect x="1.5" y="13.5" width="3" height="3"/><rect x="7.5" y="13.5" width="15" height="3"/><rect x="25.5" y="13.5" width="3" height="3"/><rect x="7.5" y="16.5" width="15" height="3"/><rect x="10.5" y="19.5" width="9" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
  "virus": '<rect x="1.5" y="1.5" width="3" height="3"/><rect x="13.5" y="1.5" width="3" height="3"/><rect x="25.5" y="1.5" width="3" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="10.5" y="4.5" width="9" height="3"/><rect x="22.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="19.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="6" height="3"/><rect x="22.5" y="13.5" width="6" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="7.5" y="19.5" width="3" height="3"/><rect x="19.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="3" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/><rect x="25.5" y="25.5" width="3" height="3"/>',
  "warning": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="10.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="10.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="13.5" y="10.5" width="3" height="3"/><rect x="19.5" y="10.5" width="3" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="13.5" y="13.5" width="3" height="3"/><rect x="19.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="13.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/><rect x="25.5" y="22.5" width="3" height="3"/><rect x="1.5" y="25.5" width="27" height="3"/>'
};
var iconNames = Object.keys(bodies);
function icon(name, label2 = "") {
  const a11y = label2 ? ` role="img" aria-label="${label2.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c)}"` : ` aria-hidden="true"`;
  return `<svg class="icon icon-${name}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" fill="currentColor" shape-rendering="crispEdges" focusable="false"${a11y}>${bodies[name]}</svg>`;
}

// src/i18n.ts
function dig(bag, path) {
  let cur = bag;
  for (const part2 of path.split(".")) {
    if (!cur || typeof cur !== "object" || !(part2 in cur)) return void 0;
    cur = cur[part2];
  }
  return typeof cur === "string" ? cur : void 0;
}
function t(path, fallback) {
  const bag = window.rl?.I18N;
  return dig(bag, path) ?? fallback;
}

// src/folders.ts
var KOLAB_KEYS = ["/private/vendor/kolab/folder-type", "/shared/vendor/kolab/folder-type"];
var KOLAB_TYPES = {
  configuration: "CONFIGURATION",
  event: "CALENDAR",
  contact: "CONTACTS",
  task: "TASKS",
  note: "NOTES",
  file: "FILES",
  journal: "JOURNAL"
};
var KOLAB_LABEL = {
  configuration: "Konfiguration",
  event: "Kalender",
  contact: "Kontakte",
  task: "Aufgaben",
  note: "Aufzeichnungen",
  file: "Dateien",
  journal: "Tagebuch"
};
var ROLE_ICON = {
  inbox: "inbox",
  sent: "sent",
  drafts: "drafts",
  trash: "trash",
  archive: "archive",
  junk: "spam",
  spam: "spam"
};
var ACL_RIGHTS = [
  ["l", "Ordner sehen"],
  ["r", "Mails lesen"],
  ["s", "Gelesen-Status setzen"],
  ["w", "Andere Merker setzen"],
  ["i", "Mails einf\xFCgen"],
  ["p", "An den Ordner senden"],
  ["k", "Unterordner anlegen"],
  ["x", "Ordner l\xF6schen oder umbenennen"],
  ["t", "Als gel\xF6scht markieren"],
  ["e", "Gel\xF6schte endg\xFCltig entfernen"],
  ["a", "Rechte verwalten"]
];
function esc2(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function collection(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const list = value["@Collection"];
    if (Array.isArray(list)) return list;
  }
  return [];
}
function bytes(value) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toLocaleString("de-DE", { maximumFractionDigits: size < 10 && unit ? 1 : 0 })} ${units[unit]}`;
}
function parentOf(fullName, delimiter) {
  if (!delimiter) return "";
  const at = fullName.lastIndexOf(delimiter);
  return at > 0 ? fullName.slice(0, at) : "";
}
function parseFolders(result) {
  const map = /* @__PURE__ */ new Map();
  collection(result).forEach((item) => {
    const fullName = String(item.fullName || "");
    if (!fullName) return;
    const attributes = (Array.isArray(item.attributes) ? item.attributes : []).map((value) => String(value).toLowerCase());
    const metadata = {};
    if (item.metadata && typeof item.metadata === "object") {
      Object.entries(item.metadata).forEach(([key, value]) => {
        if (value != null) metadata[key] = String(value);
      });
    }
    const delimiter = String(item.delimiter || "");
    const exists = !attributes.includes("\\nonexistent");
    const kolab = (metadata[KOLAB_KEYS[0]] || metadata[KOLAB_KEYS[1]] || "").split(".")[0];
    map.set(fullName, {
      fullName,
      name: String(item.name || fullName.split(delimiter || "\0").pop() || fullName),
      delimiter,
      role: String(item.role || "").toLowerCase(),
      unread: Number(item.unreadEmails || 0),
      total: Number(item.totalEmails || 0),
      uidNext: Number(item.uidNext || 0),
      size: Number(item.size || 0),
      subscribed: attributes.includes("\\subscribed"),
      exists,
      selectable: exists && !attributes.includes("\\noselect"),
      noInferiors: attributes.includes("\\noinferiors"),
      checkable: Boolean(item.checkable),
      kolabType: kolab && kolab !== "mail" ? kolab : "",
      metadata,
      constructed: false,
      parent: parentOf(fullName, delimiter),
      depth: 0
    });
  });
  [...map.values()].forEach((folder) => {
    let parent = folder.parent;
    while (parent && !map.has(parent)) {
      map.set(parent, {
        fullName: parent,
        name: parent.split(folder.delimiter).pop() || parent,
        delimiter: folder.delimiter,
        role: "",
        unread: 0,
        total: 0,
        uidNext: 0,
        size: 0,
        subscribed: false,
        exists: false,
        selectable: false,
        noInferiors: false,
        checkable: false,
        kolabType: "",
        metadata: {},
        constructed: true,
        parent: parentOf(parent, folder.delimiter),
        depth: 0
      });
      parent = parentOf(parent, folder.delimiter);
    }
  });
  map.forEach((folder) => {
    let depth = 0;
    let parent = folder.parent;
    while (parent) {
      depth += 1;
      parent = map.get(parent)?.parent || "";
    }
    folder.depth = depth;
  });
  const quota = (value) => value == null || value === "" ? null : Number(value);
  return {
    folders: [...map.values()],
    quotaUsage: quota(result.quotaUsage),
    quotaLimit: quota(result.quotaLimit),
    capabilities: (Array.isArray(result.capabilities) ? result.capabilities : []).map((value) => String(value).toUpperCase())
  };
}
var ROLE_RANK = { inbox: 0, sent: 1, drafts: 2, junk: 3, spam: 3, trash: 4, archive: 5 };
function buildTree(folders, roleOf) {
  const nodes = new Map(folders.map((info) => [info.fullName, { info, children: [] }]));
  const roots = [];
  nodes.forEach((node) => {
    const parent = node.info.parent ? nodes.get(node.info.parent) : void 0;
    (parent ? parent.children : roots).push(node);
  });
  const rank = (node) => ROLE_RANK[roleOf(node.info)] ?? 10;
  const sort = (list) => {
    list.sort((a, b) => rank(a) - rank(b) || a.info.name.localeCompare(b.info.name, "de", { sensitivity: "base" }));
    list.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}
var SYSTEM_NAME = {
  inbox: ["FOLDER_LIST.INBOX_NAME", "Posteingang"],
  sent: ["FOLDER_LIST.SENT_NAME", "Gesendet"],
  drafts: ["FOLDER_LIST.DRAFTS_NAME", "Entw\xFCrfe"],
  junk: ["FOLDERS_UI.ROLE_JUNK", "Spam"],
  trash: ["FOLDER_LIST.TRASH_NAME", "Papierkorb"],
  archive: ["FOLDER_LIST.ARCHIVE_NAME", "Archiv"]
};
function displayName(folder, role) {
  const system = SYSTEM_NAME[role];
  return system && folder.depth === 0 ? t(system[0], system[1]) : folder.name;
}
function folderPath(folder) {
  return folder.delimiter ? folder.fullName.split(folder.delimiter).join(" / ") : folder.fullName;
}
function flattenTree(roots, options2) {
  const query = options2.filter.trim().toLowerCase();
  const rows2 = [];
  const matches = (node) => !query || node.info.name.toLowerCase().includes(query) || node.info.fullName.toLowerCase().includes(query) || node.children.some(matches);
  const walk2 = (list, depth) => {
    list.forEach((node) => {
      if (options2.hidden(node.info) || !matches(node)) return;
      const children = node.children.filter((child) => !options2.hidden(child.info));
      const collapsed = !query && options2.collapsed.has(node.info.fullName);
      rows2.push({
        info: node.info,
        depth,
        role: options2.roleOf(node.info),
        hasChildren: children.length > 0,
        collapsed,
        current: node.info.fullName === options2.current,
        path: folderPath(node.info),
        actions: options2.actions(node.info, children.length > 0)
      });
      if (!collapsed) walk2(children, depth + 1);
    });
  };
  walk2(roots, 0);
  return rows2;
}
function renderSidebarRows(rows2, filtering) {
  if (!rows2.length) return `<p class="quiet folder-empty">${esc2(filtering ? t("FOLDERS_UI.NO_MATCH", "Kein Ordner gefunden.") : t("FOLDERS_UI.EMPTY", "Keine Ordner."))}</p>`;
  return rows2.map((row2) => {
    const name = displayName(row2.info, row2.role);
    const target = esc2(row2.info.fullName);
    const toggle = row2.hasChildren ? `<button type="button" class="icon-btn ftoggle" data-action="f-toggle" data-target="${target}" tabindex="-1" aria-expanded="${row2.collapsed ? "false" : "true"}" aria-label="${esc2(`${t("FOLDERS_UI.SUBFOLDERS_OF", "Unterordner von")} ${name}`)}" title="${esc2(row2.collapsed ? t("FOLDERS_UI.EXPAND", "Aufklappen") : t("FOLDERS_UI.COLLAPSE", "Zuklappen"))}">${icon(row2.collapsed ? "chevron-right" : "chevron-down")}</button>` : `<span class="ftoggle" aria-hidden="true"></span>`;
    const count = row2.info.unread > 0 ? `<span class="count" aria-label="${row2.info.unread} ${esc2(t("FOLDERS_UI.UNREAD", "ungelesen"))}">${row2.info.unread}</span>` : "";
    const symbol = icon(ROLE_ICON[row2.role] || (row2.hasChildren && !row2.collapsed ? "folder-open" : "folder"));
    const pathNote = filtering && row2.depth > 0 ? `<span class="sr"> (${esc2(row2.path)})</span>` : "";
    const label2 = `${symbol}<span class="folder-name">${esc2(name)}${pathNote}</span>${count}`;
    const main = row2.info.selectable ? `<button type="button" class="folder" data-folder="${target}" data-depth="${row2.depth}" aria-current="${row2.current ? "page" : "false"}" title="${esc2(row2.path)}">${label2}</button>` : `<button type="button" class="folder is-group" data-action="f-toggle" data-target="${target}" data-depth="${row2.depth}" title="${esc2(`${row2.path} \xB7 ${t("FOLDERS_UI.NOT_SELECTABLE", "nicht ausw\xE4hlbar")}`)}"${row2.hasChildren ? ` aria-expanded="${row2.collapsed ? "false" : "true"}"` : " disabled"}>${label2}</button>`;
    const more = row2.actions.length ? `<button type="button" class="icon-btn fmore" data-action="f-menu" data-target="${target}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc2(`${t("FOLDERS_UI.ACTIONS_FOR", "Aktionen f\xFCr")} ${name}`)}" title="${esc2(t("FOLDERS_UI.ACTIONS", "Ordneraktionen"))}">${icon("more")}</button>` : "";
    return `<div class="frow" style="--depth:${row2.depth}" data-row="${target}">${toggle}${main}${more}</div>`;
  }).join("");
}
function quotaText(quota) {
  const pct = quota.limit > 0 ? Math.min(100, Math.round(quota.used / quota.limit * 100)) : 0;
  return `${bytes(quota.used)} ${t("FOLDERS_UI.OF", "von")} ${bytes(quota.limit)} ${t("FOLDERS_UI.USED", "belegt")} (${pct} %)`;
}
function renderQuota(quota) {
  if (!quota || !quota.limit) return "";
  const pct = Math.min(100, Math.round(quota.used / quota.limit * 100));
  return `<p class="mono quota-label">${esc2(t("FOLDERS_UI.QUOTA", "Speicher"))}</p>
    <div class="quota-bar${pct >= 90 ? " full" : ""}" aria-hidden="true"><span style="width:${pct}%"></span></div>
    <p class="quiet quota-text">${esc2(quotaText(quota))}</p>`;
}
var ACTION_LABEL = {
  "create-sub": ["folder-plus", "FOLDERS_UI.NEW_SUBFOLDER", "Neuer Unterordner"],
  rename: ["edit-as-new", "FOLDERS_UI.RENAME", "Umbenennen"],
  "read-all": ["mark-read", "MESSAGE_LIST.MENU_SET_ALL_SEEN", "Alle als gelesen markieren"],
  clear: ["delete-forever", "MESSAGE_LIST.BUTTON_EMPTY_FOLDER", "Ordner leeren"],
  settings: ["settings", "FOLDERS_UI.FOLDER_SETTINGS", "Ordnereinstellungen"]
};
function renderFolderMenu(target, actions) {
  return actions.map((action) => {
    const [name, key, fallback] = ACTION_LABEL[action];
    return `<li><button type="button" class="menu-item${action === "clear" ? " danger-item" : ""}" role="menuitem" data-action="f-${action}" data-target="${esc2(target)}">${icon(name)}<span>${esc2(t(key, fallback))}</span></button></li>`;
  }).join("");
}
function option(value, label2, selected) {
  return `<option value="${esc2(value)}"${selected ? " selected" : ""}>${esc2(label2)}</option>`;
}
function select(name, label2, options2) {
  return `<label class="field"><span>${esc2(label2)}</span><select name="${name}">${options2}</select></label>`;
}
function check(name, label2, on2) {
  return `<label class="check"><input type="checkbox" name="${name}"${on2 ? " checked" : ""}> ${esc2(label2)}</label>`;
}
function deskButton(action, iconName, label2, attrs, danger = false, pressed, compact = false) {
  const extra = Object.entries(attrs).map(([key, value]) => ` data-${key}="${esc2(value)}"`).join("");
  const press = pressed == null ? "" : ` aria-pressed="${pressed ? "true" : "false"}"`;
  const text2 = compact ? `<span class="sr">${esc2(label2)}</span>` : `<span class="btn-label">${esc2(label2)}</span>`;
  const tip = compact ? ` title="${esc2(label2)}"` : "";
  return `<button type="button" class="${danger ? "danger" : "text-btn"}${compact ? " icon-only" : ""}" data-action="${action}"${extra}${press}${tip}>${icon(iconName)}${text2}</button>`;
}
function indentLabel(row2) {
  return `${"\xA0\xA0".repeat(row2.depth)}${displayName(row2.info, row2.role)}`;
}
function parentOptions(rows2, selected, exclude = "") {
  const top = option("", t("FOLDERS_UI.TOP_LEVEL", "Oberste Ebene"), !selected);
  return top + rows2.filter((row2) => row2.info.exists && !row2.info.noInferiors && (!exclude || row2.info.fullName !== exclude && !row2.info.fullName.startsWith(exclude + row2.info.delimiter))).map((row2) => option(row2.info.fullName, indentLabel(row2), row2.info.fullName === selected)).join("");
}
function kolabLabel(type) {
  return type ? `Kolab ${t(`SETTINGS_FOLDERS.TYPE_${KOLAB_TYPES[type] || ""}`, KOLAB_LABEL[type] || type)}` : "";
}
function renderFolderDesk(desk, edit) {
  const error = `<p class="error" id="settings-error" hidden></p>`;
  if (!desk) return `${error}<p class="quiet">${esc2(t("SETTINGS_FOLDERS.LOADING_PROCESS", "Ordnerliste wird geladen"))} \u2026</p>`;
  const note2 = desk.notice ? `<p class="quiet">${esc2(desk.notice)}</p>` : "";
  const quota = desk.quota && desk.quota.limit ? `<p class="quiet">${esc2(t("FOLDERS_UI.QUOTA", "Speicher"))}: ${esc2(quotaText(desk.quota))}</p>` : "";
  const editing = edit?.kind === "folder" && !edit.fresh ? desk.rows.find((row2) => row2.info.fullName === edit.id) : void 0;
  const creating = edit?.kind === "folder" && edit.fresh;
  const rows2 = desk.rows.map((row2) => {
    const name = displayName(row2.info, row2.role);
    const meta = [
      row2.info.selectable ? `${row2.info.total} ${row2.info.total === 1 ? t("FOLDERS_UI.MAIL", "Mail") : t("FOLDERS_UI.MAILS", "Mails")}${row2.info.unread ? `, ${row2.info.unread} ${t("FOLDERS_UI.UNREAD", "ungelesen")}` : ""}` : t("FOLDERS_UI.NOT_SELECTABLE", "nicht ausw\xE4hlbar"),
      row2.role && row2.role !== "inbox" ? t(`FOLDERS_UI.ROLE_${row2.role.toUpperCase()}`, { sent: "Gesendet", drafts: "Entw\xFCrfe", junk: "Spam", spam: "Spam", trash: "Papierkorb", archive: "Archiv" }[row2.role] || row2.role) : "",
      row2.info.exists && !row2.info.subscribed ? t("FOLDERS_UI.NOT_SUBSCRIBED", "nicht abonniert") : "",
      row2.info.checkable ? t("FOLDERS_UI.CHECKED", "wird gepr\xFCft") : "",
      kolabLabel(row2.info.kolabType)
    ].filter(Boolean).join(" \xB7 ");
    const actions = [
      row2.info.exists ? deskButton("settings-edit", "compose", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "folder", id: row2.info.fullName }) : "",
      row2.info.selectable && row2.role !== "inbox" ? deskButton("f-subscribe", row2.info.subscribed ? "eye" : "eye-off", row2.info.subscribed ? t("SETTINGS_FOLDERS.BUTTON_UNSUBSCRIBE", "Abonnement beenden") : t("SETTINGS_FOLDERS.BUTTON_SUBSCRIBE", "Abonnieren"), { target: row2.info.fullName }, false, row2.info.subscribed, true) : "",
      row2.info.selectable ? deskButton("f-checkable", row2.info.checkable ? "bell" : "bell-off", row2.info.checkable ? t("FOLDERS_UI.CHECK_OFF", "Nicht mehr pr\xFCfen") : t("FOLDERS_UI.CHECK_ON", "Auf neue Mail pr\xFCfen"), { target: row2.info.fullName }, false, row2.info.checkable, true) : "",
      desk.acl && row2.info.exists ? deskButton("f-acl", "folder-shared", t("FOLDERS_UI.SHARING", "Freigaben"), { target: row2.info.fullName }, false, void 0, true) : "",
      row2.canClear ? deskButton("f-clear", "delete-forever", t("MESSAGE_LIST.BUTTON_EMPTY_FOLDER", "Ordner leeren"), { target: row2.info.fullName }, true, void 0, true) : "",
      row2.canDelete ? deskButton("f-delete", "delete", t("GLOBAL.DELETE", "L\xF6schen"), { target: row2.info.fullName }, true, void 0, true) : ""
    ].join("");
    const indent = `style="padding-left:${row2.depth * 16}px"`;
    return `<li class="set-row folder-set-row"><span class="grow" ${indent}><strong title="${esc2(folderPath(row2.info))}">${icon(ROLE_ICON[row2.role] || "folder")} ${esc2(name)}</strong>${meta ? `<span class="quiet">${esc2(meta)}</span>` : ""}</span>${actions}</li>${editing === row2 ? "<!--EDIT-->" : ""}`;
  }).join("");
  const subscribeLabel = t("FOLDERS_UI.SUBSCRIBE", "Abonnieren");
  const createForm = `<form class="fields" data-action="settings-form" data-kind="folder-create">
      <p class="mono">${esc2(t("POPUPS_CREATE_FOLDER.TITLE_CREATE_FOLDER", "Ordner anlegen"))}</p>
      <label class="field"><span>${esc2(t("GLOBAL.NAME", "Name"))}</span><input name="folder" type="text" required autocomplete="off"></label>
      ${select("parent", t("POPUPS_CREATE_FOLDER.LABEL_PARENT", "\xDCbergeordneter Ordner"), parentOptions(desk.rows, edit?.id || ""))}
      ${check("subscribe", subscribeLabel, true)}
      <div class="dialog-actions"><button type="button" class="text-btn" data-action="settings-cancel">${esc2(t("GLOBAL.CANCEL", "Abbrechen"))}</button><button type="submit" class="ink-btn">${icon("folder-plus")}<span class="btn-label">${esc2(t("POPUPS_CREATE_FOLDER.BUTTON_CREATE", "Anlegen"))}</span></button></div>
    </form>`;
  const kolabTypes = desk.kolab ? Object.keys(KOLAB_TYPES) : [];
  const editForm = editing ? `<form class="fields" data-action="settings-form" data-kind="folder-save">
      <p class="mono">${esc2(folderPath(editing.info))}</p>
      <input type="hidden" name="oldName" value="${esc2(editing.info.fullName)}">
      ${editing.canRename ? `<label class="field"><span>${esc2(t("GLOBAL.NAME", "Name"))}</span><input name="name" type="text" value="${esc2(editing.info.name)}" required autocomplete="off"></label>
      ${select("parent", t("POPUPS_CREATE_FOLDER.LABEL_PARENT", "\xDCbergeordneter Ordner"), parentOptions(desk.rows, editing.info.parent, editing.info.fullName))}` : `<input type="hidden" name="name" value="${esc2(editing.info.name)}"><input type="hidden" name="parent" value="${esc2(editing.info.parent)}"><p class="quiet">${esc2(t("FOLDERS_UI.SYSTEM_NO_RENAME", "Systemordner werden nicht umbenannt."))}</p>`}
      ${editing.role === "inbox" ? `<input type="hidden" name="subscribe" value="1">` : check("subscribe", subscribeLabel, editing.info.subscribed)}
      ${editing.info.selectable ? check("checkable", t("FOLDERS_UI.CHECK_ON", "Auf neue Mail pr\xFCfen"), editing.info.checkable) : ""}
      ${kolabTypes.length ? select("kolab", t("FOLDERS_UI.KOLAB_TYPE", "Kolab-Typ"), option("", t("FOLDERS_UI.KOLAB_MAIL", "Mail"), !editing.info.kolabType) + kolabTypes.map((type) => option(type, kolabLabel(type), type === editing.info.kolabType)).join("")) : ""}
      <div class="dialog-actions"><button type="button" class="text-btn" data-action="settings-cancel">${esc2(t("GLOBAL.CANCEL", "Abbrechen"))}</button><button type="submit" class="ink-btn">${icon("save")}<span class="btn-label">${esc2(t("GLOBAL.SAVE", "Speichern"))}</span></button></div>
    </form>` : "";
  const selectable = desk.rows.filter((row2) => row2.info.selectable && row2.role !== "inbox");
  const systemSelect = (name, label2) => select(
    name,
    label2,
    option("", t("FOLDERS_UI.AUTOMATIC", "Automatisch (nach Rolle)"), !desk.system[name]) + selectable.map((row2) => option(row2.info.fullName, indentLabel(row2), row2.info.fullName === desk.system[name])).join("")
  );
  const systemForm = `<details><summary>${esc2(t("SETTINGS_FOLDERS.BUTTON_SYSTEM", "Systemordner"))}</summary>
    <form class="fields" data-action="settings-form" data-kind="folder-system">
      <p class="quiet">${esc2(t("POPUPS_SYSTEM_FOLDERS.TITLE_SYSTEM_FOLDERS", "W\xE4hlen Sie die Systemordner aus"))}</p>
      ${systemSelect("sent", t("FOLDER_LIST.SENT_NAME", "Gesendet"))}
      ${systemSelect("drafts", t("FOLDER_LIST.DRAFTS_NAME", "Entw\xFCrfe"))}
      ${systemSelect("junk", t("FOLDERS_UI.ROLE_JUNK", "Spam"))}
      ${systemSelect("trash", t("FOLDER_LIST.TRASH_NAME", "Papierkorb"))}
      ${systemSelect("archive", t("FOLDER_LIST.ARCHIVE_NAME", "Archiv"))}
      <div class="dialog-actions"><button type="submit" class="ink-btn">${icon("save")}<span class="btn-label">${esc2(t("GLOBAL.SAVE", "Speichern"))}</span></button></div>
    </form></details>`;
  const optionsForm = `<form class="fields" data-action="settings-form" data-kind="folder-options">
      ${check("hideUnsubscribed", t("SETTINGS_FOLDERS.HIDE_UNSUBSCRIBED", "Nicht abonnierte Ordner ausblenden"), desk.hideUnsubscribed)}
      ${desk.kolab ? check("unhideKolab", t("SETTINGS_FOLDERS.UNHIDE_KOLAB_FOLDERS", "Kolab-Ordner anzeigen"), desk.unhideKolab) : ""}
      <div class="dialog-actions"><button type="submit" class="text-btn">${icon("save")}<span class="btn-label">${esc2(t("GLOBAL.SAVE", "Speichern"))}</span></button></div>
    </form>`;
  const add = creating ? createForm : deskButton("settings-edit", "folder-plus", t("SETTINGS_FOLDERS.BUTTON_CREATE", "Ordner anlegen"), { kind: "folder", fresh: "1", id: "" });
  return `${error}<p class="mono">${esc2(t("SETTINGS_FOLDERS.LEGEND_FOLDERS", "Ordnerliste"))}</p>${note2}${quota}
    ${optionsForm}
    ${add}
    <ul class="set-list">${rows2.replace("<!--EDIT-->", editForm ? `<li class="set-edit">${editForm}</li>` : "")}</ul>
    ${systemForm}`;
}
function parseAcl(result) {
  return collection(result).map((item) => ({
    identifier: String(item.identifier || ""),
    rights: String(item.rights || ""),
    mine: Boolean(item.mine)
  }));
}
function explainRights(rights) {
  const parts2 = ACL_RIGHTS.filter(([letter]) => rights.includes(letter)).map(([letter, fallback]) => t(`IMAP.ACL_${letter.toUpperCase()}`, fallback));
  return parts2.join(", ") || t("FOLDERS_UI.NO_RIGHTS", "keine Rechte");
}
function renderAcl(folder, entries, error) {
  const mine = entries.find((entry) => entry.mine);
  const canAdmin = Boolean(mine?.rights.includes("a"));
  const others = entries.filter((entry) => !entry.mine);
  const list = others.map((entry) => `<li class="set-row"><span class="grow"><strong>${esc2(entry.identifier)}</strong><span class="quiet">${esc2(explainRights(entry.rights))}</span></span>${canAdmin ? deskButton("f-acl-delete", "delete", t("GLOBAL.DELETE", "L\xF6schen"), { target: folder, id: entry.identifier }, true) : ""}</li>`).join("");
  const form2 = canAdmin ? `<form class="fields" data-action="settings-form" data-kind="folder-acl-set">
      <input type="hidden" name="folder" value="${esc2(folder)}">
      <label class="field"><span>${esc2(t("FOLDERS_UI.ACL_IDENTIFIER", "Benutzer oder Gruppe"))}</span><input name="identifier" type="text" required autocomplete="off"></label>
      <fieldset class="choices acl-rights"><legend class="mono">${esc2(t("IMAP.ACL_RIGHTS", "Rechte"))}</legend>
        ${ACL_RIGHTS.map(([letter, fallback]) => check(`r_${letter}`, `${letter} \xB7 ${t(`IMAP.ACL_${letter.toUpperCase()}`, fallback)}`, letter === "l" || letter === "r")).join("")}
      </fieldset>
      <div class="dialog-actions"><button type="submit" class="ink-btn">${icon("check")}<span class="btn-label">${esc2(t("FOLDERS_UI.ACL_SAVE", "Freigabe speichern"))}</span></button></div>
    </form>` : `<p class="quiet">${esc2(t("FOLDERS_UI.ACL_READONLY", "Sie d\xFCrfen die Freigaben dieses Ordners nicht \xE4ndern."))}</p>`;
  return `${error ? `<p class="error">${esc2(error)}</p>` : ""}
    ${mine ? `<p class="quiet">${esc2(t("FOLDERS_UI.ACL_MINE", "Ihre Rechte"))}: ${esc2(explainRights(mine.rights))}</p>` : ""}
    <ul class="set-list">${list}</ul>${list ? "" : `<p class="quiet">${esc2(t("FOLDERS_UI.ACL_NONE", "Keine weiteren Freigaben."))}</p>`}
    ${form2}`;
}

// src/sieve/script.ts
function parseFilterScript(source) {
  try {
    const tokens = tokenize(source);
    const script = walk(tokens);
    return { ok: true, script };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Das Skript l\xE4sst sich nicht in Regeln lesen." };
  }
}
function compileFilterScript(script, capa) {
  const need = /* @__PURE__ */ new Set();
  const has = (name) => !capa.length || capa.includes(name);
  const blocks = [];
  const rules = script.rules.filter((rule) => rule.actions.length || rule.conditions.length);
  rules.forEach((rule, index) => {
    if (!rule.actions.length) throw new Error(`Regel ${index + 1} braucht eine Aktion.`);
    blocks.push(compileRule(rule, index, need));
  });
  if (script.vacation?.on) blocks.unshift(compileVacation(script.vacation, need));
  for (const name of need) {
    if (!has(name)) throw new Error(`Der Server nennt die Erweiterung \u201E${name}\u201C nicht.`);
  }
  const require2 = need.size ? `require [${[...need].map(quote).join(", ")}];\r
\r
` : "";
  return `${require2}# This is SnappyMail sieve script.\r
${blocks.join("\r\n")}`;
}
function compileFilterForm(form2, capa) {
  if (form2.querySelector("[data-part='use-raw']")?.checked) {
    return form2.querySelector("textarea[name='body']")?.value || "";
  }
  const vacationOn = Boolean(form2.querySelector("[data-part='vacation-on']")?.checked);
  const vacation = {
    on: vacationOn,
    from: valueOf(form2, "vacation-from"),
    until: valueOf(form2, "vacation-until"),
    days: valueOf(form2, "vacation-days") || "7",
    subject: valueOf(form2, "vacation-subject"),
    text: valueOf(form2, "vacation-text"),
    addresses: valueOf(form2, "vacation-addresses")
  };
  const rules = [...form2.querySelectorAll("[data-rule]")].map((node) => readRule(node));
  return compileFilterScript({ rules, vacation: vacationOn || vacation.text ? vacation : null }, capa);
}
function blankRule() {
  return {
    name: "",
    enabled: true,
    match: "all",
    conditions: [{ field: "from", header: "", op: "contains", value: "" }],
    actions: [{ type: "move", value: "" }]
  };
}
function valueOf(form2, part2) {
  const node = form2.querySelector(`[data-part='${part2}']`);
  return node?.value.trim() || "";
}
function readRule(node) {
  const conditions = [...node.querySelectorAll("[data-cond]")].map((row2) => ({
    field: row2.querySelector("[data-part='field']")?.value || "from",
    header: row2.querySelector("[data-part='header']")?.value.trim() || "",
    op: row2.querySelector("[data-part='op']")?.value || "contains",
    value: row2.querySelector("[data-part='value']")?.value.trim() || ""
  })).filter((item) => item.value || item.field === "size");
  const actions = [...node.querySelectorAll("[data-act]")].map((row2) => ({
    type: row2.querySelector("[data-part='type']")?.value || "stop",
    value: row2.querySelector("[data-part='avalue']")?.value.trim() || ""
  }));
  return {
    name: node.querySelector("[data-part='name']")?.value.trim() || "",
    enabled: Boolean(node.querySelector("[data-part='on']")?.checked),
    match: node.querySelector("[data-part='match']")?.value === "any" ? "any" : "all",
    conditions,
    actions
  };
}
function compileVacation(vacation, need) {
  if (!vacation.text.trim()) throw new Error("Die Abwesenheitsnotiz braucht einen Text.");
  need.add("vacation");
  const days = Math.max(1, Number.parseInt(vacation.days, 10) || 7);
  const addresses2 = vacation.addresses.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean);
  addresses2.forEach((email) => {
    if (!email.includes("@")) throw new Error("Jede Adresse der Abwesenheitsnotiz braucht ein @.");
  });
  const lines = [];
  if (vacation.from || vacation.until) {
    if (vacation.from && !/^\d{4}-\d{2}-\d{2}$/.test(vacation.from)) throw new Error("Der Beginn braucht das Format JJJJ-MM-TT.");
    if (vacation.until && !/^\d{4}-\d{2}-\d{2}$/.test(vacation.until)) throw new Error("Das Ende braucht das Format JJJJ-MM-TT.");
    need.add("relational");
    need.add("date");
    const tests = [
      vacation.from ? `currentdate :value "ge" "date" ${quote(vacation.from)}` : "",
      vacation.until ? `currentdate :value "le" "date" ${quote(vacation.until)}` : ""
    ].filter(Boolean);
    lines.push(tests.length > 1 ? `if allof (\r
    ${tests.join(",\r\n    ")}\r
)` : `if ${tests[0]}`);
    lines.push("{");
    lines.push(`    ${vacationCommand(vacation, days, addresses2)}`);
    lines.push("}");
  } else {
    lines.push(vacationCommand(vacation, days, addresses2));
  }
  return lines.join("\r\n");
}
function vacationCommand(vacation, days, addresses2) {
  const subject = vacation.subject ? ` :subject ${quote(vacation.subject.replace(/\s+/g, " "))}` : "";
  const list = addresses2.length ? ` :addresses [${addresses2.map(quote).join(", ")}]` : "";
  return `vacation :days ${days}${list}${subject} ${quote(vacation.text)};`;
}
function compileRule(rule, index, need) {
  const name = rule.name.trim() || `Regel ${index + 1}`;
  const tests = rule.conditions.map((condition) => conditionToTest(condition, need));
  const actions = rule.actions.map((action) => actionToCommand(action, need));
  const body = actions.map((line2) => `    ${line2}`).join("\r\n");
  let block;
  if (!tests.length) block = `if true {\r
${body}\r
}`;
  else if (tests.length === 1) block = `if ${tests[0]} {\r
${body}\r
}`;
  else block = `if ${rule.match === "any" ? "anyof" : "allof"} (\r
    ${tests.join(",\r\n    ")}\r
) {\r
${body}\r
}`;
  const wrapped = rule.enabled ? block : `/* @disabled\r
${block}\r
*/`;
  return `# ${name.replace(/[\r\n]+/g, " ")}\r
${wrapped}\r
`;
}
function conditionToTest(condition, need) {
  if (!condition.value) throw new Error("Eine Bedingung braucht einen Wert.");
  if (condition.field === "size") {
    if (condition.op !== "over" && condition.op !== "under") throw new Error("Die Gr\xF6\xDFe vergleicht nur gr\xF6\xDFer oder kleiner.");
    if (!/^[0-9]+[KkMmGg]?$/.test(condition.value)) throw new Error("Die Gr\xF6\xDFe ist eine Zahl, optional mit K, M oder G.");
    return `size :${condition.op} ${condition.value}`;
  }
  let tag = ":contains";
  if (condition.op === "is") tag = ":is";
  else if (condition.op === "regex") {
    tag = ":regex";
    need.add("regex");
  } else if (condition.op === "starts") tag = ":matches";
  else if (condition.op === "ends") tag = ":matches";
  else if (condition.op !== "contains") throw new Error("Dieser Vergleich gilt nur f\xFCr die Gr\xF6\xDFe.");
  const written = condition.op === "starts" ? `${condition.value}*` : condition.op === "ends" ? `*${condition.value}` : condition.value;
  if (condition.field === "body") {
    need.add("body");
    return `body ${tag} ${quote(written)}`;
  }
  const header = condition.field === "from" ? "From" : condition.field === "to" ? "To" : condition.field === "subject" ? "Subject" : condition.header.trim();
  if (!header) throw new Error("Die Kopfzeile braucht einen Namen.");
  const list = condition.field === "to" ? `["To", "Cc"]` : `[${quote(header)}]`;
  return `header ${tag} ${list} ${quote(written)}`;
}
function actionToCommand(action, need) {
  if (action.type === "move" || action.type === "copy") {
    if (!action.value) throw new Error("Der Ordner fehlt.");
    need.add("fileinto");
    if (action.type === "copy") need.add("copy");
    return `fileinto${action.type === "copy" ? " :copy" : ""} ${quote(action.value)};`;
  }
  if (action.type === "forward" || action.type === "forward-drop") {
    if (!action.value.includes("@")) throw new Error("Die Weiterleitung braucht eine E-Mail-Adresse.");
    const redirect = `redirect ${quote(action.value)};`;
    return action.type === "forward-drop" ? `${redirect}\r
    discard;` : redirect;
  }
  if (action.type === "reject") {
    if (!action.value) throw new Error("Die Ablehnung braucht einen Text.");
    need.add("reject");
    return `reject ${quote(action.value)};`;
  }
  if (action.type === "discard") return "discard;";
  if (action.type === "seen") {
    need.add("imap4flags");
    return 'addflag "\\\\Seen";';
  }
  if (action.type === "flag") {
    if (!action.value || /\s/.test(action.value)) throw new Error("Die Markierung ist ein Wort ohne Leerzeichen.");
    need.add("imap4flags");
    return `addflag ${quote(action.value)};`;
  }
  return "stop;";
}
function quote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function tokenize(source) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "#") {
      const end = source.indexOf("\n", i);
      const text2 = source.slice(i + 1, end < 0 ? source.length : end).trim();
      if (text2 && !text2.startsWith("This is SnappyMail") && !text2.startsWith("Please") && !text2.startsWith("RAINLOOP")) out.push({ k: "name", v: text2 });
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Ein Kommentar ist nicht geschlossen.");
      const body = source.slice(i + 2, end);
      if (body.trimStart().startsWith("@disabled")) {
        out.push({ k: "off" });
        out.push(...tokenize(body.replace(/^\s*@disabled/, "")));
      }
      i = end + 2;
      continue;
    }
    if (char === '"') {
      let v = "";
      i += 1;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") {
          v += source[i + 1] || "";
          i += 2;
          continue;
        }
        v += source[i];
        i += 1;
      }
      if (source[i] !== '"') throw new Error("Eine Zeichenkette ist nicht geschlossen.");
      out.push({ k: "str", v });
      i += 1;
      continue;
    }
    if (char === ":") {
      i += 1;
      let v = "";
      while (i < source.length && /[A-Za-z0-9_-]/.test(source[i])) {
        v += source[i];
        i += 1;
      }
      if (!v) throw new Error("Ein Schl\xFCsselwort nach dem Doppelpunkt fehlt.");
      out.push({ k: "tag", v: v.toLowerCase() });
      continue;
    }
    if (/[0-9]/.test(char)) {
      let v = "";
      while (i < source.length && /[0-9]/.test(source[i])) {
        v += source[i];
        i += 1;
      }
      if (i < source.length && /[KkMmGg]/.test(source[i])) {
        v += source[i];
        i += 1;
      }
      out.push({ k: "num", v });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let v = "";
      while (i < source.length && /[A-Za-z0-9_\\]/.test(source[i])) {
        v += source[i];
        i += 1;
      }
      out.push({ k: "id", v: v.toLowerCase() });
      continue;
    }
    const punct = { "(": "lpar", ")": "rpar", "{": "lbrace", "}": "rbrace", "[": "lbrack", "]": "rbrack", ",": "comma", ";": "semi" };
    const kind = punct[char];
    if (!kind) throw new Error(`Unbekanntes Zeichen \u201E${char}\u201C.`);
    out.push({ k: kind });
    i += 1;
  }
  return out;
}
var Cursor = class {
  constructor(tokens, at = 0) {
    this.tokens = tokens;
    this.at = at;
  }
  peek() {
    return this.tokens[this.at] || null;
  }
  take() {
    const tok = this.tokens[this.at];
    if (!tok) throw new Error("Das Skript endet zu fr\xFCh.");
    this.at += 1;
    return tok;
  }
  eat(kind) {
    if (this.peek()?.k === kind) {
      this.at += 1;
      return true;
    }
    return false;
  }
};
function walk(tokens) {
  const cur = new Cursor(tokens);
  const rules = [];
  let vacation = null;
  let pending = "";
  let disabled = false;
  while (cur.peek()) {
    const tok = cur.peek();
    if (tok?.k === "name") {
      pending = tok.v;
      cur.take();
      continue;
    }
    if (tok?.k === "off") {
      disabled = true;
      cur.take();
      continue;
    }
    if (tok?.k !== "id") throw new Error("An dieser Stelle steht kein Befehl.");
    const word = tok.v;
    cur.take();
    if (word === "require") {
      skipRequire(cur);
      pending = "";
      disabled = false;
      continue;
    }
    if (word === "if") {
      const test = readTest(cur);
      if (cur.take().k !== "lbrace") throw new Error("Dem Vergleich fehlt der Block.");
      const commands2 = readCommands(cur);
      if (isVacation(test, commands2)) {
        if (vacation) throw new Error("Mehr als eine Abwesenheitsnotiz.");
        vacation = vacationFrom(test, commands2);
      } else rules.push(ruleFrom(pending, !disabled, test, commands2));
      pending = "";
      disabled = false;
      continue;
    }
    const commands = readOneCommand(word, cur);
    if (word === "vacation") {
      if (vacation) throw new Error("Mehr als eine Abwesenheitsnotiz.");
      vacation = vacationFrom(null, commands);
    } else rules.push(ruleFrom(pending, !disabled, null, commands));
    pending = "";
    disabled = false;
  }
  return { rules, vacation };
}
function skipRequire(cur) {
  if (cur.peek()?.k === "str" || cur.peek()?.k === "lbrack") {
    if (cur.peek()?.k === "lbrack") {
      cur.take();
      while (cur.peek() && cur.peek()?.k !== "rbrack") cur.take();
      if (cur.take().k !== "rbrack") throw new Error("require ist nicht geschlossen.");
    } else cur.take();
  }
  if (!cur.eat("semi")) throw new Error("require endet nicht mit einem Strichpunkt.");
}
function readTest(cur) {
  const tok = cur.take();
  if (tok.k !== "id") throw new Error("Dem if fehlt der Vergleich.");
  if (tok.v === "allof" || tok.v === "anyof") {
    if (cur.take().k !== "lpar") throw new Error("allof oder anyof braucht Klammern.");
    const tests = [];
    while (!cur.eat("rpar")) {
      tests.push(readOneTest(cur));
      cur.eat("comma");
    }
    if (!tests.length) throw new Error("Der Vergleich ist leer.");
    return { kind: tok.v === "anyof" ? "any" : "all", tests };
  }
  return { kind: "one", tests: [readOneTest(cur, tok)] };
}
function readOneTest(cur, first) {
  const tok = first || cur.take();
  if (tok.k !== "id") throw new Error("Unbekannter Vergleich.");
  if (tok.v === "true") return { kind: "true" };
  if (tok.v === "size") {
    const tag = cur.take();
    if (tag.k !== "tag" || tag.v !== "over" && tag.v !== "under") throw new Error("size kennt hier nur :over und :under.");
    const num2 = cur.take();
    if (num2.k !== "num") throw new Error("size braucht eine Zahl.");
    return { kind: "size", op: tag.v, value: num2.v };
  }
  if (tok.v === "currentdate") {
    const tags2 = [];
    const strings2 = [];
    while (cur.peek() && cur.peek()?.k !== "comma" && cur.peek()?.k !== "rpar" && cur.peek()?.k !== "lbrace") {
      const item = cur.take();
      if (item.k === "tag") tags2.push(item.v);
      else if (item.k === "str") strings2.push(item.v);
      else throw new Error("currentdate hat eine unbekannte Form.");
    }
    if (!tags2.includes("value") || strings2[1] !== "date" || !strings2[2]) throw new Error("Der Zeitraum nutzt currentdate :value.");
    if (strings2[0] === "ge") return { kind: "date", which: "from", value: strings2[2] };
    if (strings2[0] === "le") return { kind: "date", which: "until", value: strings2[2] };
    throw new Error("Der Zeitraum vergleicht nur ab und bis.");
  }
  if (tok.v !== "header" && tok.v !== "body" && tok.v !== "address") throw new Error(`Der Vergleich \u201E${tok.v}\u201C steht nicht im Formular.`);
  const tags = [];
  const strings = [];
  while (cur.peek() && !["comma", "rpar", "lbrace"].includes(cur.peek()?.k || "")) {
    const item = cur.peek();
    if (item?.k === "tag") {
      tags.push(item.v);
      cur.take();
      continue;
    }
    strings.push(readStringList(cur));
  }
  const op = opFromTags(tags);
  if (!op) throw new Error("Dieser Vergleich steht nicht im Formular.");
  if (tok.v === "body") {
    const value = strings[0]?.[0] || "";
    if (strings.length !== 1 || strings[0].length !== 1) throw new Error("Der Textvergleich hat mehrere Werte.");
    return { kind: "header", name: "body", extra: "", op, value };
  }
  if (strings.length < 2) throw new Error("Dem Kopfzeilenvergleich fehlt der Wert.");
  const names = strings[0];
  const values2 = strings[1];
  if (values2.length !== 1) throw new Error("Ein Vergleich mit mehreren Werten bleibt im Rohtext.");
  const known = names.length === 1 && names[0].toLowerCase() === "from" ? "from" : names.length === 1 && names[0].toLowerCase() === "subject" ? "subject" : names.length === 1 && names[0].toLowerCase() === "to" || names.length === 2 && names.map((item) => item.toLowerCase()).sort().join() === "cc,to" ? "to" : names.length === 1 ? "header" : "";
  if (!known) throw new Error("Diese Kopfzeilen bleiben im Rohtext.");
  return { kind: "header", name: known, extra: known === "header" ? names[0] : "", op, value: values2[0] };
}
function opFromTags(tags) {
  if (tags.includes("contains")) return "contains";
  if (tags.includes("is")) return "is";
  if (tags.includes("regex")) return "regex";
  if (tags.includes("matches")) return "starts";
  return null;
}
function readStringList(cur) {
  if (cur.peek()?.k === "lbrack") {
    cur.take();
    const list = [];
    while (!cur.eat("rbrack")) {
      const tok2 = cur.take();
      if (tok2.k !== "str") throw new Error("In der Liste steht keine Zeichenkette.");
      list.push(tok2.v);
      cur.eat("comma");
    }
    return list;
  }
  const tok = cur.take();
  if (tok.k !== "str") throw new Error("Hier steht keine Zeichenkette.");
  return [tok.v];
}
function readCommands(cur) {
  const list = [];
  while (cur.peek() && cur.peek()?.k !== "rbrace") {
    const tok = cur.take();
    if (tok.k !== "id") throw new Error("In der Regel steht kein Befehl.");
    if (tok.v === "if") throw new Error("Verschachtelte Regeln bleiben im Rohtext.");
    list.push(readOneCommand(tok.v, cur)[0]);
  }
  if (cur.take().k !== "rbrace") throw new Error("Der Block ist nicht geschlossen.");
  return list;
}
function readOneCommand(name, cur) {
  const next = cur.peek();
  const copy = next?.k === "tag" && next.v === "copy";
  if (copy) cur.take();
  const args = [];
  const tags = [];
  while (cur.peek() && cur.peek()?.k !== "semi") {
    const tok = cur.peek();
    if (tok?.k === "tag") {
      tags.push(tok.v);
      cur.take();
      if (["days", "subject", "addresses", "from", "handle"].includes(tok.v)) {
        if (tok.v === "addresses") args.push(`addresses:${readStringList(cur).join(",")}`);
        else {
          const value = cur.take();
          if (value.k !== "str" && value.k !== "num") throw new Error(`:${tok.v} hat einen unbekannten Wert.`);
          args.push(`${tok.v}:${value.v}`);
        }
      } else if (tok.v !== "copy" && tok.v !== "mime") throw new Error(`Die Angabe :${tok.v} bleibt im Rohtext.`);
      continue;
    }
    if (tok?.k === "str" || tok?.k === "num") {
      args.push(tok.v);
      cur.take();
      continue;
    }
    throw new Error(`Der Befehl \u201E${name}\u201C bleibt im Rohtext.`);
  }
  if (!cur.eat("semi")) throw new Error(`\u201E${name}\u201C endet nicht mit einem Strichpunkt.`);
  if (!["fileinto", "redirect", "reject", "ereject", "discard", "stop", "addflag", "vacation"].includes(name)) {
    throw new Error(`Der Befehl \u201E${name}\u201C bleibt im Rohtext.`);
  }
  return [{ name, copy: copy || tags.includes("copy"), args }];
}
function isVacation(test, commands) {
  const dates = test?.tests.every((item) => item.kind === "date") && test.tests.length > 0;
  const only = commands.every((cmd) => cmd.name === "vacation" || cmd.name === "stop");
  return Boolean(dates && only && commands.some((cmd) => cmd.name === "vacation"));
}
function vacationFrom(test, commands) {
  const cmd = commands.find((item) => item.name === "vacation");
  if (!cmd) throw new Error("Die Abwesenheitsnotiz hat keinen Text.");
  const text2 = [...cmd.args].reverse().find((item) => !/^(days|subject|addresses|from|handle):/.test(item)) || "";
  const pick = (key) => cmd.args.find((item) => item.startsWith(`${key}:`))?.slice(key.length + 1) || "";
  const from = test?.tests.find((item) => item.kind === "date" && item.which === "from");
  const until = test?.tests.find((item) => item.kind === "date" && item.which === "until");
  return {
    on: true,
    from: from && from.kind === "date" ? from.value : "",
    until: until && until.kind === "date" ? until.value : "",
    days: pick("days") || "7",
    subject: pick("subject"),
    text: text2,
    addresses: pick("addresses")
  };
}
function ruleFrom(name, enabled, test, commands) {
  const conditions = [];
  if (test) {
    test.tests.forEach((item) => {
      if (item.kind === "true") return;
      if (item.kind === "date") throw new Error("Ein Zeitraum geh\xF6rt zur Abwesenheitsnotiz.");
      if (item.kind === "size") {
        conditions.push({ field: "size", header: "", op: item.op, value: item.value });
        return;
      }
      let op = item.op;
      let value = item.value;
      if (op === "starts") {
        if (value.endsWith("*") && !value.slice(0, -1).includes("*")) {
          op = "starts";
          value = value.slice(0, -1);
        } else if (value.startsWith("*") && !value.slice(1).includes("*")) {
          op = "ends";
          value = value.slice(1);
        } else throw new Error("Dieser Platzhalter bleibt im Rohtext.");
      }
      conditions.push({
        field: item.name === "body" ? "body" : item.name,
        header: item.extra,
        op,
        value
      });
    });
  }
  const actions = [];
  for (let i = 0; i < commands.length; i += 1) {
    const cmd = commands[i];
    if (cmd.name === "vacation") throw new Error("Die Abwesenheitsnotiz steht f\xFCr sich.");
    if (cmd.name === "redirect" && commands[i + 1]?.name === "discard") {
      actions.push({ type: "forward-drop", value: cmd.args[0] || "" });
      i += 1;
      continue;
    }
    if (cmd.name === "fileinto") actions.push({ type: cmd.copy ? "copy" : "move", value: cmd.args[0] || "" });
    else if (cmd.name === "redirect") actions.push({ type: "forward", value: cmd.args[0] || "" });
    else if (cmd.name === "reject" || cmd.name === "ereject") actions.push({ type: "reject", value: cmd.args[0] || "" });
    else if (cmd.name === "discard") actions.push({ type: "discard", value: "" });
    else if (cmd.name === "stop") actions.push({ type: "stop", value: "" });
    else if (cmd.name === "addflag") {
      const flag2 = cmd.args[0] || "";
      actions.push(flag2 === "\\Seen" ? { type: "seen", value: "" } : { type: "flag", value: flag2 });
    }
  }
  if (!actions.length) throw new Error("Die Regel hat keine Aktion.");
  return { name, enabled, match: test?.kind === "any" ? "any" : "all", conditions, actions };
}

// src/sieve/form.ts
function esc3(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
var FIELDS = [
  ["from", "SETTINGS_FILTERS.FIELD_FROM", "Von"],
  ["to", "SETTINGS_FILTERS.FIELD_TO", "An"],
  ["subject", "SETTINGS_FILTERS.FIELD_SUBJECT", "Betreff"],
  ["header", "SETTINGS_FILTERS.FIELD_HEADER", "Kopfzeile"],
  ["body", "SETTINGS_FILTERS.FIELD_BODY", "Text"],
  ["size", "SETTINGS_FILTERS.FIELD_SIZE", "Gr\xF6\xDFe"]
];
var OPS = [
  ["contains", "SETTINGS_FILTERS.OP_CONTAINS", "enth\xE4lt"],
  ["is", "SETTINGS_FILTERS.OP_IS", "ist"],
  ["starts", "SETTINGS_FILTERS.OP_STARTS", "beginnt mit"],
  ["ends", "SETTINGS_FILTERS.OP_ENDS", "endet mit"],
  ["regex", "SETTINGS_FILTERS.OP_REGEX", "Regex"],
  ["over", "SETTINGS_FILTERS.OP_OVER", "gr\xF6\xDFer als"],
  ["under", "SETTINGS_FILTERS.OP_UNDER", "kleiner als"]
];
var ACTIONS = [
  ["move", "SETTINGS_FILTERS.ACT_MOVE", "In Ordner verschieben"],
  ["copy", "SETTINGS_FILTERS.ACT_COPY", "In Ordner kopieren"],
  ["forward", "SETTINGS_FILTERS.ACT_FORWARD", "Weiterleiten, Kopie behalten"],
  ["forward-drop", "SETTINGS_FILTERS.ACT_FORWARD_DROP", "Weiterleiten, ohne Kopie"],
  ["reject", "SETTINGS_FILTERS.ACT_REJECT", "Ablehnen mit Text"],
  ["discard", "SETTINGS_FILTERS.ACT_DISCARD", "Verwerfen"],
  ["seen", "SETTINGS_FILTERS.ACT_SEEN", "Als gelesen markieren"],
  ["flag", "SETTINGS_FILTERS.ACT_FLAG", "Markieren"],
  ["stop", "SETTINGS_FILTERS.ACT_STOP", "Weitere Regeln stoppen"]
];
function options(rows2, current) {
  return rows2.map(([id, key, fallback]) => `<option value="${id}"${id === current ? " selected" : ""}>${esc3(t(key, fallback))}</option>`).join("");
}
function conditionRow(condition) {
  const size = condition.field === "size";
  return `<div class="rule-line" data-cond>
    <select data-part="field" aria-label="${esc3(t("SETTINGS_FILTERS.FIELD", "Feld"))}">${options(FIELDS, condition.field)}</select>
    <input data-part="header" value="${esc3(condition.header)}" placeholder="${esc3(t("SETTINGS_FILTERS.HEADER_NAME", "Name der Kopfzeile"))}" aria-label="${esc3(t("SETTINGS_FILTERS.HEADER_NAME", "Name der Kopfzeile"))}"${condition.field === "header" ? "" : " hidden"}>
    <select data-part="op" aria-label="${esc3(t("SETTINGS_FILTERS.OP", "Vergleich"))}">${options(OPS, condition.op)}</select>
    <input data-part="value" value="${esc3(condition.value)}" placeholder="${esc3(size ? t("SETTINGS_FILTERS.SIZE_VALUE", "z. B. 2M") : t("SETTINGS_FILTERS.VALUE", "Wert"))}" aria-label="${esc3(t("SETTINGS_FILTERS.VALUE", "Wert"))}">
    <button type="button" class="icon-btn" data-action="cond-remove" aria-label="${esc3(t("GLOBAL.DELETE", "L\xF6schen"))}">${icon("delete")}</button>
  </div>`;
}
function actionRow(action, folders) {
  const needs = action.type === "move" || action.type === "copy" || action.type === "forward" || action.type === "forward-drop" || action.type === "reject" || action.type === "flag";
  const list = action.type === "move" || action.type === "copy" ? ' list="filter-folders"' : "";
  return `<div class="rule-line" data-act>
    <select data-part="type" aria-label="${esc3(t("SETTINGS_FILTERS.ACTION", "Aktion"))}">${options(ACTIONS, action.type)}</select>
    <input data-part="avalue" value="${esc3(action.value)}"${list}${needs ? "" : " hidden"} placeholder="${esc3(placeholder(action.type))}" aria-label="${esc3(placeholder(action.type))}">
    <button type="button" class="icon-btn" data-action="act-remove" aria-label="${esc3(t("GLOBAL.DELETE", "L\xF6schen"))}">${icon("delete")}</button>
  </div>`;
}
function placeholder(type) {
  if (type === "move" || type === "copy") return t("SETTINGS_FILTERS.FOLDER", "Ordner");
  if (type === "forward" || type === "forward-drop") return t("GLOBAL.EMAIL", "E-Mail");
  if (type === "reject") return t("SETTINGS_FILTERS.REJECT_TEXT", "Text der Ablehnung");
  if (type === "flag") return t("SETTINGS_FILTERS.FLAG_NAME", "Markierung");
  return "";
}
function ruleCard(rule, folders) {
  return `<li class="set-row rule-card" draggable="true" data-sort="rule" data-rule>
    <div class="rule-line">
      <label class="check"><input type="checkbox" data-part="on"${rule.enabled ? " checked" : ""}> ${esc3(t("SETTINGS_DESK.ACTIVE", "Aktiv"))}</label>
      <input data-part="name" value="${esc3(rule.name)}" placeholder="${esc3(t("GLOBAL.NAME", "Name"))}" aria-label="${esc3(t("GLOBAL.NAME", "Name"))}">
      <select data-part="match" aria-label="${esc3(t("SETTINGS_FILTERS.MATCH", "Bedingungen"))}">
        <option value="all"${rule.match === "all" ? " selected" : ""}>${esc3(t("SETTINGS_FILTERS.MATCH_ALL", "Alle Bedingungen"))}</option>
        <option value="any"${rule.match === "any" ? " selected" : ""}>${esc3(t("SETTINGS_FILTERS.MATCH_ANY", "Eine Bedingung"))}</option>
      </select>
      <button type="button" class="icon-btn" data-action="settings-move" data-list="rules" data-dir="up" aria-label="${esc3(t("SETTINGS_DESK.UP", "Nach oben"))}">${icon("chevron-up")}</button>
      <button type="button" class="icon-btn" data-action="settings-move" data-list="rules" data-dir="down" aria-label="${esc3(t("SETTINGS_DESK.DOWN", "Nach unten"))}">${icon("chevron-down")}</button>
      <button type="button" class="icon-btn" data-action="rule-remove" aria-label="${esc3(t("GLOBAL.DELETE", "L\xF6schen"))}">${icon("delete")}</button>
    </div>
    <div class="conds">${rule.conditions.map((item) => conditionRow(item)).join("")}</div>
    <button type="button" class="text-btn" data-action="cond-add">${icon("plus")}<span class="btn-label">${esc3(t("SETTINGS_FILTERS.ADD_CONDITION", "Bedingung hinzuf\xFCgen"))}</span></button>
    <div class="acts">${rule.actions.map((item) => actionRow(item, folders)).join("")}</div>
    <button type="button" class="text-btn" data-action="act-add">${icon("plus")}<span class="btn-label">${esc3(t("SETTINGS_FILTERS.ADD_ACTION", "Aktion hinzuf\xFCgen"))}</span></button>
  </li>`;
}
function renderFilterEditor(name, body, parsed, reason, folders, vacationAvailable, capa) {
  const script = parsed || { rules: [], vacation: null };
  const raw = !parsed;
  const vacation = script.vacation;
  const showVacation = vacationAvailable || Boolean(vacation?.on);
  const folderList = folders.map((item) => `<option value="${esc3(item)}"></option>`).join("");
  const cards = (parsed ? script.rules : []).map((rule) => ruleCard(rule, folders)).join("");
  const fresh = blankRule();
  return `<div data-sieve-capa="${esc3(capa.join(" "))}"></div>
    <p class="quiet">${esc3(raw ? reason : t("SETTINGS_FILTERS.FORM_HINT", "Regeln gelten von oben nach unten. Was sich nicht abbilden l\xE4sst, bleibt im Skript."))}</p>
    <button type="button" class="text-btn" data-action="script-mode">${icon("filter")}<span class="btn-label">${esc3(raw ? t("SETTINGS_FILTERS.SHOW_RULES", "Als Regeln zeigen") : t("SETTINGS_FILTERS.EDIT_SCRIPT", "Skript bearbeiten"))}</span></button>
    <datalist id="filter-folders">${folderList}</datalist>
    <div data-editor="form"${raw ? " hidden" : ""}>
      ${showVacation ? `<fieldset class="fields vacation-box">
        <legend class="mono">${esc3(t("SETTINGS_FILTERS.VACATION", "Abwesenheitsnotiz"))}</legend>
        <label class="check"><input type="checkbox" data-part="vacation-on"${vacation?.on ? " checked" : ""}> ${esc3(t("SETTINGS_FILTERS.VACATION_ON", "Antwort automatisch senden"))}</label>
        <div class="rule-line">
          <label class="field"><span>${esc3(t("SETTINGS_FILTERS.VACATION_FROM", "Von"))}</span><input data-part="vacation-from" type="date" value="${esc3(vacation?.from || "")}"></label>
          <label class="field"><span>${esc3(t("SETTINGS_FILTERS.VACATION_UNTIL", "Bis"))}</span><input data-part="vacation-until" type="date" value="${esc3(vacation?.until || "")}"></label>
          <label class="field"><span>${esc3(t("SETTINGS_FILTERS.VACATION_DAYS", "Intervall in Tagen"))}</span><input data-part="vacation-days" type="number" min="1" value="${esc3(vacation?.days || "7")}"></label>
        </div>
        <label class="field"><span>${esc3(t("SETTINGS_FILTERS.VACATION_SUBJECT", "Betreff"))}</span><input data-part="vacation-subject" value="${esc3(vacation?.subject || "")}"></label>
        <label class="field"><span>${esc3(t("SETTINGS_FILTERS.VACATION_ADDRESSES", "Adressen"))}</span><input data-part="vacation-addresses" value="${esc3(vacation?.addresses || "")}" placeholder="${esc3(t("SETTINGS_FILTERS.VACATION_ADDRESSES_HINT", "Kommagetrennt, leer f\xFCr alle Empf\xE4nger"))}"></label>
        <label class="field"><span>${esc3(t("SETTINGS_FILTERS.VACATION_TEXT", "Text"))}</span><textarea data-part="vacation-text">${esc3(vacation?.text || "")}</textarea></label>
      </fieldset>` : ""}
      <p class="mono">${esc3(t("SETTINGS_FILTERS.RULES", "Regeln"))}</p>
      <ul class="set-list" data-rule-list>${cards}</ul>
      ${cards ? "" : `<p class="quiet" data-rule-empty>${esc3(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}</p>`}
      <button type="button" class="text-btn" data-action="rule-add">${icon("plus")}<span class="btn-label">${esc3(t("SETTINGS_FILTERS.ADD_RULE", "Regel hinzuf\xFCgen"))}</span></button>
    </div>
    <div data-editor="raw"${raw ? "" : " hidden"}>
      <label class="field"><span>${esc3(t("SETTINGS_DESK.SCRIPT", "Skript"))}</span><textarea name="body" class="code">${esc3(body)}</textarea></label>
    </div>
    <input type="checkbox" data-part="use-raw"${raw ? " checked" : ""} hidden>
    <template data-rule-template>${ruleCard(fresh, folders)}</template>
    <template data-cond-template>${conditionRow(fresh.conditions[0])}</template>
    <template data-act-template>${actionRow(fresh.actions[0], folders)}</template>
    <input type="hidden" name="script-name" value="${esc3(name)}">`;
}
function syncFilterRow(row2) {
  const field2 = row2.querySelector("[data-part='field']");
  const type = row2.querySelector("[data-part='type']");
  if (field2) {
    const header = row2.querySelector("[data-part='header']");
    if (header) header.hidden = field2.value !== "header";
    row2.querySelectorAll("[data-part='op'] option").forEach((option2) => {
      const sizeOp = option2.value === "over" || option2.value === "under";
      option2.hidden = field2.value === "size" ? !sizeOp : sizeOp;
    });
    const op = row2.querySelector("[data-part='op']");
    if (op && op.selectedOptions[0]?.hidden) op.value = field2.value === "size" ? "over" : "contains";
  }
  if (type) {
    const input2 = row2.querySelector("[data-part='avalue']");
    if (!input2) return;
    const needs = ["move", "copy", "forward", "forward-drop", "reject", "flag"].includes(type.value);
    input2.hidden = !needs;
    input2.placeholder = placeholder(type.value);
    input2.setAttribute("aria-label", placeholder(type.value) || t("SETTINGS_FILTERS.VALUE", "Wert"));
    if (type.value === "move" || type.value === "copy") input2.setAttribute("list", "filter-folders");
    else input2.removeAttribute("list");
  }
}

// src/theme.ts
var KEY = "sm-appearance";
function readAppearance() {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
  }
  return "system";
}
function applyAppearance(mode) {
  const dark = mode === "dark" || mode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches;
  const root3 = document.documentElement;
  root3.dataset.appearance = mode;
  root3.classList.toggle("dark", dark);
  root3.style.colorScheme = dark ? "dark" : "light";
  window.dispatchEvent(new CustomEvent("sm-appearance", { detail: { dark } }));
  try {
    localStorage.setItem(KEY, mode);
  } catch {
  }
}
function watchSystemTheme(onChange) {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onChange);
}

// src/jcard.ts
var PREFS = /* @__PURE__ */ new Set(["Ask", "Never", "Always", "IfPossible"]);
var MANAGED = /* @__PURE__ */ new Set(["n", "fn", "nickname", "note", "bday", "title", "org", "email", "tel", "url", "adr", "categories", "x-crypto"]);
function propName(row2) {
  const raw = String(row2[0] || "").toLowerCase();
  const dot = raw.lastIndexOf(".");
  return dot >= 0 ? raw.slice(dot + 1) : raw;
}
function paramsOf(row2) {
  const value = row2?.[1];
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}
function flat(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((part2) => typeof part2 === "string" ? part2 : "").filter(Boolean).join(" ");
  return "";
}
function parts(value, count) {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => typeof list[index] === "string" ? list[index] : "");
}
function pref(value) {
  const text2 = String(value || "");
  return PREFS.has(text2) ? text2 : "Ask";
}
function asCard(card) {
  if (Array.isArray(card) && String(card[0]).toLowerCase() === "vcard" && Array.isArray(card[1])) {
    const rows2 = card[1].filter(Array.isArray).map((row2) => {
      const item = row2;
      return [String(item[0] || ""), paramsOf(item), String(item[2] || "text"), item[3]];
    });
    const groups = Array.isArray(card[2]) ? [card[2]] : [];
    return groups.length ? ["vcard", rows2, ...groups] : ["vcard", rows2];
  }
  return ["vcard", [["version", {}, "text", "4.0"]]];
}
function writeProp(card, name, value) {
  const next = asCard(card);
  const rows2 = next[1];
  const index = rows2.findIndex((row2) => propName(row2) === name.toLowerCase());
  const line2 = [name, {}, "text", value];
  if (index >= 0) rows2[index] = line2;
  else rows2.push(line2);
  return next;
}
function rowsNamed(card, name) {
  return card[1].filter((row2) => propName(row2) === name);
}
function dateValue(value) {
  const text2 = flat(value).trim();
  const compact = text2.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return text2;
}
function blankCard() {
  return {
    id: "",
    readOnly: false,
    prefix: "",
    given: "",
    middle: "",
    surname: "",
    suffix: "",
    nickname: null,
    note: null,
    birthday: null,
    org: "",
    department: "",
    title: "",
    emails: [""],
    phones: null,
    urls: null,
    addresses: null,
    tags: null,
    sign: "Ask",
    encrypt: "Ask",
    sendAll: true,
    source: ["vcard", [["version", {}, "text", "4.0"]]]
  };
}
function parseCard(raw) {
  const source = asCard(raw.jCard);
  const name = parts(rowsNamed(source, "n")[0]?.[3], 5);
  const org = parts(rowsNamed(source, "org")[0]?.[3], 2);
  const crypto = paramsOf(rowsNamed(source, "x-crypto")[0]);
  const emails = rowsNamed(source, "email").map((row2) => flat(row2[3])).filter(Boolean);
  const phones = rowsNamed(source, "tel").map((row2) => flat(row2[3]));
  const urls = rowsNamed(source, "url").map((row2) => flat(row2[3]));
  const addresses2 = rowsNamed(source, "adr").map((row2) => {
    const value = parts(row2[3], 7);
    return { pobox: value[0], ext: value[1], street: value[2], locality: value[3], region: value[4], code: value[5], country: value[6] };
  });
  const tags = rowsNamed(source, "categories")[0];
  const tagText = Array.isArray(tags?.[3]) ? tags[3].map((part2) => flat(part2)).filter(Boolean).join(", ") : flat(tags?.[3]);
  const one = (field2) => {
    const row2 = rowsNamed(source, field2)[0];
    return row2 ? flat(row2[3]) : null;
  };
  return {
    id: raw.id == null ? "" : String(raw.id),
    readOnly: Boolean(raw.readOnly),
    surname: name[0],
    given: name[1],
    middle: name[2],
    prefix: name[3],
    suffix: name[4],
    nickname: one("nickname"),
    note: one("note"),
    birthday: rowsNamed(source, "bday")[0] ? dateValue(rowsNamed(source, "bday")[0][3]) : null,
    org: org[0],
    department: org[1],
    title: one("title") || "",
    emails: emails.length ? emails : [""],
    phones: phones.length ? phones : null,
    urls: urls.length ? urls : null,
    addresses: addresses2.length ? addresses2 : null,
    tags: tags ? tagText : null,
    sign: pref(crypto.signpref),
    encrypt: pref(crypto.encryptpref),
    sendAll: true,
    source
  };
}
function displayName2(card) {
  const name = [card.prefix, card.given, card.middle, card.surname, card.suffix].map((part2) => part2.trim()).filter(Boolean).join(" ");
  return name || card.emails.find((item) => item.trim()) || card.nickname || "";
}
function reuseText(existing, name, values2, type = "text") {
  const pool = existing.filter((row2) => propName(row2) === name);
  const used = /* @__PURE__ */ new Set();
  return values2.map((value) => value.trim()).filter(Boolean).map((value) => {
    const match = pool.findIndex((row2, index) => !used.has(index) && flat(row2[3]) === value);
    if (match >= 0) {
      used.add(match);
      return [name, paramsOf(pool[match]), String(pool[match][2] || type), value];
    }
    return [name, {}, type, value];
  });
}
function single(existing, name, value, type = "text") {
  const text2 = value.trim();
  if (!text2) return null;
  const prev = existing.find((row2) => propName(row2) === name);
  return [name, paramsOf(prev), String(prev?.[2] || type), text2];
}
function toJCard(card) {
  const kept = card.source[1].filter((row2) => !MANAGED.has(propName(row2))).map((row2) => [row2[0], paramsOf(row2), row2[2], row2[3]]);
  if (!kept.some((row2) => propName(row2) === "version")) kept.unshift(["version", {}, "text", "4.0"]);
  const name = [card.surname, card.given, card.middle, card.prefix, card.suffix];
  kept.push(["n", {}, "text", name]);
  const fn = displayName2(card);
  if (fn) kept.push(["fn", {}, "text", fn]);
  const nickname = card.nickname == null ? null : single(card.source[1], "nickname", card.nickname);
  const note2 = card.note == null ? null : single(card.source[1], "note", card.note);
  const title = single(card.source[1], "title", card.title);
  const birthday = card.birthday == null ? null : single(card.source[1], "bday", card.birthday, "date");
  [nickname, note2, title, birthday].forEach((row2) => {
    if (row2) kept.push(row2);
  });
  if (card.org.trim() || card.department.trim()) {
    const prev = card.source[1].find((row2) => propName(row2) === "org");
    const value = card.department.trim() ? [card.org.trim(), card.department.trim()] : [card.org.trim()];
    kept.push(["org", paramsOf(prev), "text", value]);
  }
  reuseText(card.source[1], "email", card.emails).forEach((row2) => kept.push(row2));
  if (card.phones) reuseText(card.source[1], "tel", card.phones).forEach((row2) => kept.push(row2));
  if (card.urls) reuseText(card.source[1], "url", card.urls, "uri").forEach((row2) => kept.push(row2));
  (card.addresses || []).forEach((item, index) => {
    const filled = [item.pobox, item.ext, item.street, item.locality, item.region, item.code, item.country].some((part2) => part2.trim());
    if (!filled) return;
    const prev = rowsNamed(card.source, "adr")[index];
    kept.push(["adr", paramsOf(prev), String(prev?.[2] || "text"), [item.pobox, item.ext, item.street, item.locality, item.region, item.code, item.country]]);
  });
  if (card.tags != null && card.tags.trim()) {
    const prev = card.source[1].find((row2) => propName(row2) === "categories");
    kept.push(["categories", paramsOf(prev), "text", card.tags.trim()]);
  }
  const prevCrypto = card.source[1].find((row2) => propName(row2) === "x-crypto");
  const crypto = paramsOf(prevCrypto);
  crypto.allowed = crypto.allowed || "PGP/INLINE,PGP/MIME,S/MIME,S/MIMEOpaque";
  crypto.signpref = card.sign;
  crypto.encryptpref = card.encrypt;
  kept.push(["x-crypto", crypto, "x-crypto", ""]);
  return card.source[2] ? ["vcard", kept, card.source[2]] : ["vcard", kept];
}
function formatAddress(name, email) {
  const clean = name.replace(/"/g, "").trim();
  if (!clean || clean.toLowerCase() === email.toLowerCase()) return email;
  return /[",<>]/.test(clean) ? `"${clean}" <${email}>` : `${clean} <${email}>`;
}

// src/settings.ts
function readCaps(data) {
  const capa = data.Capa && typeof data.Capa === "object" ? data.Capa : {};
  return {
    accounts: Boolean(capa.AdditionalAccounts),
    identities: Boolean(capa.Identities),
    contacts: Boolean(capa.Contacts),
    sieve: Boolean(capa.Sieve),
    openpgp: Boolean(capa.OpenPGP),
    gnupg: Boolean(capa.GnuPG)
  };
}
function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}
function text(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function identityOf(item) {
  return {
    id: text(item.id),
    label: text(item.label),
    email: text(item.email),
    name: text(item.name),
    replyTo: text(item.replyTo),
    bcc: text(item.bcc),
    signature: text(item.signature),
    signatureInsertBefore: Boolean(item.signatureInsertBefore),
    sentFolder: text(item.sentFolder),
    pgpEncrypt: Boolean(item.pgpEncrypt),
    pgpSign: Boolean(item.pgpSign),
    smimeKey: text(item.smimeKey),
    smimeCertificate: text(item.smimeCertificate),
    smimeCertificateChain: text(item.smimeCertificateChain)
  };
}
function keyRow(armored, source = "armor", id = "", email = "", secret = /PRIVATE/i.test(armored)) {
  const kind = secret ? t("SETTINGS_OPENPGP.TITLE_PRIVATE", "Privat") : /PUBLIC/i.test(armored) || source !== "armor" ? t("SETTINGS_OPENPGP.TITLE_PUBLIC", "\xD6ffentlich") : t("SETTINGS_DESK.KEYS", "Schl\xFCssel");
  const body = armored.replace(/-----.*?-----/g, "").replace(/\s+/g, "");
  return { kind, preview: email || id.slice(-16) || body.slice(0, 32), id, email, secret, source, armored };
}
async function tryCall(action, params = {}) {
  try {
    return { value: await call(action, params), error: "" };
  } catch (error) {
    return { value: null, error: explain(error) };
  }
}
async function loadDesk(caps, currentEmail, mainEmail, app = {}) {
  const main = mainEmail || currentEmail;
  const plugins = app.Plugins || {};
  const snap = {
    caps,
    mainEmail: main,
    currentEmail,
    accounts: [{ email: main, name: "", current: currentEmail === main, main: true, unread: null }],
    identities: [],
    scripts: caps.sieve ? [] : null,
    sieveCapa: [],
    folderNames: [],
    keys: [],
    certs: [],
    notes: { accounts: "", contacts: "", filters: "", keys: "", certs: "" },
    app,
    twoFactor: null,
    passwordPlugin: Boolean(plugins["change-password"]),
    assist: null,
    assistTones: []
  };
  const desk = await tryCall("AccountsAndIdentities");
  if (desk.error) snap.notes.accounts = desk.error;
  else if (desk.value) {
    const extra = values(desk.value.Accounts).map((item) => {
      const row2 = item;
      const email = text(row2.email);
      return { email, name: text(row2.name), current: email === currentEmail, main: false, unread: null };
    }).filter((row2) => row2.email && row2.email !== main);
    snap.accounts = snap.accounts.concat(extra);
    snap.identities = values(desk.value.Identities).map((item) => identityOf(item));
    const named = snap.identities.find((item) => item.email === main && item.name);
    if (named) snap.accounts[0].name = named.name;
  }
  if (caps.sieve) {
    const filters = await tryCall("Filters");
    if (filters.error) snap.notes.filters = filters.error;
    else if (filters.value) {
      const bag = filters.value;
      snap.sieveCapa = values(bag.Capa).map((item) => text(item)).filter(Boolean);
      snap.scripts = values(bag.Scripts).map((item) => {
        const row2 = item;
        return { name: text(row2.name), active: Boolean(row2.active), body: text(row2.body) };
      }).filter((row2) => row2.name);
      const tree = await tryCall("Folders");
      if (!tree.error && tree.value) {
        snap.folderNames = parseFolders(tree.value).folders.filter((item) => item.selectable).map((item) => item.fullName);
      }
    }
  }
  const keys = await tryCall("GetPGPKeys");
  if (keys.error) snap.notes.keys = keys.error;
  else snap.keys = values(keys.value).map((item) => text(item)).filter(Boolean).map((item) => keyRow(item));
  const gnu = await tryCall("GnupgGetKeys");
  if (!gnu.error && gnu.value) {
    const fromBag = (bag, secret) => values(bag).map((item) => {
      const row2 = item;
      const sub = values(row2.subkeys)[0];
      const uid = values(row2.uids)[0];
      const id = text(sub?.fingerprint || sub?.keyid);
      const email = text(uid?.email);
      if (!id) return null;
      return keyRow(text(uid?.name) || email || id, "gnupg", id, email, secret);
    }).filter((item) => Boolean(item));
    const listed = [...fromBag(gnu.value.private, true), ...fromBag(gnu.value.public, false)];
    const ids = new Set(listed.map((item) => item.id));
    snap.keys = listed.concat(snap.keys.filter((item) => !item.id || !ids.has(item.id)));
  }
  const stored = await tryCall("GetStoredPGPKeys");
  if (!stored.error && stored.value) {
    const add = (list, secret) => values(list).forEach((item) => {
      const row2 = item;
      const armored = text(row2.value);
      const id = text(row2.id);
      if (!armored || snap.keys.some((key) => key.id && key.id === id)) return;
      snap.keys.push(keyRow(armored, "stored", id, "", secret));
    });
    add(stored.value.public, false);
    add(stored.value.private, true);
  }
  const certs = await tryCall("SMimeGetCertificates");
  if (certs.error) snap.notes.certs = certs.error;
  else {
    snap.certs = values(certs.value).map((item) => {
      const row2 = item;
      const until = Number(row2.validTo_time_t || 0);
      return {
        id: text(row2.id),
        name: text(row2.CN),
        email: text(row2.emailAddress),
        until: until ? new Date(until * 1e3).toLocaleDateString() : ""
      };
    });
  }
  await Promise.all(snap.accounts.filter((item) => !item.current && !item.main).map(async (item) => {
    const info = await tryCall("AccountUnread", { email: item.email });
    if (!info.error && info.value) item.unread = Number(info.value.unreadEmails || 0);
  }));
  if (plugins["two-factor-auth"]) {
    const info = await tryCall("GetTwoFactorInfo");
    const value = info.value;
    if (value && typeof value === "object") {
      snap.twoFactor = {
        enabled: Boolean(value.Enable),
        ready: Boolean(value.IsSet),
        secret: text(value.Secret),
        codes: text(value.BackupCodes),
        qr: text(value.QRCode)
      };
    }
  }
  if (plugins["ai-copilot"]) {
    const via = await pluginSafe();
    snap.assist = via.settings;
    snap.assistTones = via.tones;
  }
  return snap;
}
async function pluginSafe() {
  try {
    const result = await plugin("AiGetSettings");
    return { settings: result.settings || {}, tones: result.tones || [] };
  } catch {
    return { settings: null, tones: [] };
  }
}
async function applyDesk(name, data, snap) {
  if (name === "save-account") {
    if (!data.email?.trim() || !data.password) throw new ApiError(0, "Adresse und Passwort eintragen.");
    await call("AccountSetup", { email: data.email.trim(), password: data.password, name: data.name || "", new: 1 });
    return "reload";
  }
  if (name === "edit-account") {
    if (!data.email?.trim()) throw new ApiError(0, "Adresse eintragen.");
    await call("AccountSetup", { email: data.email.trim(), password: data.password || "", name: data.name || "", new: 0 });
    return "reload";
  }
  if (name === "sort-accounts") {
    const emails = data.order.split(",").map((item) => item.trim()).filter(Boolean);
    await call("AccountsAndIdentitiesSortOrder", { Accounts: emails });
    return "reload";
  }
  if (name === "sort-identities") {
    const ids = data.order.split(",").map((item) => item.trim()).filter(Boolean);
    await call("AccountsAndIdentitiesSortOrder", { Identities: ids });
    return "reload";
  }
  if (name === "import-account") {
    await call("AccountImport", { email: data.email, rootfolder: data.email });
    return "reload";
  }
  if (name === "change-password") {
    if (!data.PrevPassword || !data.NewPassword) throw new ApiError(0, "Beide Passw\xF6rter eintragen.");
    if (data.NewPassword !== data.Repeat) throw new ApiError(0, "Die Wiederholung stimmt nicht.");
    await call("ChangePassword", { PrevPassword: data.PrevPassword, NewPassword: data.NewPassword });
    return "reload";
  }
  if (name === "two-factor-create") {
    await call("CreateTwoFactorSecret", { Code: data.Code || "" });
    return "reload";
  }
  if (name === "two-factor-enable") {
    await call("EnableTwoFactor", { Enable: data.Enable ? "1" : "0", Code: data.Code || "" });
    return "reload";
  }
  if (name === "two-factor-clear") {
    await call("ClearTwoFactorInfo", { Code: data.Code || "" });
    return "reload";
  }
  if (name === "assist-save") {
    const features = {};
    Object.keys(data).forEach((key) => {
      if (key.startsWith("feature:")) features[key.slice(8)] = data[key] === "1";
    });
    await plugin("AiSaveSettings", {
      settings: {
        enabled: data.enabled === "1",
        features,
        tone: data.tone || "professional",
        language: data.language || "auto",
        name: data.name || "",
        style: data.style || "",
        addresses: data.addresses || "",
        notice_ack: data.notice_ack === "1"
      }
    });
    return "reload";
  }
  if (name === "delete-account") {
    await call("AccountDelete", { emailToDelete: data.email });
    return data.email === snap.currentEmail ? "session" : "reload";
  }
  if (name === "switch-account") {
    await call("AccountSwitch", { Email: data.email });
    return "session";
  }
  if (name === "save-identity") {
    if (!data.email?.trim()) throw new ApiError(0, "E-Mail eintragen.");
    await call("IdentityUpdate", {
      Id: data.id || "",
      Label: data.label || "",
      Email: data.email.trim(),
      Name: data.name || "",
      ReplyTo: data.replyTo || "",
      Bcc: data.bcc || "",
      Signature: data.signature || "",
      SignatureInsertBefore: data.signatureInsertBefore ? 1 : 0,
      sentFolder: data.sentFolder || "",
      pgpEncrypt: data.pgpEncrypt ? 1 : 0,
      pgpSign: data.pgpSign ? 1 : 0,
      smimeKey: data.smimeKey || "",
      smimeCertificate: data.smimeCertificate || "",
      smimeCertificateChain: data.smimeCertificateChain || ""
    });
    return "reload";
  }
  if (name === "delete-identity") {
    await call("IdentityDelete", { idToDelete: data.id });
    return "reload";
  }
  if (name === "save-sync") {
    await call("SaveContactsSyncData", {
      Mode: Number(data.Mode || 0),
      Url: data.Url || "",
      User: data.User || "",
      Password: data.Password || ""
    });
    const previous = snap.app.ContactsSync;
    const sync = previous && typeof previous === "object" ? { ...previous } : {};
    sync.Mode = Number(data.Mode || 0);
    sync.Url = data.Url || "";
    sync.User = data.User || "";
    sync.Password = data.Password ? "********" : "";
    snap.app.ContactsSync = sync;
    return "keep";
  }
  if (name === "save-script") {
    if (!data.name?.trim()) throw new ApiError(0, "Name eintragen.");
    await call("FiltersScriptSave", { name: data.name.trim(), body: data.body || "" });
    return "reload";
  }
  if (name === "activate-script") {
    await call("FiltersScriptActivate", { name: data.name });
    return "reload";
  }
  if (name === "delete-script") {
    await call("FiltersScriptDelete", { name: data.name });
    return "reload";
  }
  if (name === "import-key") {
    if (!data.key?.trim()) throw new ApiError(0, "Schl\xFCssel einf\xFCgen.");
    if (!data.backup && !data.gnupg) throw new ApiError(0, "Speicherort w\xE4hlen.");
    await call("PgpImportKey", {
      key: data.key,
      keyId: "",
      email: data.email || "",
      backup: data.backup ? 1 : 0,
      gnuPG: data.gnupg ? 1 : 0
    });
    return "reload";
  }
  if (name === "import-cert") {
    if (!data.pem?.trim()) throw new ApiError(0, "Zertifikat einf\xFCgen.");
    await call("SMimeImportCertificate", { pem: data.pem });
    return "reload";
  }
  if (name === "delete-gnupg") {
    await call("GnupgDeleteKey", { keyId: data.id, isPrivate: data.secret === "1" ? 1 : 0 });
    return "reload";
  }
  if (name === "delete-stored") {
    const row2 = snap.keys[Number(data.index)];
    if (!row2?.armored || !row2.id) throw new ApiError(0, "Der gespeicherte Schl\xFCssel fehlt.");
    await call("DeletePGPKey", { key: row2.armored, keyId: row2.id });
    return "reload";
  }
  if (name === "generate-key") {
    if (!data.email?.trim()) throw new ApiError(0, "E-Mail eintragen.");
    await call("GnupgGenerateKey", { name: data.name || "", email: data.email.trim(), passphrase: data.passphrase || "" });
    return "reload";
  }
  if (name === "store-pair") {
    if (!data.publicKey?.trim() && !data.privateKey?.trim()) throw new ApiError(0, "Mindestens einen Schl\xFCssel einf\xFCgen.");
    const onServer = (data.publicOn ? 1 : 0) + (data.privateOn ? 2 : 0);
    const inGnuPG = (data.publicGnu ? 1 : 0) + (data.privateGnu ? 2 : 0);
    await call("PgpStoreKeyPair", {
      publicKey: data.publicKey || "",
      privateKey: data.privateKey || "",
      onServer,
      inGnuPG
    });
    return "reload";
  }
  if (name === "create-cert") {
    if (!data.email?.trim()) throw new ApiError(0, "E-Mail eintragen.");
    await call("SMimeCreateCertificate", {
      name: data.name || "",
      email: data.email.trim(),
      passphrase: data.passphrase || "",
      privateKey: data.privateKey || ""
    });
    return "reload";
  }
  if (name === "export-smime") {
    const pem = await call("SMimeExportPrivateKey", {
      privateKey: data.privateKey || "",
      oldPassphrase: data.oldPassphrase || "",
      newPassphrase: data.newPassphrase || ""
    });
    if (typeof pem === "string" && pem) {
      const url = URL.createObjectURL(new Blob([pem], { type: "application/x-pem-file" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "smime-private.pem";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
    return "keep";
  }
  return "reload";
}
function esc4(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function field(label2, name, value, type = "text", extra = "") {
  const control = type === "area" ? `<textarea name="${name}" class="${extra}">${esc4(value)}</textarea>` : `<input name="${name}" type="${type}" value="${esc4(value)}" ${extra}>`;
  return `<label class="field"><span>${esc4(label2)}</span>${control}</label>`;
}
function check2(name, label2, on2) {
  return `<label class="check"><input type="checkbox" name="${name}"${on2 ? " checked" : ""}> ${esc4(label2)}</label>`;
}
var BUTTON_ICON = {
  "settings-edit": "compose",
  "settings-delete": "delete",
  "settings-switch": "user",
  "settings-activate": "check"
};
function button(action, label2, attrs, danger = false) {
  const extra = Object.entries(attrs).map(([key, value]) => ` data-${key}="${esc4(value)}"`).join("");
  const name = attrs.fresh ? "plus" : BUTTON_ICON[action] || "chevron-right";
  return `<button type="button" class="${danger ? "danger" : "text-btn"}" data-action="${action}"${extra}>${icon(name)}<span class="btn-label">${esc4(label2)}</span></button>`;
}
function row(title, meta, actions) {
  return `<li class="set-row"><span class="grow"><strong title="${esc4(title)}">${esc4(title)}</strong>${meta ? `<span class="quiet">${esc4(meta)}</span>` : ""}</span>${actions}</li>`;
}
function form(kind, inner, submit, cancel) {
  const back = cancel ? `<button type="button" class="text-btn" data-action="settings-cancel">${esc4(t("GLOBAL.CANCEL", "Abbrechen"))}</button>` : "";
  return `<form class="fields" data-action="settings-form" data-kind="${kind}">${inner}<div class="dialog-actions">${back}<button type="submit" class="ink-btn">${icon(kind === "search-contacts" ? "search" : kind.startsWith("import") ? "upload" : kind === "save-account" ? "account-add" : "save")}<span class="btn-label">${esc4(submit)}</span></button></div></form>`;
}
function note(textValue, error = false) {
  if (!textValue) return "";
  return `<p class="${error ? "error" : "quiet"}">${esc4(textValue)}</p>`;
}
function loading() {
  return `<p class="quiet">${esc4(t("GLOBAL.LOADING", "Wird geladen"))} \u2026</p>`;
}
var blankIdentity = () => ({
  id: "",
  label: "",
  email: "",
  name: "",
  replyTo: "",
  bcc: "",
  signature: "",
  signatureInsertBefore: false,
  sentFolder: "",
  pgpEncrypt: false,
  pgpSign: false,
  smimeKey: "",
  smimeCertificate: "",
  smimeCertificateChain: ""
});
function identityForm(item, caps) {
  const crypto = caps.openpgp || caps.gnupg ? `${check2("pgpSign", t("CRYPTO.SIGN", "Unterschreiben"), item.pgpSign)}${check2("pgpEncrypt", t("CRYPTO.ENCRYPT", "Verschl\xFCsseln"), item.pgpEncrypt)}` : "";
  const smimeOpen = item.smimeCertificate || item.smimeKey || item.smimeCertificateChain ? " open" : "";
  return form("save-identity", `
    <input type="hidden" name="id" value="${esc4(item.id)}">
    ${field(t("POPUPS_IDENTITY.LABEL", "Label"), "label", item.label)}
    ${field(t("GLOBAL.NAME", "Name"), "name", item.name)}
    ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", item.email, "email", 'autocomplete="email" required')}
    ${field(t("GLOBAL.REPLY_TO", "Antwort an"), "replyTo", item.replyTo, "email", 'autocomplete="email"')}
    ${field(t("GLOBAL.BCC", "BCC"), "bcc", item.bcc)}
    ${field(t("SETTINGS_DESK.SENT_FOLDER", "Ordner f\xFCr Gesendet"), "sentFolder", item.sentFolder)}
    ${field(t("POPUPS_IDENTITY.SIGNATURE", "Signatur"), "signature", item.signature, "area", "short")}
    ${check2("signatureInsertBefore", t("POPUPS_IDENTITY.LABEL_SIGNATURE_INSERT_BEFORE", "Diese Signatur in Antworten vor dem zitierten Text einf\xFCgen"), item.signatureInsertBefore)}
    ${crypto}
    <details${smimeOpen}>
      <summary>${esc4(t("SMIME.CERTIFICATES", "S/MIME-Zertifikate"))}</summary>
      ${field(t("SMIME.CERTIFICATE", "Zertifikat"), "smimeCertificate", item.smimeCertificate, "area", "code")}
      ${field(t("CRYPTO.PRIVATE_KEY", "Privater Schl\xFCssel"), "smimeKey", item.smimeKey, "area", "code")}
      ${field(t("SMIME.CERTIFICATECHAIN", "Zwischenzertifikat(e)"), "smimeCertificateChain", item.smimeCertificateChain, "area", "code")}
    </details>
  `, t("GLOBAL.SAVE", "Speichern"), true);
}
function flag(app, key, fallback = false) {
  const value = app[key];
  if (value == null || value === "") return fallback;
  return value === true || value === 1 || value === "1";
}
function num(app, key, fallback) {
  const value = Number(app[key]);
  return Number.isFinite(value) ? value : fallback;
}
function choice(name, value, label2, current) {
  return `<label class="check"><input type="radio" name="${name}" data-pref="${name}" value="${esc4(value)}"${current === value ? " checked" : ""}> ${esc4(label2)}</label>`;
}
function prefCheck(name, label2, on2) {
  return `<label class="check"><input type="checkbox" data-pref="${name}"${on2 ? " checked" : ""}> ${esc4(label2)}</label>`;
}
function prefSelect(name, label2, current, options2) {
  const items = options2.map(([value, textValue]) => `<option value="${esc4(value)}"${value === current ? " selected" : ""}>${esc4(textValue)}</option>`).join("");
  return `<label class="field"><span>${esc4(label2)}</span><select data-pref="${name}">${items}</select></label>`;
}
function group(title, body) {
  return `<p class="mono">${esc4(title)}</p><div class="fields">${body}</div>`;
}
function renderGeneral(app) {
  const languages = app.System?.languages || {};
  const langOptions = Object.entries(languages).map(([code, label2]) => [code, label2]);
  const language = String(app.language || "");
  const hour = String(app.hourCycle || "");
  const layout = String(num(app, "Layout", 1));
  const perPage = String(num(app, "MessagesPerPage", 25));
  const interval = String(num(app, "CheckMailInterval", 15));
  const minInterval = String(Math.max(1, num(app, "minRefreshInterval", 5)));
  const sort = String(app.defaultSort || "");
  const thread = String(app.threadAlgorithm || "");
  const images = String(app.ViewImages || "ask");
  const editor = String(app.EditorDefaultType || "Plain") === "Html" ? "Html" : "Plain";
  const sounds = Array.isArray(app.newMailSounds) ? app.newMailSounds.map((item) => String(item)) : ["new-mail"];
  const sound = String(app.NotificationSound || "new-mail");
  const permission = typeof Notification === "undefined" ? "" : Notification.permission;
  const denied = permission === "denied" ? `<p class="quiet">${esc4(t("SETTINGS_GENERAL.CHROME_NOTIFICATION_DESC_DENIED", "Der Browser hat Hinweise abgelehnt. Die Freigabe liegt in den Browser-Einstellungen."))}</p>` : "";
  const lang = flag(app, "allowLanguagesOnSettings", true) && langOptions.length ? prefSelect("language", t("GLOBAL.LANGUAGE", "Sprache"), language, langOptions) : "";
  return `
    ${group(t("SETTINGS_GENERAL.LEGEND_TIME", "Sprache und Zeit"), `
      ${lang}
      ${prefSelect("hourCycle", t("SETTINGS_GENERAL.HOUR_CYCLE", "Uhrzeit"), hour, [["", t("SETTINGS_GENERAL.HOUR_AUTO", "Wie im System")], ["h23", t("SETTINGS_GENERAL.HOUR_24", "24 Stunden")], ["h12", t("SETTINGS_GENERAL.HOUR_12", "12 Stunden")]])}
    `)}
    ${group(t("SETTINGS_LABELS.FOLDERS", "Postfach"), `
      <fieldset class="choices">
        <legend class="quiet">${esc4(t("SETTINGS_GENERAL.LAYOUT", "Layout"))}</legend>
        ${choice("Layout", "0", t("SETTINGS_GENERAL.LAYOUT_NO_SPLIT", "Ohne Teilung"), layout)}
        ${choice("Layout", "1", t("SETTINGS_GENERAL.LAYOUT_COLUMNS", "Spalten"), layout)}
        ${choice("Layout", "2", t("SETTINGS_GENERAL.LAYOUT_BOTTOM", "Brief unten"), layout)}
      </fieldset>
      ${prefSelect("MessagesPerPage", t("SETTINGS_GENERAL.MESSAGES_PER_PAGE", "Mails pro Seite"), perPage, ["10", "20", "25", "50", "100"].map((value) => [value, value]))}
      ${prefSelect("CheckMailInterval", t("SETTINGS_GENERAL.CHECK_INTERVAL", "Abrufintervall"), interval, ["5", "10", "15", "30", "60"].filter((value) => Number(value) >= Number(minInterval)).map((value) => [value, `${value} min`]))}
      ${prefSelect("defaultSort", t("MESSAGE_LIST.SORT", "Sortierung"), sort, [["", t("MESSAGE_LIST.SORT_DATE", "Datum")], ["DATE", t("MESSAGE_LIST.SORT_DATE", "Datum")], ["FROM", t("MESSAGE_LIST.SORT_FROM", "Absender")], ["SUBJECT", t("MESSAGE_LIST.SORT_SUBJECT", "Betreff")], ["SIZE", t("MESSAGE_LIST.SORT_SIZE", "Gr\xF6\xDFe")]])}
      ${prefCheck("UseThreads", t("SETTINGS_GENERAL.THREADS", "Unterhaltungen"), flag(app, "useThreads") || flag(app, "UseThreads"))}
      ${prefSelect("threadAlgorithm", t("SETTINGS_GENERAL.THREAD_ALGORITHM", "Thread-Verfahren"), thread, [["", t("SETTINGS_GENERAL.THREAD_SERVER", "Wie der Server")], ["REFERENCES", "References"], ["ORDEREDSUBJECT", "Subject"]])}
      ${prefCheck("UseCheckboxesInList", t("SETTINGS_GENERAL.CHECKBOXES", "Kontrollk\xE4stchen in der Liste"), flag(app, "UseCheckboxesInList", true))}
      ${prefCheck("listGrouped", t("SETTINGS_GENERAL.GROUPED", "Nach Datum gruppieren"), flag(app, "listGrouped"))}
      ${prefCheck("HideDeleted", t("SETTINGS_GENERAL.HIDE_DELETED", "Gel\xF6schte ausblenden"), flag(app, "HideDeleted", true))}
      ${prefCheck("HideUnsubscribed", t("SETTINGS_GENERAL.HIDE_UNSUB", "Nicht abonnierte ausblenden"), flag(app, "HideUnsubscribed"))}
      ${prefCheck("ShowUnreadCount", t("SETTINGS_GENERAL.UNREAD_TITLE", "Ungelesen im Fenstertitel"), flag(app, "ShowUnreadCount"))}
    `)}
    ${group(t("SETTINGS_GENERAL.LEGEND_READ", "Lesen"), `
      ${prefCheck("messageReadAuto", t("SETTINGS_GENERAL.READ_AUTO", "Beim Lesen als gelesen markieren"), flag(app, "messageReadAuto", true))}
      ${prefSelect("MessageReadDelay", t("SETTINGS_GENERAL.READ_DELAY", "Gelesen nach"), String(num(app, "MessageReadDelay", 5)), [["0", t("SETTINGS_GENERAL.READ_NOW", "Sofort")], ["2", "2 s"], ["5", "5 s"], ["10", "10 s"]])}
      ${prefCheck("showNextMessage", t("SETTINGS_GENERAL.SHOW_NEXT", "Nach dem L\xF6schen die n\xE4chste Mail \xF6ffnen"), flag(app, "showNextMessage"))}
      ${prefCheck("messageNewWindow", t("SETTINGS_GENERAL.NEW_WINDOW", "Brief in einem neuen Fenster"), flag(app, "messageNewWindow"))}
      ${prefSelect("MsgDefaultAction", t("SETTINGS_GENERAL.DEFAULT_REPLY", "Standard-Antwort"), String(num(app, "MsgDefaultAction", 1)), [["1", t("MESSAGE.BUTTON_REPLY", "Antworten")], ["2", t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten")]])}
      ${prefCheck("ViewHTML", t("SETTINGS_GENERAL.VIEW_HTML", "HTML bevorzugen"), flag(app, "ViewHTML", true))}
      ${prefSelect("ViewImages", t("SETTINGS_GENERAL.VIEW_IMAGES", "Externe Bilder"), images, [["ask", t("SETTINGS_GENERAL.IMAGES_ASK", "Fragen")], ["always", t("SETTINGS_GENERAL.IMAGES_ALWAYS", "Immer laden")], ["match", t("SETTINGS_GENERAL.IMAGES_LIST", "Nur die Liste")], ["never", t("SETTINGS_GENERAL.IMAGES_NEVER", "Nie")]])}
      <label class="field"><span>${esc4(t("SETTINGS_GENERAL.IMAGE_LIST", "Liste f\xFCr externe Bilder"))}</span><textarea data-pref="ViewImagesWhitelist">${esc4(String(app.ViewImagesWhitelist || ""))}</textarea></label>
      ${prefCheck("RemoveColors", t("SETTINGS_GENERAL.REMOVE_COLORS", "Farben entfernen"), flag(app, "RemoveColors"))}
      ${prefCheck("AllowStyles", t("SETTINGS_GENERAL.ALLOW_STYLES", "Stile erlauben"), flag(app, "AllowStyles"))}
      ${prefSelect("minFontSize", t("SETTINGS_GENERAL.MIN_FONT", "Mindestschrift"), String(num(app, "minFontSize", 5)), ["5", "8", "10", "12", "14"].map((value) => [value, `${value} px`]))}
      ${prefCheck("CollapseBlockquotes", t("SETTINGS_GENERAL.COLLAPSE_QUOTES", "Zitate einklappen"), flag(app, "CollapseBlockquotes", true))}
      ${prefSelect("MaxBlockquotesLevel", t("SETTINGS_GENERAL.QUOTE_LEVEL", "Zitate ab Ebene"), String(num(app, "MaxBlockquotesLevel", 0)), [["0", t("SETTINGS_GENERAL.QUOTE_ALL", "Alle")], ["1", "1"], ["2", "2"], ["3", "3"]])}
      ${prefCheck("ListInlineAttachments", t("SETTINGS_GENERAL.INLINE", "Eingebettete Anh\xE4nge listen"), flag(app, "ListInlineAttachments"))}
      ${prefCheck("simpleAttachmentsList", t("SETTINGS_GENERAL.SIMPLE_FILES", "Einfache Anhangsliste"), flag(app, "simpleAttachmentsList"))}
    `)}
    ${group(t("SETTINGS_GENERAL.LEGEND_WRITE", "Schreiben"), `
      ${prefSelect("EditorDefaultType", t("SETTINGS_GENERAL.EDITOR", "Editor"), editor, [["Plain", t("COMPOSE.TOGGLE_TO_PLAIN", "Text")], ["Html", "HTML"]])}
      ${prefCheck("markdown", "Markdown", flag(app, "markdown"))}
      ${prefCheck("allowSpellcheck", t("SETTINGS_GENERAL.SPELLCHECK", "Rechtschreibung"), flag(app, "allowSpellcheck"))}
      ${prefCheck("AllowDraftAutosave", t("SETTINGS_GENERAL.AUTOSAVE", "Entw\xFCrfe automatisch speichern"), flag(app, "AllowDraftAutosave", true))}
      ${prefCheck("ReplySameFolder", t("SETTINGS_GENERAL.REPLY_SAME", "In denselben Ordner antworten"), flag(app, "ReplySameFolder"))}
      ${prefCheck("ContactsAutosave", t("SETTINGS_GENERAL.CONTACTS_SAVE", "Empf\xE4nger als Kontakte merken"), flag(app, "ContactsAutosave", true))}
      ${prefCheck("requestReadReceipt", t("SETTINGS_GENERAL.RECEIPT", "Lesebest\xE4tigung anfragen"), flag(app, "requestReadReceipt"))}
      ${prefCheck("requestDsn", t("SETTINGS_GENERAL.DSN", "Zustellbest\xE4tigung anfragen"), flag(app, "requestDsn"))}
      ${prefCheck("requireTLS", "TLS", flag(app, "requireTLS"))}
      ${prefCheck("pgpSign", t("CRYPTO.SIGN", "Unterschreiben"), flag(app, "pgpSign"))}
      ${prefCheck("pgpEncrypt", t("CRYPTO.ENCRYPT", "Verschl\xFCsseln"), flag(app, "pgpEncrypt"))}
      <p class="quiet">${esc4(t("SETTINGS_GENERAL.MAILTO_DESC", "mailto:-Links k\xF6nnen direkt hier eine neue Nachricht \xF6ffnen."))}</p>
      <button type="button" class="text-btn" data-action="mailto-register">${icon("external")}<span>${esc4(t("SETTINGS_GENERAL.MAILTO", "Als Programm f\xFCr mailto:-Links registrieren"))}</span></button>
    `)}
    ${group(t("SETTINGS_GENERAL.LEGEND_NOTIFY", "Benachrichtigungen"), `
      ${prefCheck("DesktopNotifications", t("SETTINGS_GENERAL.DESKTOP", "Hinweis auf dem Desktop"), flag(app, "DesktopNotifications", true))}
      <p class="quiet">${esc4(permission === "granted" ? t("SETTINGS_GENERAL.NOTIFY_OK", "Der Browser erlaubt Hinweise.") : permission === "denied" ? "" : t("SETTINGS_GENERAL.NOTIFY_ASK", "Der Browser fragt beim Einschalten."))}</p>
      ${denied}
      ${prefCheck("SoundNotification", t("SETTINGS_GENERAL.SOUND", "Ton"), flag(app, "SoundNotification", true))}
      ${prefSelect("NotificationSound", t("SETTINGS_GENERAL.SOUND_NAME", "Klang"), sound, sounds.map((name) => [name, name]))}
      <button type="button" class="text-btn" data-action="preview-sound">${icon("external")}<span>${esc4(t("SETTINGS_GENERAL.SOUND_PREVIEW", "Probeh\xF6ren"))}</span></button>
    `)}`;
}
function renderSecurity(snap) {
  const app = snap.app;
  const logout = String(num(app, "AutoLogout", 30));
  const forget = String(num(app, "keyPassForget", 15));
  const password = snap.passwordPlugin ? form("change-password", `
    ${field(t("GLOBAL.PASSWORD", "Passwort"), "PrevPassword", "", "password", 'autocomplete="current-password" required')}
    ${field(t("SETTINGS_SECURITY.NEW_PASSWORD", "Neues Passwort"), "NewPassword", "", "password", 'autocomplete="new-password" required')}
    ${field(t("SETTINGS_SECURITY.REPEAT", "Wiederholen"), "Repeat", "", "password", 'autocomplete="new-password" required')}
  `, t("SETTINGS_SECURITY.CHANGE", "Passwort \xE4ndern"), false) : "";
  const factor = snap.twoFactor ? `
    <p class="mono">${esc4(t("SETTINGS_SECURITY.TWO_FACTOR", "Zwei-Faktor"))}</p>
    <p class="quiet">${esc4(snap.twoFactor.enabled ? t("SETTINGS_SECURITY.TWO_ON", "Eingeschaltet.") : t("SETTINGS_SECURITY.TWO_OFF", "Ausgeschaltet."))}</p>
    ${snap.twoFactor.secret ? `<p class="quiet">${esc4(snap.twoFactor.secret)}</p>` : ""}
    ${snap.twoFactor.codes ? `<p class="quiet">${esc4(t("SETTINGS_SECURITY.BACKUP", "Ersatzcodes"))}: ${esc4(snap.twoFactor.codes)}</p>` : ""}
    ${form("two-factor-create", field(t("SETTINGS_SECURITY.CURRENT_CODE", "Aktueller Code"), "Code", ""), t("SETTINGS_SECURITY.NEW_SECRET", "Neues Geheimnis"), false)}
    ${form("two-factor-enable", `
      ${check2("Enable", t("SETTINGS_SECURITY.TWO_ENABLE", "Zwei-Faktor einschalten"), snap.twoFactor.enabled)}
      ${field(t("SETTINGS_SECURITY.CURRENT_CODE", "Aktueller Code"), "Code", "")}
    `, t("GLOBAL.SAVE", "Speichern"), false)}
    ${form("two-factor-clear", field(t("SETTINGS_SECURITY.CURRENT_CODE", "Aktueller Code"), "Code", ""), t("SETTINGS_SECURITY.CLEAR", "Zwei-Faktor l\xF6schen"), false)}
  ` : "";
  return `
    ${group(t("SETTINGS_SECURITY.LEGEND", "Sitzung"), `
      ${prefSelect("AutoLogout", t("SETTINGS_SECURITY.AUTO_LOGOUT", "Automatisch abmelden nach"), logout, [["0", t("SETTINGS_SECURITY.NEVER", "Nie")], ["5", "5 min"], ["15", "15 min"], ["30", "30 min"], ["60", "1 h"], ["120", "2 h"]])}
      ${prefSelect("keyPassForget", t("SETTINGS_SECURITY.KEY_FORGET", "Schl\xFCssel-Passwort vergessen nach"), forget, [["0", t("SETTINGS_SECURITY.NEVER", "Nie")], ["5", "5 min"], ["15", "15 min"], ["30", "30 min"], ["60", "1 h"]])}
    `)}
    ${password}
    ${factor}`;
}
var ASSIST_FEATURES = [
  ["summarize", "Zusammenfassen"],
  ["draft", "Entwurf"],
  ["quick_replies", "Kurze Antworten"],
  ["search", "Suche"],
  ["triage", "Einordnen"],
  ["triage_llm", "Einordnen mit Modell"],
  ["chat", "Fragen"],
  ["alerts", "Hinweise"]
];
function renderAssistant(snap) {
  const settings = snap.assist;
  if (!settings) return note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verf\xFCgbar."));
  const features = settings.features || {};
  const admin = snap.app.Plugins?.["ai-copilot"]?.features || {};
  const providers = snap.app.Plugins?.["ai-copilot"]?.providers || {};
  const provider = providers.default;
  const tones = (snap.assistTones.length ? snap.assistTones : ["professional"]).map((tone) => [tone, tone]);
  const boxes = ASSIST_FEATURES.filter(([name]) => admin[name] !== false).map(
    ([name, label2]) => prefCheck(`feature:${name}`, label2, features[name] !== false)
  ).join("");
  return `
    <p class="mono">${esc4(t("AI_COPILOT.TITLE", "Assistent"))}</p>
    <form class="fields" data-action="settings-form" data-kind="assist-save">
      ${check2("enabled", t("AI_COPILOT.ENABLED", "Assistent f\xFCr dieses Konto"), settings.enabled !== false)}
      ${boxes.replace(/data-pref=/g, "name=").replace(/type="checkbox"/g, 'type="checkbox"')}
      <label class="field"><span>${esc4(t("AI_COPILOT.TONE", "Standardton"))}</span><select name="tone">${tones.map(([value]) => `<option value="${esc4(value)}"${value === String(settings.tone || "professional") ? " selected" : ""}>${esc4(value)}</option>`).join("")}</select></label>
      ${prefSelect("language", t("GLOBAL.LANGUAGE", "Sprache"), String(settings.language || "auto"), [["auto", "Automatisch"], ["de", "Deutsch"], ["en", "Englisch"]]).replace('data-pref="language"', 'name="language"')}
      ${field(t("AI_COPILOT.NAME", "Eigener Name"), "name", String(settings.name || ""))}
      ${field(t("AI_COPILOT.STYLE", "Schreibstil"), "style", String(settings.style || ""), "area")}
      ${field(t("AI_COPILOT.ADDRESSES", "Eigene Adressen"), "addresses", String(settings.addresses || ""), "area")}
      <p class="quiet">${esc4(provider ? `${provider.name || ""} ${provider.model || ""}`.trim() : "")}</p>
      <p class="quiet">${esc4(t("AI_COPILOT.PRIVACY", "Der Assistent sendet Brieftext erst nach einer Einwilligung an den Anbieter."))}</p>
      ${check2("notice_ack", t("AI_COPILOT.NOTICE", "Einwilligung bleibt gespeichert"), Boolean(settings.notice_ack))}
      <button type="button" class="text-btn" data-action="assist-revoke">${esc4(t("AI_COPILOT.REVOKE", "Einwilligung zur\xFCcknehmen"))}</button>
      <div class="dialog-actions"><button type="submit" class="ink-btn">${icon("save")}<span class="btn-label">${esc4(t("GLOBAL.SAVE", "Speichern"))}</span></div>
    </form>`;
}
function lookSection() {
  const current = readAppearance();
  const choice3 = (value, label2) => `<label class="check"><input type="radio" name="appearance" value="${value}"${current === value ? " checked" : ""}> ${label2}</label>`;
  return `
    <p class="mono">${esc4(t("SETTINGS_DESK.APPEARANCE", "Erscheinungsbild"))}</p>
    <fieldset class="choices">
      ${choice3("system", t("SETTINGS_DESK.SYSTEM", "System"))}
      ${choice3("light", t("SETTINGS_DESK.LIGHT", "Hell"))}
      ${choice3("dark", t("SETTINGS_DESK.DARK", "Dunkel"))}
    </fieldset>
    <p class="mono">${esc4(t("SETTINGS_GENERAL.MAILTO_LINKS", "E-Mail-Adressen"))}</p>
    <p class="quiet">${esc4(t("SETTINGS_GENERAL.MAILTO_DESC", "mailto:-Links k\xF6nnen direkt hier eine neue Nachricht \xF6ffnen."))}</p>
    <button type="button" class="text-btn" data-action="mailto-register">${icon("external")}<span>${esc4(t("SETTINGS_GENERAL.MAILTO", "Als Programm f\xFCr mailto:-Links registrieren"))}</span></button>`;
}
function renderDesk(section, snap, edit) {
  const error = `<p class="error" id="settings-error" hidden></p>`;
  if (section === "look") return error + lookSection();
  if (section === "general") return error + renderGeneral(snap?.app || {});
  if (section === "security") return error + (snap ? renderSecurity(snap) : loading());
  if (section === "assistant") return error + (snap ? renderAssistant(snap) : loading());
  if (!snap) return error + loading();
  if (section === "accounts") {
    const extras = snap.accounts.filter((item) => !item.main).map((item) => item.email);
    const rows2 = snap.accounts.map((item) => {
      const unread = item.unread == null ? "" : `${item.unread} ${t("MAILBOX.UNREAD", "ungelesen")}`;
      const meta = [item.main ? t("SETTINGS_DESK.MAIN", "Hauptkonto") : item.name, item.current ? t("SETTINGS_DESK.ACTIVE", "Aktiv") : "", unread].filter(Boolean).join(" \xB7 ");
      const index = extras.indexOf(item.email);
      const actions = [
        item.main ? "" : button("settings-move", t("SETTINGS_DESK.UP", "Nach oben"), { list: "accounts", dir: "up", email: item.email }),
        item.main ? "" : button("settings-move", t("SETTINGS_DESK.DOWN", "Nach unten"), { list: "accounts", dir: "down", email: item.email }),
        item.current ? "" : button("settings-switch", t("SETTINGS_DESK.SWITCH", "Wechseln"), { email: item.email }),
        item.main ? "" : button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "account", id: item.email }),
        item.main || !snap.caps.accounts ? "" : button("settings-import", t("SETTINGS_DESK.IMPORT", "Importieren"), { email: item.email }),
        item.main ? "" : button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "account", email: item.email }, true)
      ].join("");
      const drag = item.main ? "" : ` draggable="true" data-sort="account" data-email="${esc4(item.email)}" data-index="${index}"`;
      return `<li class="set-row"${drag}><span class="grow"><strong title="${esc4(item.email)}">${esc4(item.email)}</strong>${meta ? `<span class="quiet">${esc4(meta)}</span>` : ""}</span>${actions}</li>`;
    }).join("");
    const editing = edit?.kind === "account" ? snap.accounts.find((item) => item.email === edit.id) : null;
    const editor = editing ? form("edit-account", `
      ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", editing.email, "email", "readonly")}
      ${field(t("GLOBAL.NAME", "Name"), "name", editing.name)}
      ${field(t("GLOBAL.PASSWORD", "Passwort"), "password", "", "password", 'autocomplete="new-password"')}
      <p class="quiet">${esc4(t("SETTINGS_DESK.PASSWORD_KEEP", "Leer lassen, um das Passwort zu behalten."))}</p>
    `, t("GLOBAL.SAVE", "Speichern"), true) : "";
    const add = snap.caps.accounts ? form("save-account", `
          ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", "", "email", 'autocomplete="email" required')}
          ${field(t("GLOBAL.PASSWORD", "Passwort"), "password", "", "password", 'autocomplete="current-password" required')}
          ${field(t("GLOBAL.NAME", "Name"), "name", "")}
        `, t("POPUPS_ADD_ACCOUNT.BUTTON_ADD_ACCOUNT", "Hinzuf\xFCgen"), false) : "";
    return `${error}<p class="mono">${esc4(t("SETTINGS_ACCOUNTS.LEGEND_ACCOUNTS", "Konten"))}</p>${note(snap.notes.accounts, true)}<ul class="set-list">${rows2}</ul>${add}${editor}`;
  }
  if (section === "identities") {
    const rows2 = snap.identities.map((item) => row(
      item.name || item.email || item.label,
      [item.email, item.label].filter(Boolean).join(" \xB7 "),
      [
        button("settings-move", t("SETTINGS_DESK.UP", "Nach oben"), { list: "identities", dir: "up", id: item.id }),
        button("settings-move", t("SETTINGS_DESK.DOWN", "Nach unten"), { list: "identities", dir: "down", id: item.id }),
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "identity", id: item.id }),
        item.id && snap.caps.identities ? button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "identity", id: item.id }, true) : ""
      ].join("")
    ).replace('<li class="set-row">', `<li class="set-row" draggable="true" data-sort="identity" data-id="${esc4(item.id)}">`)).join("");
    const adding = edit?.kind === "identity";
    const current = edit?.kind === "identity" ? edit.fresh ? blankIdentity() : snap.identities.find((item) => item.id === edit.id) || blankIdentity() : null;
    const editor = current ? identityForm(current, snap.caps) : "";
    const add = snap.caps.identities && !adding ? button("settings-edit", t("SETTINGS_ACCOUNTS.BUTTON_ADD_IDENTITY", "Identit\xE4t hinzuf\xFCgen"), { kind: "identity", fresh: "1" }) : "";
    return `${error}<p class="mono">${esc4(t("SETTINGS_ACCOUNTS.LEGEND_IDENTITIES", "Identit\xE4ten"))}</p>${note(snap.notes.accounts, true)}<ul class="set-list">${rows2 || ""}</ul>${rows2 ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}${add}${editor}`;
  }
  if (section === "contacts") {
    const sync = snap.app.ContactsSync;
    if (!sync || typeof sync !== "object") return error + note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verf\xFCgbar."));
    const row2 = sync;
    const mode = String(row2.Mode ?? 0);
    const options2 = [
      ["0", t("GLOBAL.NO", "Nein")],
      ["1", t("GLOBAL.YES", "Ja")],
      ["2", t("SETTINGS_CONTACTS.SYNC_READ", "Nur lesend")]
    ].map(([id, label2]) => `<option value="${id}"${id === mode ? " selected" : ""}>${esc4(label2)}</option>`).join("");
    const password = String(row2.Password || "");
    return `${error}<p class="mono">${esc4(t("SETTINGS_CONTACTS.LEGEND_CONTACTS_SYNC", "Remote-Synchronisierung (CardDAV)"))}</p>${note(snap.notes.contacts, true)}
      <form class="fields" data-action="settings-form" data-kind="save-sync">
        <label class="field"><span>${esc4(t("SETTINGS_CONTACTS.LABEL_CONTACTS_SYNC_ENABLE", "Remote-Synchronisierung aktivieren"))}</span><select name="Mode">${options2}</select></label>
        ${field(t("SETTINGS_CONTACTS.LABEL_CONTACTS_SYNC_AB_URL", "Adressbuch-URL"), "Url", String(row2.Url || ""), "url", 'autocomplete="off" inputmode="url"')}
        ${field(t("SETTINGS_CONTACTS.LABEL_CONTACTS_SYNC_USER", "Benutzer"), "User", String(row2.User || ""), "text", 'autocomplete="username"')}
        ${field(t("GLOBAL.PASSWORD", "Passwort"), "Password", password, "password", 'autocomplete="new-password"')}
        ${password === "********" ? `<p class="quiet">${esc4(t("SETTINGS_CONTACTS.PASSWORD_KEEP", "Acht Sterne stehen f\xFCr das gespeicherte Passwort."))}</p>` : ""}
      </form>
      <div class="dialog-actions">
        <button type="button" class="text-btn" data-action="test-sync">${icon("check")}<span class="btn-label">${esc4(t("GLOBAL.TEST", "Testen"))}</span></button>
        <button type="button" class="text-btn" data-action="sync-now"${mode === "0" ? " hidden" : ""}>${icon("refresh")}<span class="btn-label">${esc4(t("CONTACTS.SYNC_NOW", "Jetzt synchronisieren"))}</span></button>
      </div>
      <p class="quiet">${esc4(t("SETTINGS_CONTACTS.SYNC_HINT", "\xC4nderungen werden beim Verlassen des Feldes gespeichert. Das Adressbuch selbst liegt in der Seitenleiste."))}</p>`;
  }
  if (section === "filters") {
    if (!snap.scripts) return error + note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verf\xFCgbar."));
    const rows2 = snap.scripts.map((item) => row(
      item.name,
      item.active ? t("SETTINGS_DESK.ACTIVE", "Aktiv") : "",
      [
        item.active ? "" : button("settings-activate", t("SETTINGS_DESK.ACTIVATE", "Aktivieren"), { name: item.name }),
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "script", id: item.name }),
        button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "script", name: item.name }, true)
      ].join("")
    )).join("");
    const adding = edit?.kind === "script";
    const current = edit?.kind === "script" && !edit.fresh ? snap.scripts.find((item) => item.name === edit.id) : null;
    const source = current?.body || "";
    const parsed = parseFilterScript(source);
    const editor = adding ? form("save-script", `
      ${field(t("GLOBAL.NAME", "Name"), "name", current?.name || "", "text", current ? "readonly" : "required")}
      ${renderFilterEditor(current?.name || "", source, parsed.ok ? parsed.script : null, parsed.ok ? "" : parsed.reason, snap.folderNames, snap.sieveCapa.includes("vacation"), snap.sieveCapa)}
    `, t("GLOBAL.SAVE", "Speichern"), true) : "";
    const add = adding ? "" : button("settings-edit", t("SETTINGS_FILTERS.BUTTON_ADD_SCRIPT", "Skript hinzuf\xFCgen"), { kind: "script", fresh: "1" });
    return `${error}<p class="mono">${esc4(t("SETTINGS_LABELS.FILTERS", "Filter"))}</p>${note(snap.notes.filters, true)}<ul class="set-list">${rows2}</ul>${rows2 ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}${add}${editor}`;
  }
  const keyRows = snap.keys.map((item, index) => row(
    item.email || item.kind,
    [item.kind, item.preview, item.source === "gnupg" ? "GnuPG" : item.source === "stored" ? t("OPENPGP.BACKUP_ON_SERVER", "Gespeichert") : ""].filter(Boolean).join(" \xB7 "),
    [
      button("settings-export", t("GLOBAL.EXPORT", "Exportieren"), { kind: "key", index: String(index) }),
      item.source === "gnupg" ? button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "gnupg", id: item.id, secret: item.secret ? "1" : "0" }, true) : item.source === "stored" && item.id ? button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "stored", index: String(index), id: item.id }, true) : ""
    ].join("")
  )).join("");
  const certRows = snap.certs.map((item) => row(
    item.name || item.email || item.id,
    [item.email, item.until ? `${t("CRYPTO.VALID_UNTIL", "G\xFCltig bis")} ${item.until}` : ""].filter(Boolean).join(" \xB7 "),
    ""
  )).join("");
  const keyImport = form("import-key", `
    ${field(t("SETTINGS_OPENPGP.BUTTON_IMPORT_KEY", "Schl\xFCssel importieren"), "key", "", "area", "code")}
    ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", "", "email", 'autocomplete="email"')}
    ${check2("backup", t("OPENPGP.BACKUP_ON_SERVER", "Auf dem Server verschl\xFCsselt speichern"), true)}
    ${snap.caps.gnupg ? check2("gnupg", t("OPENPGP.STORE_IN_GNUPG", "Auf dem Server in GnuPG speichern"), false) : ""}
  `, t("OPENPGP.POPUP_IMPORT_BUTTON", "Importieren"), false);
  const generate = snap.caps.gnupg ? form("generate-key", `
    ${field(t("GLOBAL.NAME", "Name"), "name", "", "text")}
    ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", snap.currentEmail, "email", 'autocomplete="email" required')}
    ${field(t("CRYPTO.PASSPHRASE", "Passphrase"), "passphrase", "", "password", 'autocomplete="new-password"')}
  `, t("OPENPGP.GENERATE", "Schl\xFCsselpaar erzeugen"), false) : "";
  const storePair = form("store-pair", `
    ${field(t("OPENPGP.PUBLIC_KEY", "\xD6ffentlicher Schl\xFCssel"), "publicKey", "", "area", "code")}
    ${field(t("CRYPTO.PRIVATE_KEY", "Privater Schl\xFCssel"), "privateKey", "", "area", "code")}
    ${check2("publicOn", t("OPENPGP.STORE_PUBLIC", "\xD6ffentlichen Schl\xFCssel speichern"), true)}
    ${check2("privateOn", t("OPENPGP.STORE_PRIVATE", "Privaten Schl\xFCssel speichern"), false)}
    ${snap.caps.gnupg ? `${check2("publicGnu", t("OPENPGP.PUBLIC_GNUPG", "\xD6ffentlichen Schl\xFCssel in GnuPG"), false)}${check2("privateGnu", t("OPENPGP.PRIVATE_GNUPG", "Privaten Schl\xFCssel in GnuPG"), false)}` : ""}
  `, t("GLOBAL.SAVE", "Speichern"), false);
  const certImport = form("import-cert", `
    ${field(t("SMIME.CERTIFICATE", "Zertifikat"), "pem", "", "area", "code")}
  `, t("OPENPGP.POPUP_IMPORT_BUTTON", "Importieren"), false);
  const certCreate = form("create-cert", `
    ${field(t("GLOBAL.NAME", "Name"), "name", "", "text")}
    ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", snap.currentEmail, "email", 'autocomplete="email" required')}
    ${field(t("CRYPTO.PASSPHRASE", "Passphrase"), "passphrase", "", "password", 'autocomplete="new-password"')}
    ${field(t("CRYPTO.PRIVATE_KEY", "Privater Schl\xFCssel"), "privateKey", "", "area", "code")}
  `, t("SMIME.CREATE", "Zertifikat erzeugen"), false);
  const certExport = form("export-smime", `
    ${field(t("CRYPTO.PRIVATE_KEY", "Privater Schl\xFCssel"), "privateKey", "", "area", "code")}
    ${field(t("SMIME.OLD_PASSPHRASE", "Bisherige Passphrase"), "oldPassphrase", "", "password", 'autocomplete="current-password"')}
    ${field(t("SMIME.NEW_PASSPHRASE", "Neue Passphrase"), "newPassphrase", "", "password", 'autocomplete="new-password"')}
  `, t("SMIME.EXPORT_KEY", "Privaten Schl\xFCssel exportieren"), false);
  return `${error}
    <p class="mono">${esc4(t("SETTINGS_DESK.KEYS", "Schl\xFCssel"))}</p>
    <p class="quiet">${esc4(t("SETTINGS_DESK.KEY_HINT", "Signieren und Verschl\xFCsseln stehen an der Identit\xE4t und im Editor."))}</p>
    ${note(snap.notes.keys, true)}
    <ul class="set-list">${keyRows}</ul>
    ${keyRows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}
    <details><summary>${esc4(t("SETTINGS_OPENPGP.BUTTON_IMPORT_KEY", "Schl\xFCssel importieren"))}</summary>${keyImport}</details>
    ${generate ? `<details><summary>${esc4(t("OPENPGP.GENERATE", "Schl\xFCsselpaar erzeugen"))}</summary>${generate}</details>` : ""}
    <details><summary>${esc4(t("OPENPGP.STORE_PAIR", "Schl\xFCsselpaar speichern"))}</summary>${storePair}</details>
    <p class="mono">${esc4(t("SMIME.CERTIFICATES", "S/MIME-Zertifikate"))}</p>
    ${note(snap.notes.certs, true)}
    <ul class="set-list">${certRows}</ul>
    ${certRows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}
    <details><summary>${esc4(t("SMIME.POPUP_IMPORT_TITLE", "S/MIME-Zertifikat importieren"))}</summary>${certImport}</details>
    <details><summary>${esc4(t("SMIME.CREATE", "Zertifikat erzeugen"))}</summary>${certCreate}</details>
    <details><summary>${esc4(t("SMIME.EXPORT_KEY", "Privaten Schl\xFCssel exportieren"))}</summary>${certExport}</details>`;
}

// src/crypto.ts
var sessionPass = /* @__PURE__ */ new Map();
function rememberedPass(id) {
  return sessionPass.get(id) || "";
}
function rememberPass(id, value, keep) {
  if (keep && value) sessionPass.set(id, value);
}
function emptyParts() {
  return { pgpEncrypted: null, pgpSigned: null, smimeEncrypted: null, smimeSigned: null };
}
function part(value) {
  if (!value || typeof value !== "object") return null;
  const row2 = value;
  const partId = String(row2.partId || "");
  if (!partId) return null;
  const keyIds = Array.isArray(row2.keyIds) ? row2.keyIds.map((item) => String(item)).filter(Boolean) : [];
  return { partId, sigPartId: String(row2.sigPartId || ""), detached: Boolean(row2.detached), keyIds };
}
function readParts(item) {
  return {
    pgpEncrypted: part(item.pgpEncrypted),
    pgpSigned: part(item.pgpSigned),
    smimeEncrypted: part(item.smimeEncrypted),
    smimeSigned: part(item.smimeSigned)
  };
}
function autocryptHeader(headers) {
  return headers.autocrypt || "";
}
function autocryptKey(header) {
  const email = /addr=([^;]+)/i.exec(header)?.[1]?.trim() || "";
  const data = /keydata=([A-Za-z0-9+/=\s]+)/i.exec(header)?.[1]?.replace(/\s+/g, "") || "";
  if (!data) return null;
  let key = "";
  try {
    key = atob(data);
  } catch {
    return null;
  }
  if (!key.includes("BEGIN PGP")) key = `-----BEGIN PGP PUBLIC KEY BLOCK-----

${key}
-----END PGP PUBLIC KEY BLOCK-----`;
  return { email, key };
}
function bodyFromDecrypt(raw) {
  const text2 = raw.replace(/\r\n/g, "\n");
  const html = text2.match(/<html[\s\S]*<\/html>/i)?.[0] || (/<(p|div|br|table)\b/i.test(text2) ? text2 : "");
  if (html) return { html, plain: "" };
  const chunks = text2.split(/\n\n/);
  const looksLikeHeader = chunks.length > 1 && /^[\w-]+:\s/m.test(chunks[0] || "");
  return { html: "", plain: looksLikeHeader ? chunks.slice(1).join("\n\n") : text2 };
}
function rows(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  if (value && typeof value === "object") return Object.values(value).filter((item) => item && typeof item === "object");
  return [];
}
function keyOf(row2, secret) {
  const subs = rows(row2.subkeys);
  const id = String(subs[0]?.fingerprint || subs[0]?.keyid || row2.fingerprint || "");
  if (!id) return null;
  const uids = rows(row2.uids);
  const email = String(uids[0]?.email || "");
  const name = String(uids[0]?.name || uids[0]?.uid || email || id.slice(-16));
  return {
    id,
    email,
    name,
    secret,
    canEncrypt: Boolean(row2.can_encrypt ?? row2.can_decrypt ?? true),
    canSign: Boolean(row2.can_sign ?? row2.can_verify ?? secret)
  };
}
async function loadGnuKeys() {
  const bag = await call("GnupgGetKeys");
  const pub = rows(bag?.public).map((row2) => keyOf(row2, false)).filter((row2) => Boolean(row2));
  const sec = rows(bag?.private).map((row2) => keyOf(row2, true)).filter((row2) => Boolean(row2));
  return [...sec, ...pub];
}
function emailOf(value) {
  const hit = /<([^>]+)>/.exec(value);
  return (hit?.[1] || value).trim().toLowerCase();
}
async function keysFor(address2, known) {
  const email = emailOf(address2);
  const local = known.filter((key) => key.email.toLowerCase() === email && !key.secret && key.canEncrypt);
  if (local.length || !email) return local;
  const found = await call("PgpSearchKey", { query: email });
  if (typeof found === "string" && found.includes("BEGIN PGP")) {
    await call("PgpImportKey", { key: found, keyId: "", email, backup: 0, gnuPG: 1 });
    const again = await loadGnuKeys();
    known.splice(0, known.length, ...again);
    return again.filter((key) => key.email.toLowerCase() === email && !key.secret && key.canEncrypt);
  }
  return [];
}
async function gnupgDecrypt(folder, uid, partId, keyId, passphrase) {
  const result = await call("GnupgDecrypt", { folder, uid, partId, keyId, passphrase, data: "" });
  if (typeof result === "string") return result;
  return String(result?.data || "");
}
async function smimeDecrypt(folder, uid, partId, certificate, privateKey, passphrase) {
  const result = await call("SMimeDecryptMessage", { folder, uid, partId, certificate, privateKey, passphrase });
  return String(result?.data || "");
}
async function pgpVerify(folder, uid, part2) {
  const result = await call("PgpVerifyMessage", {
    folder,
    uid,
    partId: part2.partId,
    sigPartId: part2.sigPartId,
    tryGnuPG: 1
  });
  if (!result || typeof result !== "object") {
    return { ok: false, text: t("CRYPTO.VERIFY_FAIL", "Die Signatur lie\xDF sich nicht pr\xFCfen.") };
  }
  const status = Number(result.status ?? 0);
  const fingerprint = String(result.fingerprint || "");
  const message = String(result.message || "");
  const ok = status === 0;
  const who = fingerprint ? fingerprint.slice(-16) : "";
  const line2 = ok ? t("CRYPTO.VERIFY_OK", "Signatur g\xFCltig.") + (who ? ` ${who}` : "") : message || t("CRYPTO.VERIFY_BAD", "Die Signatur ist ung\xFCltig.");
  return { ok, text: line2 };
}
async function smimeVerify(folder, uid, part2) {
  const result = await call("SMimeVerifyMessage", {
    folder,
    uid,
    partId: part2.partId,
    sigPartId: part2.sigPartId,
    detached: part2.detached ? 1 : 0
  });
  const ok = Boolean(result && typeof result === "object" && result.success);
  return {
    ok,
    text: ok ? t("CRYPTO.SMIME_OK", "S/MIME-Signatur g\xFCltig.") : t("CRYPTO.SMIME_BAD", "Die S/MIME-Signatur ist ung\xFCltig oder der Aussteller fehlt.")
  };
}
function downloadText(name, text2) {
  const url = URL.createObjectURL(new Blob([text2], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// src/search.ts
var QUICK_FLAGS = ["unseen", "flagged", "attachment"];
var PERIODS = [
  ["", "SEARCH.DATE_ALL", "Alle"],
  ["3", "SEARCH.SINCE_3_DAYS", "Nicht \xE4lter als 3 Tage"],
  ["7", "SEARCH.SINCE_7_DAYS", "Nicht \xE4lter als eine Woche"],
  ["30", "SEARCH.SINCE_MONTH", "Nicht \xE4lter als ein Monat"],
  ["90", "SEARCH.SINCE_3_MONTHS", "Nicht \xE4lter als 3 Monate"],
  ["180", "SEARCH.SINCE_6_MONTHS", "Nicht \xE4lter als 6 Monate"],
  ["365", "SEARCH.SINCE_YEAR", "Nicht \xE4lter als ein Jahr"],
  ["-3", "SEARCH.BEFORE_3_DAYS", "\xC4lter als 3 Tage"],
  ["-7", "SEARCH.BEFORE_7_DAYS", "\xC4lter als eine Woche"],
  ["-30", "SEARCH.BEFORE_MONTH", "\xC4lter als ein Monat"],
  ["-90", "SEARCH.BEFORE_3_MONTHS", "\xC4lter als 3 Monate"],
  ["-180", "SEARCH.BEFORE_6_MONTHS", "\xC4lter als 6 Monate"],
  ["-365", "SEARCH.BEFORE_YEAR", "\xC4lter als ein Jahr"]
];
var FLAG_KEYS = /* @__PURE__ */ new Set(["attachment", "unseen", "flagged", "answered", "unanswered"]);
var VALUE_KEYS = ["from", "to", "subject", "text", "keyword", "since", "before", "larger", "smaller", "in"];
function emptyCriteria() {
  return {
    from: "",
    to: "",
    subject: "",
    text: "",
    keyword: "",
    since: "",
    until: "",
    period: "",
    larger: "",
    smaller: "",
    attachment: false,
    unseen: false,
    flagged: false,
    replied: "",
    subtree: ""
  };
}
function encodeValue(value) {
  return value.replace(/[%&+=#]/g, (char) => encodeURIComponent(char));
}
function decodeValue(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}
function isoDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function shiftDay(iso, days) {
  const date = /* @__PURE__ */ new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return isoDate(date);
}
function isStructured(query) {
  const parts2 = query.split("&").map((part2) => part2.trim()).filter(Boolean);
  return parts2.length > 0 && parts2.every((part2) => {
    const name = part2.split("=")[0].toLowerCase();
    return part2.includes("=") ? VALUE_KEYS.includes(name) || /^[a-z_[\]]+$/.test(name) : FLAG_KEYS.has(name);
  });
}
function parseSearch(query) {
  const result = emptyCriteria();
  const trimmed = query.trim();
  if (!trimmed) return result;
  if (!isStructured(trimmed)) {
    result.text = trimmed;
    return result;
  }
  trimmed.split("&").forEach((part2) => {
    if (!part2) return;
    const at = part2.indexOf("=");
    const name = (at < 0 ? part2 : part2.slice(0, at)).toLowerCase();
    const value = at < 0 ? "" : decodeValue(part2.slice(at + 1));
    switch (name) {
      case "from":
      case "to":
      case "subject":
      case "text":
      case "keyword":
      case "larger":
      case "smaller":
        result[name] = value;
        break;
      case "since":
        result.since = value;
        break;
      case "before":
        result.until = shiftDay(value, -1);
        break;
      case "in":
        result.subtree = value === "subtree" || value === "subtree-one" ? value : "";
        break;
      case "attachment":
        result.attachment = true;
        break;
      case "unseen":
        result.unseen = true;
        break;
      case "flagged":
        result.flagged = true;
        break;
      case "answered":
        result.replied = "yes";
        break;
      case "unanswered":
        result.replied = "no";
        break;
      default:
        break;
    }
  });
  return result;
}
function serializeSearch(c, multisearch) {
  const parts2 = [];
  const add = (name, value) => {
    if (value.trim()) parts2.push(`${name}=${encodeValue(value.trim())}`);
  };
  add("from", c.from);
  add("to", c.to);
  add("subject", c.subject);
  add("text", c.text);
  add("keyword", c.keyword);
  if (multisearch && c.subtree) parts2.push(`in=${c.subtree}`);
  const days = Number(c.period || 0);
  if (days > 0) {
    add("since", shiftDay(isoDate(/* @__PURE__ */ new Date()), -days));
  } else if (days < 0) {
    add("before", shiftDay(isoDate(/* @__PURE__ */ new Date()), days));
  } else {
    add("since", c.since);
    if (c.until) add("before", shiftDay(c.until, 1));
  }
  add("larger", c.larger.replace(/\s+/g, "").toUpperCase());
  add("smaller", c.smaller.replace(/\s+/g, "").toUpperCase());
  if (c.attachment) parts2.push("attachment");
  if (c.unseen) parts2.push("unseen");
  if (c.flagged) parts2.push("flagged");
  if (c.replied === "yes") parts2.push("answered");
  if (c.replied === "no") parts2.push("unanswered");
  return parts2.join("&");
}
function activeQuick(query) {
  const c = parseSearch(query);
  return new Set(QUICK_FLAGS.filter((flag2) => c[flag2]));
}
function toggleQuick(query, flag2, multisearch) {
  const c = parseSearch(query);
  c[flag2] = !c[flag2];
  return serializeSearch(c, multisearch);
}
function esc5(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function sizeParts(value) {
  const match = /^(\d+(?:[.,]\d+)?)\s*([KM]?)$/i.exec(value.trim());
  return match ? [match[1], (match[2] || "K").toUpperCase()] : ["", "K"];
}
function sizeField(name, label2, value) {
  const [num2, unit] = sizeParts(value);
  return `<div class="field size-field"><span>${esc5(label2)}</span><div class="size-row">
    <input name="${name}" type="number" min="0" step="1" inputmode="numeric" value="${esc5(num2)}" aria-label="${esc5(label2)}">
    <select name="${name}Unit" aria-label="${esc5(t("SEARCH_UI.UNIT", "Einheit"))}"><option value="K"${unit === "K" ? " selected" : ""}>KB</option><option value="M"${unit === "M" ? " selected" : ""}>MB</option></select>
  </div></div>`;
}
function input(name, label2, value, type = "text", extra = "") {
  return `<label class="field"><span>${esc5(label2)}</span><input name="${name}" type="${type}" value="${esc5(value)}" autocomplete="off" ${extra}></label>`;
}
function choice2(name, label2, on2) {
  return `<label class="check"><input type="checkbox" name="${name}"${on2 ? " checked" : ""}> ${esc5(label2)}</label>`;
}
function renderSearchForm(c, options2) {
  const periodOptions = PERIODS.map(([value, key, fallback]) => `<option value="${value}"${c.period === value ? " selected" : ""}>${esc5(t(key, fallback))}</option>`).join("");
  const replied = [["", t("SEARCH_UI.ANY", "Egal")], ["yes", t("GLOBAL.YES", "Ja")], ["no", t("GLOBAL.NO", "Nein")]].map(([value, label2]) => `<option value="${value}"${c.replied === value ? " selected" : ""}>${esc5(label2)}</option>`).join("");
  const keywordList = options2.keywords.length ? `<datalist id="adv-keywords">${options2.keywords.map((word) => `<option value="${esc5(word)}"></option>`).join("")}</datalist>` : "";
  const subtree = options2.multisearch ? `<label class="field"><span>${esc5(t("SEARCH.SUBFOLDERS", "Unterordner"))}</span><select name="subtree">
        <option value=""${!c.subtree ? " selected" : ""}>${esc5(t("SEARCH.SUBFOLDERS_NONE", "Keine"))}</option>
        <option value="subtree-one"${c.subtree === "subtree-one" ? " selected" : ""}>${esc5(t("SEARCH.SUBFOLDERS_SUBTREE_ONE", "Eine Ebene"))}</option>
        <option value="subtree"${c.subtree === "subtree" ? " selected" : ""}>${esc5(t("SEARCH.SUBFOLDERS_SUBTREE", "Alle"))}</option>
      </select></label>` : "";
  return `
    <div class="adv-grid">
      ${input("from", t("GLOBAL.FROM", "Von"), c.from)}
      ${input("to", t("GLOBAL.TO", "An"), c.to)}
      ${input("subject", t("GLOBAL.SUBJECT", "Betreff"), c.subject)}
      ${input("text", t("SEARCH.TEXT", "Text"), c.text)}
      ${input("keyword", t("SEARCH.KEYWORD", "Schlagwort"), c.keyword, "text", options2.keywords.length ? `list="adv-keywords"` : "")}${keywordList}
      <label class="field"><span>${esc5(t("SEARCH_UI.PERIOD", "Zeitraum"))}</span><select name="period">${periodOptions}</select></label>
      ${input("since", t("SEARCH_UI.DATE_FROM", "Datum von"), c.since, "date")}
      ${input("until", t("SEARCH_UI.DATE_TO", "Datum bis"), c.until, "date")}
      ${sizeField("larger", t("SEARCH_UI.MIN_SIZE", "Mindestgr\xF6\xDFe"), c.larger)}
      ${sizeField("smaller", t("SEARCH_UI.MAX_SIZE", "H\xF6chstgr\xF6\xDFe"), c.smaller)}
      <label class="field"><span>${esc5(t("SEARCH.REPLIED", "Beantwortet"))}</span><select name="replied">${replied}</select></label>
      ${subtree}
    </div>
    <fieldset class="choices">
      ${choice2("attachment", t("SEARCH.HAS_ATTACHMENT", "Anhang vorhanden"), c.attachment)}
      ${choice2("unseen", t("SEARCH.UNSEEN", "Ungelesen"), c.unseen)}
      ${choice2("flagged", t("SEARCH.FLAGGED", "Markiert"), c.flagged)}
    </fieldset>
    <p class="quiet">${esc5(t("SEARCH_UI.PERIOD_HINT", "Ein Zeitraum ersetzt \u201EDatum von\u201C und \u201EDatum bis\u201C."))}</p>
    <div class="dialog-actions">
      <button type="button" class="text-btn" data-action="adv-reset">${icon("close")}<span class="btn-label">${esc5(t("SEARCH_UI.RESET", "Zur\xFCcksetzen"))}</span></button>
      <button type="button" class="text-btn" data-action="close-dialog">${esc5(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
      <button type="submit" class="ink-btn">${icon("search")}<span class="btn-label">${esc5(t("GLOBAL.SEARCH", "Suchen"))}</span></button>
    </div>`;
}
function readSearchForm(form2) {
  const data = new FormData(form2);
  const get = (name) => String(data.get(name) || "").trim();
  const size = (name) => {
    const value = get(name);
    return value ? `${Math.max(0, Math.round(Number(value.replace(",", ".")) || 0))}${get(`${name}Unit`) || "K"}` : "";
  };
  const replied = get("replied");
  const subtree = get("subtree");
  return {
    from: get("from"),
    to: get("to"),
    subject: get("subject"),
    text: get("text"),
    keyword: get("keyword"),
    since: get("since"),
    until: get("until"),
    period: get("period"),
    larger: size("larger"),
    smaller: size("smaller"),
    attachment: data.get("attachment") === "on",
    unseen: data.get("unseen") === "on",
    flagged: data.get("flagged") === "on",
    replied: replied === "yes" || replied === "no" ? replied : "",
    subtree: subtree === "subtree" || subtree === "subtree-one" ? subtree : ""
  };
}

// src/compose.ts
var ADDRESS = /^(?:[^\s@]+@[^\s@]+\.[^\s@]+|[^\s@]+@[^\s@]+)$/;
var ALLOWED_TAGS2 = /* @__PURE__ */ new Set(["A", "B", "BLOCKQUOTE", "BR", "CODE", "DIV", "EM", "I", "LI", "OL", "P", "PRE", "S", "STRONG", "U", "UL"]);
var ALLOWED_ATTR = /* @__PURE__ */ new Set(["href", "title"]);
function esc6(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
function button2(action, symbol, label2, extra = "") {
  return `<button type="button" class="icon-btn" data-compose="${action}" aria-label="${esc6(label2)}" title="${esc6(label2)}" ${extra}>${icon(symbol)}</button>`;
}
function sizeLabel(bytes2) {
  if (!bytes2) return "";
  if (bytes2 < 1024) return `${bytes2} B`;
  if (bytes2 < 1024 * 1024) return `${Math.round(bytes2 / 1024)} KB`;
  return `${(bytes2 / 1024 / 1024).toFixed(1)} MB`;
}
function addresses(value) {
  const result = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "<") angle++;
    if (!quoted && char === ">") angle = Math.max(0, angle - 1);
    if (!quoted && !angle && (char === "," || char === ";")) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}
function emailOf2(value) {
  return (value.match(/<([^>]+)>/)?.[1] || value).trim();
}
function validAddress(value) {
  return ADDRESS.test(emailOf2(value));
}
function htmlToPlain(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  doc.querySelectorAll("p,div,li,blockquote,pre").forEach((node) => node.append("\n"));
  doc.querySelectorAll("li").forEach((node) => node.prepend("\u2022 "));
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}
function plainToHtml2(text2, quoted = false) {
  const lines = text2.replace(/\r/g, "").split("\n");
  const normal = [];
  const quote3 = [];
  const flush = () => {
    if (quote3.length) {
      const content = quote3.map((line2) => esc6(line2.replace(/^> ?/, ""))).join("<br>");
      normal.push(`<blockquote>${content}</blockquote>`);
      quote3.length = 0;
    }
  };
  lines.forEach((line2) => {
    if (quoted && /^>/.test(line2)) quote3.push(line2);
    else {
      flush();
      normal.push(esc6(line2));
    }
  });
  flush();
  return normal.join("<br>");
}
function markdownToHtml(text2) {
  const escaped = esc6(text2.replace(/\r/g, ""));
  const blocks = escaped.split(/\n{2,}/).map((block) => {
    if (/^```/.test(block)) return `<pre><code>${block.replace(/^```[^\n]*\n?|```$/g, "")}</code></pre>`;
    if (/^(?:&gt; ?)/.test(block)) return `<blockquote>${block.replace(/^&gt; ?/gm, "").replace(/\n/g, "<br>")}</blockquote>`;
    const lines = block.split("\n");
    if (lines.every((line2) => /^[-*] /.test(line2))) return `<ul>${lines.map((line2) => `<li>${line2.slice(2)}</li>`).join("")}</ul>`;
    if (lines.every((line2) => /^\d+\. /.test(line2))) return `<ol>${lines.map((line2) => `<li>${line2.replace(/^\d+\. /, "")}</li>`).join("")}</ol>`;
    const heading = block.match(/^(#{1,3}) (.+)$/);
    if (heading) return `<p><strong>${heading[2]}</strong></p>`;
    return `<p>${block.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/_([^_]+)_/g, "<em>$1</em>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>').replace(/\n/g, "<br>")}</p>`;
  });
  return blocks.join("");
}
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const clean = (node) => {
    [...node.children].forEach((child) => {
      clean(child);
      if (!ALLOWED_TAGS2.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        return;
      }
      [...child.attributes].forEach((attr) => {
        if (!ALLOWED_ATTR.has(attr.name.toLowerCase()) || child.tagName !== "A" && attr.name.toLowerCase() === "href") child.removeAttribute(attr.name);
      });
      if (child.tagName === "A") {
        const href = child.getAttribute("href") || "";
        if (!/^(https?:|mailto:)/i.test(href)) child.removeAttribute("href");
        child.setAttribute("rel", "noopener noreferrer");
      }
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
var Composer = class {
  constructor(host, prefs, callbacks) {
    this.callbacks = callbacks;
    this.prefs = prefs;
    host.innerHTML = `<section class="composer" hidden aria-label="${esc6(t("COMPOSE.NEW_MESSAGE", "Neue Mail"))}">
      <form class="composer-form">
        <div class="composer-bar">
          ${button2("close", "close", t("GLOBAL.CLOSE", "Schlie\xDFen"))}
          <span class="title title-md" id="compose-title">${esc6(t("COMPOSE.NEW_MESSAGE", "Neue Mail"))}</span><span class="spacer"></span>
          ${button2("save", "save", t("COMPOSE.BUTTON_SAVE", "Entwurf speichern"))}
          ${button2("minimize", "minimize", t("COMPOSE.BUTTON_MINIMIZE", "Minimieren"))}
          <button type="submit" class="ink-btn">${icon("send")}<span>${esc6(t("COMPOSE.BUTTON_SEND", "Senden"))}</span></button>
        </div>
        <div class="compose-scroll">
          <div class="fields compose-fields">
            <label class="field"><span>${esc6(t("GLOBAL.FROM", "Von"))}</span><select name="identity" id="compose-identity"></select></label>
            <div class="compose-recipient"><span class="field-label">${esc6(t("GLOBAL.TO", "An"))}</span><div class="recipient-box" data-recipient="to"></div><button type="button" class="text-btn compose-more" data-compose="more-fields">Cc \xB7 Bcc \xB7 ${esc6(t("GLOBAL.REPLY_TO", "Antwort an"))}</button></div>
            <div class="compose-recipient" data-extra="cc" hidden><span class="field-label">${esc6(t("GLOBAL.CC", "Cc"))}</span><div class="recipient-box" data-recipient="cc"></div></div>
            <div class="compose-recipient" data-extra="bcc" hidden><span class="field-label">${esc6(t("GLOBAL.BCC", "Bcc"))}</span><div class="recipient-box" data-recipient="bcc"></div></div>
            <label class="field" data-extra="reply" hidden><span>${esc6(t("GLOBAL.REPLY_TO", "Antwort an"))}</span><input name="replyTo" type="email" autocomplete="email"></label>
            <label class="field"><span>${esc6(t("GLOBAL.SUBJECT", "Betreff"))}</span><input name="subject" type="text"></label>
          </div>
          <ul class="compose-files" id="compose-files" aria-label="${esc6(t("GLOBAL.ATTACHMENTS", "Anh\xE4nge"))}" hidden></ul>
          <div class="compose-editor-wrap">
            <div class="editor-tools" role="toolbar" aria-label="${esc6(t("COMPOSE.FORMAT_TEXT", "Text formatieren"))}">
              ${button2("bold", "bold", t("COMPOSE.BOLD", "Fett"))}${button2("italic", "italic", t("COMPOSE.ITALIC", "Kursiv"))}${button2("underline", "underline", t("COMPOSE.UNDERLINE", "Unterstrichen"))}
              <span class="tool-separator"></span>${button2("insertUnorderedList", "list-bullet", t("COMPOSE.BULLETED_LIST", "Aufz\xE4hlung"))}${button2("insertOrderedList", "list-number", t("COMPOSE.NUMBERED_LIST", "Nummerierte Liste"))}
              ${button2("quote", "quote", t("COMPOSE.QUOTE", "Zitat"))}${button2("link", "link", t("COMPOSE.INSERT_LINK", "Link einf\xFCgen"))}${button2("removeFormat", "format-clear", t("COMPOSE.REMOVE_FORMAT", "Format entfernen"))}
              <span class="spacer"></span><button type="button" class="seg" data-compose="mode" aria-pressed="false">HTML</button>
            </div>
            <div class="compose-html" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${esc6(t("GLOBAL.TEXT", "Nachricht"))}" data-placeholder="${esc6(t("COMPOSE.BODY_PLACEHOLDER", "Nachricht schreiben \u2026"))}"></div>
            <textarea class="compose-plain" name="body" aria-label="${esc6(t("GLOBAL.TEXT", "Nachricht"))}" placeholder="${esc6(t("COMPOSE.BODY_PLACEHOLDER", "Nachricht schreiben \u2026"))}"></textarea>
          </div>
          <div class="compose-bottom">
            <input type="file" id="compose-upload" multiple hidden>
            <button type="button" class="text-btn" data-compose="attach">${icon("attach")}<span>${esc6(t("COMPOSE.ATTACH_FILES", "Anh\xE4ngen"))}</span></button>
            <details class="compose-options"><summary>${esc6(t("COMPOSE.SEND_OPTIONS", "Sendeoptionen"))}</summary><div class="compose-option-grid">
              <label class="check"><input type="checkbox" name="important"> ${esc6(t("COMPOSE.BUTTON_MARK_AS_IMPORTANT", "Wichtig markieren"))}</label>
              <label class="check"><input type="checkbox" name="receipt"> ${esc6(t("COMPOSE.BUTTON_REQUEST_READ_RECEIPT", "Lesebest\xE4tigung anfordern"))}</label>
              <label class="check"><input type="checkbox" name="dsn"> ${esc6(t("COMPOSE.BUTTON_REQUEST_DSN", "Zustellbest\xE4tigung anfordern"))}</label>
              <label class="check"><input type="checkbox" name="tls"> ${esc6(t("COMPOSE.BUTTON_REQUIRE_TLS", "TLS erzwingen"))}</label>
              <label class="check" data-crypto hidden><input type="checkbox" name="sign"> ${esc6(t("CRYPTO.SIGN", "Signieren"))}</label>
              <label class="check" data-crypto hidden><input type="checkbox" name="encrypt"> ${esc6(t("CRYPTO.ENCRYPT", "Verschl\xFCsseln"))}</label>
            </div></details>
            <p class="quiet" id="compose-crypto" hidden></p>
            <span class="spacer"></span><span class="quiet live" id="compose-status"></span>
          </div>
          <p class="error" id="send-error" role="alert" hidden></p>
          <p class="quiet compose-drop-hint">${esc6(t("COMPOSE.ATTACH_DROP_FILES_DESC", "Dateien hier ablegen, um sie anzuh\xE4ngen."))}</p>
        </div>
      </form>
    </section>
    <button type="button" class="compose-dock" hidden data-compose="restore">${icon("compose")}<span id="compose-dock-title">${esc6(t("COMPOSE.RESUME_DRAFT", "Entwurf fortsetzen"))}</span>${icon("chevron-up")}</button>
    <dialog id="compose-close" aria-labelledby="compose-close-title"><div class="dialog-body">
      <h2 id="compose-close-title" class="title title-md">${esc6(t("COMPOSE.SAVE_DRAFT", "Entwurf speichern?"))}</h2><p class="quiet">${esc6(t("COMPOSE.UNSAVED_WARNING", "Die \xC4nderungen gehen sonst verloren."))}</p>
      <div class="dialog-actions compose-close-actions"><button type="button" class="text-btn" value="cancel">${esc6(t("COMPOSE.CONTINUE_WRITING", "Weiter schreiben"))}</button><button type="button" class="danger" value="discard">${esc6(t("COMPOSE.DISCARD", "Verwerfen"))}</button><button type="button" class="ink-btn" value="save">${icon("save")}<span>${esc6(t("GLOBAL.SAVE", "Speichern"))}</span></button></div>
    </div></dialog>`;
    this.root = host.querySelector(".composer");
    this.form = host.querySelector(".composer-form");
    this.editor = host.querySelector(".compose-html");
    this.plain = host.querySelector(".compose-plain");
    this.fileInput = host.querySelector("#compose-upload");
    this.closeDialog = host.querySelector("#compose-close");
    ["to", "cc", "bcc"].forEach((name) => this.makeRecipients(name));
    this.wire();
    this.setMode(prefs.editor === "Html" ? "html" : "plain");
  }
  root;
  form;
  editor;
  plain;
  identities = [];
  prefs;
  files = [];
  gnuKeys = null;
  cryptoTimer = 0;
  missingKeys = [];
  fields = /* @__PURE__ */ new Map();
  seed = null;
  mode = "plain";
  draftRef = null;
  baseline = "";
  autosaveTimer = 0;
  saving = false;
  sending = false;
  instantNext = false;
  minimized = false;
  fileInput;
  closeDialog;
  opener = null;
  configure(prefs, identities) {
    this.prefs = prefs;
    this.identities = identities;
    const select2 = this.form.elements.namedItem("identity");
    const current = select2.value;
    select2.replaceChildren(...identities.map((identity) => {
      const option2 = document.createElement("option");
      option2.value = identity.id;
      option2.textContent = `${identity.name ? `${identity.name} ` : ""}<${identity.email}>`;
      return option2;
    }));
    select2.value = identities.some((item) => item.id === current) ? current : identities[0]?.id || "";
    select2.disabled = identities.length < 2;
    const crypto = prefs.gnupg || identities.some((item) => item.smimeCertificate || item.smimeKey);
    this.root.querySelectorAll("[data-crypto]").forEach((row2) => {
      row2.hidden = !crypto;
    });
    this.editor.spellcheck = prefs.spellcheck;
    this.plain.spellcheck = prefs.spellcheck;
    hostSave(this.root).hidden = !prefs.draftsFolder;
  }
  makeRecipients(name) {
    const box = this.root.querySelector(`[data-recipient='${name}']`);
    box.innerHTML = `<div class="recipient-chips"></div><input type="text" autocomplete="off" aria-label="${esc6(name === "to" ? "An" : name === "cc" ? "Cc" : "Bcc")}"><div class="recipient-suggestions" role="listbox" hidden></div>`;
    const field2 = { name, box, input: box.querySelector("input"), list: box.querySelector(".recipient-suggestions"), values: [], suggestions: [], active: -1, timer: 0, request: 0 };
    this.fields.set(name, field2);
    field2.input.addEventListener("input", () => this.suggestions(field2));
    field2.input.addEventListener("keydown", (event) => this.fieldKey(event, field2));
    field2.input.addEventListener("blur", () => window.setTimeout(() => {
      this.commitInput(field2);
      field2.list.hidden = true;
    }, 100));
    box.addEventListener("click", (event) => {
      if (!event.target.closest("button")) field2.input.focus({ preventScroll: true });
    });
  }
  wire() {
    this.root.addEventListener("click", (event) => {
      const target = event.target.closest("[data-compose]");
      if (!target) return;
      const action = target.dataset.compose || "";
      if (["bold", "italic", "underline", "insertUnorderedList", "insertOrderedList", "removeFormat"].includes(action)) {
        this.editor.focus({ preventScroll: true });
        document.execCommand(action);
        this.changed();
      } else if (action === "quote") {
        this.editor.focus({ preventScroll: true });
        document.execCommand("formatBlock", false, "blockquote");
        this.changed();
      } else if (action === "link") {
        const href = window.prompt(t("COMPOSE.LINK_ADDRESS", "Link-Adresse"), "https://");
        if (href && /^https?:\/\//i.test(href)) {
          this.editor.focus({ preventScroll: true });
          document.execCommand("createLink", false, href);
          this.changed();
        }
      } else if (action === "mode") this.setMode(this.mode === "html" ? "plain" : "html");
      else if (action === "more-fields") this.root.querySelectorAll("[data-extra]").forEach((row2) => {
        row2.hidden = false;
      });
      else if (action === "attach") this.fileInput.click();
      else if (action === "save") void this.save(false);
      else if (action === "close") void this.requestClose();
      else if (action === "minimize") this.minimize();
    });
    this.root.parentElement?.querySelector("[data-compose='restore']")?.addEventListener("click", () => this.restore());
    this.fileInput.addEventListener("change", () => {
      this.addFiles([...this.fileInput.files || []]);
      this.fileInput.value = "";
    });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.send();
    });
    this.form.addEventListener("input", (event) => {
      if (!event.target.closest(".recipient-box")) this.changed();
    });
    this.form.addEventListener("change", (event) => {
      this.changed();
      const name = event.target.name;
      if (name === "sign" || name === "encrypt" || name === "identity") void this.lookUpKeys();
    });
    this.form.elements.namedItem("identity").addEventListener("change", () => this.changeIdentity());
    this.editor.addEventListener("paste", (event) => {
      event.preventDefault();
      const html = event.clipboardData?.getData("text/html") || "";
      const text2 = event.clipboardData?.getData("text/plain") || "";
      document.execCommand("insertHTML", false, html ? sanitizeHtml(html) : plainToHtml2(text2));
      this.changed();
    });
    this.root.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.root.classList.add("dragging");
    });
    this.root.addEventListener("dragleave", (event) => {
      if (!this.root.contains(event.relatedTarget)) this.root.classList.remove("dragging");
    });
    this.root.addEventListener("drop", (event) => {
      event.preventDefault();
      this.root.classList.remove("dragging");
      this.addFiles([...event.dataTransfer?.files || []]);
    });
    this.closeDialog.querySelectorAll("button[value]").forEach((button3) => {
      button3.addEventListener("click", () => this.closeDialog.close(button3.value));
    });
    this.closeDialog.addEventListener("close", () => {
      if (this.closeDialog.returnValue === "save") void this.save(true);
      else if (this.closeDialog.returnValue === "discard") this.finishClose(true);
      this.closeDialog.returnValue = "";
    });
    document.addEventListener("keydown", (event) => {
      if (this.root.hidden || this.minimized || this.closeDialog.open) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void this.save(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.send();
      } else if (event.key === "Escape" && !this.root.querySelector("dialog[open]")) {
        event.preventDefault();
        void this.requestClose();
      }
    });
  }
  /** Nächstes Öffnen ohne Einfahrbewegung (Tastatur). */
  armInstant() {
    this.instantNext = true;
  }
  open(seed) {
    const instant = Boolean(seed.instant || this.instantNext);
    this.instantNext = false;
    this.seed = seed;
    this.draftRef = seed.draftRef || null;
    this.files = [];
    this.root.querySelector("#compose-title").textContent = seed.title;
    (this.root.parentElement?.querySelector("#compose-dock-title")).textContent = seed.subject || seed.title;
    this.fields.forEach((field2, name) => {
      field2.values = addresses(String(seed[name] || ""));
      field2.input.value = "";
      this.paintRecipients(field2);
    });
    this.form.elements.namedItem("subject").value = seed.subject;
    this.form.elements.namedItem("replyTo").value = seed.replyTo || "";
    this.root.querySelectorAll("[data-extra]").forEach((row2) => {
      row2.hidden = true;
    });
    if (seed.cc) this.root.querySelector("[data-extra='cc']").hidden = false;
    if (seed.bcc) this.root.querySelector("[data-extra='bcc']").hidden = false;
    if (seed.replyTo) this.root.querySelector("[data-extra='reply']").hidden = false;
    const identity = this.identities.find((item) => item.id === seed.identityId) || this.identities[0];
    this.form.elements.namedItem("identity").value = identity?.id || "";
    this.mode = this.prefs.editor === "Html" ? "html" : "plain";
    this.plain.value = seed.body;
    this.editor.innerHTML = seed.html ? sanitizeHtml(seed.html) : plainToHtml2(seed.body, seed.mode === "reply");
    this.paintMode();
    this.setOptions();
    this.applyIdentity(identity, true);
    this.setStatus("");
    this.setError("");
    this.root.hidden = false;
    this.minimized = false;
    (this.root.parentElement?.querySelector(".compose-dock")).hidden = true;
    if (instant || matchMedia("(max-width: 799px)").matches) {
      this.root.dataset.instant = "1";
      this.root.dataset.open = "true";
    } else {
      delete this.root.dataset.instant;
      this.root.dataset.open = "false";
      requestAnimationFrame(() => {
        this.root.dataset.open = "true";
      });
    }
    this.callbacks.mobile(true);
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = seed.to ? seed.subject ? this.mode === "html" ? this.editor : this.plain : this.form.elements.namedItem("subject") : this.fields.get("to")?.input;
    target?.focus({ preventScroll: true });
    this.baseline = this.fingerprint();
    this.scheduleAutosave();
  }
  setOptions() {
    const identity = this.identity();
    const set = (name, value) => {
      this.form.elements.namedItem(name).checked = value;
    };
    set("important", false);
    set("receipt", this.prefs.readReceipt);
    set("dsn", this.prefs.dsn);
    set("tls", this.prefs.requireTLS);
    set("sign", Boolean(identity?.pgpSign || this.prefs.pgpSign));
    set("encrypt", Boolean(identity?.pgpEncrypt || this.prefs.pgpEncrypt));
    this.root.dataset.pgpSign = String(identity?.pgpSign || this.prefs.pgpSign);
    this.root.dataset.pgpEncrypt = String(identity?.pgpEncrypt || this.prefs.pgpEncrypt);
    void this.lookUpKeys();
  }
  identity() {
    return this.identities.find((item) => item.id === this.form.elements.namedItem("identity").value) || this.identities[0];
  }
  signature(identity, html) {
    let signature = identity.signature || "";
    const isHtml = signature.startsWith(":HTML:");
    if (isHtml) signature = signature.slice(6);
    const from = `${identity.name ? `${identity.name} ` : ""}<${identity.email}>`;
    signature = signature.replace(/{{FROM-FULL}}|{{FROM}}/g, from).replace(/{{DATE}}/g, (/* @__PURE__ */ new Date()).toLocaleString()).replace(/{{TIME}}/g, (/* @__PURE__ */ new Date()).toLocaleTimeString()).replace(/{{MOMENT:[^}]+}}/g, "");
    return html ? isHtml ? sanitizeHtml(signature) : plainToHtml2(signature) : isHtml ? htmlToPlain(signature) : signature;
  }
  applyIdentity(identity, initial) {
    if (!identity) return;
    if (initial || this.seed?.mode === "new" || !this.seed?.mode) {
      if (identity.replyTo && !this.form.elements.namedItem("replyTo").value) {
        this.form.elements.namedItem("replyTo").value = identity.replyTo;
        this.root.querySelector("[data-extra='reply']").hidden = false;
      }
      const bcc = this.fields.get("bcc");
      if (bcc && identity.bcc && !bcc.values.length) {
        bcc.values = addresses(identity.bcc);
        this.paintRecipients(bcc);
        this.root.querySelector("[data-extra='bcc']").hidden = false;
      }
    }
    this.root.querySelectorAll(".compose-signature").forEach((node) => node.remove());
    const signature = this.signature(identity, this.mode === "html");
    if (!signature) return;
    if (this.mode === "html") {
      const node = document.createElement("div");
      node.className = "compose-signature";
      node.innerHTML = `<br>${signature}`;
      if (identity.signatureInsertBefore) this.editor.prepend(node);
      else this.editor.append(node);
    } else {
      const cleaned = this.plain.value.replace(/\n*-- \n[\s\S]*?(?=\n\n|$)/g, "");
      this.plain.value = identity.signatureInsertBefore ? `

-- 
${signature}${cleaned}` : `${cleaned}

-- 
${signature}`;
    }
  }
  changeIdentity() {
    const identity = this.identity();
    this.applyIdentity(identity, false);
    this.root.dataset.pgpSign = String(identity?.pgpSign || this.prefs.pgpSign);
    this.root.dataset.pgpEncrypt = String(identity?.pgpEncrypt || this.prefs.pgpEncrypt);
    this.changed();
  }
  setMode(mode) {
    if (mode === this.mode) {
      this.paintMode();
      return;
    }
    if (mode === "html") this.editor.innerHTML = this.prefs.markdown ? markdownToHtml(this.plain.value) : plainToHtml2(this.plain.value, true);
    else this.plain.value = htmlToPlain(this.editor.innerHTML);
    this.mode = mode;
    this.paintMode();
    this.changed();
  }
  paintMode() {
    this.editor.hidden = this.mode !== "html";
    this.plain.hidden = this.mode === "html";
    this.root.querySelectorAll(".editor-tools > [data-compose]:not([data-compose='mode']), .tool-separator").forEach((item) => {
      item.hidden = this.mode !== "html";
    });
    const toggle = this.root.querySelector("[data-compose='mode']");
    toggle.textContent = this.mode === "html" ? "Text" : "HTML";
    toggle.setAttribute("aria-pressed", this.mode === "html" ? "true" : "false");
  }
  paintRecipients(field2) {
    const chips = field2.box.querySelector(".recipient-chips");
    chips.innerHTML = field2.values.map((value, index) => `<span class="recipient-chip${validAddress(value) ? "" : " invalid"}" title="${esc6(validAddress(value) ? value : t("COMPOSE.INVALID_ADDRESS", "Ung\xFCltige Adresse"))}">${validAddress(value) ? "" : icon("error")}${esc6(value)}<button type="button" data-chip="${index}" aria-label="${esc6(t("COMPOSE.REMOVE_RECIPIENT", "%ADDRESS% entfernen").replace("%ADDRESS%", value))}">${icon("close")}</button></span>`).join("");
    chips.querySelectorAll("button").forEach((button3) => button3.addEventListener("click", () => {
      field2.values.splice(Number(button3.dataset.chip), 1);
      this.paintRecipients(field2);
      this.changed();
      field2.input.focus({ preventScroll: true });
    }));
  }
  commitInput(field2) {
    const value = field2.input.value.trim().replace(/[,;]$/, "");
    if (!value) return false;
    addresses(value).forEach((item) => field2.values.push(item));
    field2.input.value = "";
    field2.list.hidden = true;
    this.paintRecipients(field2);
    this.changed();
    void this.lookUpKeys();
    return true;
  }
  suggestions(field2) {
    const query = field2.input.value.trim();
    window.clearTimeout(field2.timer);
    if (!query) {
      field2.list.hidden = true;
      return;
    }
    const request = ++field2.request;
    field2.timer = window.setTimeout(async () => {
      try {
        const result = await call("Suggestions", { Query: query });
        if (request !== field2.request) return;
        field2.suggestions = (result || []).filter((row2) => row2?.[0]).map((row2) => row2[1] ? `${row2[1]} <${row2[0]}>` : row2[0]);
        field2.active = -1;
        field2.list.innerHTML = field2.suggestions.map((value, index) => `<button type="button" role="option" aria-selected="false" data-suggestion="${index}">${esc6(value)}</button>`).join("");
        field2.list.hidden = !field2.suggestions.length;
        field2.list.querySelectorAll("button").forEach((button3) => button3.addEventListener("mousedown", (event) => {
          event.preventDefault();
          field2.input.value = field2.suggestions[Number(button3.dataset.suggestion)];
          this.commitInput(field2);
        }));
      } catch {
        field2.list.hidden = true;
      }
    }, 200);
  }
  fieldKey(event, field2) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (field2.list.hidden) return;
      event.preventDefault();
      field2.active = (field2.active + (event.key === "ArrowDown" ? 1 : -1) + field2.suggestions.length) % field2.suggestions.length;
      field2.list.querySelectorAll("button").forEach((button3, index) => button3.setAttribute("aria-selected", index === field2.active ? "true" : "false"));
    } else if (event.key === "Enter" || event.key === "," || event.key === ";") {
      event.preventDefault();
      if (event.key === "Enter" && field2.active >= 0) field2.input.value = field2.suggestions[field2.active];
      this.commitInput(field2);
    } else if (event.key === "Backspace" && !field2.input.value && field2.values.length) {
      field2.values.pop();
      this.paintRecipients(field2);
      this.changed();
    } else if (event.key === "Escape") field2.list.hidden = true;
  }
  addFiles(list) {
    list.forEach((file) => {
      const item = { name: file.name, size: sizeLabel(file.size), bytes: file.size, state: "busy", progress: 0, tempName: "", type: file.type };
      this.files.push(item);
      if (this.prefs.attachmentLimit > 0 && file.size > this.prefs.attachmentLimit) {
        item.state = "error";
        item.error = t("COMPOSE.ATTACHMENT_TOO_LARGE", "Die Datei \xFCberschreitet die Grenze von %SIZE%.").replace("%SIZE%", sizeLabel(this.prefs.attachmentLimit));
      } else {
        item.task = upload(file, (percent) => {
          item.progress = percent;
          this.paintFiles();
        });
        void item.task.promise.then((result) => {
          item.name = result.name;
          item.bytes = result.size;
          item.size = sizeLabel(result.size);
          item.tempName = result.tempName;
          item.type = result.mimeType;
          item.state = "";
        }).catch((error) => {
          item.state = "error";
          item.error = explain(error);
        }).finally(() => {
          item.task = void 0;
          this.paintFiles();
        });
      }
      this.paintFiles();
    });
    this.changed();
  }
  async attachFrom(items) {
    if (!items.length) return;
    const added = items.map((item) => ({ name: item.name, size: sizeLabel(item.size), bytes: item.size, state: "busy", tempName: "", type: "" }));
    this.files.push(...added);
    this.paintFiles();
    try {
      const result = await call("MessageUploadAttachments", { attachments: items.map((item) => item.key) });
      added.forEach((file, index) => {
        const row2 = Array.isArray(result) ? result[index] : null;
        if (row2 && row2.tempName) {
          file.tempName = row2.tempName;
          file.type = String(row2.mimeType || "");
          file.state = "";
        } else {
          file.state = "error";
          file.error = t("COMPOSE.ORIGINAL_ATTACHMENT_ERROR", "Der Original-Anhang konnte nicht \xFCbernommen werden.");
        }
      });
    } catch (error) {
      added.forEach((file) => {
        file.state = "error";
        file.error = explain(error);
      });
    }
    this.paintFiles();
  }
  paintFiles() {
    const box = this.root.querySelector("#compose-files");
    box.hidden = !this.files.length;
    box.innerHTML = this.files.map((file, index) => {
      const action = file.state === "busy" ? t("COMPOSE.CANCEL_UPLOAD", "Upload von %NAME% abbrechen").replace("%NAME%", file.name) : t("COMPOSE.REMOVE_RECIPIENT", "%ADDRESS% entfernen").replace("%ADDRESS%", file.name);
      return `<li class="compose-file">${icon(file.state === "busy" ? "loading" : file.state === "error" ? "error" : "attachment")}<span class="grow" title="${esc6(file.error || file.name)}">${esc6(file.name)}</span><span class="quiet">${esc6(file.state === "error" ? file.error || t("COMPOSE.ATTACHMENTS_ERROR_DESC", "Fehler") : file.size)}</span>${file.state === "busy" ? `<progress max="100" value="${file.progress || 0}" aria-label="${esc6(t("COMPOSE.UPLOAD_PROGRESS", "Upload-Fortschritt"))}"></progress>` : ""}<button type="button" class="icon-btn" data-file="${index}" aria-label="${esc6(action)}" title="${esc6(action)}">${icon("close")}</button></li>`;
    }).join("");
    box.querySelectorAll("[data-file]").forEach((button3) => button3.addEventListener("click", () => {
      const index = Number(button3.dataset.file);
      this.files[index]?.task?.abort();
      this.files.splice(index, 1);
      this.paintFiles();
      this.changed();
    }));
  }
  values(saveFolder) {
    this.fields.forEach((field2) => this.commitInput(field2));
    const identity = this.identity();
    if (!identity) throw new ApiError(0, t("COMPOSE.NO_IDENTITY", "Keine Absender-Identit\xE4t vorhanden."));
    const invalid = [...this.fields.values()].flatMap((field2) => field2.values).filter((value) => !validAddress(value));
    if (invalid.length) throw new ApiError(303, `${t("COMPOSE.INVALID_ADDRESS", "Ung\xFCltige Adresse")}: ${invalid[0]}`);
    const html = this.mode === "html" ? sanitizeHtml(this.editor.innerHTML) : this.prefs.markdown ? markdownToHtml(this.plain.value) : "";
    const plain = this.mode === "html" ? htmlToPlain(html) : this.plain.value;
    const attachments = {};
    this.files.filter((file) => file.tempName && file.state !== "error").forEach((file) => {
      attachments[file.tempName] = { name: file.name, inline: false, cId: "", location: "", type: file.type || "application/octet-stream" };
    });
    return {
      ...this.seed,
      to: this.fields.get("to")?.values.join(", ") || "",
      cc: this.fields.get("cc")?.values.join(", ") || "",
      bcc: this.fields.get("bcc")?.values.join(", ") || "",
      replyTo: String(this.form.elements.namedItem("replyTo").value || ""),
      subject: String(this.form.elements.namedItem("subject").value || ""),
      body: plain,
      plain,
      html,
      identityID: identity.id,
      from: `${identity.name ? `${identity.name} ` : ""}<${identity.email}>`,
      saveFolder,
      attachments,
      markAsImportant: this.form.elements.namedItem("important").checked ? 1 : 0,
      readReceiptRequest: this.form.elements.namedItem("receipt").checked ? 1 : 0,
      dsn: this.form.elements.namedItem("dsn").checked ? 1 : 0,
      requireTLS: this.form.elements.namedItem("tls").checked ? 1 : 0,
      pgpSign: this.form.elements.namedItem("sign").checked ? 1 : 0,
      pgpEncrypt: this.form.elements.namedItem("encrypt").checked ? 1 : 0,
      signFingerprint: "",
      signPassphrase: "",
      sign: "",
      encryptFingerprints: "",
      encryptCertificates: [],
      messageFolder: this.draftRef?.folder || "",
      messageUid: this.draftRef?.uid || 0
    };
  }
  send() {
    if (this.sending || this.saving) return;
    void this.sendReady();
  }
  async sendReady() {
    try {
      const values2 = this.values(this.saveFolder());
      if (!values2.to && !values2.cc && !values2.bcc) throw new ApiError(303, t("COMPOSE.EMPTY_TO_ERROR_DESC", "Geben Sie bitte mindestens einen Empf\xE4nger an."));
      if (this.files.some((file) => file.state === "busy")) throw new ApiError(0, t("COMPOSE.ATTACHMENTS_UPLOAD_ERROR_DESC", "Anh\xE4nge werden noch hochgeladen."));
      if (this.files.some((file) => file.state === "error")) throw new ApiError(0, t("COMPOSE.ATTACHMENTS_ERROR_DESC", "Entfernen Sie die fehlgeschlagenen Anh\xE4nge vor dem Senden."));
      if (values2.pgpEncrypt && this.missingKeys.length) {
        throw new ApiError(0, t("CRYPTO.MISSING_KEYS", "F\xFCr diese Empf\xE4nger fehlt ein Schl\xFCssel: %LIST%.").replace("%LIST%", this.missingKeys.join(", ")));
      }
      await this.attachCrypto(values2);
      this.sending = true;
      this.setBusy(true, t("COMPOSE.SENDING", "Wird gesendet \u2026"));
      this.callbacks.send(values2);
    } catch (error) {
      this.setError(explain(error));
    }
  }
  async lookUpKeys() {
    window.clearTimeout(this.cryptoTimer);
    const sign = this.form.elements.namedItem("sign").checked;
    const encrypt = this.form.elements.namedItem("encrypt").checked;
    const hint = this.root.querySelector("#compose-crypto");
    if (!this.prefs.gnupg || !sign && !encrypt) {
      this.missingKeys = [];
      hint.hidden = true;
      return;
    }
    this.cryptoTimer = window.setTimeout(async () => {
      try {
        if (!this.gnuKeys) this.gnuKeys = await loadGnuKeys();
        const recipients = [...this.fields.get("to")?.values || [], ...this.fields.get("cc")?.values || []];
        const missing = [];
        if (encrypt) {
          for (const value of recipients) {
            const found = await keysFor(value, this.gnuKeys);
            if (!found.length) missing.push(emailOf2(value));
          }
        }
        this.missingKeys = missing;
        hint.hidden = !missing.length;
        hint.textContent = missing.length ? t("CRYPTO.MISSING_KEYS", "F\xFCr diese Empf\xE4nger fehlt ein Schl\xFCssel: %LIST%.").replace("%LIST%", missing.join(", ")) : "";
      } catch (error) {
        hint.hidden = false;
        hint.textContent = explain(error);
      }
    }, 300);
  }
  async attachCrypto(values2) {
    const identity = this.identity();
    const sign = values2.pgpSign === 1;
    const encrypt = values2.pgpEncrypt === 1;
    if (!sign && !encrypt) return;
    if (this.prefs.gnupg && !this.gnuKeys) this.gnuKeys = await loadGnuKeys();
    const from = emailOf2(identity?.email || "");
    const secret = (this.gnuKeys || []).find((key) => key.secret && key.email.toLowerCase() === from) || (this.gnuKeys || []).find((key) => key.secret);
    if (sign && secret) {
      let pass = rememberedPass(secret.id);
      if (!pass) {
        const answer = await this.callbacks.passphrase(
          t("CRYPTO.PASSPHRASE_TITLE", "Passphrase"),
          t("CRYPTO.PASSPHRASE", "Passphrase")
        );
        if (!answer) throw new ApiError(0, t("CRYPTO.PASSPHRASE_REQUIRED", "Ohne Passphrase wird nicht signiert."));
        pass = answer.value;
        rememberPass(secret.id, pass, answer.remember);
      }
      values2.signFingerprint = secret.id;
      values2.signPassphrase = pass;
    } else if (sign && identity?.smimeCertificate && identity.smimeKey) {
      values2.sign = "S/MIME";
      let pass = rememberedPass(`smime:${identity.id}`);
      if (!pass) {
        const answer = await this.callbacks.passphrase(
          t("CRYPTO.PASSPHRASE_TITLE", "Passphrase"),
          t("CRYPTO.PASSPHRASE", "Passphrase")
        );
        if (answer) {
          pass = answer.value;
          rememberPass(`smime:${identity.id}`, pass, answer.remember);
        }
      }
      values2.signPassphrase = pass;
    }
    if (encrypt && this.prefs.gnupg) {
      const recipients = [values2.to, values2.cc].join(", ").split(",").map((item) => item.trim()).filter(Boolean);
      const ids = [];
      for (const value of recipients) {
        const found = await keysFor(value, this.gnuKeys || []);
        found.forEach((key) => {
          if (!ids.includes(key.id)) ids.push(key.id);
        });
      }
      if (secret && !ids.includes(secret.id)) ids.push(secret.id);
      values2.encryptFingerprints = JSON.stringify(ids);
    } else if (encrypt && identity?.smimeCertificate) {
      values2.encryptCertificates = [identity.smimeCertificate];
    }
  }
  saveFolder() {
    const identity = this.identity();
    if (identity?.sentFolder && identity.sentFolder !== "-") return identity.sentFolder;
    if (this.prefs.replySameFolder && this.seed?.mode && ["reply", "forward"].includes(this.seed.mode) && this.seed.sourceFolder) return this.seed.sourceFolder;
    return this.prefs.sentFolder;
  }
  async save(closeAfter) {
    if (this.saving || this.sending) return;
    if (!this.prefs.draftsFolder) {
      this.setError(t("COMPOSE.NO_DRAFTS_FOLDER", "Kein Entw\xFCrfe-Ordner eingerichtet."));
      return;
    }
    let status = "";
    try {
      if (this.empty()) {
        if (closeAfter) this.finishClose(false);
        return;
      }
      if (this.files.some((file) => file.state === "busy")) throw new ApiError(0, t("COMPOSE.ATTACHMENTS_UPLOAD_ERROR_DESC", "Anh\xE4nge werden noch hochgeladen."));
      this.setError("");
      this.saving = true;
      this.setBusy(true, t("COMPOSE.SAVING", "Wird gespeichert \u2026"));
      const values2 = this.values(this.prefs.draftsFolder);
      const saved = await this.callbacks.save(values2);
      this.draftRef = saved;
      this.baseline = this.fingerprint();
      status = t("COMPOSE.SAVED_TIME", "Gespeichert um %TIME%").replace("%TIME%", (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      if (closeAfter) this.finishClose(false);
    } catch (error) {
      this.setError(explain(error));
    } finally {
      this.saving = false;
      this.setBusy(false, status);
      this.scheduleAutosave();
    }
  }
  empty() {
    const content = this.mode === "html" ? htmlToPlain(this.editor.innerHTML) : this.plain.value;
    const subject = this.form.elements.namedItem("subject").value.trim();
    return ![...this.fields.values()].some((field2) => field2.values.length || field2.input.value.trim()) && !subject && !content.trim() && !this.files.length;
  }
  fingerprint() {
    return JSON.stringify({
      to: [...this.fields.values()].map((field2) => field2.values),
      subject: this.form.elements.namedItem("subject").value,
      replyTo: this.form.elements.namedItem("replyTo").value,
      identity: this.identity()?.id,
      body: this.mode === "html" ? this.editor.innerHTML : this.plain.value,
      files: this.files.map((file) => file.tempName || file.name),
      options: ["important", "receipt", "dsn", "tls"].map((name) => this.form.elements.namedItem(name).checked)
    });
  }
  changed() {
    this.scheduleAutosave();
  }
  scheduleAutosave() {
    window.clearTimeout(this.autosaveTimer);
    if (!this.prefs.autosave || this.root.hidden) return;
    this.autosaveTimer = window.setTimeout(() => {
      if (!this.root.hidden && !this.minimized && !this.empty() && this.fingerprint() !== this.baseline) void this.save(false);
      else this.scheduleAutosave();
    }, 6e4);
  }
  async requestClose() {
    if (this.empty() && !this.draftRef) {
      this.finishClose(false);
      return;
    }
    if (this.fingerprint() === this.baseline) {
      this.finishClose(false);
      return;
    }
    this.closeDialog.showModal();
  }
  minimize() {
    this.minimized = true;
    this.root.hidden = true;
    (this.root.parentElement?.querySelector(".compose-dock")).hidden = false;
    this.callbacks.mobile(false);
    this.opener?.focus({ preventScroll: true });
  }
  restore() {
    this.minimized = false;
    this.root.hidden = false;
    (this.root.parentElement?.querySelector(".compose-dock")).hidden = true;
    this.callbacks.mobile(true);
    (this.mode === "html" ? this.editor : this.plain).focus({ preventScroll: true });
  }
  finishClose(discard) {
    window.clearTimeout(this.autosaveTimer);
    this.files.forEach((file) => file.task?.abort());
    delete this.root.dataset.instant;
    this.root.dataset.open = "false";
    const hide = () => {
      this.root.hidden = true;
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || matchMedia("(max-width: 799px)").matches) hide();
    else {
      const timer = window.setTimeout(hide, 200);
      this.root.addEventListener("transitionend", (event) => {
        if (event.target !== this.root || event.propertyName !== "transform") return;
        window.clearTimeout(timer);
        hide();
      }, { once: true });
    }
    (this.root.parentElement?.querySelector(".compose-dock")).hidden = true;
    this.minimized = false;
    this.callbacks.mobile(false);
    this.callbacks.close(discard);
    this.opener?.focus({ preventScroll: true });
  }
  sent() {
    this.sending = false;
    this.setBusy(false, "");
    this.finishClose(false);
  }
  setError(error) {
    this.sending = false;
    this.setBusy(false, "");
    const slot = this.root.querySelector("#send-error");
    slot.hidden = !error;
    slot.textContent = error;
  }
  setBusy(busy, status) {
    const submit = this.form.querySelector("button[type='submit']");
    submit.disabled = busy;
    submit.innerHTML = `${icon(busy ? "loading" : "send")}<span>${esc6(busy && this.sending ? t("COMPOSE.SENDING", "Wird gesendet \u2026") : t("COMPOSE.BUTTON_SEND", "Senden"))}</span>`;
    this.setStatus(status);
  }
  setStatus(text2) {
    this.root.querySelector("#compose-status").textContent = text2;
  }
  setBody(text2) {
    if (this.mode === "html") this.editor.innerHTML = plainToHtml2(text2);
    else this.plain.value = text2;
    this.changed();
  }
  body() {
    return this.mode === "html" ? htmlToPlain(this.editor.innerHTML) : this.plain.value;
  }
  subject() {
    return this.form.elements.namedItem("subject").value;
  }
  isOpen() {
    return !this.root.hidden;
  }
};
function hostSave(root3) {
  return root3.querySelector("[data-compose='save']");
}

// src/reader.ts
function esc7(value) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
function person(item) {
  const text2 = item.name ? `${item.name} <${item.email}>` : item.email;
  return `<button type="button" class="addr" data-action="m-address" data-email="${esc7(item.email)}" data-name="${esc7(item.name)}" title="${esc7(item.email)}">${esc7(item.name || item.email)}</button><span class="sr">${esc7(text2)}</span>`;
}
function people(list) {
  return list.map(person).join('<span class="sep">, </span>');
}
function line(label2, list) {
  if (!list.length) return "";
  return `<div class="head-line"><span class="head-key mono">${esc7(label2)}</span><span class="head-val">${people(list)}</span></div>`;
}
var FILE_ICON = {
  image: "image",
  pdf: "drafts",
  calendar: "calendar",
  text: "drafts",
  archive: "download-zip",
  other: "attachment"
};
function bar(kind, iconName, text2, actions) {
  return `<div class="note-bar" data-kind="${kind}" role="status">${icon(iconName)}<span class="grow">${esc7(text2)}</span>${actions}</div>`;
}
function textButton(action, label2, extra = "") {
  return `<button type="button" class="text-btn" data-action="${action}"${extra}>${esc7(label2)}</button>`;
}
function renderReader(body, data, expanded) {
  const tags = data.keywords.map(
    (tag) => `<span class="tag">${icon("tag")}<span>${esc7(tag)}</span><button type="button" class="tag-x" data-action="m-untag" data-tag="${esc7(tag)}" aria-label="Schlagwort ${esc7(tag)} entfernen">${icon("close")}</button></span>`
  ).join("");
  const from = data.from[0];
  const summary = `
    <div class="head-line head-main">
      <span class="head-val">${from ? person(from) : '<span class="quiet">(unbekannt)</span>'}</span>
      <span class="spacer"></span>
      <time class="quiet" title="${esc7(data.whenFull)}">${esc7(data.when)}</time>
      <button type="button" class="icon-btn" data-action="m-details" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "Details ausblenden" : "Details anzeigen"}" title="Details">${icon(expanded ? "chevron-up" : "chevron-down")}</button>
    </div>`;
  const details = expanded ? `
    <div class="head-details">
      ${line("Von", data.from)}
      ${line("An", data.to)}
      ${line("Cc", data.cc)}
      ${line("Bcc", data.bcc)}
      ${line("Antwort an", data.replyTo)}
      <div class="head-line"><span class="head-key mono">Datum</span><span class="head-val">${esc7(data.whenFull)}</span></div>
      ${data.size ? `<div class="head-line"><span class="head-key mono">Gr\xF6\xDFe</span><span class="head-val">${esc7(data.size)}</span></div>` : ""}
    </div>` : data.to.length ? `<div class="head-line quiet"><span class="head-key mono">An</span><span class="head-val">${people(data.to.slice(0, 3))}${data.to.length + data.cc.length > 3 ? ` <span class="quiet">+${data.to.length + data.cc.length - 3}</span>` : ""}</span></div>` : "";
  const bars = [];
  if (data.deleted) bars.push(bar("deleted", "trash", "Als gel\xF6scht markiert.", textButton("m-restore", "Wiederherstellen")));
  if (data.spam) bars.push(bar("spam", "spam", data.spam, ""));
  if (data.blocked) {
    bars.push(bar(
      "images",
      "image-blocked",
      data.blocked === 1 ? "Ein externes Bild wurde blockiert." : `${data.blocked} externe Bilder wurden blockiert.`,
      textButton("m-images", "Anzeigen") + (from ? textButton("m-images-always", "Immer f\xFCr diesen Absender") : "")
    ));
  }
  if (data.failed) {
    bars.push(bar(
      "images",
      "image-blocked",
      data.failed === 1 ? "Ein externes Bild ist nicht erreichbar." : `${data.failed} externe Bilder sind nicht erreichbar.`,
      ""
    ));
  }
  if (data.tracking) {
    bars.push(bar(
      "tracking",
      "shield-check",
      data.originalLinks ? "Links zeigen auf die Originaladressen mit Tracking." : "Tracking in Links und Bildern wurde entfernt.",
      textButton("m-links", data.originalLinks ? "Bereinigte Links" : "Originallinks")
    ));
  }
  if (data.receipt) {
    bars.push(bar(
      "receipt",
      "receipt",
      `Der Absender bittet um eine Lesebest\xE4tigung an ${data.receipt}.`,
      textButton("m-receipt", "Best\xE4tigung senden") + textButton("m-receipt-skip", "Nicht senden")
    ));
  }
  if (data.crypto && (data.crypto.encrypted || data.crypto.signed || data.crypto.autocrypt)) {
    const actions = [
      data.crypto.encrypted ? textButton("m-decrypt", t("CRYPTO.DECRYPT", "Entschl\xFCsseln")) : "",
      data.crypto.signed ? textButton("m-verify", t("CRYPTO.VERIFY", "Signatur pr\xFCfen")) : "",
      data.crypto.smime ? textButton("m-smime-certs", t("SMIME.IMPORT_FROM_MAIL", "Zertifikate \xFCbernehmen")) : "",
      data.crypto.autocrypt ? textButton("m-autocrypt", t("CRYPTO.IMPORT_AUTOCRYPT", "Schl\xFCssel \xFCbernehmen")) : ""
    ].join("");
    const mark = data.crypto.state === "bad" ? "shield-alert" : "shield-check";
    const fallback = data.crypto.encrypted && data.crypto.signed ? t("CRYPTO.BOTH", "Diese Mail ist verschl\xFCsselt und signiert.") : data.crypto.encrypted ? t("CRYPTO.ENCRYPTED", "Diese Mail ist verschl\xFCsselt.") : data.crypto.signed ? t("CRYPTO.SIGNED", "Diese Mail ist signiert.") : t("CRYPTO.AUTOCRYPT", "Der Absender legt einen Schl\xFCssel bei.");
    bars.push(bar("crypto", mark, data.crypto.text || fallback, actions));
  }
  const cal = data.calendar ? `
    <section class="cal-card" aria-label="Termin">
      ${icon("calendar", "Termin")}
      <div class="grow">
        <p class="cal-title">${esc7(data.calendar.summary || "Termin")}</p>
        <p class="quiet">${esc7([data.calendar.start, data.calendar.end].filter(Boolean).join(" \u2013 "))}</p>
        ${data.calendar.location ? `<p class="quiet">${esc7(data.calendar.location)}</p>` : ""}
        ${data.calendar.organizer ? `<p class="quiet">Organisiert von ${esc7(data.calendar.organizer)}</p>` : ""}
      </div>
    </section>` : "";
  const files = data.files.length ? `
    <section class="files" aria-label="Anh\xE4nge">
      <div class="files-head"><span class="mono">${data.files.length === 1 ? "1 Anhang" : `${data.files.length} Anh\xE4nge`}</span><span class="spacer"></span>
        ${data.zip && data.files.length > 1 ? `<button type="button" class="text-btn" data-action="m-zip">${icon("download-zip")}<span class="btn-label">Alle als ZIP</span></button>` : ""}
      </div>
      <ul class="file-list${data.simpleFiles ? " simple" : ""}">
        ${data.files.map((file) => `
          <li class="file">
            ${file.thumb && !data.simpleFiles ? `<button type="button" class="file-thumb" data-action="m-preview" data-index="${file.index}" aria-label="${esc7(file.name)} ansehen"><img src="${esc7(file.thumb)}" alt="" loading="lazy"></button>` : `<span class="file-icon">${icon(FILE_ICON[file.kind])}</span>`}
            <span class="file-meta">
              ${file.kind === "image" || file.kind === "pdf" || file.kind === "text" ? `<button type="button" class="file-name" data-action="m-preview" data-index="${file.index}" title="${esc7(file.name)}">${esc7(file.name)}</button>` : `<span class="file-name" title="${esc7(file.name)}">${esc7(file.name)}</span>`}
              <span class="quiet">${esc7(file.size)}</span>
            </span>
            <a class="icon-btn" href="${esc7(file.href)}" download="${esc7(file.name)}" aria-label="${esc7(file.name)} laden" title="Laden">${icon("download")}</a>
          </li>`).join("")}
      </ul>
    </section>` : "";
  body.innerHTML = `
    <div class="read-measure">
    <header class="letter-head">
      <h2 class="title">${data.flagged ? `<span class="flag-mark">${icon("flag-filled", "Markiert")}</span>` : ""}${esc7(data.subject || "(ohne Betreff)")}</h2>
      ${summary}
      ${details}
      <div class="tags">${tags}<button type="button" class="text-btn tag-add" data-action="m-tag">${icon("plus")}<span class="btn-label">Schlagwort</span></button></div>
    </header>
    ${bars.join("")}
    ${cal}
    ${files}
    </div>`;
  const frame = document.createElement("iframe");
  frame.className = "letter";
  frame.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy = "no-referrer";
  frame.title = "Brief";
  const fit = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    const height = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
    if (height) frame.style.height = `${Math.max(240, Math.ceil(height))}px`;
  };
  frame.addEventListener("load", () => {
    fit();
    const doc = frame.contentDocument;
    if (!doc) return;
    const observer = new ResizeObserver(fit);
    if (doc.documentElement) observer.observe(doc.documentElement);
    if (doc.body) observer.observe(doc.body);
    void doc.fonts?.ready.then(fit);
  });
  frame.srcdoc = data.srcdoc;
  body.querySelector(".read-measure")?.append(frame);
}
function renderBulk(body, data) {
  const b = (action, name, label2, danger = false) => `<button type="button" class="${danger ? "danger" : "text-btn"} bulk-btn" data-action="${action}">${icon(name)}<span class="btn-label">${esc7(label2)}</span></button>`;
  body.innerHTML = `
    <div class="bulk">
      <p class="title title-md">${data.count} Mails ausgew\xE4hlt</p>
      <div class="bulk-grid">
        ${b("m-read", "mark-read", "Als gelesen markieren")}
        ${b("m-unread-all", "mark-unread", "Als ungelesen markieren")}
        ${b("m-flag-all", "flag-filled", "Markieren")}
        ${b("m-unflag-all", "flag", "Markierung entfernen")}
        ${b("m-move", "move", "Verschieben \u2026")}
        ${b("m-copy", "copy", "Kopieren \u2026")}
        ${data.place.archive ? b("m-archive", "archive", "Archivieren") : ""}
        ${data.place.inSpam ? b("m-notspam", "not-spam", "Kein Spam") : data.place.spam ? b("m-spam", "spam", "Spam") : ""}
        ${b("m-forward-att", "forward-attachment", "Als Anhang weiterleiten")}
        ${data.zip ? b("m-zip-mails", "download-zip", "Als ZIP laden") : ""}
        ${b("delete", "delete", data.place.inTrash ? "Endg\xFCltig l\xF6schen" : "L\xF6schen", true)}
        ${data.place.inTrash ? "" : b("m-delete-forever", "delete-forever", "Endg\xFCltig l\xF6schen", true)}
      </div>
      <button type="button" class="text-btn" data-action="m-clear-selection">${icon("close")}<span class="btn-label">Auswahl aufheben</span></button>
    </div>`;
}

// src/contacts.ts
var PAGE = 50;
var Book = class {
  constructor(host, hooks) {
    this.host = host;
    this.hooks = hooks;
    this.host.innerHTML = this.shell();
    matchMedia("(min-width: 800px)").addEventListener("change", () => {
      if (this.host.isConnected) this.renderCard();
    });
    this.host.addEventListener("input", (event) => this.onInput(event));
    this.host.addEventListener("change", (event) => this.onChange(event));
    this.host.querySelector("#book-file")?.addEventListener("change", (event) => {
      const input2 = event.target;
      const file = input2.files?.[0];
      input2.value = "";
      if (file) void this.importFile(file);
    });
    this.renderRows();
    this.renderCard();
  }
  search = "";
  page = 1;
  count = 0;
  rows = [];
  draft = null;
  saved = "";
  checked = /* @__PURE__ */ new Set();
  anchor = -1;
  tab = "person";
  busy = false;
  request = 0;
  syncAllowed = false;
  syncMode = 0;
  timer = 0;
  setSync(allowed, mode) {
    this.syncAllowed = allowed;
    this.syncMode = mode;
    const button3 = this.host.querySelector("[data-op='sync']");
    if (button3) button3.hidden = !allowed;
  }
  async open() {
    await this.load();
    this.host.querySelector("#book-q")?.focus({ preventScroll: true });
  }
  reload() {
    return this.load();
  }
  async confirmLeave() {
    if (!this.dirty()) return true;
    const choice3 = await this.hooks.choose(
      t("GLOBAL.SAVE_CHANGES", "\xC4nderungen speichern?"),
      t("CONTACTS.UNSAVED", "Die \xC4nderungen an diesem Kontakt sind nicht gespeichert."),
      t("GLOBAL.SAVE", "Speichern"),
      t("COMPOSE.DISCARD", "Verwerfen")
    );
    if (choice3 === "cancel") return false;
    if (choice3 === "ok") return this.save();
    this.revert();
    return true;
  }
  onKey(event) {
    const key = event.key.toLowerCase();
    if (key === "a" && (event.ctrlKey || event.metaKey) || event.key === "*") {
      event.preventDefault();
      this.rows.forEach((row2) => {
        if (row2.id) this.checked.add(row2.id);
      });
      this.renderRows();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === "c" || key === "w") {
      event.preventDefault();
      this.write(false);
      return;
    }
    if (event.key === "Delete" || event.key === "#") {
      event.preventDefault();
      void this.remove();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const target = event.target;
      if (target.getAttribute("role") === "tab" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        const order = ["person", "work", "crypto"];
        const index = Math.max(0, order.indexOf(this.tab));
        const next = order[(index + (event.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
        this.tab = next;
        this.renderCard();
        this.host.querySelector(`[data-tab='${next}']`)?.focus({ preventScroll: true });
        return;
      }
      if (target.closest(".book-card")) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      this.move(event.key === "ArrowDown" ? 1 : -1);
    }
  }
  async onAction(op, target, event) {
    if (op === "more" || op === "add-menu") {
      this.toggleMenu(op === "more" ? "#book-menu" : "#book-add", target);
      return;
    }
    this.closeMenus();
    if (op === "check") {
      const mouse = event;
      this.toggleCheck(target.dataset.id || "", mouse.shiftKey);
      return;
    }
    if (op === "open") {
      await this.select(target.dataset.id || "");
      return;
    }
    if (op === "new") {
      await this.create();
      return;
    }
    if (op === "save") {
      await this.save();
      return;
    }
    if (op === "delete") {
      await this.remove();
      return;
    }
    if (op === "write") {
      this.write(false);
      return;
    }
    if (op === "write-all") {
      this.write(true);
      return;
    }
    if (op === "import") {
      this.host.querySelector("#book-file")?.click();
      return;
    }
    if (op === "sync") {
      await this.sync();
      return;
    }
    if (op === "clear-search") {
      this.setSearch("");
      return;
    }
    if (op === "page") {
      await this.turn(target.dataset.dir === "next" ? 1 : -1);
      return;
    }
    if (op === "back-list") {
      this.hooks.pane("list");
      return;
    }
    if (op === "tab") {
      this.tab = target.dataset.tab || "person";
      this.renderCard();
      this.host.querySelector(`[data-tab='${this.tab}']`)?.focus({ preventScroll: true });
      return;
    }
    if (op === "add") {
      this.addField(target.dataset.field || "");
      return;
    }
    if (op === "drop") {
      this.dropField(target.dataset.field || "", Number(target.dataset.index || 0));
      return;
    }
  }
  shell() {
    const vcf = rawPath("ContactsVcf");
    const csv = rawPath("ContactsCsv");
    return `
      <div class="book-list">
        <div class="pane-head">
          <button type="button" class="icon-btn" data-action="close-book" aria-label="${esc8(t("CONTACTS.BACK_TO_MAIL", "Zum Postfach"))}" title="${esc8(t("CONTACTS.BACK_TO_MAIL", "Zum Postfach"))}">${icon("back")}</button>
          <h1 class="title title-md">${esc8(t("GLOBAL.CONTACTS", "Kontakte"))}</h1>
          <span class="spacer"></span>
          <button type="button" class="icon-btn" data-action="book" data-op="new" aria-label="${esc8(t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzuf\xFCgen"))}" title="${esc8(t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzuf\xFCgen"))}">${icon("plus")}</button>
          <button type="button" class="icon-btn" data-action="book" data-op="write" aria-label="${esc8(t("CONTACTS.MAIL_SELECTION", "Mail an Auswahl"))}" title="${esc8(t("CONTACTS.MAIL_SELECTION", "Mail an Auswahl"))}">${icon("compose")}</button>
          <button type="button" class="icon-btn" data-action="book" data-op="delete" aria-label="${esc8(t("GLOBAL.DELETE", "L\xF6schen"))}" title="${esc8(t("GLOBAL.DELETE", "L\xF6schen"))}">${icon("delete")}</button>
          <div class="bar-more">
            <button type="button" class="icon-btn" data-action="book" data-op="more" aria-haspopup="menu" aria-expanded="false" aria-controls="book-menu" aria-label="${esc8(t("GLOBAL.MORE", "Mehr"))}" title="${esc8(t("GLOBAL.MORE", "Mehr"))}">${icon("more")}</button>
            <div class="menu menu-right" id="book-menu" role="menu" hidden>
              <button type="button" class="menu-item" role="menuitem" data-action="book" data-op="import">${icon("upload")}<span>${esc8(t("CONTACTS.BUTTON_IMPORT", "Import (csv, vcf, vCard)"))}</span></button>
              <a class="menu-item" role="menuitem" href="${esc8(vcf)}" download="contacts.vcf">${icon("download")}<span>${esc8(t("CONTACTS.BUTTON_EXPORT_VCARD", "Export (vcf, vCard)"))}</span></a>
              <a class="menu-item" role="menuitem" href="${esc8(csv)}" download="contacts.csv">${icon("download")}<span>${esc8(t("CONTACTS.BUTTON_EXPORT_CSV", "Export (csv)"))}</span></a>
              <button type="button" class="menu-item" role="menuitem" data-action="book" data-op="write-all">${icon("compose")}<span>${esc8(t("CONTACTS.SEND_TO_ALL_CONTACT_EMAILS", "An alle E-Mail-Adressen schreiben"))}</span></button>
              <button type="button" class="menu-item" role="menuitem" data-action="book" data-op="sync" hidden>${icon("refresh")}<span>${esc8(t("CONTACTS.SYNC_NOW", "Jetzt synchronisieren"))}</span></button>
            </div>
          </div>
        </div>
        <form class="search-wrap" data-action="book-search">
          <label class="sr" for="book-q">${esc8(t("GLOBAL.SEARCH", "Suchen"))}</label>
          <input class="search" id="book-q" type="search" placeholder="${esc8(t("GLOBAL.SEARCH", "Suchen"))}" autocomplete="off">
          <button type="button" class="icon-btn" data-action="book" data-op="clear-search" hidden aria-label="${esc8(t("CONTACTS.CLEAR_SEARCH", "Suche leeren"))}">${icon("close")}</button>
        </form>
        <p class="error" id="book-error" hidden></p>
        <div class="pane-body" id="book-rows"></div>
        <div class="book-pager" id="book-pager"></div>
      </div>
      <div class="book-card">
        <div id="book-card"></div>
      </div>
      <p class="sr" id="book-live" aria-live="polite"></p>
      <input id="book-file" type="file" accept=".csv,.vcf,.vcard,text/csv,text/vcard,text/x-vcard" hidden>`;
  }
  async load() {
    const ticket = ++this.request;
    this.busy = true;
    this.note("");
    try {
      const result = await call("Contacts", {
        Search: this.search,
        Offset: (this.page - 1) * PAGE,
        Limit: PAGE
      });
      if (ticket !== this.request) return;
      const list = Array.isArray(result.List) ? result.List : result.List ? Object.values(result.List) : [];
      this.rows = list.map((item) => parseCard(item));
      this.count = Number(result.Count || 0);
      const pages = Math.max(1, Math.ceil(this.count / PAGE));
      if (this.page > pages) {
        this.page = pages;
        await this.load();
        return;
      }
      if (this.draft?.id && !this.rows.some((row2) => row2.id === this.draft?.id) && !this.dirty()) this.draft = null;
      this.checked.forEach((id) => {
        if (!this.rows.some((row2) => row2.id === id)) this.checked.delete(id);
      });
    } catch (error) {
      if (ticket !== this.request) return;
      this.rows = [];
      this.count = 0;
      this.fail(error);
    } finally {
      if (ticket === this.request) {
        this.busy = false;
        this.renderRows();
        this.renderPager();
        if (!this.draft) this.renderCard();
      }
    }
  }
  async select(id) {
    if (this.draft?.id === id && id) {
      if (!this.hooks.wide()) this.hooks.pane("reader");
      return;
    }
    if (!await this.confirmLeave()) return;
    const row2 = this.rows.find((item) => item.id === id);
    this.draft = row2 ? clone(row2) : null;
    this.tab = "person";
    this.remember();
    this.renderRows();
    this.renderCard();
    if (!this.hooks.wide()) this.hooks.pane("reader");
    this.host.querySelector(".book-card input, .book-card button")?.focus({ preventScroll: true });
  }
  async create() {
    if (!await this.confirmLeave()) return;
    this.draft = blankCard();
    this.tab = "person";
    this.remember();
    this.renderRows();
    this.renderCard();
    if (!this.hooks.wide()) this.hooks.pane("reader");
    this.host.querySelector("[data-field='given']")?.focus({ preventScroll: true });
  }
  dirty() {
    return Boolean(this.draft) && JSON.stringify(toJCard(this.draft)) !== this.saved;
  }
  remember() {
    this.saved = this.draft ? JSON.stringify(toJCard(this.draft)) : "";
  }
  /** Verwirft ungespeicherte Eingaben und stellt den zuletzt geladenen Kontakt her. */
  revert() {
    if (!this.draft?.id) {
      this.draft = null;
      this.saved = "";
      this.renderCard();
      return;
    }
    const row2 = this.rows.find((item) => item.id === this.draft?.id);
    this.draft = row2 ? clone(row2) : null;
    this.remember();
    this.renderCard();
  }
  async save() {
    const card = this.draft;
    if (!card || card.readOnly) return false;
    if (!displayName2(card)) {
      this.fail(new ApiError(0, t("CONTACTS.NEED_NAME", "Name oder E-Mail eintragen.")));
      return false;
    }
    this.busy = true;
    try {
      const result = await call("ContactSave", {
        uid: card.id,
        jCard: toJCard(card)
      });
      if (result.Result === false) throw new ApiError(1, t("CONTACTS.ERROR_SAVE", "Der Kontakt konnte nicht gespeichert werden."));
      card.id = String(result.ResultID || card.id);
      card.source = toJCard(card);
      this.remember();
      this.live(t("CONTACTS.SAVED", "Gespeichert"));
      await this.load();
      const fresh = this.rows.find((row2) => row2.id === card.id);
      if (fresh) this.draft = clone(fresh);
      this.remember();
      this.renderCard();
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    } finally {
      this.busy = false;
    }
  }
  targets() {
    const picked = this.rows.filter((row2) => row2.id && this.checked.has(row2.id));
    if (picked.length) return picked;
    return this.draft ? [this.draft] : [];
  }
  async remove() {
    const rows2 = this.targets().filter((row2) => row2.id && !row2.readOnly);
    if (!rows2.length || this.busy) return;
    const what = rows2.length === 1 ? t("CONTACTS.DELETE_ONE", "%NAME% wird aus dem Adressbuch entfernt.").replace("%NAME%", displayName2(rows2[0]) || t("CONTACTS.THIS_CONTACT", "Dieser Kontakt")) : t("CONTACTS.DELETE_MANY", "%N% Kontakte werden aus dem Adressbuch entfernt.").replace("%N%", String(rows2.length));
    const ok = await this.hooks.confirm(t("CONTACTS.DELETE_TITLE", "Kontakte l\xF6schen?"), what, t("GLOBAL.DELETE", "L\xF6schen"));
    if (!ok) return;
    this.busy = true;
    try {
      await call("ContactsDelete", { uids: rows2.map((row2) => row2.id).join(",") });
      rows2.forEach((row2) => this.checked.delete(row2.id));
      if (this.draft && rows2.some((row2) => row2.id === this.draft?.id)) this.draft = null;
      this.live(rows2.length === 1 ? t("CONTACTS.DELETED_ONE", "Kontakt gel\xF6scht.") : t("CONTACTS.DELETED_MANY", "%N% Kontakte gel\xF6scht.").replace("%N%", String(rows2.length)));
      await this.load();
      this.renderCard();
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
  }
  write(all) {
    const lines = [];
    this.targets().forEach((card) => {
      const emails = card.emails.map((item) => item.trim()).filter(Boolean);
      const use = all || card.sendAll ? emails : emails.slice(0, 1);
      const name = displayName2(card);
      use.forEach((email) => lines.push(formatAddress(name, email)));
    });
    if (!lines.length) {
      this.live(t("CONTACTS.NO_EMAIL", "Keine E-Mail-Adresse in der Auswahl."));
      return;
    }
    this.hooks.compose(lines.join(", "));
  }
  async importFile(file) {
    this.busy = true;
    this.note("");
    try {
      const count = await uploadContacts(file);
      this.live(t("CONTACTS.IMPORT_OK", "%N% Kontakte \xFCbernommen.").replace("%N%", String(count)));
      this.page = 1;
      await this.load();
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
  }
  async sync() {
    if (!this.syncAllowed) return;
    if (!this.syncMode) {
      this.live(t("CONTACTS.SYNC_OFF", "Die Synchronisierung ist in den Einstellungen aus."));
      return;
    }
    this.busy = true;
    this.note("");
    try {
      await syncContacts();
      this.live(t("CONTACTS.SYNC_OK", "Synchronisiert."));
      await this.load();
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
  }
  setSearch(value) {
    this.search = value;
    const input2 = this.host.querySelector("#book-q");
    if (input2 && input2.value !== value) input2.value = value;
    const clear = this.host.querySelector("[data-op='clear-search']");
    if (clear) clear.hidden = !value;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.page = 1;
      void this.load();
    }, 250);
  }
  async turn(dir) {
    const pages = Math.max(1, Math.ceil(this.count / PAGE));
    const next = Math.min(pages, Math.max(1, this.page + dir));
    if (next === this.page) return;
    if (!await this.confirmLeave()) return;
    this.page = next;
    this.draft = null;
    await this.load();
    this.renderCard();
    this.host.querySelector("[data-op='open']")?.focus({ preventScroll: true });
  }
  move(dir) {
    if (!this.rows.length) return;
    const index = this.rows.findIndex((row2) => row2.id === this.draft?.id);
    const next = this.rows[Math.min(this.rows.length - 1, Math.max(0, index + dir))];
    if (next) void this.select(next.id);
  }
  toggleCheck(id, range) {
    if (!id) return;
    const ids = this.rows.map((row2) => row2.id);
    const index = ids.indexOf(id);
    if (range && this.anchor >= 0 && index >= 0) {
      const [from, to] = [this.anchor, index].sort((a, b) => a - b);
      for (let cursor = from; cursor <= to; cursor += 1) if (ids[cursor]) this.checked.add(ids[cursor]);
    } else if (this.checked.has(id)) this.checked.delete(id);
    else this.checked.add(id);
    this.anchor = index;
    this.renderRows();
  }
  addField(field2) {
    const card = this.draft;
    if (!card || card.readOnly) return;
    if (field2 === "email") card.emails.push("");
    else if (field2 === "phone") card.phones = (card.phones || []).concat("");
    else if (field2 === "url") card.urls = (card.urls || []).concat("");
    else if (field2 === "address") card.addresses = (card.addresses || []).concat(emptyAddress());
    else if (field2 === "nickname") card.nickname = card.nickname ?? "";
    else if (field2 === "note") card.note = card.note ?? "";
    else if (field2 === "birthday") card.birthday = card.birthday ?? "";
    else if (field2 === "tags") card.tags = card.tags ?? "";
    this.tab = field2 === "tags" ? "person" : this.tab;
    this.renderCard();
    const selector = field2 === "address" ? "[data-field='street']" : `[data-field='${field2 === "phone" ? "phone" : field2 === "email" ? "email" : field2}']`;
    const nodes = this.host.querySelectorAll(selector);
    nodes[nodes.length - 1]?.focus({ preventScroll: true });
  }
  dropField(field2, index) {
    const card = this.draft;
    if (!card || card.readOnly) return;
    if (field2 === "email") {
      card.emails.splice(index, 1);
      if (!card.emails.length) card.emails = [""];
    } else if (field2 === "phone" && card.phones) {
      card.phones.splice(index, 1);
      if (!card.phones.length) card.phones = null;
    } else if (field2 === "url" && card.urls) {
      card.urls.splice(index, 1);
      if (!card.urls.length) card.urls = null;
    } else if (field2 === "address" && card.addresses) {
      card.addresses.splice(index, 1);
      if (!card.addresses.length) card.addresses = null;
    } else if (field2 === "nickname") card.nickname = null;
    else if (field2 === "note") card.note = null;
    else if (field2 === "birthday") card.birthday = null;
    else if (field2 === "tags") card.tags = null;
    this.renderCard();
  }
  onInput(event) {
    const input2 = event.target;
    if (input2.id === "book-q") {
      this.setSearch(input2.value);
      return;
    }
    this.patch(input2);
  }
  onChange(event) {
    const input2 = event.target;
    if (input2.dataset.field) this.patch(input2);
  }
  patch(input2) {
    const card = this.draft;
    const field2 = input2.dataset.field || "";
    if (!card || !field2) return;
    const index = Number(input2.dataset.index || 0);
    const value = input2.value;
    if (field2 === "given") card.given = value;
    else if (field2 === "middle") card.middle = value;
    else if (field2 === "surname") card.surname = value;
    else if (field2 === "prefix") card.prefix = value;
    else if (field2 === "suffix") card.suffix = value;
    else if (field2 === "nickname") card.nickname = value;
    else if (field2 === "note") card.note = value;
    else if (field2 === "birthday") card.birthday = value;
    else if (field2 === "org") card.org = value;
    else if (field2 === "department") card.department = value;
    else if (field2 === "title") card.title = value;
    else if (field2 === "tags") card.tags = value;
    else if (field2 === "email") card.emails[index] = value;
    else if (field2 === "phone" && card.phones) card.phones[index] = value;
    else if (field2 === "url" && card.urls) card.urls[index] = value;
    else if (field2 === "sign" || field2 === "encrypt") card[field2] = value;
    else if (card.addresses && ["pobox", "ext", "street", "locality", "region", "code", "country"].includes(field2)) {
      card.addresses[index][field2] = value;
    } else if (field2 === "send-all") card.sendAll = input2.checked;
    if (["given", "middle", "surname", "prefix", "suffix", "nickname", "email"].includes(field2)) this.renderRows();
  }
  renderRows() {
    const box = this.host.querySelector("#book-rows");
    const clear = this.host.querySelector("[data-op='clear-search']");
    if (clear) clear.hidden = !this.search;
    if (!box) return;
    if (!this.rows.length && !this.busy) {
      const empty = this.search ? t("CONTACTS.EMPTY_SEARCH", "Keine Kontakte gefunden") : t("CONTACTS.EMPTY_LIST", "Keine Kontakte");
      box.innerHTML = `<div class="empty"><span class="icon icon-lg">${icon("contacts")}</span><p>${esc8(empty)}</p>${this.search ? "" : `<button type="button" class="ink-btn" data-action="book" data-op="new">${icon("plus")}<span class="btn-label">${esc8(t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzuf\xFCgen"))}</span></button>`}</div>`;
      return;
    }
    if (!this.rows.length) {
      box.innerHTML = `<p class="quiet">${esc8(t("GLOBAL.LOADING", "Wird geladen"))} \u2026</p>`;
      return;
    }
    box.innerHTML = `<div class="book-rows" role="list">${this.rows.map((row2) => {
      const shown = this.draft?.id === row2.id ? this.draft : row2;
      const name = displayName2(shown) || t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt");
      const mail = shown.emails.find((item) => item.trim()) || "";
      const current = this.draft?.id === row2.id;
      const on2 = this.checked.has(row2.id);
      return `<div class="book-row" role="listitem"${current ? ` aria-current="true"` : ""}>
        <label class="book-check"><input type="checkbox" data-action="book" data-op="check" data-id="${esc8(row2.id)}"${on2 ? " checked" : ""} aria-label="${esc8(t("CONTACTS.SELECT", "Ausw\xE4hlen: %NAME%").replace("%NAME%", name))}"></label>
        <button type="button" class="book-open" data-action="book" data-op="open" data-id="${esc8(row2.id)}">
          <strong>${esc8(name)}</strong>
          ${mail ? `<span class="quiet">${esc8(mail)}</span>` : ""}
        </button>
      </div>`;
    }).join("")}</div>`;
  }
  renderPager() {
    const box = this.host.querySelector("#book-pager");
    if (!box) return;
    const pages = Math.max(1, Math.ceil(this.count / PAGE));
    if (pages < 2) {
      box.innerHTML = "";
      box.setAttribute("hidden", "");
      return;
    }
    box.removeAttribute("hidden");
    const label2 = t("CONTACTS.PAGE_STATUS", "Seite %P% von %N%").replace("%P%", String(this.page)).replace("%N%", String(pages));
    box.innerHTML = `
      <button type="button" class="text-btn" data-action="book" data-op="page" data-dir="prev"${this.page <= 1 ? " disabled" : ""}>${icon("chevron-left")}<span class="btn-label">${esc8(t("GLOBAL.BACK", "Zur\xFCck"))}</span></button>
      <span class="quiet">${esc8(label2)}</span>
      <button type="button" class="text-btn" data-action="book" data-op="page" data-dir="next"${this.page >= pages ? " disabled" : ""}><span class="btn-label">${esc8(t("CONTACTS.NEXT_PAGE", "Weiter"))}</span>${icon("chevron-right")}</button>`;
  }
  renderCard() {
    const box = this.host.querySelector("#book-card");
    if (!box) return;
    const card = this.draft;
    if (!card) {
      box.innerHTML = `<div class="empty"><span class="icon icon-lg">${icon("contacts")}</span><p>${esc8(t("CONTACTS.CONTACT_VIEW_DESC", "Kontakt aus der Liste w\xE4hlen, um ihn anzuzeigen."))}</p></div>`;
      return;
    }
    const lock = card.readOnly;
    const dis = lock ? " disabled" : "";
    const canEdit = !lock;
    const back = this.hooks.wide() ? "" : `<button type="button" class="icon-btn" data-action="book" data-op="back-list" aria-label="${esc8(t("GLOBAL.BACK", "Zur\xFCck"))}">${icon("back")}</button>`;
    const heading = displayName2(card) || t("CONTACTS.BUTTON_CREATE_CONTACT", "Kontakt anlegen");
    box.innerHTML = `
      <div class="book-card-head">
        ${back}
        <h2 class="title title-md">${esc8(heading)}</h2>
        ${lock ? `<p class="quiet">${esc8(t("CONTACTS.LABEL_READ_ONLY", "Schreibgesch\xFCtzt"))}</p>` : `<button type="button" class="ink-btn" data-action="book" data-op="save">${icon("save")}<span class="btn-label">${esc8(card.id ? t("GLOBAL.SAVE", "Speichern") : t("CONTACTS.BUTTON_CREATE_CONTACT", "Kontakt anlegen"))}</span></button>`}
      </div>
      <div class="book-tabs" role="tablist" aria-label="${esc8(t("GLOBAL.CONTACTS", "Kontakte"))}">
        ${this.tabButton("person", t("CONTACTS.TAB_CONTACT", "Kontakt"))}
        ${this.tabButton("work", t("CONTACTS.TAB_BUSINESS", "Unternehmen"))}
        ${this.tabButton("crypto", t("CONTACTS.TAB_CRYPTO", "Verschl\xFCsselung"))}
      </div>
      <div class="book-panels">
        <div role="tabpanel" id="book-panel-person" ${this.tab === "person" ? "" : "hidden"}>
          ${this.text("prefix", t("CONTACTS.NAME_PREFIX", "Vorsatz"), card.prefix, "honorific-prefix", dis)}
          ${this.text("given", t("CONTACTS.FIRST_NAME", "Vorname"), card.given, "given-name", dis)}
          ${this.text("middle", t("CONTACTS.MIDDLE_NAME", "Weiterer Vorname"), card.middle, "additional-name", dis)}
          ${this.text("surname", t("CONTACTS.LAST_NAME", "Nachname"), card.surname, "family-name", dis)}
          ${this.text("suffix", t("CONTACTS.NAME_SUFFIX", "Nachsatz"), card.suffix, "honorific-suffix", dis)}
          ${card.nickname == null ? "" : this.text("nickname", t("CONTACTS.NICK_NAME", "Spitzname"), card.nickname, "nickname", dis, canEdit)}
          <fieldset class="book-group">
            <legend class="mono">${esc8(t("GLOBAL.EMAIL", "E-Mail"))}</legend>
            <label class="check"><input type="checkbox" data-field="send-all"${card.sendAll ? " checked" : ""}${dis}> ${esc8(t("CONTACTS.SEND_TO_ALL_CONTACT_EMAILS", "An alle E-Mail-Adressen schreiben"))}</label>
            ${card.emails.map((value, index) => this.row("email", value, index, "email", dis, canEdit && card.emails.length > 1)).join("")}
          </fieldset>
          ${card.phones ? this.group(t("CONTACTS.ADD_MENU_PHONE", "Telefon"), card.phones.map((value, index) => this.row("phone", value, index, "tel", dis, canEdit)).join("")) : ""}
          ${card.urls ? this.group(t("CONTACTS.ADD_MENU_URL", "URL"), card.urls.map((value, index) => this.row("url", value, index, "url", dis, canEdit)).join("")) : ""}
          ${card.addresses ? card.addresses.map((item, index) => this.address(item, index, dis, canEdit)).join("") : ""}
          ${card.birthday == null ? "" : this.text("birthday", t("CONTACTS.LABEL_BIRTHDAY", "Geburtstag"), card.birthday, "bday", dis, canEdit, "date")}
          ${card.note == null ? "" : this.area("note", t("CONTACTS.ADD_MENU_NOTE", "Anmerkung"), card.note, dis, canEdit)}
          ${card.tags == null ? "" : this.text("tags", t("CONTACTS.ADD_MENU_TAGS", "Schlagw\xF6rter"), card.tags, "off", dis, canEdit)}
        </div>
        <div role="tabpanel" id="book-panel-work" ${this.tab === "work" ? "" : "hidden"}>
          ${this.text("org", t("CONTACTS.LABEL_ORGANIZATION", "Organisation"), card.org, "organization", dis)}
          ${this.text("department", t("CONTACTS.LABEL_DEPARTMENT", "Abteilung"), card.department, "organization", dis)}
          ${this.text("title", t("CONTACTS.LABEL_TITLE", "Titel"), card.title, "organization-title", dis)}
        </div>
        <div role="tabpanel" id="book-panel-crypto" ${this.tab === "crypto" ? "" : "hidden"}>
          ${this.crypto("sign", t("CRYPTO.SIGN", "Unterschreiben"), card.sign, dis)}
          ${this.crypto("encrypt", t("CRYPTO.ENCRYPT", "Verschl\xFCsseln"), card.encrypt, dis)}
        </div>
      </div>
      ${lock ? "" : `<div class="book-add bar-more">
        <button type="button" class="text-btn" data-action="book" data-op="add-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="book-add">${icon("plus")}<span class="btn-label">${esc8(t("CONTACTS.ADD_MENU_LABEL", "Hinzuf\xFCgen"))}</span></button>
        <div class="menu" id="book-add" role="menu" hidden>
          ${card.nickname == null ? this.addItem("nickname", t("CONTACTS.ADD_MENU_NICKNAME", "Spitzname")) : ""}
          ${this.addItem("email", t("GLOBAL.EMAIL", "E-Mail"))}
          ${this.addItem("phone", t("CONTACTS.ADD_MENU_PHONE", "Telefon"))}
          ${this.addItem("url", t("CONTACTS.ADD_MENU_URL", "URL"))}
          ${this.addItem("address", t("CONTACTS.ADD_MENU_ADDRESS", "Adresse"))}
          ${card.birthday == null ? this.addItem("birthday", t("CONTACTS.ADD_MENU_BIRTHDAY", "Geburtstag")) : ""}
          ${card.note == null ? this.addItem("note", t("CONTACTS.ADD_MENU_NOTE", "Anmerkung")) : ""}
          ${card.tags == null ? this.addItem("tags", t("CONTACTS.ADD_MENU_TAGS", "Schlagw\xF6rter")) : ""}
        </div>
      </div>`}`;
  }
  tabButton(id, label2) {
    const on2 = this.tab === id;
    return `<button type="button" role="tab" id="book-tab-${id}" aria-controls="book-panel-${id}" aria-selected="${on2 ? "true" : "false"}" tabindex="${on2 ? "0" : "-1"}" data-action="book" data-op="tab" data-tab="${id}">${esc8(label2)}</button>`;
  }
  text(field2, label2, value, auto, dis, drop = false, type = "text") {
    return `<label class="field"><span>${esc8(label2)}</span><span class="book-line"><input data-field="${field2}" type="${type}" value="${esc8(value)}" autocomplete="${esc8(auto)}"${dis}>${drop ? this.drop(field2, 0, label2) : ""}</span></label>`;
  }
  area(field2, label2, value, dis, drop) {
    return `<label class="field"><span>${esc8(label2)}</span><span class="book-line"><textarea data-field="${field2}"${dis}>${esc8(value)}</textarea>${drop ? this.drop(field2, 0, label2) : ""}</span></label>`;
  }
  row(field2, value, index, auto, dis, drop) {
    const type = field2 === "email" ? "email" : field2 === "phone" ? "tel" : field2 === "url" ? "url" : "text";
    return `<span class="book-line"><input data-field="${field2}" data-index="${index}" type="${type}" value="${esc8(value)}" autocomplete="${auto}"${field2 === "url" ? ` placeholder="https://"` : ""}${dis}>${drop ? this.drop(field2, index, field2) : ""}</span>`;
  }
  address(item, index, dis, drop) {
    const line2 = (field2, label2, auto) => `<label class="field"><span>${esc8(label2)}</span><input data-field="${field2}" data-index="${index}" type="text" value="${esc8(item[field2])}" autocomplete="${auto}"${dis}></label>`;
    return `<fieldset class="book-group"><legend class="mono">${esc8(t("CONTACTS.ADD_MENU_ADDRESS", "Adresse"))}</legend>
      ${line2("street", t("CONTACTS.STREET", "Stra\xDFe"), "street-address")}
      ${line2("ext", t("CONTACTS.EXT", "Adresszusatz"), "off")}
      ${line2("code", t("CONTACTS.POSTCODE", "Postleitzahl"), "postal-code")}
      ${line2("locality", t("CONTACTS.LOCALITY", "Ort"), "address-level2")}
      ${line2("region", t("CONTACTS.REGION", "Region"), "address-level1")}
      ${line2("country", t("CONTACTS.COUNTRY", "Land"), "country-name")}
      ${line2("pobox", t("CONTACTS.POBOX", "Postfach"), "off")}
      ${drop ? this.drop("address", index, t("CONTACTS.ADD_MENU_ADDRESS", "Adresse")) : ""}
    </fieldset>`;
  }
  crypto(field2, label2, value, dis) {
    const options2 = [
      ["Ask", t("CONTACTS.ASK", "Fragen")],
      ["IfPossible", t("CONTACTS.ALWAYS_IF_POSSIBLE", "Wenn m\xF6glich")],
      ["Always", t("CONTACTS.ALWAYS", "Immer")],
      ["Never", t("CONTACTS.NEVER", "Niemals")]
    ];
    return `<label class="field"><span>${esc8(label2)}</span><select data-field="${field2}"${dis}>${options2.map(([id, text2]) => `<option value="${id}"${id === value ? " selected" : ""}>${esc8(text2)}</option>`).join("")}</select></label>`;
  }
  group(legend, inner) {
    return `<fieldset class="book-group"><legend class="mono">${esc8(legend)}</legend>${inner}</fieldset>`;
  }
  addItem(field2, label2) {
    return `<button type="button" class="menu-item" role="menuitem" data-action="book" data-op="add" data-field="${field2}">${icon("plus")}<span>${esc8(label2)}</span></button>`;
  }
  drop(field2, index, label2) {
    return `<button type="button" class="icon-btn" data-action="book" data-op="drop" data-field="${field2}" data-index="${index}" aria-label="${esc8(t("CONTACTS.REMOVE_FIELD", "Feld entfernen") + ": " + label2)}">${icon("minus")}</button>`;
  }
  toggleMenu(selector, source) {
    const menu = this.host.querySelector(selector);
    if (!menu) return;
    const open = menu.hidden;
    this.closeMenus();
    menu.hidden = !open;
    source.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) menu.querySelector("[role='menuitem']")?.focus({ preventScroll: true });
  }
  closeMenus() {
    this.host.querySelectorAll("#book-menu, #book-add").forEach((menu) => {
      menu.hidden = true;
    });
    this.host.querySelectorAll("[data-op='more'], [data-op='add-menu']").forEach((button3) => button3.setAttribute("aria-expanded", "false"));
  }
  note(text2) {
    const slot = this.host.querySelector("#book-error");
    if (!slot) return;
    slot.hidden = !text2;
    slot.textContent = text2;
  }
  fail(error) {
    const text2 = error instanceof ApiError && error.code === 0 ? error.message : explain(error);
    this.note(text2);
  }
  live(text2) {
    this.note("");
    const slot = this.host.querySelector("#book-live");
    if (slot) slot.textContent = text2;
  }
};
function emptyAddress() {
  return { pobox: "", ext: "", street: "", locality: "", region: "", code: "", country: "" };
}
function clone(card) {
  return {
    ...card,
    emails: card.emails.slice(),
    phones: card.phones ? card.phones.slice() : null,
    urls: card.urls ? card.urls.slice() : null,
    addresses: card.addresses ? card.addresses.map((item) => ({ ...item })) : null,
    source: card.source
  };
}
function esc8(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function mountBook(host, hooks) {
  return new Book(host, hooks);
}

// src/view.ts
var SORTS = [
  ["", "MESSAGE_LIST.SORT_DATE_DESC", "Datum absteigend"],
  ["DATE", "MESSAGE_LIST.SORT_DATE_ASC", "Datum aufsteigend"],
  ["FROM", "MESSAGE_LIST.SORT_FROM_ASC", "Von A-Z"],
  ["REVERSE FROM", "MESSAGE_LIST.SORT_FROM_DESC", "Von Z-A"],
  ["REVERSE SIZE", "MESSAGE_LIST.SORT_SIZE_DESC", "Gr\xF6\xDFe absteigend"],
  ["SIZE", "MESSAGE_LIST.SORT_SIZE_ASC", "Gr\xF6\xDFe aufsteigend"],
  ["SUBJECT", "MESSAGE_LIST.SORT_SUBJECT_ASC", "Betreff A-Z"],
  ["REVERSE SUBJECT", "MESSAGE_LIST.SORT_SUBJECT_DESC", "Betreff Z-A"],
  ["REVERSE ARRIVAL", "MESSAGE_LIST.SORT_ARRIVAL_DESC", "Eingang absteigend"],
  ["ARRIVAL", "MESSAGE_LIST.SORT_ARRIVAL_ASC", "Eingang aufsteigend"]
];
var CATEGORY = {
  needs_reply: "Antwort n\xF6tig",
  personal: "F\xFCr mich",
  newsletter: "Newsletter",
  notification: "Benachrichtigungen",
  invoice: "Rechnungen"
};
function categoryMark(category) {
  if (!category || !CATEGORY[category]) return "";
  const mark = category === "needs_reply" ? `<i class="wait" aria-hidden="true"></i>` : "";
  return `<span class="cat">${mark}${esc9(t("AI_COPILOT.CAT_" + category.toUpperCase(), CATEGORY[category]))}</span>`;
}
function rowMarks(row2) {
  const marks = [
    [row2.attachment, "attachment", "Mit Anhang"],
    [row2.answered, "answered", "Beantwortet"],
    [row2.forwarded, "forwarded", "Weitergeleitet"],
    [row2.flagged, "flag-filled", "Markiert"]
  ];
  const html = marks.filter(([on2]) => on2).map(([, name, label2]) => icon(name, label2)).join("");
  return html ? `<span class="marks">${html}</span>` : "";
}
function esc9(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function withIcon(name, label2) {
  return `${icon(name)}<span class="btn-label">${esc9(label2)}</span>`;
}
function withAssist(label2) {
  return `${withIcon("assist", label2)}<span class="ai-tag" aria-hidden="true">KI</span>`;
}
var ROLE_ICON2 = {
  inbox: "inbox",
  sent: "sent",
  drafts: "drafts",
  trash: "trash",
  archive: "archive",
  junk: "spam",
  spam: "spam"
};
function createView(root3, actions) {
  let shell = null;
  let opener = null;
  let section = "look";
  let edit = null;
  let snap = null;
  let composer = null;
  let book = null;
  let composePrefs = {
    editor: "Plain",
    markdown: false,
    spellcheck: false,
    autosave: true,
    draftsFolder: "",
    sentFolder: "",
    replySameFolder: false,
    attachmentLimit: 0,
    readReceipt: false,
    dsn: false,
    requireTLS: false,
    pgpSign: false,
    pgpEncrypt: false,
    gnupg: false
  };
  let composeIdentities = [];
  const wide = () => matchMedia("(min-width: 800px)").matches;
  const docked = () => matchMedia("(min-width: 1280px)").matches;
  function chooseDialog(title, text2, ok, alt = "", danger = true) {
    const dialog = shell?.querySelector("#confirm");
    if (!dialog) return Promise.resolve("cancel");
    dialog.querySelector("#confirm-title").textContent = title;
    const body = dialog.querySelector("#confirm-text");
    body.hidden = !text2;
    body.textContent = text2;
    const accept = dialog.querySelector("#confirm-ok");
    accept.className = danger ? "danger" : "ink-btn";
    accept.innerHTML = withIcon(danger ? "delete" : "check", ok);
    const other = dialog.querySelector("#confirm-alt");
    other.hidden = !alt;
    other.textContent = alt;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        const value = dialog.returnValue;
        resolve(value === "ok" || value === "alt" ? value : "cancel");
      }, { once: true });
    });
  }
  async function closeBook() {
    if (shell?.dataset.surface !== "contacts") return true;
    if (book && !await book.confirmLeave()) return false;
    if (!shell) return true;
    shell.dataset.surface = "mail";
    const node = shell.querySelector("#book");
    if (node) node.hidden = true;
    shell.querySelectorAll("[data-action='open-book']").forEach((button3) => button3.setAttribute("aria-pressed", "false"));
    return true;
  }
  async function openBook() {
    if (!shell) return;
    if (shell.dataset.full === "true") toggleFullscreen(false);
    if (!docked()) setSidebar(false);
    shell.dataset.surface = "contacts";
    const node = shell.querySelector("#book");
    if (node) node.hidden = false;
    shell.querySelectorAll("[data-action='open-book']").forEach((button3) => button3.setAttribute("aria-pressed", "true"));
    if (!wide()) pane("list");
    await book?.open();
    shell.querySelector("#book-q")?.focus({ preventScroll: true });
  }
  const showLogin = (title, options2) => {
    document.title = title;
    const languages = options2?.languages || {};
    const codes = Object.keys(languages);
    const langField = options2 && codes.length ? `<label class="field"><span>${esc9(t("GLOBAL.LANGUAGE", "Sprache"))}</span><select name="language">${codes.map((code) => `<option value="${esc9(code)}"${code === options2.language ? " selected" : ""}>${esc9(languages[code] || code)}</option>`).join("")}</select></label>` : "";
    const codeField = options2?.twoFactor ? `<label class="field"><span>${esc9(t("LOGIN.TWO_FACTOR", "Code"))}</span><input name="totp" inputmode="numeric" autocomplete="one-time-code"></label>` : "";
    root3.innerHTML = `
      <main class="login">
        <form class="login-card" novalidate>
          <h1 class="title">${esc9(title)}</h1>
          ${langField}
          <label class="field"><span>${esc9(t("GLOBAL.EMAIL", "E-Mail"))}</span>
            <input name="email" type="email" autocomplete="email" inputmode="email" required>
          </label>
          <p class="error" data-for="email" hidden></p>
          <label class="field"><span>${esc9(t("GLOBAL.PASSWORD", "Passwort"))}</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <p class="error" data-for="password" hidden></p>
          ${codeField}
          <label class="stay"><input name="stay" type="checkbox"> ${esc9(t("LOGIN.LABEL_SIGN_ME", "Anmeldung merken"))}</label>
          <p class="error" data-for="form" hidden></p>
          <button type="submit" class="ink-btn">${esc9(t("LOGIN.BUTTON_SIGN_IN", "Anmelden"))}</button>
        </form>
      </main>`;
    const form2 = root3.querySelector("form");
    form2.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form2);
      actions.login(String(data.get("email") || ""), String(data.get("password") || ""), data.get("stay") === "on", String(data.get("totp") || ""));
    });
    form2.querySelector("select[name='language']")?.addEventListener("change", (event) => {
      actions.act("login-lang", { language: event.target.value });
    });
  };
  const setLoginBusy = (busy) => {
    const button3 = root3.querySelector(".login-card button");
    if (button3) button3.disabled = busy;
  };
  const setLoginError = (text2) => {
    const slot = root3.querySelector("[data-for='form']");
    if (!slot) return;
    slot.hidden = !text2;
    slot.textContent = text2;
  };
  const showMail = (email, folderName, assist) => {
    root3.innerHTML = `
      <div class="shell" data-pane="list" data-layout="1" data-surface="mail" data-sidebar="${docked() ? "open" : "closed"}">
        <button type="button" class="scrim" data-action="close-sidebar" aria-label="Ordner schlie\xDFen"></button>
        <aside class="sidebar" aria-label="Ordner">
          <div class="account">
            <button type="button" class="account-btn" data-action="account" aria-expanded="false" aria-controls="account-menu" aria-haspopup="menu"></button>
            <div class="menu" id="account-menu" role="menu" hidden>
              <div id="account-list"></div>
              <button type="button" class="menu-item" role="menuitem" data-action="open-book" data-book-entry hidden>${icon("contacts")}<span>${esc9(t("GLOBAL.CONTACTS", "Kontakte"))}</span></button>
              <button type="button" class="menu-item" role="menuitem" data-action="settings">${icon("settings")}<span>${esc9(t("GLOBAL.SETTINGS", "Einstellungen"))}</span></button>
              <button type="button" class="menu-item" role="menuitem" data-action="logout">${icon("logout")}<span>${esc9(t("GLOBAL.LOGOUT", "Abmelden"))}</span></button>
            </div>
          </div>
          <p class="group-label mono">${esc9(t("FOLDERS_UI.FOLDERS", "Ordner"))}</p>
          <div class="folder-filter" hidden>
            <label class="sr" for="folder-q">${esc9(t("FOLDERS_UI.FILTER", "Ordner suchen"))}</label>
            <input class="search" id="folder-q" type="search" placeholder="${esc9(t("FOLDERS_UI.FILTER", "Ordner suchen"))}" autocomplete="off">
          </div>
          <div id="folder-tree" class="folder-tree"></div>
          <button type="button" class="folder book-entry" data-action="open-book" data-book-entry hidden aria-pressed="false">${icon("contacts")}<span class="folder-name">${esc9(t("GLOBAL.CONTACTS", "Kontakte"))}</span></button>
          <div class="sidebar-foot">
            <button type="button" class="text-btn" data-action="f-create" hidden>${withIcon("folder-plus", t("SETTINGS_FOLDERS.BUTTON_CREATE", "Ordner anlegen"))}</button>
            <div id="quota" class="quota"></div>
          </div>
          <ul class="menu folder-menu" id="folder-menu" role="menu" aria-label="${esc9(t("FOLDERS_UI.ACTIONS", "Ordneraktionen"))}" hidden></ul>
        </aside>
        <section class="list-pane" aria-label="Mails">
          <div class="pane-head">
            <button type="button" class="icon-btn" data-action="toggle-sidebar" aria-label="Ordner ein- oder ausblenden">${icon("menu")}</button>
            <h1 class="title title-md" id="folder-title"></h1>
            <span class="spacer"></span>
            <div class="bar-more view-more">
              <button type="button" class="icon-btn" data-action="view-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="view-menu" aria-label="${esc9(t("FOLDERS_UI.VIEW_MENU", "Sortierung und Ansicht"))}" title="${esc9(t("FOLDERS_UI.VIEW_MENU", "Sortierung und Ansicht"))}" hidden>${icon("sort")}</button>
              <div class="menu menu-right" id="view-menu" role="menu" hidden></div>
            </div>
            <button type="button" class="icon-btn" data-action="m-select-all" aria-label="Alle ausw\xE4hlen" title="Alle ausw\xE4hlen (Strg+A)">${icon("select-all")}</button>
            <button type="button" class="icon-btn" data-action="m-refresh" aria-label="Aktualisieren" title="Aktualisieren">${icon("refresh")}</button>
          </div>
          <form class="search-wrap" data-action="search">
            <label class="sr" for="search">Suche</label>
            <div class="search-field">
              ${icon("search")}
              <input class="search" id="search" type="search" placeholder="" autocomplete="off" aria-keyshortcuts="Escape">
              <button type="button" class="icon-btn search-clear" data-action="clear-search" data-clear="field" hidden aria-label="Suche l\xF6schen" title="Suche l\xF6schen">${icon("close")}</button>
            </div>
            <button type="button" class="icon-btn" data-action="adv-search" aria-haspopup="dialog" aria-label="${esc9(t("SEARCH.TITLE_ADV", "Erweiterte Suche"))}" title="${esc9(t("SEARCH.TITLE_ADV", "Erweiterte Suche"))}">${icon("filter")}</button>
          </form>
          <div class="criteria" id="criteria" hidden></div>
          <div class="quick" role="group" aria-label="${esc9(t("SEARCH_UI.QUICK", "Schnellfilter"))}">
            <button type="button" class="chip" data-action="quick" data-flag="unseen" aria-pressed="false">${withIcon("mark-unread", t("SEARCH.UNSEEN", "Ungelesen"))}</button>
            <button type="button" class="chip" data-action="quick" data-flag="flagged" aria-pressed="false">${withIcon("flag", t("SEARCH.FLAGGED", "Markiert"))}</button>
            <button type="button" class="chip" data-action="quick" data-flag="attachment" aria-pressed="false">${withIcon("attachment", t("SEARCH_UI.WITH_ATTACHMENT", "Mit Anhang"))}</button>
          </div>
          <p class="list-status live" id="list-status"></p>
          <div class="thread-bar" id="thread-bar" hidden>
            <button type="button" class="text-btn" data-action="thread-back">${withIcon("back", t("FOLDERS_UI.BACK_TO_LIST", "Zur\xFCck zur Liste"))}</button>
            <span class="quiet" id="thread-label"></span>
          </div>
          <div class="pane-body" id="list-body">
            <div id="rows"></div>
            <p class="result-label mono" id="list-result" hidden></p>
            <p class="empty" id="list-empty" hidden></p>
            <button type="button" class="text-btn" data-action="clear-search" data-clear="list" hidden>Suche aufheben</button>
            <button type="button" class="text-btn more-row" data-action="more" hidden>${icon("chevron-down")}<span>Weitere</span></button>
            <p class="error" id="list-error" hidden></p>
          </div>
        </section>
        <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Breite der Liste" tabindex="0" aria-valuemin="288" aria-valuemax="640" aria-valuenow="384"></div>
        <section class="reader" aria-label="Brief">
          <div class="reader-bar">
            <button type="button" class="text-btn bar-btn" data-action="back" title="${esc9(t("GLOBAL.BACK", "Zur\xFCck"))}" hidden>${withIcon("back", t("GLOBAL.BACK", "Zur\xFCck"))}</button>
            <span class="quiet" id="reader-place"></span>
            <span class="spacer"></span>
            <button type="button" class="text-btn bar-btn reply-main" data-action="reply" title="${esc9(t("MESSAGE.BUTTON_REPLY", "Antworten"))}" hidden>${withIcon("reply", t("MESSAGE.BUTTON_REPLY", "Antworten"))}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="reply-all" title="${esc9(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}" hidden>${withIcon("reply-all", t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</button>
            <button type="button" class="text-btn bar-btn" data-action="forward" title="${esc9(t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}" hidden>${withIcon("forward", t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}</button>
            <button type="button" class="text-btn bar-btn" data-action="archive" title="${esc9(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}" hidden>${withIcon("archive", t("GLOBAL.TO_ARCHIVE", "Archivieren"))}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="unread" title="Ungelesen" hidden>${withIcon("mark-unread", "Ungelesen")}</button>
            <span class="bar-sep" aria-hidden="true"></span>
            <button type="button" class="text-btn bar-btn" data-action="delete" title="${esc9(t("GLOBAL.DELETE", "L\xF6schen"))}" hidden>${withIcon("delete", t("GLOBAL.DELETE", "L\xF6schen"))}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-flag" data-one="1" title="Markieren (I)" aria-pressed="false" hidden>${withIcon("flag", "Markieren")}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-move" data-one="1" title="Verschieben (M)" hidden>${withIcon("move", "Verschieben")}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-spam" data-one="1" title="Spam" hidden>${withIcon("spam", "Spam")}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-notspam" data-one="1" title="Kein Spam" hidden>${withIcon("not-spam", "Kein Spam")}</button>
            <div class="bar-more">
              <button type="button" class="icon-btn" data-action="m-more" data-one="1" aria-label="Weitere Aktionen" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu" title="Weitere Aktionen" hidden>${icon("more")}</button>
              <div class="menu menu-right" id="more-menu" role="menu" hidden>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="reply-all">${icon("reply-all")}<span>${esc9(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="unread" data-narrow="unread">${icon("mark-unread")}<span>Gelesen / ungelesen</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-flag">${icon("flag")}<span>Markieren</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-move">${icon("move")}<span>Verschieben \u2026</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-spam" data-narrow="spam">${icon("spam")}<span>Spam</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-notspam" data-narrow="notspam">${icon("not-spam")}<span>Kein Spam</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-edit-draft" hidden>${icon("compose")}<span>Entwurf bearbeiten</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-edit-new">${icon("edit-as-new")}<span>Als neu bearbeiten</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-forward-att">${icon("forward-attachment")}<span>Als Anhang weiterleiten</span></button>
                <hr class="menu-sep">
                <button type="button" class="menu-item" role="menuitem" data-action="m-copy">${icon("copy")}<span>Kopieren nach \u2026</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-tag">${icon("tag")}<span>Schlagwort hinzuf\xFCgen</span></button>
                <hr class="menu-sep">
                <button type="button" class="menu-item" role="menuitem" data-action="m-mode" data-mode-item="1">${icon("source")}<span>Nur Text anzeigen</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-swap">${icon("eye")}<span>Farben umkehren</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-unsubscribe" hidden>${icon("unsubscribe")}<span>Vom Verteiler abmelden</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-print">${icon("print")}<span>Drucken</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-window">${icon("external")}<span>In neuem Fenster</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-fullscreen">${icon("fullscreen")}<span>Vollbild</span></button>
                <hr class="menu-sep">
                <button type="button" class="menu-item" role="menuitem" data-action="m-source">${icon("code")}<span>Quelltext anzeigen</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-eml">${icon("download")}<span>Als .eml laden</span></button>
                <hr class="menu-sep">
                <button type="button" class="menu-item danger-item" role="menuitem" data-action="m-delete-forever">${icon("delete-forever")}<span>Endg\xFCltig l\xF6schen</span></button>
              </div>
            </div>
            <button type="button" class="icon-btn wide-only" data-action="m-prev" data-one="1" aria-label="Vorige Mail (K)" title="Vorige Mail (K)" hidden>${icon("chevron-up")}</button>
            <button type="button" class="icon-btn wide-only" data-action="m-next" data-one="1" aria-label="N\xE4chste Mail (J)" title="N\xE4chste Mail (J)" hidden>${icon("chevron-down")}</button>
          </div>
          <p class="quiet live" id="notice"></p>
          <div class="pane-body" id="reader-body">
            <div class="empty reader-empty" id="reader-empty">${icon("inbox")}<p>W\xE4hlen Sie eine Mail.</p></div>
          </div>
        </section>
        <section class="book" id="book" hidden aria-label="${esc9(t("GLOBAL.CONTACTS", "Kontakte"))}"></section>
        <div id="compose-host"></div>
        <nav class="tabbar" aria-label="Navigation">
          <button type="button" class="text-btn" data-action="pane-folders">${withIcon("folder", "Ordner")}</button>
          <button type="button" class="text-btn" data-action="pane-search">${withIcon("search", "Suche")}</button>
          <button type="button" class="ink-btn" data-action="compose">${withIcon("compose", t("FOLDER_LIST.BUTTON_NEW_MESSAGE", "Neue Nachricht"))}</button>
        </nav>
        <dialog id="settings" class="dialog-wide" aria-labelledby="settings-title">
          <div class="dialog-body">
            <div class="settings-sticky">
              <div class="sheet-head" style="padding:0;border:0;min-height:0">
                <h2 id="settings-title" class="title title-md">${esc9(t("GLOBAL.SETTINGS", "Einstellungen"))}</h2>
                <span class="spacer"></span>
                <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc9(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
              </div>
              <nav class="settings-nav" aria-label="${esc9(t("GLOBAL.SETTINGS", "Einstellungen"))}">
                <button type="button" class="text-btn" data-action="settings-section" data-section="look" aria-pressed="true">${withIcon("eye", t("SETTINGS_DESK.APPEARANCE", "Erscheinungsbild"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="general">${withIcon("settings", t("SETTINGS_LABELS.GENERAL", "Allgemein"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="security">${withIcon("key", t("SETTINGS_LABELS.SECURITY", "Sicherheit"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="assistant" hidden>${withIcon("assist", t("AI_COPILOT.TITLE", "Assistent"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="folders">${withIcon("folder", t("SETTINGS_LABELS.FOLDERS", "Ordner"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="accounts">${withIcon("users", t("SETTINGS_LABELS.ACCOUNTS", "Konten"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="identities">${withIcon("identity", t("SETTINGS_ACCOUNTS.LEGEND_IDENTITIES", "Identit\xE4ten"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="contacts" hidden>${withIcon("contacts", t("SETTINGS_LABELS.CONTACTS", "Kontakte"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="filters" hidden>${withIcon("filter", t("SETTINGS_LABELS.FILTERS", "Filter"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="keys">${withIcon("key", t("SETTINGS_DESK.KEYS", "Schl\xFCssel"))}</button>
              </nav>
            </div>
            <p class="quiet live" id="settings-live" aria-live="polite"></p>
            <div id="settings-panel"></div>
          </div>
        </dialog>
        <dialog id="keys" aria-labelledby="keys-title">
          <div class="dialog-body">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="keys-title" class="title title-md">Tasten</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc9(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
            </div>
            <ul class="keys">
              <li><span>N\xE4chste, vorige Mail</span><kbd>J</kbd> <kbd>K</kbd></li>
              <li><span>\xD6ffnen</span><kbd>Enter</kbd></li>
              <li><span>Unterhaltung \xF6ffnen</span><kbd>T</kbd></li>
              <li><span>Zur\xFCck zur Liste (Unterhaltung)</span><kbd>Esc</kbd></li>
              <li><span>Ordner auf-, zuklappen</span><kbd>\u2190</kbd> <kbd>\u2192</kbd></li>
              <li><span>Ordneraktionen</span><kbd>Umschalt</kbd> <kbd>F10</kbd></li>
              <li><span>Schreiben</span><kbd>C</kbd></li>
              <li><span>Antworten</span><kbd>R</kbd></li>
              <li><span>Allen antworten</span><kbd>A</kbd></li>
              <li><span>Weiterleiten</span><kbd>F</kbd></li>
              <li><span>Archivieren</span><kbd>E</kbd></li>
              <li><span>Markieren</span><kbd>I</kbd></li>
              <li><span>Gelesen / ungelesen</span><kbd>U</kbd></li>
              <li><span>Verschieben</span><kbd>M</kbd></li>
              <li><span>L\xF6schen</span><kbd>#</kbd> <kbd>Entf</kbd></li>
              <li><span>Endg\xFCltig l\xF6schen</span><kbd>Umschalt</kbd> <kbd>Entf</kbd></li>
              <li><span>Alle ausw\xE4hlen</span><kbd>Strg</kbd> <kbd>A</kbd></li>
              <li><span>Auswahl erweitern</span><kbd>Umschalt</kbd> <kbd>Klick</kbd></li>
              <li><span>Aktualisieren</span><kbd>Umschalt</kbd> <kbd>R</kbd></li>
              <li><span>Seitenleiste</span><kbd>\\</kbd></li>
              <li><span>Gelesen</span><kbd>Umschalt</kbd> <kbd>U</kbd></li>
              <li><span>Ordner, Liste, Brief</span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></li>
              <li><span>Vollbild</span><kbd>V</kbd></li>
              <li><span>Zitate ein oder aus</span><kbd>Q</kbd></li>
              <li><span>Senden im Editor</span><kbd>Strg</kbd> <kbd>Enter</kbd></li>
              <li><span>Entwurf speichern</span><kbd>Strg</kbd> <kbd>S</kbd></li>
              <li><span>Editor minimieren</span><kbd>,</kbd></li>
              <li><span>Schlie\xDFen</span><kbd>Esc</kbd></li>
              <li><span>Diese Liste</span><kbd>?</kbd></li>
            </ul>
          </div>
        </dialog>
        <dialog id="confirm" aria-labelledby="confirm-title">
          <div class="dialog-body">
            <h2 id="confirm-title" class="title title-md">Wirklich l\xF6schen?</h2>
            <p class="quiet" id="confirm-text" hidden></p>
            <div class="dialog-actions">
              <button type="button" class="text-btn" value="cancel">${esc9(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
              <button type="button" class="text-btn" value="alt" id="confirm-alt" hidden></button>
              <button type="button" class="danger" value="ok" id="confirm-ok">${withIcon("delete", t("GLOBAL.DELETE", "L\xF6schen"))}</button>
            </div>
          </div>
        </dialog>
        <dialog id="picker" aria-labelledby="picker-title">
          <form class="dialog-body" method="dialog" data-action="picker">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="picker-title" class="title title-md">Verschieben nach</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc9(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
            </div>
            <label class="sr" for="picker-q">Ordner suchen</label>
            <input class="search" id="picker-q" type="search" placeholder="Ordner suchen" autocomplete="off">
            <div class="picker-list" id="picker-list" role="listbox" aria-label="Ordner"></div>
          </form>
        </dialog>
        <dialog id="prompt-dlg" aria-labelledby="prompt-title">
          <form class="dialog-body" data-action="prompt-form">
            <h2 id="prompt-title" class="title title-md"></h2>
            <label class="field"><span id="prompt-label"></span><input id="prompt-input" type="text" autocomplete="off"></label>
            <label class="check" id="prompt-remember-row" hidden><input id="prompt-remember" type="checkbox"> ${esc9(t("CRYPTO.REMEMBER_SESSION", "F\xFCr diese Sitzung merken"))}</label>
            <div class="dialog-actions">
              <button type="button" class="text-btn" data-action="close-dialog">${esc9(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
              <button type="submit" class="ink-btn">${withIcon("check", "\xDCbernehmen")}</button>
            </div>
          </form>
        </dialog>
        <dialog id="lightbox" class="dialog-wide lightbox" aria-labelledby="lightbox-title">
          <div class="dialog-body">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="lightbox-title" class="title title-md"></h2>
              <span class="spacer"></span>
              <a class="icon-btn" id="lightbox-open" target="_blank" rel="noopener" aria-label="In neuem Tab \xF6ffnen" title="In neuem Tab \xF6ffnen">${icon("external")}</a>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc9(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
            </div>
            <div class="lightbox-body" id="lightbox-body"></div>
          </div>
        </dialog>
        <dialog id="adv-search" class="dialog-wide" aria-labelledby="adv-title">
          <form class="dialog-body" data-action="adv-search-form">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="adv-title" class="title title-md">${esc9(t("SEARCH.TITLE_ADV", "Erweiterte Suche"))}</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc9(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
            </div>
            <div id="adv-body"></div>
          </form>
        </dialog>
        <dialog id="folder-dlg" aria-labelledby="folder-dlg-title">
          <form class="dialog-body" data-action="folder-dlg-form">
            <h2 id="folder-dlg-title" class="title title-md"></h2>
            <label class="field"><span>${esc9(t("GLOBAL.NAME", "Name"))}</span><input id="folder-dlg-name" type="text" required autocomplete="off"></label>
            <label class="field"><span>${esc9(t("POPUPS_CREATE_FOLDER.LABEL_PARENT", "\xDCbergeordneter Ordner"))}</span><select id="folder-dlg-parent"></select></label>
            <label class="check"><input type="checkbox" id="folder-dlg-sub" checked> ${esc9(t("FOLDERS_UI.SUBSCRIBE", "Abonnieren"))}</label>
            <div class="dialog-actions">
              <button type="button" class="text-btn" data-action="close-dialog">${esc9(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
              <button type="submit" class="ink-btn">${withIcon("folder-plus", t("POPUPS_CREATE_FOLDER.BUTTON_CREATE", "Anlegen"))}</button>
            </div>
          </form>
        </dialog>
        <dialog id="acl-dlg" class="dialog-wide" aria-labelledby="acl-title">
          <div class="dialog-body">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="acl-title" class="title title-md"></h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc9(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
            </div>
            <div id="acl-body"></div>
          </div>
        </dialog>
        <ul class="menu addr-menu" id="addr-menu" role="menu" hidden>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-write">${icon("compose")}<span>Mail schreiben</span></button></li>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-copy">${icon("copy")}<span>Adresse kopieren</span></button></li>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-search">${icon("search")}<span>Mails von dieser Adresse</span></button></li>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-contact" hidden>${icon("contacts")}<span>${esc9(t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzuf\xFCgen"))}</span></button></li>
        </ul>
      </div>`;
    const next = root3.querySelector(".shell");
    if (!next) return;
    shell = next;
    const account = next.querySelector(".account-btn");
    account.innerHTML = `<span class="account-mail">${esc9(email)}</span>${icon("chevron-down")}`;
    composer = new Composer(next.querySelector("#compose-host"), composePrefs, {
      send: (values2) => actions.send(values2),
      save: (values2) => actions.saveCompose(values2),
      close: (discard) => actions.closeCompose(discard),
      mobile: (open) => {
        if (!wide()) pane(open ? "compose" : "list");
      },
      notice: (text2) => {
        const slot = shell?.querySelector("#notice");
        if (slot) slot.textContent = text2;
      },
      passphrase: (title, label2) => promptDialog(title, label2, "", true)
    });
    composer.configure(composePrefs, composeIdentities);
    book = mountBook(next.querySelector("#book"), {
      confirm: (title, text2, ok, danger = true) => chooseDialog(title, text2, ok, "", danger).then((value) => value === "ok"),
      choose: (title, text2, ok, alt) => chooseDialog(title, text2, ok, alt, false),
      compose: (to) => actions.act("compose-to", { to }),
      pane: (name) => pane(name),
      wide
    });
    next.querySelector("#folder-title").textContent = folderName;
    next.querySelector("#reader-place").textContent = folderName;
    const search = next.querySelector("#search");
    search.placeholder = `In ${folderName} suchen`;
    wireShell();
    if (assist) installAssist(assist);
  };
  function pane(name) {
    if (!shell) return;
    shell.dataset.pane = name;
    const back = shell.querySelector("[data-action='back']");
    back.hidden = wide() || name !== "reader";
  }
  let expanded = false;
  let keyHandler = null;
  let lastReader = null;
  function paintBar(data) {
    lastReader = data;
    if (!shell) return;
    const show = (name, on2) => {
      shell?.querySelectorAll(`.reader-bar > [data-action='${name}'], .reader-bar > .bar-more > [data-action='${name}']`).forEach((button3) => {
        button3.hidden = !on2;
      });
    };
    const one = Boolean(data);
    ["reply", "reply-all", "forward", "delete", "m-flag", "m-move", "m-more", "m-prev", "m-next", "unread"].forEach((name) => show(name, one));
    show("archive", one && Boolean(data?.place.archive));
    show("m-spam", one && Boolean(data?.place.spam) && !data?.place.inSpam);
    show("m-notspam", one && Boolean(data?.place.inSpam));
    if (!data) return;
    const flag2 = shell.querySelector(".reader-bar > [data-action='m-flag']");
    if (flag2) {
      flag2.setAttribute("aria-pressed", data.flagged ? "true" : "false");
      flag2.innerHTML = withIcon(data.flagged ? "flag-filled" : "flag", data.flagged ? "Markiert" : "Markieren");
    }
    const unread = shell.querySelector(".reader-bar > [data-action='unread']");
    if (unread) {
      unread.innerHTML = withIcon(data.seen ? "mark-unread" : "mark-read", data.seen ? "Ungelesen" : "Gelesen");
      unread.title = data.seen ? "Als ungelesen markieren (U)" : "Als gelesen markieren (U)";
    }
    const del = shell.querySelector(".reader-bar > [data-action='delete']");
    if (del) del.title = data.place.inTrash ? "Endg\xFCltig l\xF6schen" : t("GLOBAL.DELETE", "L\xF6schen");
    const menuShow = (name, on2) => {
      const item = shell?.querySelector(`#more-menu [data-action='${name}']`);
      if (item) item.hidden = !on2;
    };
    menuShow("m-edit-draft", data.place.inDrafts);
    shell.querySelectorAll("#more-menu [data-narrow='spam']").forEach((item) => {
      item.hidden = !(data.place.spam && !data.place.inSpam);
    });
    shell.querySelectorAll("#more-menu [data-narrow='notspam']").forEach((item) => {
      item.hidden = !data.place.inSpam;
    });
    menuShow("m-unsubscribe", data.unsubscribe);
    menuShow("m-mode", data.canToggleMode);
    menuShow("m-delete-forever", !data.place.inTrash);
    const mode = shell.querySelector("#more-menu [data-action='m-mode']");
    if (mode) mode.innerHTML = `${icon("source")}<span>${data.mode === "html" ? "Nur Text anzeigen" : "HTML anzeigen"}</span>`;
    const swap = shell.querySelector("#more-menu [data-action='m-swap']");
    if (swap) swap.innerHTML = `${icon("eye")}<span>${data.swap ? "Originalfarben" : "Farben umkehren"}</span>`;
  }
  function setSidebar(open) {
    if (shell) shell.dataset.sidebar = open ? "open" : "closed";
  }
  function closeMenu() {
    shell?.querySelectorAll("#account-menu, #more-menu, #addr-menu, #folder-menu, #view-menu").forEach((menu) => {
      menu.hidden = true;
    });
    shell?.querySelectorAll("[data-action='account'], [data-action='m-more'], [data-action='f-menu'], [data-action='view-menu']").forEach((button3) => {
      button3.setAttribute("aria-expanded", "false");
    });
  }
  function anyMenuOpen() {
    return Boolean(shell?.querySelector("#account-menu:not([hidden]), #more-menu:not([hidden]), #addr-menu:not([hidden]), #folder-menu:not([hidden]), #view-menu:not([hidden])"));
  }
  let addrTarget = { email: "", name: "" };
  let menuReturn = null;
  let folderActions = /* @__PURE__ */ new Map();
  let folderDesk = null;
  let listMode = { sortable: false, sort: "", threadsAvailable: false, useThreads: false, grouped: false, threadOpen: "" };
  function openFolderMenu(target, anchor, point) {
    const menu = shell?.querySelector("#folder-menu");
    const sidebar = shell?.querySelector(".sidebar");
    const list = folderActions.get(target);
    if (!menu || !sidebar || !list?.length) return;
    closeMenu();
    menu.innerHTML = renderFolderMenu(target, list);
    const box = sidebar.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const x = point ? point.x : rect.right - 8;
    const y = point ? point.y : rect.bottom;
    menu.style.left = `${Math.max(4, Math.min(x - box.left, box.width - 228))}px`;
    menu.style.top = `${y - box.top + sidebar.scrollTop + 4}px`;
    menu.hidden = false;
    const limit = Math.min(window.innerHeight, shell?.querySelector(".tabbar")?.getBoundingClientRect().top || window.innerHeight);
    const height = menu.getBoundingClientRect().height;
    if (y + 4 + height > limit) {
      const above = (point ? point.y : rect.top) - height - 4;
      menu.style.top = `${Math.max(4, above - box.top + sidebar.scrollTop)}px`;
    }
    const more = sidebar.querySelector(`.fmore[data-target="${CSS.escape(target)}"]`);
    more?.setAttribute("aria-expanded", "true");
    menuReturn = more || anchor;
    menu.querySelector("button")?.focus({ preventScroll: true });
  }
  function paintViewMenu() {
    const menu = shell?.querySelector("#view-menu");
    const button3 = shell?.querySelector("[data-action='view-menu']");
    if (!menu || !button3) return;
    const sorts = listMode.sortable && !listMode.threadOpen ? `<p class="menu-label mono">${esc9(t("MESSAGE_LIST.SORT", "Sortieren"))}</p>` + SORTS.map(([value, key, fallback]) => `<button type="button" class="menu-item" role="menuitemradio" aria-checked="${listMode.sort === value ? "true" : "false"}" data-action="sort" data-sort="${esc9(value)}">${icon(listMode.sort === value ? "check" : "sort")}<span>${esc9(t(key, fallback))}</span></button>`).join("") : "";
    const threads = listMode.threadsAvailable ? `<button type="button" class="menu-item" role="menuitemcheckbox" aria-checked="${listMode.useThreads ? "true" : "false"}" data-action="threads-toggle">${icon(listMode.useThreads ? "checkbox-checked" : "checkbox")}<span>${esc9(t("SETTINGS_GENERAL.USE_THREADS", "Als Unterhaltungen anzeigen"))}</span></button>` : "";
    const group2 = `<button type="button" class="menu-item" role="menuitemcheckbox" aria-checked="${listMode.grouped ? "true" : "false"}" data-action="group-toggle">${icon(listMode.grouped ? "checkbox-checked" : "checkbox")}<span>${esc9(t("FOLDERS_UI.GROUP_BY_DATE", "Nach Datum gruppieren"))}</span></button>`;
    menu.innerHTML = sorts + (sorts ? `<hr class="menu-sep">` : "") + `<p class="menu-label mono">${esc9(t("FOLDERS_UI.VIEW", "Ansicht"))}</p>` + threads + group2;
    button3.hidden = false;
  }
  function folderButtons() {
    return [...shell?.querySelectorAll("#folder-tree .folder:not([disabled])") ?? []];
  }
  function openAddrMenu(target) {
    const menu = shell?.querySelector("#addr-menu");
    if (!menu || !shell) return;
    closeMenu();
    addrTarget = { email: target.dataset.email || "", name: target.dataset.name || "" };
    const box = shell.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left - box.left, box.width - 240))}px`;
    menu.style.top = `${rect.bottom - box.top + 4}px`;
    menu.hidden = false;
    menu.querySelector("button")?.focus({ preventScroll: true });
  }
  function openLayer(layer, from) {
    opener = from;
    layer.hidden = false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      layer.dataset.instant = "1";
      layer.dataset.open = "true";
      return;
    }
    delete layer.dataset.instant;
    layer.dataset.open = "false";
    requestAnimationFrame(() => {
      layer.dataset.open = "true";
    });
  }
  function closeLayer(layer) {
    const back = opener;
    opener = null;
    back?.focus({ preventScroll: true });
    layer.dataset.open = "false";
    let settled = false;
    const finish = (event) => {
      if (settled) return;
      if (event && (event.target !== layer || event.propertyName !== "transform")) return;
      settled = true;
      window.clearTimeout(timer);
      layer.removeEventListener("transitionend", finish);
      layer.hidden = true;
    };
    const timer = window.setTimeout(() => finish(), 320);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else layer.addEventListener("transitionend", finish);
  }
  function toggleFullscreen(force) {
    if (!shell) return;
    const on2 = force ?? shell.dataset.full !== "true";
    shell.dataset.full = on2 ? "true" : "false";
    const button3 = shell.querySelector("[data-action='m-fullscreen']");
    if (button3) button3.innerHTML = `${icon(on2 ? "fullscreen-exit" : "fullscreen")}<span>${on2 ? "Vollbild beenden" : "Vollbild"}</span>`;
    if (on2 && !wide()) pane("reader");
  }
  function wireShell() {
    if (!shell) return;
    const menu = shell.querySelector("#account-menu");
    const accountBtn = shell.querySelector("[data-action='account']");
    const list = shell.querySelector(".list-pane");
    const separator = shell.querySelector(".splitter");
    const setListWidth = (px2) => {
      const next = Math.min(640, Math.max(288, Math.round(px2)));
      shell?.style.setProperty("--list-w", `${next}px`);
      separator.setAttribute("aria-valuenow", String(next));
    };
    shell.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action], [data-folder], [data-uid]");
      if (!target?.closest("#book-menu, #book-add, [data-op='more'], [data-op='add-menu']")) {
        shell?.querySelectorAll("#book-menu, #book-add").forEach((menu2) => {
          menu2.hidden = true;
        });
        shell?.querySelectorAll("[data-op='more'], [data-op='add-menu']").forEach((button3) => button3.setAttribute("aria-expanded", "false"));
      }
      if (anyMenuOpen() && !target?.closest(".account, .bar-more, #addr-menu")) closeMenu();
      if (!target) return;
      const action = target.dataset.action;
      if (target.classList.contains("menu-item") && target.closest("#more-menu")) closeMenu();
      if (target.dataset.folder && !action) {
        void (async () => {
          if (!await closeBook()) return;
          actions.selectFolder(target.dataset.folder || "");
          if (!wide()) pane("list");
          if (!docked()) setSidebar(false);
        })();
      } else if (target.dataset.uid) {
        const mouse = event;
        if (mouse.shiftKey || mouse.ctrlKey || mouse.metaKey) {
          event.preventDefault();
          actions.act("select", { uid: target.dataset.uid, mode: mouse.shiftKey ? "range" : "toggle" });
          return;
        }
        actions.selectMessage(Number(target.dataset.uid));
        if (!wide()) pane("reader");
      } else if (action === "toggle-sidebar") {
        if (!wide()) pane("folders");
        else setSidebar(shell?.dataset.sidebar !== "open");
      } else if (action === "close-sidebar") setSidebar(false);
      else if (action === "account") {
        const open = menu.hidden;
        closeMenu();
        menu.hidden = !open;
        accountBtn.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) actions.act("accounts", {});
      } else if (action === "m-more") {
        const more = shell?.querySelector("#more-menu");
        const open = more.hidden;
        closeMenu();
        more.hidden = !open;
        target.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) more.querySelector(".menu-item:not([hidden])")?.focus({ preventScroll: true });
      } else if (action === "f-toggle") {
        actions.act("f-toggle", { target: target.dataset.target || "" });
      } else if (action === "f-menu") {
        const open = target.getAttribute("aria-expanded") === "true";
        if (open) closeMenu();
        else openFolderMenu(target.dataset.target || "", target);
      } else if (action === "f-settings") {
        closeMenu();
        openFolderSettings(target.dataset.target || "");
      } else if (action?.startsWith("f-")) {
        if (target.closest(".menu")) closeMenu();
        const data = {};
        Object.entries(target.dataset).forEach(([key, value]) => {
          if (value != null) data[key] = value;
        });
        actions.act(action, data);
      } else if (action === "view-menu") {
        const menuEl = shell?.querySelector("#view-menu");
        const open = menuEl.hidden;
        closeMenu();
        if (open) {
          paintViewMenu();
          menuEl.hidden = false;
          target.setAttribute("aria-expanded", "true");
          menuReturn = target;
          menuEl.querySelector(".menu-item")?.focus({ preventScroll: true });
        }
      } else if (action === "sort" || action === "threads-toggle" || action === "group-toggle") {
        closeMenu();
        shell?.querySelector("[data-action='view-menu']")?.focus({ preventScroll: true });
        actions.act(action, { sort: target.dataset.sort || "" });
      } else if (action === "quick") {
        actions.act("quick", { flag: target.dataset.flag || "", query: (shell?.querySelector("#search")).value.trim() });
      } else if (action === "adv-search") {
        actions.act("adv-search", { query: (shell?.querySelector("#search")).value.trim() });
      } else if (action === "adv-reset") {
        const form2 = target.closest("form");
        form2?.reset();
        form2?.querySelectorAll("input").forEach((field2) => {
          if (field2.type === "checkbox") field2.checked = false;
          else field2.value = "";
        });
        form2?.querySelectorAll("select").forEach((field2) => {
          field2.selectedIndex = 0;
        });
      } else if (action === "thread-back") {
        actions.act("thread-back", {});
      } else if (action === "m-address") {
        openAddrMenu(target);
      } else if (action === "m-addr-write" || action === "m-addr-copy" || action === "m-addr-search" || action === "m-addr-contact") {
        closeMenu();
        actions.act(action.slice(2), addrTarget);
      } else if (action === "m-check") {
        event.stopPropagation();
        const mouse = event;
        actions.act("select", { uid: target.dataset.ref || "", mode: mouse.shiftKey ? "range" : "toggle" });
      } else if (action === "m-details") {
        expanded = !expanded;
        const body = shell?.querySelector("#reader-body");
        if (body && lastReader) {
          const top = body.scrollTop;
          renderReader(body, lastReader, expanded);
          body.scrollTop = top;
          body.querySelector("[data-action='m-details']")?.focus({ preventScroll: true });
        }
      } else if (action === "m-fullscreen") {
        closeMenu();
        toggleFullscreen();
      } else if (action?.startsWith("m-")) {
        if (target.closest(".menu")) closeMenu();
        const data = {};
        Object.entries(target.dataset).forEach(([key, value]) => {
          if (value != null) data[key] = value;
        });
        actions.act(action.slice(2), data);
      } else if (action === "settings") {
        closeMenu();
        section = "look";
        edit = null;
        snap = null;
        paintSettings();
        (shell?.querySelector("#settings")).showModal();
        void actions.settings?.("open", {});
      } else if (action === "preview-sound") {
        const name = shell?.querySelector("[data-pref='NotificationSound']")?.value || "new-mail";
        const audio = new Audio(`${location.pathname.replace(/\/+$/, "")}/snappymail/v/0.0.0/static/sounds/${encodeURIComponent(name)}.mp3`);
        void audio.play().catch(() => void 0);
      } else if (action === "assist-revoke") {
        const box = shell?.querySelector("input[name='notice_ack']");
        if (box) box.checked = false;
        void actions.settings?.("assist-save", { notice_ack: "" });
      } else if (action === "rule-add" || action === "cond-add" || action === "act-add" || action === "rule-remove" || action === "cond-remove" || action === "act-remove") {
        editFilterDom(target, action);
      } else if (action === "script-mode") {
        toggleScriptMode(target);
      } else if (action === "settings-move") {
        const list2 = target.dataset.list || "";
        if (list2 === "rules") {
          const card = target.closest("[data-rule]");
          if (!card) return;
          const sibling = target.dataset.dir === "down" ? card.nextElementSibling : card.previousElementSibling;
          if (sibling) target.dataset.dir === "down" ? sibling.after(card) : sibling.before(card);
          return;
        }
        const dir = target.dataset.dir === "down" ? 1 : -1;
        const rows2 = [...shell?.querySelectorAll(list2 === "accounts" ? "[data-sort='account']" : "[data-sort='identity']") || []];
        const key = list2 === "accounts" ? "email" : "id";
        const order = rows2.map((row2) => row2.dataset[key] || "").filter(Boolean);
        const index = order.indexOf(target.dataset[key] || "");
        const next = index + dir;
        if (index < 0 || next < 0 || next >= order.length) return;
        const swap = order[index];
        order[index] = order[next];
        order[next] = swap;
        void actions.settings?.(list2 === "accounts" ? "sort-accounts" : "sort-identities", { order: order.join(",") });
      } else if (action === "settings-export") {
        void actions.settings?.("export-key", { index: target.dataset.index || "" });
      } else if (action === "settings-import") {
        void actions.settings?.("import-account", { email: target.dataset.email || "" });
      } else if (action === "mailto-register") {
        try {
          const url = `${location.origin}${location.pathname.replace(/\/+$/, "")}/?/Mailto/&q[]=/0/?to=%s`;
          navigator.registerProtocolHandler("mailto", url);
          const slot = shell?.querySelector("#settings-error");
          if (slot) {
            slot.className = "quiet";
            slot.hidden = false;
            slot.textContent = "Die Registrierung wurde im Browser angefragt.";
          }
        } catch {
          const slot = shell?.querySelector("#settings-error");
          if (slot) {
            slot.className = "error";
            slot.hidden = false;
            slot.textContent = "Der Browser erlaubt diese Registrierung nicht.";
          }
        }
      } else if (action === "settings-section") {
        section = target.dataset.section || "look";
        edit = null;
        paintSettings();
        if (section === "folders") actions.act("f-desk", {});
      } else if (action === "settings-edit") {
        edit = { kind: target.dataset.kind || "", id: target.dataset.id || "", fresh: target.dataset.fresh === "1" };
        paintSettings();
      } else if (action === "settings-cancel") {
        edit = null;
        paintSettings();
      } else if (action === "settings-delete" || action === "settings-switch" || action === "settings-activate") {
        const name = action === "settings-delete" ? `delete-${target.dataset.kind || ""}` : action === "settings-switch" ? "switch-account" : "activate-script";
        const payload = {
          id: target.dataset.id || "",
          email: target.dataset.email || "",
          name: target.dataset.name || "",
          secret: target.dataset.secret || "",
          index: target.dataset.index || ""
        };
        void (async () => {
          if (action === "settings-delete") {
            const dialog = shell?.querySelector("#confirm");
            if (!dialog) return;
            dialog.querySelector("#confirm-title").textContent = "Wirklich l\xF6schen?";
            dialog.querySelector("#confirm-text").hidden = true;
            const ok_ = dialog.querySelector("#confirm-ok");
            ok_.className = "danger";
            ok_.innerHTML = withIcon("delete", t("GLOBAL.DELETE", "L\xF6schen"));
            dialog.querySelector("#confirm-alt").hidden = true;
            dialog.returnValue = "";
            dialog.showModal();
            const ok = await new Promise((resolve) => {
              dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
            });
            if (!ok) return;
          }
          await actions.settings?.(name, payload);
        })();
      } else if (action === "logout") actions.logout();
      else if (action === "close-dialog") target.closest("dialog")?.close();
      else if (action === "search") {
      } else if (action === "drop-criterion") {
        const input2 = shell?.querySelector("#search");
        if (!input2) return;
        const params = new URLSearchParams(input2.value);
        params.delete(target.dataset.key || "");
        input2.value = params.toString();
        actions.search(input2.value);
      } else if (action === "clear-search") {
        (shell?.querySelector("#search")).value = "";
        actions.clearSearch();
      } else if (action === "more") actions.more();
      else if (action === "back") pane("list");
      else if (action === "pane-folders") pane("folders");
      else if (action === "pane-search") {
        pane("list");
        const field2 = shell?.dataset.surface === "contacts" ? "#book-q" : "#search";
        shell?.querySelector(field2)?.focus({ preventScroll: true });
      } else if (action === "test-sync" || action === "sync-now") {
        const form2 = shell?.querySelector("form[data-kind='save-sync']");
        if (!form2) return;
        const data = {};
        new FormData(form2).forEach((value, key) => {
          data[key] = String(value);
        });
        void actions.settings?.(action, data);
      } else if (action === "open-book") {
        closeMenu();
        void openBook();
      } else if (action === "close-book") {
        void closeBook();
      } else if (action === "book") {
        const data = {};
        Object.entries(target.dataset).forEach(([key, value]) => {
          if (value != null) data[key] = value;
        });
        void book?.onAction(data.op || "", target, event);
      } else if (action === "compose") actions.compose();
      else if (action === "reply") actions.reply(false);
      else if (action === "reply-all") actions.reply(true);
      else if (action === "forward") actions.forward();
      else if (action === "archive") actions.archive();
      else if (action === "unread") actions.unread();
      else if (action === "delete") actions.askDelete();
      else if (action === "close-sheet") {
        const sheet = shell?.querySelector(".sheet");
        if (sheet) closeLayer(sheet);
      } else if (action === "open-sheet") {
        if (!wide()) pane("reader");
        const sheet = shell?.querySelector(".sheet");
        if (sheet) openLayer(sheet, target);
      } else if (action === "cat") {
        shell?.querySelectorAll(".filter").forEach((button3) => {
          button3.setAttribute("aria-pressed", button3.dataset.cat === target.dataset.cat ? "true" : "false");
        });
        actions.assist?.("cat", target.dataset);
      } else if (action === "mode" || action === "tone") {
        target.parentElement?.querySelectorAll("button").forEach((button3) => {
          button3.setAttribute("aria-pressed", button3 === target ? "true" : "false");
        });
      } else if (action === "prompt") {
        const area = shell?.querySelector("#ask");
        if (area) area.value = target.textContent || "";
        actions.assist?.("ask", { text: target.textContent || "" });
      } else if (action) actions.assist?.(action, target.dataset);
    });
    shell.addEventListener("submit", (event) => {
      const form2 = event.target;
      if (form2.classList.contains("composer-form")) return;
      if (form2.dataset.action === "adv-search-form") {
        event.preventDefault();
        const query = serializeSearch(readSearchForm(form2), form2.dataset.multisearch === "1");
        (shell?.querySelector("#search")).value = query;
        form2.closest("dialog").close();
        actions.search(query);
        return;
      }
      if (form2.dataset.action === "folder-dlg-form") return;
      if (form2.dataset.action === "book-search") {
        event.preventDefault();
        return;
      }
      if (form2.dataset.action === "search") {
        event.preventDefault();
        actions.search(form2.querySelector("#search").value.trim());
      } else if (form2.dataset.action === "ask") {
        event.preventDefault();
        const area = form2.querySelector("textarea");
        actions.assist?.("ask", { text: area.value });
      } else if (form2.dataset.action === "settings-form") {
        event.preventDefault();
        const data = {};
        new FormData(form2).forEach((value, key) => {
          data[key] = String(value);
        });
        form2.querySelectorAll("input[type='checkbox']").forEach((box) => {
          if (box.name) data[box.name] = box.checked ? "1" : "";
        });
        if (form2.dataset.kind === "save-script") {
          try {
            const capa = (form2.querySelector("[data-sieve-capa]")?.getAttribute("data-sieve-capa") || "").split(" ").filter(Boolean);
            data.body = compileFilterForm(form2, capa);
          } catch (error) {
            const slot = shell?.querySelector("#settings-error");
            if (slot) {
              slot.className = "error";
              slot.hidden = false;
              slot.textContent = error instanceof Error ? error.message : "Das Skript l\xE4sst sich nicht speichern.";
            }
            return;
          }
        }
        void actions.settings?.(form2.dataset.kind || "", data);
      }
    });
    shell.addEventListener("contextmenu", (event) => {
      const row2 = event.target.closest("#folder-tree .frow");
      if (!row2) return;
      const name = row2.dataset.row || "";
      if (!folderActions.get(name)?.length) return;
      event.preventDefault();
      const mouse = event;
      const fromKeyboard = mouse.clientX === 0 && mouse.clientY === 0;
      openFolderMenu(name, row2, fromKeyboard ? void 0 : { x: mouse.clientX, y: mouse.clientY });
    });
    const folderFilter = shell.querySelector("#folder-q");
    folderFilter.addEventListener("input", () => actions.act("f-filter", { q: folderFilter.value }));
    shell.querySelector(".sidebar")?.addEventListener("keydown", (raw) => {
      const event = raw;
      const current = event.target.closest("#folder-tree .folder");
      if (!current) {
        const menuEl = event.target.closest("#folder-menu");
        if (menuEl && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          const items = [...menuEl.querySelectorAll(".menu-item")];
          const index2 = items.indexOf(event.target);
          items[(index2 + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus({ preventScroll: true });
        }
        return;
      }
      const buttons = folderButtons();
      const index = buttons.indexOf(current);
      const row2 = current.closest(".frow");
      const name = row2?.dataset.row || "";
      const toggle = row2?.querySelector(".ftoggle[aria-expanded]");
      const go = (next) => {
        if (next) {
          event.preventDefault();
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: "nearest" });
        }
      };
      if (event.key === "ArrowDown") go(buttons[index + 1]);
      else if (event.key === "ArrowUp") go(buttons[index - 1]);
      else if (event.key === "Home") go(buttons[0]);
      else if (event.key === "End") go(buttons[buttons.length - 1]);
      else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (toggle?.getAttribute("aria-expanded") === "false") actions.act("f-toggle", { target: name });
        else if (toggle) go(buttons[index + 1]);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (toggle?.getAttribute("aria-expanded") === "true") actions.act("f-toggle", { target: name });
        else {
          const depth = Number(current.dataset.depth || 0);
          if (depth > 0) go(buttons.slice(0, index).reverse().find((item) => Number(item.dataset.depth || 0) < depth));
        }
      }
    });
    shell.addEventListener("change", (event) => {
      const input2 = event.target;
      const syncForm = input2.closest("form[data-kind='save-sync']");
      if (syncForm) {
        const data = {};
        new FormData(syncForm).forEach((value2, key) => {
          data[key] = String(value2);
        });
        void actions.settings?.("save-sync", data);
        return;
      }
      if (input2.name === "appearance") applyAppearance(input2.value);
      const filterPart = event.target.dataset?.part;
      if (filterPart === "field" || filterPart === "type") {
        const row2 = event.target.closest(".rule-line");
        if (row2) syncFilterRow(row2);
      }
      const pref2 = input2.dataset.pref || event.target.dataset?.pref;
      if (!pref2) return;
      const control = event.target;
      let value = "value" in control ? control.value : "";
      if (control instanceof HTMLInputElement && control.type === "checkbox") value = control.checked ? "1" : "0";
      if (pref2 === "DesktopNotifications" && value === "1" && "Notification" in window && Notification.permission !== "granted") {
        void Notification.requestPermission().then((state) => {
          const slot = shell?.querySelector("#settings-error");
          if (state === "denied" && slot) {
            slot.className = "quiet";
            slot.hidden = false;
            slot.textContent = t("SETTINGS_GENERAL.CHROME_NOTIFICATION_DESC_DENIED", "Der Browser hat Hinweise abgelehnt. Die Freigabe liegt in den Browser-Einstellungen.");
          }
        });
      }
      void actions.settings?.("pref", { key: pref2, value });
    });
    shell.addEventListener("dragstart", (event) => {
      const row2 = event.target.closest("[data-sort]");
      if (!row2 || !event.dataTransfer) return;
      if (row2.dataset.sort === "rule") {
        row2.classList.add("dragging-rule");
        event.dataTransfer.setData("application/x-sm-sort", "rule");
        event.dataTransfer.effectAllowed = "move";
        return;
      }
      event.dataTransfer.setData("application/x-sm-sort", `${row2.dataset.sort}:${row2.dataset.email || row2.dataset.id || ""}`);
      event.dataTransfer.effectAllowed = "move";
    });
    shell.addEventListener("dragover", (event) => {
      const row2 = event.target.closest("[data-sort]");
      if (!row2 || !event.dataTransfer?.types.includes("application/x-sm-sort")) return;
      event.preventDefault();
    });
    shell.addEventListener("drop", (event) => {
      const row2 = event.target.closest("[data-sort]");
      const raw = event.dataTransfer?.getData("application/x-sm-sort") || "";
      if (!row2 || !raw) return;
      event.preventDefault();
      if (raw === "rule" && row2.dataset.sort === "rule") {
        const from2 = shell?.querySelector(".dragging-rule");
        if (from2 && from2 !== row2) {
          const nodes = [...row2.parentElement?.children || []];
          if (nodes.indexOf(from2) < nodes.indexOf(row2)) row2.after(from2);
          else row2.before(from2);
        }
        return;
      }
      const [kind, id] = raw.split(":");
      if (row2.dataset.sort !== kind || !id) return;
      const rows2 = [...shell?.querySelectorAll(`[data-sort='${kind}']`) || []];
      const order = rows2.map((item) => (kind === "account" ? item.dataset.email : item.dataset.id) || "").filter(Boolean);
      const from = order.indexOf(id);
      const to = order.indexOf((kind === "account" ? row2.dataset.email : row2.dataset.id) || "");
      if (from < 0 || to < 0 || from === to) return;
      order.splice(from, 1);
      order.splice(to, 0, id);
      void actions.settings?.(kind === "account" ? "sort-accounts" : "sort-identities", { order: order.join(",") });
    });
    shell.addEventListener("dragend", () => shell?.querySelector(".dragging-rule")?.classList.remove("dragging-rule"));
    function editFilterDom(target, action) {
      const form2 = target.closest("form");
      if (!form2) return;
      if (action === "rule-remove") {
        target.closest("[data-rule]")?.remove();
        return;
      }
      if (action === "cond-remove") {
        target.closest("[data-cond]")?.remove();
        return;
      }
      if (action === "act-remove") {
        target.closest("[data-act]")?.remove();
        return;
      }
      const kind = action === "rule-add" ? "rule" : action === "cond-add" ? "cond" : "act";
      const template = form2.querySelector(`[data-${kind}-template]`);
      const host = action === "rule-add" ? form2.querySelector("[data-rule-list]") : target.closest("[data-rule]")?.querySelector(kind === "cond" ? ".conds" : ".acts");
      if (!template || !host) return;
      host.append(template.content.cloneNode(true));
      form2.querySelector("[data-rule-empty]")?.remove();
      const added = host.lastElementChild;
      added?.querySelectorAll(".rule-line").forEach((row2) => syncFilterRow(row2));
    }
    function toggleScriptMode(target) {
      const form2 = target.closest("form");
      if (!form2) return;
      const rawBox = form2.querySelector("[data-part='use-raw']");
      const rawPane = form2.querySelector("[data-editor='raw']");
      const formPane = form2.querySelector("[data-editor='form']");
      const area = form2.querySelector("textarea[name='body']");
      const slot = shell?.querySelector("#settings-error");
      const label2 = target.querySelector(".btn-label");
      const capa = (form2.querySelector("[data-sieve-capa]")?.getAttribute("data-sieve-capa") || "").split(" ").filter(Boolean);
      const fail = (text2) => {
        if (slot) {
          slot.className = "error";
          slot.hidden = false;
          slot.textContent = text2;
        }
      };
      if (!rawBox?.checked) {
        try {
          if (area) area.value = compileFilterForm(form2, capa);
          rawBox && (rawBox.checked = true);
          if (rawPane) rawPane.hidden = false;
          if (formPane) formPane.hidden = true;
          if (label2) label2.textContent = t("SETTINGS_FILTERS.SHOW_RULES", "Als Regeln zeigen");
          if (slot) slot.hidden = true;
        } catch (error) {
          fail(error instanceof Error ? error.message : "Das Skript l\xE4sst sich nicht zeigen.");
        }
        return;
      }
      const parsed = parseFilterScript(area?.value || "");
      if (!parsed.ok) {
        fail(parsed.reason);
        return;
      }
      const list2 = form2.querySelector("[data-rule-list]");
      if (list2) list2.innerHTML = parsed.script.rules.map((rule) => ruleCard(rule, [])).join("");
      const vacation = parsed.script.vacation;
      const set = (part2, value) => {
        const node = form2.querySelector(`[data-part='${part2}']`);
        if (node) node.value = value;
      };
      const on2 = form2.querySelector("[data-part='vacation-on']");
      if (on2) on2.checked = Boolean(vacation?.on);
      set("vacation-from", vacation?.from || "");
      set("vacation-until", vacation?.until || "");
      set("vacation-days", vacation?.days || "7");
      set("vacation-subject", vacation?.subject || "");
      set("vacation-addresses", vacation?.addresses || "");
      set("vacation-text", vacation?.text || "");
      rawBox.checked = false;
      if (rawPane) rawPane.hidden = true;
      if (formPane) formPane.hidden = false;
      if (label2) label2.textContent = t("SETTINGS_FILTERS.EDIT_SCRIPT", "Skript bearbeiten");
      if (slot) slot.hidden = true;
      if (!parsed.script.rules.length && !list2?.childElementCount) list2?.insertAdjacentHTML("beforebegin", "");
    }
    if (keyHandler) document.removeEventListener("keydown", keyHandler);
    keyHandler = (event) => {
      if (!shell?.isConnected || event.defaultPrevented) return;
      const typing = event.target instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(event.target.type) || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLElement && event.target.isContentEditable;
      if (event.key === "Escape") {
        if (shell?.querySelector("dialog[open]")) return;
        if (anyMenuOpen()) {
          const back = menuReturn;
          closeMenu();
          menuReturn = null;
          back?.focus({ preventScroll: true });
          return;
        }
        if (shell?.dataset.full === "true") {
          toggleFullscreen(false);
          return;
        }
        if (!docked() && shell?.dataset.sidebar === "open") {
          setSidebar(false);
          return;
        }
        const bookMenu = shell.querySelector("#book-menu:not([hidden]), #book-add:not([hidden])");
        if (bookMenu) {
          bookMenu.hidden = true;
          const opener2 = shell.querySelector(bookMenu.id === "book-add" ? "[data-op='add-menu']" : "[data-op='more']");
          opener2?.setAttribute("aria-expanded", "false");
          opener2?.focus({ preventScroll: true });
          return;
        }
        const searchField = document.activeElement;
        if (searchField instanceof HTMLInputElement && searchField.id === "search" && searchField.value) {
          event.preventDefault();
          searchField.value = "";
          const status = shell.querySelector("#list-status");
          if (status) status.textContent = "Suche gel\xF6scht";
          actions.clearSearch();
          return;
        }
        if (shell.dataset.surface === "contacts") {
          if (!wide() && shell.dataset.pane === "reader") {
            pane("list");
            return;
          }
          void closeBook();
          return;
        }
        if (!typing && listMode.threadOpen) actions.act("thread-back", {});
        return;
      }
      if (typing || shell.querySelector("dialog[open]")) return;
      const focusedControl = event.target instanceof HTMLButtonElement && !event.target.dataset.uid;
      if (focusedControl && (event.key === "Enter" || event.key === " ")) return;
      if (shell.dataset.surface === "contacts" && event.key !== "\\" && event.key !== "?") {
        book?.onKey(event);
        return;
      }
      const key = event.key.toLowerCase();
      if (event.key === "\\") {
        event.preventDefault();
        if (!wide()) pane(shell?.dataset.pane === "folders" ? "list" : "folders");
        else setSidebar(shell?.dataset.sidebar !== "open");
      } else if (event.key === "?") {
        event.preventDefault();
        (shell?.querySelector("#keys")).showModal();
      } else if (event.key === "." && (event.ctrlKey || event.metaKey) && shell?.querySelector(".sheet")) {
        event.preventDefault();
        if (!wide()) pane("reader");
        openLayer(shell.querySelector(".sheet"), null);
      } else if (key === "a" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        actions.act("select-all", {});
      } else if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      } else if (key === "r" && event.shiftKey) actions.act("refresh", {});
      else if (event.key === "Delete" && event.shiftKey) actions.act("delete-forever", {});
      else if (event.key === "Delete" || event.key === "#") actions.askDelete();
      else if (event.key === "*") actions.act("select-all", {});
      else if (key === "c") {
        event.preventDefault();
        composer?.armInstant();
        actions.compose();
      } else if (key === "r") {
        event.preventDefault();
        composer?.armInstant();
        actions.reply(false);
      } else if (key === "a") {
        event.preventDefault();
        composer?.armInstant();
        actions.reply(true);
      } else if (key === "f") {
        event.preventDefault();
        composer?.armInstant();
        actions.forward();
      } else if (key === "e") actions.archive();
      else if (key === "i") actions.act("flag", {});
      else if (key === "u" && event.shiftKey) actions.markRead();
      else if (key === "u") actions.markUnread();
      else if (key === "v") {
        event.preventDefault();
        toggleFullscreen();
      } else if (key === "q") {
        event.preventDefault();
        actions.quotes();
      } else if (event.key === "," && shell.querySelector(".composer:not([hidden])")) {
        event.preventDefault();
        composer?.minimize();
      } else if (key === "1" || key === "2" || key === "3") {
        event.preventDefault();
        const target = key === "1" ? "folders" : key === "2" ? "list" : "reader";
        if (!wide() || key === "1") pane(target === "folders" ? "folders" : target === "reader" ? "reader" : "list");
        const focus = shell.querySelector(key === "1" ? ".sidebar button" : key === "2" ? "[data-uid]" : ".reader button");
        focus?.focus({ preventScroll: true });
      } else if (key === "m") {
        event.preventDefault();
        actions.act("move", {});
      } else if (key === "t") {
        event.preventDefault();
        actions.act("thread", {});
      } else if (key === "j" || key === "k" || event.key === "Enter") {
        event.preventDefault();
        moveSelection(key === "k" ? -1 : key === "j" ? 1 : 0);
      }
    };
    document.addEventListener("keydown", keyHandler);
    shell.addEventListener("dragstart", (event) => {
      const row2 = event.target.closest("[data-uid]");
      if (!row2 || !event.dataTransfer) return;
      event.dataTransfer.setData("application/x-sm-uid", row2.dataset.uid || "");
      event.dataTransfer.effectAllowed = "copyMove";
      shell?.classList.add("dragging");
    });
    shell.addEventListener("dragend", () => {
      shell?.classList.remove("dragging");
      shell?.querySelectorAll(".folder.drop").forEach((node) => node.classList.remove("drop"));
    });
    shell.addEventListener("dragover", (event) => {
      const folder = event.target.closest(".folder[data-folder]");
      if (!folder || !event.dataTransfer?.types.includes("application/x-sm-uid")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = event.ctrlKey || event.altKey ? "copy" : "move";
      shell?.querySelectorAll(".folder.drop").forEach((node) => {
        if (node !== folder) node.classList.remove("drop");
      });
      folder.classList.add("drop");
    });
    shell.addEventListener("dragleave", (event) => {
      const folder = event.target.closest(".folder[data-folder]");
      if (folder && !folder.contains(event.relatedTarget)) folder.classList.remove("drop");
    });
    shell.addEventListener("drop", (event) => {
      const folder = event.target.closest(".folder[data-folder]");
      const uid = event.dataTransfer?.getData("application/x-sm-uid");
      if (!folder || !uid) return;
      event.preventDefault();
      folder.classList.remove("drop");
      actions.act("drop", { uid, folder: folder.dataset.folder || "", copy: event.ctrlKey || event.altKey ? "1" : "" });
    });
    separator.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      separator.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startW = list.getBoundingClientRect().width;
      const move = (ev) => setListWidth(startW + ev.clientX - startX);
      const up = () => {
        separator.removeEventListener("pointermove", move);
        separator.removeEventListener("pointerup", up);
      };
      separator.addEventListener("pointermove", move);
      separator.addEventListener("pointerup", up);
    });
    separator.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 16 : -16;
      setListWidth(list.getBoundingClientRect().width + delta);
    });
    const confirm = shell.querySelector("#confirm");
    confirm.addEventListener("click", (event) => {
      const button3 = event.target.closest("button");
      if (button3) confirm.close(button3.value);
    });
  }
  function moveSelection(delta) {
    const rows2 = [...shell?.querySelectorAll("[data-uid]") ?? []];
    if (!rows2.length) return;
    const index = rows2.findIndex((row3) => row3.getAttribute("aria-current") === "true");
    const next = delta === 0 ? Math.max(index, 0) : Math.min(rows2.length - 1, Math.max(0, index + delta));
    const row2 = rows2[next];
    if (!row2) return;
    actions.selectMessage(Number(row2.dataset.uid));
    row2.scrollIntoView({ block: "nearest" });
    if (!wide()) pane("reader");
  }
  function installAssist(flags) {
    shell?.querySelectorAll("[data-assist-node]").forEach((node) => node.remove());
    if (!shell) return;
    if (flags.alerts) {
      const block = document.createElement("div");
      const deadlineLabel = t("AI_COPILOT.CHECK_DUE", "Fristen mit KI auslesen");
      const deadlineHint = t("AI_COPILOT.CHECK_DUE_HINT", "Fristen und F\xE4lligkeiten mit KI aus den Mails lesen");
      block.innerHTML = `
        <p class="group-label mono">Heute</p>
        <button type="button" class="count-row" data-action="alert" data-kind="reply"><span>Offene Antworten</span><span class="count" data-count="reply">0</span></button>
        <button type="button" class="count-row" data-action="alert" data-kind="follow"><span>Ohne Antwort</span><span class="count" data-count="follow">0</span></button>
        <button type="button" class="count-row" data-action="alert" data-kind="invoice"><span>Rechnungen</span><span class="count" data-count="invoice">0</span></button>
        <p class="quiet" id="dues"></p>
        <button type="button" class="text-btn ai-action" data-action="deadlines" aria-label="${esc9(deadlineHint)}" title="${esc9(deadlineHint)}">${withAssist(deadlineLabel)}</button>`;
      shell.querySelector(".account")?.after(block);
    }
    const searchForm = shell.querySelector(".search-wrap");
    if (flags.triage && searchForm) {
      const filters = document.createElement("div");
      filters.className = "filters";
      filters.setAttribute("role", "toolbar");
      filters.setAttribute("aria-label", "Filter");
      const cats = [["all", "Alle"], ...Object.entries(CATEGORY)];
      const triageHint = t("AI_COPILOT.TRIAGE_LLM_HINT", "Mails dieser Seite mit KI einordnen");
      filters.innerHTML = cats.map(
        ([id, label2], index) => `<button type="button" class="filter" data-action="cat" data-cat="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc9(id === "all" ? t("AI_COPILOT.TAB_ALL", label2) : t("AI_COPILOT.CAT_" + id.toUpperCase(), label2))}</button>`
      ).join("") + (flags.triageLlm ? `<button type="button" class="text-btn ai-action" data-action="triage" aria-label="${esc9(triageHint)}" title="${esc9(triageHint)}">${withAssist(t("AI_COPILOT.TRIAGE_LLM", "Mit KI einordnen"))}</button>` : "");
      searchForm.after(filters);
    }
    if (flags.search && searchForm) {
      const button3 = document.createElement("button");
      const searchHint = t("AI_COPILOT.SEARCH_HINT", "Suchtext als nat\xFCrliche Sprache mit KI verstehen");
      button3.type = "button";
      button3.className = "text-btn ai-action";
      button3.dataset.action = "lang-search";
      button3.hidden = true;
      button3.innerHTML = withAssist(t("AI_COPILOT.SEARCH_INTERPRET", "Suchanfrage mit KI interpretieren"));
      button3.title = searchHint;
      button3.setAttribute("aria-label", searchHint);
      searchForm.append(button3);
      const hint = document.createElement("div");
      hint.id = "translated";
      hint.hidden = true;
      hint.className = "translate";
      hint.innerHTML = `<div class="translate-copy"><span class="mono quiet">${esc9(t("AI_COPILOT.SEARCH_SUGGESTION", "Vorgeschlagene Suche"))}</span><p class="quiet" id="translate-why"></p></div><input class="search" id="translate-q" aria-label="${esc9(t("AI_COPILOT.SEARCH_SUGGESTION", "Vorgeschlagene Suche"))}"><button type="button" class="ink-btn" data-action="run-search">${esc9(t("AI_COPILOT.SEARCH_RUN", "Suchen"))}</button>`;
      searchForm.after(hint);
      const input2 = shell.querySelector("#search");
      input2.addEventListener("input", () => {
        button3.hidden = !input2.value.trim();
      });
    }
    if (flags.summarize || flags.replies) {
      const strip = document.createElement("section");
      strip.id = "strip";
      strip.className = "assist-strip";
      strip.setAttribute("aria-label", t("AI_COPILOT.PANEL_LABEL", "KI-Unterst\xFCtzung f\xFCr diese Mail"));
      strip.setAttribute("aria-live", "polite");
      shell.querySelector("#reader-body")?.before(strip);
    }
    if (flags.chat) {
      const ask = document.createElement("button");
      const askHint = t("AI_COPILOT.ASK_COPILOT_HINT", "Mit KI im Copilot-Chat zu dieser Mail fragen");
      ask.type = "button";
      ask.className = "text-btn assist-trigger ai-action";
      ask.dataset.action = "open-sheet";
      ask.innerHTML = withAssist(t("AI_COPILOT.ASK_COPILOT", "Copilot fragen"));
      ask.classList.add("bar-btn", "primary");
      ask.title = askHint;
      ask.setAttribute("aria-label", askHint);
      shell.querySelector(".reader-bar")?.append(ask);
      const sheet = document.createElement("aside");
      sheet.className = "sheet";
      sheet.hidden = true;
      sheet.setAttribute("aria-labelledby", "copilot-title");
      sheet.innerHTML = `
        <div class="sheet-head">
          <h2 class="title title-md" id="copilot-title">${esc9(t("AI_COPILOT.ASK_COPILOT", "Copilot fragen"))}</h2>
          <span class="spacer"></span>
          <button type="button" class="icon-btn" data-action="close-sheet" aria-label="${esc9(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
        </div>
        <div class="sheet-meta mono quiet">${esc9(flags.provider)}</div>
        <div class="sheet-log" id="chat-log">
          <p class="quiet">${esc9(t("AI_COPILOT.CHAT_EMPTY", "Fragen Sie zum Beispiel, welche Mails auf eine Antwort warten."))}</p>
          <div class="prompts">
            <button type="button" class="prompt" data-action="prompt">Welche Mails warten auf meine Antwort?</button>
            <button type="button" class="prompt" data-action="prompt">Zeig mir Rechnungen vom letzten Monat</button>
            <button type="button" class="prompt" data-action="prompt">Fasse die ge\xF6ffnete Mail zusammen</button>
          </div>
        </div>
        <button type="button" class="text-btn context-chip" data-action="drop-context" id="context-chip" hidden></button>
        <form class="sheet-form" data-action="ask">
          <label class="sr" for="ask">${esc9(t("AI_COPILOT.CHAT_PLACEHOLDER", "Nachricht an Copilot \u2026"))}</label>
          <textarea id="ask" rows="2" placeholder="${esc9(t("AI_COPILOT.CHAT_PLACEHOLDER", "Nachricht an Copilot \u2026"))}"></textarea>
          <button type="submit" class="ink-btn">${esc9(t("AI_COPILOT.SEND", "Senden"))}</button>
        </form>
        <p class="error sheet-error" id="chat-error" role="alert" hidden></p>`;
      shell.querySelector(".reader")?.append(sheet);
    }
    if (flags.draft) {
      const tools = document.createElement("div");
      tools.className = "draft-tools";
      const tones = [["professional", "Professionell"], ["friendly", "Freundlich"], ["casual", "Locker"], ["concise", "Knapp"], ["formal", "F\xF6rmlich"]];
      tools.innerHTML = `
        <div class="draft-heading"><span class="mono quiet">${esc9(t("AI_COPILOT.DRAFT_ASSIST", "KI-Entwurf"))}</span><span class="quiet">${esc9(t("AI_COPILOT.DRAFT_EDIT_HINT", "Sie k\xF6nnen das Ergebnis vor dem Senden bearbeiten."))}</span></div>
        <div class="modes" role="toolbar" aria-label="Art">
          <button type="button" class="seg" data-action="mode" data-mode="new" aria-pressed="true">Neue Mail</button>
          <button type="button" class="seg" data-action="mode" data-mode="reply" aria-pressed="false">Antwort</button>
          <button type="button" class="seg" data-action="mode" data-mode="rewrite" aria-pressed="false">Umschreiben</button>
          <button type="button" class="seg" data-action="mode" data-mode="proofread" aria-pressed="false">Korrektur</button>
        </div>
        <label class="field"><span>Anweisung</span><input id="instruction" type="text" placeholder="${esc9(t("AI_COPILOT.INSTRUCTION_PLACEHOLDER", "Was soll die Mail sagen?"))}"></label>
        <div class="tones" role="toolbar" aria-label="Ton">
          ${tones.map(([id, label2], index) => `<button type="button" class="seg" data-action="tone" data-tone="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc9(t("AI_COPILOT.TONE_" + id.toUpperCase(), label2))}</button>`).join("")}
        </div>
        <div class="draft-actions">
          <button type="button" class="ink-btn ai-action" data-action="generate" title="${esc9(t("AI_COPILOT.DRAFT_HINT", "Entwurf mit KI erzeugen"))}">${withAssist(t("AI_COPILOT.GENERATE", "Entwurf mit KI erzeugen"))}</button>
          <button type="button" class="text-btn" data-action="stop-generate" hidden>${withIcon("stop", t("AI_COPILOT.STOP", "Stopp"))}</button>
          <button type="button" class="text-btn" data-action="revert-draft" hidden>${esc9(t("AI_COPILOT.REVERT_DRAFT", "Vorherigen Text wiederherstellen"))}</button>
        </div>
        <p class="subject-hint" id="subject-hint" hidden><span></span><button type="button" class="text-btn" data-action="apply-subject">${esc9(t("AI_COPILOT.APPLY_SUBJECT", "\xDCbernehmen"))}</button></p>
        <p class="quiet" id="draft-status" role="status" aria-live="polite"></p>`;
      shell.querySelector(".fields")?.prepend(tools);
    }
    const consent = document.createElement("dialog");
    consent.id = "consent";
    consent.innerHTML = `
      <div class="dialog-body">
        <h2 class="title title-md">Assistent</h2>
        <p id="consent-text"></p>
        <div class="dialog-actions">
          <button type="button" class="text-btn" value="cancel">${esc9(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
          <button type="button" class="ink-btn" value="ok">Fortfahren</button>
        </div>
      </div>`;
    consent.addEventListener("click", (event) => {
      const button3 = event.target.closest("button");
      if (button3) consent.close(button3.value);
    });
    shell.append(consent);
    shell.querySelectorAll(".filters, #strip, .sheet, .draft-tools, #consent, [data-action='open-sheet'], [data-action='lang-search'], #translated").forEach((node) => {
      node.dataset.assistNode = "1";
    });
    const alerts = shell.querySelector("[data-action='alert']")?.parentElement;
    if (alerts) alerts.dataset.assistNode = "1";
  }
  function paintSettings() {
    const panel = shell?.querySelector("#settings-panel");
    if (!panel) return;
    shell?.querySelectorAll("[data-section]").forEach((button3) => {
      const id = button3.dataset.section || "";
      button3.setAttribute("aria-pressed", id === section ? "true" : "false");
      if (id === "contacts") button3.hidden = !snap?.app.ContactsSync;
      if (id === "filters") button3.hidden = !snap?.caps.sieve;
      if (id === "assistant") button3.hidden = !(snap?.app.Plugins || {})["ai-copilot"];
    });
    panel.innerHTML = section === "folders" ? renderFolderDesk(folderDesk, edit) : renderDesk(section, snap, edit);
    if (edit) {
      const scope = section === "folders" ? panel.querySelector("form[data-kind='folder-save'], form[data-kind='folder-create']") || panel : panel;
      const field2 = scope.querySelector("input:not([type='hidden']), select, textarea");
      field2?.focus({ preventScroll: true });
      if (section === "folders") field2?.closest("form")?.scrollIntoView({ block: "nearest" });
    }
  }
  function openFolderSettings(fullName) {
    const dialog = shell?.querySelector("#settings");
    if (!dialog) return;
    section = "folders";
    edit = fullName ? { kind: "folder", id: fullName, fresh: false } : null;
    const opening = !dialog.open;
    if (opening && fullName) {
      dialog.addEventListener("close", () => {
        const back = shell?.querySelector(`.frow[data-row="${CSS.escape(fullName)}"] .fmore, .frow[data-row="${CSS.escape(fullName)}"] .folder`);
        back?.focus({ preventScroll: true });
      }, { once: true });
    }
    if (opening) {
      if (!edit) dialog.showModal();
      else {
        paintSettings();
        dialog.showModal();
      }
      void actions.settings?.("open", {});
    }
    paintSettings();
    actions.act("f-desk", {});
  }
  function promptDialog(title, label2, value, secret) {
    const dialog = shell?.querySelector("#prompt-dlg");
    if (!dialog) return Promise.resolve(null);
    const input2 = dialog.querySelector("#prompt-input");
    const form2 = dialog.querySelector("form");
    const rememberRow = dialog.querySelector("#prompt-remember-row");
    const remember = dialog.querySelector("#prompt-remember");
    dialog.querySelector("#prompt-title").textContent = title;
    dialog.querySelector("#prompt-label").textContent = label2;
    input2.type = secret ? "password" : "text";
    input2.autocomplete = secret ? "current-password" : "off";
    input2.value = value;
    remember.checked = false;
    rememberRow.hidden = !secret;
    dialog.returnValue = "";
    dialog.showModal();
    input2.focus({ preventScroll: true });
    return new Promise((resolve) => {
      const onSubmit = (event) => {
        event.preventDefault();
        event.stopPropagation();
        dialog.close("ok");
      };
      form2.addEventListener("submit", onSubmit);
      dialog.addEventListener("close", () => {
        form2.removeEventListener("submit", onSubmit);
        input2.type = "text";
        rememberRow.hidden = true;
        resolve(dialog.returnValue === "ok" ? { value: input2.value, remember: remember.checked } : null);
      }, { once: true });
    });
  }
  return {
    showLogin,
    setLoginBusy,
    setLoginError,
    showMail,
    setFolders(data) {
      const tree = shell?.querySelector("#folder-tree");
      if (!tree || !shell) return;
      const active = document.activeElement;
      const keep = active && tree.contains(active) ? { key: active.dataset.folder || active.dataset.target || "", cls: active.classList.contains("fmore") ? ".fmore" : active.classList.contains("ftoggle") ? ".ftoggle" : ".folder" } : null;
      folderActions = new Map(data.rows.map((row2) => [row2.info.fullName, row2.actions]));
      tree.innerHTML = renderSidebarRows(data.rows, Boolean(data.filter.trim()));
      if (keep?.key) {
        const sel = keep.cls === ".folder" ? `.frow[data-row="${CSS.escape(keep.key)}"] .folder` : `.frow[data-row="${CSS.escape(keep.key)}"] ${keep.cls}`;
        tree.querySelector(sel)?.focus({ preventScroll: true });
      }
      const filter = shell.querySelector(".folder-filter");
      filter.hidden = data.count <= 15 && !data.filter;
      shell.querySelector("[data-action='f-create']").hidden = !data.canCreate;
      shell.querySelector("#quota").innerHTML = renderQuota(data.quota);
      if (data.currentName) {
        const title = shell.querySelector("#folder-title");
        title.textContent = data.currentName;
        title.title = data.currentName;
        shell.querySelector("#reader-place").textContent = data.currentName;
        const search = shell.querySelector("#search");
        if (document.activeElement !== search) search.placeholder = `In ${data.currentName} suchen`;
      }
    },
    setFolderDesk(desk) {
      folderDesk = desk;
      const dialog = shell?.querySelector("#settings");
      if (dialog?.open && section === "folders" && !edit) {
        const panel = shell?.querySelector("#settings-panel");
        const top = panel?.closest(".dialog-body")?.scrollTop || 0;
        paintSettings();
        const body = panel?.closest(".dialog-body");
        if (body) body.scrollTop = top;
      }
    },
    showAcl(folder, html) {
      const dialog = shell?.querySelector("#acl-dlg");
      if (!dialog) return;
      dialog.querySelector("#acl-title").textContent = `${t("FOLDERS_UI.SHARING", "Freigaben")}: ${folder}`;
      dialog.querySelector("#acl-body").innerHTML = html;
      if (!dialog.open) dialog.showModal();
    },
    setListMode(mode) {
      listMode = mode;
      if (!shell) return;
      shell.dataset.thread = mode.threadOpen ? "open" : "";
      const bar2 = shell.querySelector("#thread-bar");
      bar2.hidden = !mode.threadOpen;
      shell.querySelector("#thread-label").textContent = mode.threadOpen ? `${t("FOLDERS_UI.THREAD", "Unterhaltung")}: ${mode.threadOpen}` : "";
      paintViewMenu();
    },
    setSearch(query, quick) {
      const input2 = shell?.querySelector("#search");
      if (input2 && input2.value.trim() !== query) input2.value = query;
      const fieldClear = shell?.querySelector(".search-clear");
      if (fieldClear) fieldClear.hidden = !input2?.value.trim();
      const names = {
        from: "Von",
        to: "An",
        subject: "Betreff",
        text: "Text",
        body: "Text",
        since: "Seit",
        before: "Bis",
        attachment: "Mit Anhang",
        unseen: "Ungelesen",
        flagged: "Markiert"
      };
      const box = shell?.querySelector("#criteria");
      if (box) {
        const chips = query.includes("=") ? [...new URLSearchParams(query).entries()].flatMap(([key, value]) => {
          const name = names[key];
          if (!name) return [];
          const label2 = value ? `${name}: ${value}` : name;
          return [`<button type="button" class="chip criterion" data-action="drop-criterion" data-key="${esc9(key)}" aria-label="${esc9(label2)} entfernen">${icon("filter")}<span>${esc9(label2)}</span>${icon("close")}</button>`];
        }) : [];
        box.hidden = chips.length === 0;
        box.innerHTML = chips.join("");
      }
      shell?.querySelectorAll("[data-action='quick']").forEach((button3) => {
        button3.setAttribute("aria-pressed", quick.has(button3.dataset.flag) ? "true" : "false");
      });
    },
    openSearch(criteria, options2) {
      const dialog = shell?.querySelector("#adv-search");
      if (!dialog) return;
      const form2 = dialog.querySelector("form");
      form2.dataset.multisearch = options2.multisearch ? "1" : "";
      dialog.querySelector("#adv-body").innerHTML = renderSearchForm(criteria, options2);
      dialog.showModal();
      form2.querySelector("input[name='from']")?.focus({ preventScroll: true });
    },
    folderDialog(options2) {
      const dialog = shell?.querySelector("#folder-dlg");
      if (!dialog) return Promise.resolve(null);
      const form2 = dialog.querySelector("form");
      const name = dialog.querySelector("#folder-dlg-name");
      const parent = dialog.querySelector("#folder-dlg-parent");
      const sub = dialog.querySelector("#folder-dlg-sub");
      dialog.querySelector("#folder-dlg-title").textContent = options2.title;
      parent.innerHTML = options2.parents.map((item) => `<option value="${esc9(item.value)}"${item.value === options2.parent ? " selected" : ""}>${esc9(item.label)}</option>`).join("");
      name.value = "";
      sub.checked = true;
      dialog.returnValue = "";
      dialog.showModal();
      name.focus({ preventScroll: true });
      return new Promise((resolve) => {
        const onSubmit = (event) => {
          event.preventDefault();
          if (!name.value.trim()) return;
          dialog.close("ok");
        };
        form2.addEventListener("submit", onSubmit);
        dialog.addEventListener("close", () => {
          form2.removeEventListener("submit", onSubmit);
          resolve(dialog.returnValue === "ok" ? { name: name.value.trim(), parent: parent.value, subscribe: sub.checked } : null);
        }, { once: true });
      });
    },
    openFolderSettings,
    setList(rows2, empty, error, more, searching) {
      const box = shell?.querySelector("#rows");
      const emptyEl = shell?.querySelector("#list-empty");
      const errorEl = shell?.querySelector("#list-error");
      const moreBtn = shell?.querySelector("[data-action='more']");
      const clearBtn = shell?.querySelector("[data-clear='list']");
      const result = shell?.querySelector("#list-result");
      if (box) {
        box.innerHTML = rows2.map((row2) => {
          const subject = row2.subject || "(ohne Betreff)";
          const group2 = row2.group ? `<h2 class="list-group mono">${esc9(row2.group)}</h2>` : "";
          const threadText = row2.threadCount ? `${t("FOLDERS_UI.THREAD_OPEN", "Unterhaltung \xF6ffnen")}: ${row2.threadCount} ${t("FOLDERS_UI.MAILS", "Mails")}${row2.threadUnseen ? `, ${row2.threadUnseen} ${t("FOLDERS_UI.UNREAD", "ungelesen")}` : ""}` : "";
          const thread = row2.threadCount ? `<button type="button" class="msg-thread${row2.threadUnseen ? " unseen" : ""}" data-action="m-thread" data-ref="${row2.uid}" aria-label="${esc9(`${threadText} \u2013 ${subject}`)}" title="${esc9(threadText)} (T)">${icon("thread")}<span>${row2.threadCount}</span></button>` : "";
          return `${group2}
          <div class="msg-row${row2.threadCount ? " has-thread" : ""}${row2.checked ? " checked" : ""}${row2.deleted ? " deleted" : ""}${row2.unseen ? " unseen" : ""}">
            <span class="unread-slot" aria-hidden="true">${row2.unseen ? `<span class="unread-mark"></span>` : ""}</span>
            <input type="checkbox" class="msg-check" data-action="m-check" data-ref="${row2.uid}"${row2.checked ? " checked" : ""} aria-label="Ausw\xE4hlen: ${esc9(subject)}">
            <button type="button" class="msg${row2.unseen ? " unseen" : ""}" data-uid="${row2.uid}" draggable="true" aria-current="${row2.current ? "true" : "false"}">
              <span class="who">${esc9(row2.who)}</span>
              <span class="when">${rowMarks({ ...row2, flagged: false })}${esc9(row2.when)}</span>
              <span class="subj">${esc9(subject)}${categoryMark(row2.category)}</span>
              <span class="peek">${esc9(row2.preview)}</span>
            </button>
            ${thread}
            <button type="button" class="msg-flag" data-action="m-flag" data-ref="${row2.uid}" aria-pressed="${row2.flagged ? "true" : "false"}" aria-label="${row2.flagged ? "Markierung entfernen" : "Markieren"}: ${esc9(subject)}" title="${row2.flagged ? "Markierung entfernen" : "Markieren"}">${icon(row2.flagged ? "flag-filled" : "flag")}</button>
          </div>`;
        }).join("");
      }
      if (emptyEl) {
        emptyEl.hidden = !empty;
        emptyEl.textContent = empty;
      }
      if (errorEl) {
        errorEl.hidden = !error;
        errorEl.textContent = error;
      }
      if (moreBtn) moreBtn.hidden = !more;
      if (clearBtn) clearBtn.hidden = !searching;
      if (result) {
        result.hidden = !searching;
        result.textContent = searching ? rows2.length ? `Ergebnisse \xB7 ${rows2.length}` : "Keine Treffer" : "";
      }
    },
    setReader(data, loading2, error) {
      if (shell) shell.dataset.reading = data ? "1" : "0";
      const body = shell?.querySelector("#reader-body");
      const addContact = shell?.querySelector("[data-action='m-addr-contact']");
      if (addContact) addContact.hidden = !data?.contacts;
      paintBar(data);
      if (!body) return;
      body.replaceChildren();
      const say = (className, text2) => {
        const p = document.createElement("p");
        p.className = className;
        p.textContent = text2;
        body.append(p);
      };
      if (loading2) return say("quiet", loading2);
      if (error) return say("error", error);
      if (!data) {
        body.innerHTML = `<div class="empty reader-empty">${icon("inbox")}<p>W\xE4hlen Sie eine Mail.</p></div>`;
        return;
      }
      renderReader(body, data, expanded);
      body.scrollTop = 0;
    },
    setBulk(data) {
      const body = shell?.querySelector("#reader-body");
      paintBar(null);
      if (body) renderBulk(body, data);
      if (!wide()) pane("reader");
    },
    setChecks(visible) {
      shell?.classList.toggle("with-checks", visible);
    },
    setRefreshing(busy) {
      const button3 = shell?.querySelector("[data-action='m-refresh']");
      if (!button3) return;
      button3.disabled = busy;
      button3.innerHTML = icon(busy ? "loading" : "refresh");
      const status = shell?.querySelector("#list-status");
      if (status) status.textContent = busy ? "Wird aktualisiert \u2026" : "";
    },
    setAccounts(items) {
      const box = shell?.querySelector("#account-list");
      if (!box) return;
      const others = items.filter((item) => !item.current);
      box.innerHTML = others.length ? `<p class="menu-label mono">Konten</p>` + others.map(
        (item) => `<button type="button" class="menu-item" role="menuitem" data-action="m-switch" data-email="${esc9(item.email)}">${icon("user")}<span class="grow">${esc9(item.email)}</span>${item.unread ? `<span class="count">${item.unread}</span>` : ""}</button>`
      ).join("") + `<hr class="menu-sep">` : "";
    },
    pickFolder(title, folders, exclude) {
      const dialog = shell?.querySelector("#picker");
      if (!dialog) return Promise.resolve(null);
      const list = dialog.querySelector("#picker-list");
      const query = dialog.querySelector("#picker-q");
      dialog.querySelector("#picker-title").textContent = title;
      const paint = () => {
        const q = query.value.trim().toLowerCase();
        const rows2 = folders.filter((folder) => folder.fullName !== exclude && (!q || folder.fullName.toLowerCase().includes(q)));
        list.innerHTML = rows2.map(
          (folder) => `<button type="button" class="folder" role="option" data-pick="${esc9(folder.fullName)}" style="padding-left:${8 + (q ? 0 : folder.depth) * 12}px">${icon(ROLE_ICON2[folder.role] || (folder.fullName.toUpperCase() === "INBOX" ? "inbox" : "folder"))}<span class="folder-name">${esc9(q ? folder.fullName : folder.name)}</span></button>`
        ).join("") || `<p class="quiet">Kein Ordner gefunden.</p>`;
      };
      query.value = "";
      paint();
      dialog.returnValue = "";
      dialog.showModal();
      query.focus({ preventScroll: true });
      return new Promise((resolve) => {
        const onInput = () => paint();
        const onClick = (event) => {
          const button3 = event.target.closest("[data-pick]");
          if (button3) dialog.close(button3.dataset.pick || "");
        };
        const onKey = (event) => {
          if (event.key === "Enter" && event.target === query) {
            event.preventDefault();
            const first = list.querySelector("[data-pick]");
            if (first) dialog.close(first.dataset.pick || "");
          }
          if (event.key === "ArrowDown" && event.target === query) {
            event.preventDefault();
            list.querySelector("[data-pick]")?.focus();
          }
        };
        query.addEventListener("input", onInput);
        list.addEventListener("click", onClick);
        dialog.addEventListener("keydown", onKey);
        dialog.addEventListener("close", () => {
          query.removeEventListener("input", onInput);
          list.removeEventListener("click", onClick);
          dialog.removeEventListener("keydown", onKey);
          resolve(dialog.returnValue || null);
        }, { once: true });
      });
    },
    ask(title, label2, value = "") {
      return promptDialog(title, label2, value, false).then((row2) => row2?.value ?? null);
    },
    askSecret(title, label2) {
      return promptDialog(title, label2, "", true);
    },
    confirm(title, text2, ok, danger = true) {
      return chooseDialog(title, text2, ok, "", danger).then((value) => value === "ok");
    },
    setBook(allowed, sync, mode) {
      shell?.querySelectorAll("[data-book-entry]").forEach((button3) => {
        button3.hidden = !allowed;
      });
      book?.setSync(sync, mode);
      if (!allowed) void closeBook();
    },
    reloadBook() {
      return book?.reload() || Promise.resolve();
    },
    preview(name, url, kind) {
      const dialog = shell?.querySelector("#lightbox");
      if (!dialog) return;
      dialog.querySelector("#lightbox-title").textContent = name;
      dialog.querySelector("#lightbox-open").href = url;
      const box = dialog.querySelector("#lightbox-body");
      box.replaceChildren();
      if (kind === "image") {
        const img = document.createElement("img");
        img.src = url;
        img.alt = name;
        box.append(img);
      } else {
        const frame = document.createElement("iframe");
        frame.src = url;
        frame.title = name;
        if (kind === "text") frame.setAttribute("sandbox", "");
        box.append(frame);
      }
      dialog.showModal();
    },
    configureCompose(prefs, identities) {
      composePrefs = prefs;
      composeIdentities = identities;
      composer?.configure(prefs, identities);
    },
    openCompose(seed) {
      composer?.open(seed);
    },
    closeCompose() {
      composer?.sent();
    },
    attachCompose(items) {
      return composer?.attachFrom(items) || Promise.resolve();
    },
    setSendState(busy, error) {
      if (!busy || error) composer?.setError(error);
    },
    notice(text2) {
      const slot = shell?.querySelector("#notice");
      if (slot) slot.textContent = text2;
    },
    confirmDelete() {
      return this.confirm("Wirklich l\xF6schen?", "", t("GLOBAL.DELETE", "L\xF6schen"));
    },
    confirmConsent(text2) {
      const dialog = shell?.querySelector("#consent");
      const slot = shell?.querySelector("#consent-text");
      if (!dialog || !slot) return Promise.resolve(true);
      slot.textContent = text2;
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      });
    },
    pressCategory(id) {
      shell?.querySelectorAll(".filter").forEach((button3) => {
        button3.setAttribute("aria-pressed", button3.dataset.cat === id ? "true" : "false");
      });
    },
    setAlerts(reply, follow, invoice, dues) {
      const write = (name, value) => {
        const slot = shell?.querySelector(`[data-count='${name}']`);
        if (slot) slot.textContent = String(value);
      };
      write("reply", reply);
      write("follow", follow);
      write("invoice", invoice);
      const line2 = shell?.querySelector("#dues");
      if (line2) line2.textContent = dues;
    },
    setStrip(state) {
      const strip = shell?.querySelector("#strip");
      if (!strip) return;
      strip.replaceChildren();
      if (!state) return;
      if (state.loading) {
        const p = document.createElement("p");
        p.className = "assist-status quiet";
        p.setAttribute("role", "status");
        p.textContent = state.loading;
        strip.append(p);
        return;
      }
      if (state.error) {
        const p = document.createElement("p");
        p.className = "error assist-status";
        p.setAttribute("role", "alert");
        p.textContent = state.error;
        strip.append(p);
      }
      const actions2 = document.createElement("div");
      actions2.className = "assist-actions";
      if (!state.tldr && state.showSummarize) {
        const button3 = document.createElement("button");
        const hint = t("AI_COPILOT.SUMMARIZE_HINT", "Verlauf mit KI zusammenfassen");
        button3.type = "button";
        button3.className = "text-btn assist-action ai-action";
        button3.dataset.action = "summarize";
        button3.innerHTML = withAssist(t("AI_COPILOT.SUMMARIZE", "Mit KI zusammenfassen"));
        button3.title = hint;
        button3.setAttribute("aria-label", hint);
        actions2.append(button3);
      }
      if (state.showReplies && !state.replies.length) {
        const replies = document.createElement("button");
        const hint = t("AI_COPILOT.QUICK_REPLIES_HINT", "Drei Antwortvorschl\xE4ge mit KI erzeugen");
        replies.type = "button";
        replies.className = "text-btn assist-action ai-action";
        replies.dataset.action = "replies";
        replies.innerHTML = withAssist(t("AI_COPILOT.QUICK_REPLIES", "Antworten mit KI vorschlagen"));
        replies.title = hint;
        replies.setAttribute("aria-label", hint);
        actions2.append(replies);
      }
      if (actions2.childElementCount) strip.append(actions2);
      if (state.tldr) {
        const result = document.createElement("div");
        result.className = "assist-result";
        const label2 = document.createElement("span");
        label2.className = "mono quiet";
        label2.textContent = t("AI_COPILOT.SUMMARY", "Zusammenfassung");
        const text2 = document.createElement("p");
        text2.className = "assist-summary";
        text2.textContent = state.tldr;
        const meta = document.createElement("div");
        meta.className = "assist-meta";
        const again = document.createElement("button");
        const hint = t("AI_COPILOT.SUMMARIZE_HINT", "Verlauf erneut mit KI zusammenfassen");
        again.type = "button";
        again.className = "text-btn ai-action";
        again.dataset.action = "summarize";
        again.dataset.force = "1";
        again.innerHTML = withAssist(t("AI_COPILOT.REGENERATE", "Mit KI neu erzeugen"));
        again.title = hint;
        again.setAttribute("aria-label", hint);
        meta.append(again);
        if (state.cached) {
          const note2 = document.createElement("span");
          note2.className = "quiet";
          note2.textContent = t("AI_COPILOT.CACHED", "Aus dem Zwischenspeicher");
          meta.append(note2);
        }
        const caveat = document.createElement("p");
        caveat.className = "quiet assist-caveat";
        caveat.textContent = t("AI_COPILOT.SUMMARY_CAVEAT", "Bitte mit dem Brief abgleichen: Zusammenfassungen k\xF6nnen Angaben falsch interpretieren.");
        result.append(label2, text2, meta, caveat);
        strip.append(result);
      }
      if (state.replies.length) {
        const group2 = document.createElement("div");
        group2.className = "assist-replies";
        const label2 = document.createElement("p");
        label2.className = "quiet";
        label2.textContent = t("AI_COPILOT.REPLY_HINT", "Vorschlag ausw\xE4hlen und als bearbeitbaren Entwurf \xF6ffnen:");
        const prompts = document.createElement("div");
        prompts.className = "prompts reply-prompts";
        state.replies.forEach((reply, index) => {
          const button3 = document.createElement("button");
          button3.type = "button";
          button3.className = "prompt";
          button3.dataset.action = "use-reply";
          button3.dataset.index = String(index);
          button3.textContent = reply.label;
          prompts.append(button3);
        });
        group2.append(label2, prompts);
        strip.append(group2);
      }
      if (state.model) {
        const model = document.createElement("p");
        model.className = "mono quiet assist-model";
        model.textContent = state.model;
        strip.append(model);
      }
    },
    setChat(turns, thinking, context = "") {
      const log = shell?.querySelector("#chat-log");
      const chip = shell?.querySelector("#context-chip");
      const error = shell?.querySelector("#chat-error");
      const busy = Boolean(thinking) && !thinking.startsWith("!");
      shell?.querySelectorAll(".sheet-form button, .sheet [data-action='prompt']").forEach((button3) => {
        button3.disabled = busy;
      });
      const area = shell?.querySelector("#ask");
      if (area) area.setAttribute("aria-busy", String(busy));
      if (chip) {
        chip.hidden = !context;
        chip.textContent = context ? `${t("AI_COPILOT.CONTEXT", "Bezug")}: ${context} \xB7 ${t("AI_COPILOT.DROP_CONTEXT", "Bezug entfernen")}` : "";
      }
      if (error) {
        error.hidden = !thinking.startsWith("!");
        error.textContent = thinking.startsWith("!") ? thinking.slice(1) : "";
      }
      if (!log) return;
      log.setAttribute("aria-busy", String(busy));
      log.replaceChildren();
      if (!turns.length && !thinking) {
        const p = document.createElement("p");
        p.className = "quiet";
        p.textContent = t("AI_COPILOT.CHAT_EMPTY", "Fragen Sie zum Beispiel, welche Mails auf eine Antwort warten.");
        const prompts = document.createElement("div");
        prompts.className = "prompts";
        ["Welche Mails warten auf meine Antwort?", "Zeig mir Rechnungen vom letzten Monat", "Fasse die ge\xF6ffnete Mail zusammen"].forEach((text2) => {
          const button3 = document.createElement("button");
          button3.type = "button";
          button3.className = "prompt";
          button3.dataset.action = "prompt";
          button3.textContent = text2;
          prompts.append(button3);
        });
        log.append(p, prompts);
      }
      turns.forEach((turn) => {
        const item = document.createElement("article");
        item.className = turn.role === "user" ? "bubble" : "assistant";
        if (turn.trace.length) {
          const trace = document.createElement("p");
          trace.className = "mono quiet";
          trace.textContent = turn.trace.join(" \xB7 ");
          item.append(trace);
        }
        const text2 = document.createElement("p");
        text2.textContent = turn.text;
        item.append(text2);
        turn.actions.forEach((action, index) => {
          const card = document.createElement("div");
          card.className = "action";
          const label2 = document.createElement("p");
          label2.textContent = action.label;
          card.append(label2);
          if (!action.state) {
            const run = document.createElement("button");
            run.type = "button";
            run.className = "ink-btn";
            run.dataset.action = "run-action";
            run.dataset.index = String(index);
            run.textContent = t("AI_COPILOT.RUN", "Ausf\xFChren");
            const dismiss = document.createElement("button");
            dismiss.type = "button";
            dismiss.className = "text-btn";
            dismiss.dataset.action = "dismiss-action";
            dismiss.dataset.index = String(index);
            dismiss.textContent = t("AI_COPILOT.DISMISS", "Verwerfen");
            card.append(run, dismiss);
          } else {
            const state = document.createElement("p");
            state.className = "quiet";
            state.textContent = action.state;
            card.append(state);
          }
          item.append(card);
        });
        log.append(item);
      });
      if (busy) {
        const p = document.createElement("p");
        p.className = "quiet thinking";
        p.setAttribute("role", "status");
        p.textContent = thinking;
        log.append(p);
      }
      log.scrollTop = log.scrollHeight;
    },
    openSheet() {
      const sheet = shell?.querySelector(".sheet");
      if (!sheet) return;
      if (!wide()) pane("reader");
      openLayer(sheet, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      shell?.querySelector("#ask")?.focus({ preventScroll: true });
    },
    closeSheet() {
      const sheet = shell?.querySelector(".sheet");
      if (sheet && !sheet.hidden) closeLayer(sheet);
    },
    draftOptions() {
      const pressed = (selector) => shell?.querySelector(`${selector}[aria-pressed="true"]`)?.dataset;
      return {
        mode: pressed("[data-mode]")?.mode || "new",
        tone: pressed("[data-tone]")?.tone || "professional",
        instruction: shell?.querySelector("#instruction")?.value || "",
        body: composer?.body() || "",
        subject: composer?.subject() || ""
      };
    },
    setDraftBody(text2) {
      composer?.setBody(text2);
    },
    setDraftBusy(busy, status) {
      const generate = shell?.querySelector("[data-action='generate']");
      const stop = shell?.querySelector("[data-action='stop-generate']");
      const revert = shell?.querySelector("[data-action='revert-draft']");
      const slot = shell?.querySelector("#draft-status");
      if (generate) generate.hidden = busy;
      if (stop) stop.hidden = !busy;
      if (revert) revert.hidden = busy;
      if (slot) slot.textContent = status;
    },
    setSubjectHint(subject) {
      const hint = shell?.querySelector("#subject-hint");
      if (!hint) return;
      hint.hidden = !subject;
      const span = hint.querySelector("span");
      if (span) span.textContent = subject ? `Betreff: ${subject}` : "";
      hint.dataset.subject = subject;
    },
    showReauth() {
      if (!shell) return;
      let dialog = shell.querySelector("#reauth");
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "reauth";
        dialog.innerHTML = `
          <form class="dialog-body">
            <h2 class="title title-md">${esc9(t("LOGIN.SESSION", "Die Sitzung ist abgelaufen"))}</h2>
            <p class="quiet">${esc9(t("LOGIN.SESSION_HINT", "Melden Sie sich erneut an. Der offene Entwurf bleibt erhalten."))}</p>
            <label class="field"><span>${esc9(t("GLOBAL.EMAIL", "E-Mail"))}</span><input name="email" type="email" autocomplete="username" required></label>
            <label class="field"><span>${esc9(t("GLOBAL.PASSWORD", "Passwort"))}</span><input name="password" type="password" autocomplete="current-password" required></label>
            <label class="field"><span>${esc9(t("LOGIN.TWO_FACTOR", "Code"))}</span><input name="totp" inputmode="numeric" autocomplete="one-time-code"></label>
            <p class="error" data-for="reauth" hidden></p>
            <div class="dialog-actions"><button type="submit" class="ink-btn">${esc9(t("LOGIN.BUTTON_SIGN_IN", "Anmelden"))}</button></div>
          </form>`;
        dialog.addEventListener("submit", (event) => {
          event.preventDefault();
          const form2 = event.target;
          const data = new FormData(form2);
          actions.login(String(data.get("email") || ""), String(data.get("password") || ""), false, String(data.get("totp") || ""));
        });
        dialog.addEventListener("cancel", (event) => event.preventDefault());
        shell.append(dialog);
      }
      if (!dialog.open) dialog.showModal();
    },
    hideReauth() {
      shell?.querySelector("#reauth")?.close();
    },
    hasMail() {
      return Boolean(shell?.isConnected);
    },
    setLayout(mode) {
      if (shell) shell.dataset.layout = String(mode);
    },
    composerOpen() {
      return Boolean(shell?.querySelector(".composer:not([hidden])"));
    },
    minimizeCompose() {
      composer?.minimize();
    },
    focusPane(name) {
      const focus = shell?.querySelector(name === "folders" ? ".sidebar button" : name === "list" ? "[data-uid]" : ".reader button");
      focus?.focus({ preventScroll: true });
    },
    setAssist(flags) {
      if (!flags) {
        shell?.querySelectorAll("[data-assist-node]").forEach((node) => node.remove());
        return;
      }
      installAssist(flags);
    },
    settingsSaved() {
      const slot = shell?.querySelector("#settings-live");
      if (!slot) return;
      slot.textContent = "";
      slot.textContent = t("GLOBAL.SAVED", "Gespeichert");
    },
    showSettings(next) {
      snap = next;
      if (section === "folders" && edit) return;
      edit = null;
      paintSettings();
    },
    settingsNotice(text2) {
      const slot = shell?.querySelector("#settings-error");
      if (!slot) return;
      slot.hidden = !text2;
      slot.textContent = text2;
    },
    showTranslation(search, explanation) {
      const box = shell?.querySelector("#translated");
      if (!box) return;
      box.hidden = false;
      box.querySelector("#translate-q").value = search;
      const why = box.querySelector("#translate-why");
      if (why) why.textContent = explanation;
    }
  };
}

// src/mail.ts
var PAGE_FALLBACK = 20;
var SYSTEM_FLAGS = /^(\\|\$ai_|\$forwarded$|\$mdnsent$|\$junk$|\$notjunk$|\$label|nonjunk$|junk$|\$phishing$|\$submitpending$|\$submitted$|\$hasattachment$|\$hasnoattachment$|\$important$|\$muted$|\$followed$)/i;
function people2(value) {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? value["@Collection"] : null;
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const row2 = item || {};
    return { name: String(row2.name || ""), email: String(row2.email || "") };
  }).filter((item) => item.email || item.name);
}
function collection2(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const list = value["@Collection"];
    if (Array.isArray(list)) return list;
  }
  return [];
}
function label(person2) {
  return person2.name || person2.email;
}
function address(person2) {
  if (!person2.email) return person2.name;
  return person2.name ? `${person2.name} <${person2.email}>` : person2.email;
}
var hourCycle;
function when(stamp) {
  if (!stamp) return "";
  const date = new Date(stamp * 1e3);
  const now = /* @__PURE__ */ new Date();
  const clock = hourCycle ? { hourCycle } : {};
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...clock });
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}
function whenFull(stamp) {
  if (!stamp) return "";
  return new Date(stamp * 1e3).toLocaleString([], { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function hasFlag(flags, name) {
  return flags.some((flag2) => flag2.toLowerCase() === name);
}
function seen(flags) {
  return hasFlag(flags, "\\seen");
}
function plainFromHtml(html) {
  return new DOMParser().parseFromString(html, "text/html").body.textContent || "";
}
function quote2(body) {
  return body.replace(/\r\n/g, "\n").split("\n").map((line2) => `> ${line2}`).join("\n");
}
function sizeLabel2(bytes2) {
  if (!bytes2) return "";
  if (bytes2 < 1024) return `${bytes2} B`;
  if (bytes2 < 1024 * 1024) return `${Math.round(bytes2 / 1024)} KB`;
  return `${(bytes2 / (1024 * 1024)).toFixed(1)} MB`;
}
function fileKind(file) {
  const type = file.mimeType.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "text/calendar" || name.endsWith(".ics")) return "calendar";
  if (type.startsWith("text/") || /\.(txt|csv|log|md)$/.test(name)) return "text";
  if (/zip|compressed|tar|rar|7z/.test(type) || /\.(zip|rar|7z|tgz|gz)$/.test(name)) return "archive";
  return "other";
}
function authStatus(value) {
  const first = Array.isArray(value) ? value[0] : null;
  return Array.isArray(first) ? String(first[0] || "") : "";
}
async function boot(root3) {
  const session = new Session(root3);
  try {
    await session.start(await loadApp());
  } catch (error) {
    root3.replaceChildren(Object.assign(document.createElement("p"), {
      className: "error",
      textContent: explain(error)
    }));
  }
}
var Session = class {
  view;
  email = "";
  accountHash = "";
  sentFolder = "";
  archiveFolder = "";
  pageSize = PAGE_FALLBACK;
  folders = [];
  folder = "INBOX";
  messages = [];
  total = 0;
  offset = 0;
  search = "";
  selected = 0;
  hasMore = false;
  current = null;
  replyKind = "";
  assistFlags = null;
  noticeAck = false;
  useContext = true;
  chat = [];
  turns = [];
  chatActions = [];
  chatBusy = false;
  replies = [];
  draftBackup = "";
  draftAbort = null;
  tagged = /* @__PURE__ */ new Set();
  alertItems = [];
  category = "all";
  /** Laufende Nummer der Listenanfragen. */
  listSeq = 0;
  mainEmail = "";
  caps = { accounts: false, identities: false, contacts: false, sieve: false, openpgp: false, gnupg: false };
  desk = null;
  prefs = {
    viewImages: "ask",
    whitelist: "",
    proxy: false,
    removeColors: false,
    allowStyles: false,
    minFontSize: 5,
    maxBlockquotes: 0,
    collapseBlockquotes: true,
    viewHtml: true,
    hideDeleted: true,
    showNext: false,
    readAuto: true,
    readDelay: 5,
    checkInterval: 15,
    showUnreadCount: false,
    desktop: true,
    sound: true,
    soundName: "new-mail",
    useChecks: true,
    listInline: false,
    simpleFiles: false,
    newWindow: false,
    zip: false,
    thumbs: false,
    webPath: "",
    hideUnsubscribed: false,
    unhideKolab: false,
    kolab: false,
    defaultSort: "",
    useThreads: false,
    threadAlgorithm: "",
    listGrouped: false
  };
  folderModel = { folders: [], quotaUsage: null, quotaLimit: null, capabilities: [] };
  collapsed = /* @__PURE__ */ new Set();
  folderFilter = "";
  systemSettings = { sent: "", drafts: "", junk: "", trash: "", archive: "" };
  sort = "";
  threadUid = 0;
  threadSubject = "";
  deskNotice = "";
  trashFolder = "";
  junkFolder = "";
  draftsFolder = "";
  checked = /* @__PURE__ */ new Set();
  anchor = 0;
  readTimer = 0;
  pollTimer = 0;
  logoutTimer = 0;
  lastPoll = 0;
  inboxUid = 0;
  inboxUnread = -1;
  letter = { uid: 0, mode: "html", images: false, links: false, swap: false };
  inlineCache = /* @__PURE__ */ new Map();
  calendarCache = /* @__PURE__ */ new Map();
  receiptSkipped = /* @__PURE__ */ new Set();
  draftRef = null;
  composeData = {};
  boot = {};
  identities = [];
  renderToken = 0;
  constructor(root3) {
    window.addEventListener("sm-appearance", () => {
      if (this.current) void this.paintLetter();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.email && Date.now() - this.lastPoll > 6e4) void this.poll(false);
    });
    watchSession(() => {
      if (this.email) this.view.showReauth();
    });
    this.view = createView(root3, {
      login: (email, password, stay, totp) => void this.login(email, password, stay, totp),
      logout: () => void this.logout(),
      selectFolder: (fullName) => void this.selectFolder(fullName),
      selectMessage: (uid) => void this.selectMessage(uid),
      search: (query) => void this.setSearch(query),
      clearSearch: () => void this.setSearch(""),
      more: () => void this.loadList(true),
      compose: () => this.openNew(),
      reply: (all) => this.openReply(all),
      forward: () => this.openForward(),
      archive: () => void this.archive(),
      unread: () => void this.markUnread(),
      markUnread: () => void this.forceSeen(false),
      markRead: () => void this.forceSeen(true),
      quotes: () => void this.toggleQuotes(),
      askDelete: () => void this.remove(),
      send: (values2) => void this.send(values2),
      saveCompose: (values2) => this.saveDraft(values2),
      closeCompose: (discard) => {
        void this.closeCompose(discard);
      },
      back: () => void 0,
      assist: (name, data) => void this.assist(name, data),
      settings: (name, data) => this.settings(name, data),
      act: (name, data) => void this.act(name, data)
    });
  }
  async start(data) {
    this.boot = data;
    const title = String(data.title || "SnappyMail");
    if (data.Auth) await this.enter(data);
    else {
      const system = data.System || {};
      this.view.showLogin(title, {
        languages: data.allowLanguagesOnLogin ? system.languages : void 0,
        language: String(data.language || ""),
        twoFactor: "RequireTwoFactor" in data
      });
    }
  }
  async login(email, password, stay, totp = "") {
    if (!email.trim() || !password) {
      this.view.setLoginError("Adresse und Passwort eintragen.");
      return;
    }
    this.view.setLoginBusy(true);
    this.view.setLoginError("");
    try {
      const result = await call("Login", {
        Email: email.trim(),
        Password: password,
        language: document.documentElement.lang || "",
        signMe: stay ? 1 : 0,
        totp_code: totp
      });
      await this.enter(result, this.view.hasMail());
    } catch (error) {
      this.view.setLoginError(explain(error));
    } finally {
      this.view.setLoginBusy(false);
    }
  }
  async logout() {
    try {
      await call("Logout");
    } catch {
    }
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.readTimer);
    this.email = "";
    this.view.showLogin(document.title || "SnappyMail");
  }
  readPrefs(data) {
    const num2 = (value, fallback) => Number.isFinite(Number(value)) && value !== "" && value != null ? Number(value) : fallback;
    const bool = (value, fallback) => value == null ? fallback : Boolean(value);
    const capa = data.Capa || {};
    const system = data.System || {};
    const minInterval = Math.max(1, num2(data.minRefreshInterval, 5));
    this.prefs = {
      viewImages: String(data.ViewImages || "ask"),
      whitelist: String(data.ViewImagesWhitelist || ""),
      proxy: Boolean(data.proxyExternalImages),
      removeColors: bool(data.RemoveColors, false),
      allowStyles: bool(data.AllowStyles, false),
      minFontSize: num2(data.minFontSize, 5),
      maxBlockquotes: num2(data.MaxBlockquotesLevel, 0),
      collapseBlockquotes: bool(data.CollapseBlockquotes, true),
      viewHtml: bool(data.ViewHTML, true),
      hideDeleted: bool(data.HideDeleted, true),
      showNext: bool(data.showNextMessage, false),
      readAuto: bool(data.messageReadAuto, true),
      readDelay: Math.max(0, num2(data.MessageReadDelay, 5)),
      checkInterval: Math.max(minInterval, num2(data.CheckMailInterval, 15)),
      showUnreadCount: bool(data.ShowUnreadCount, false),
      desktop: bool(data.DesktopNotifications, true),
      sound: bool(data.SoundNotification, true),
      soundName: String(data.NotificationSound || "new-mail"),
      useChecks: bool(data.UseCheckboxesInList, true),
      listInline: bool(data.ListInlineAttachments, false),
      simpleFiles: bool(data.simpleAttachmentsList, false),
      newWindow: bool(data.messageNewWindow, false),
      zip: Boolean(capa.AttachmentsActions),
      thumbs: Boolean(capa.AttachmentThumbnails),
      webPath: String(system.webVersionPath || "snappymail/v/0.0.0/"),
      hideUnsubscribed: bool(data.HideUnsubscribed, false),
      unhideKolab: bool(data.UnhideKolabFolders, false),
      kolab: Boolean(capa.Kolab),
      defaultSort: String(data.defaultSort || ""),
      useThreads: bool(data.useThreads ?? data.UseThreads, false),
      threadAlgorithm: String(data.threadAlgorithm || ""),
      listGrouped: bool(data.listGrouped, false)
    };
    this.systemSettings = {
      sent: String(data.SentFolder || ""),
      drafts: String(data.DraftsFolder || ""),
      junk: String(data.JunkFolder || ""),
      trash: String(data.TrashFolder || ""),
      archive: String(data.ArchiveFolder || "")
    };
  }
  /** System-Ordner: Einstellung des Kontos, sonst Rolle vom Server, sonst üblicher Name. */
  resolveSystemFolders(data) {
    const known = (name) => Boolean(name) && this.folders.some((folder) => folder.fullName === name);
    const byRole = (...roles) => this.folders.find((folder) => roles.includes(folder.role.toLowerCase()))?.fullName || "";
    const byName = (...names) => this.folders.find((folder) => names.includes(folder.fullName.toLowerCase()) || names.includes(folder.name.toLowerCase()))?.fullName || "";
    const pick = (setting, roles, names) => {
      const value = String(setting || "");
      return known(value) ? value : byRole(...roles) || byName(...names);
    };
    const src = data || {};
    this.sentFolder = pick(src.SentFolder ?? this.sentFolder, ["sent"], ["sent", "gesendet", "sent items", "gesendete elemente"]);
    this.draftsFolder = pick(src.DraftsFolder ?? this.draftsFolder, ["drafts"], ["drafts", "entw\xFCrfe", "entwurf"]);
    this.trashFolder = pick(src.TrashFolder ?? this.trashFolder, ["trash"], ["trash", "papierkorb", "deleted items", "gel\xF6schte elemente"]);
    this.junkFolder = pick(src.JunkFolder ?? this.junkFolder, ["junk", "spam"], ["junk", "spam", "junk-e-mail"]);
    this.archiveFolder = pick(src.ArchiveFolder ?? this.archiveFolder, ["archive", "all"], ["archive", "archiv"]);
  }
  place() {
    return {
      inSpam: Boolean(this.junkFolder) && this.folder === this.junkFolder,
      inTrash: !this.trashFolder || this.folder === this.trashFolder,
      inDrafts: Boolean(this.draftsFolder) && this.folder === this.draftsFolder,
      archive: Boolean(this.archiveFolder) && this.folder !== this.archiveFolder,
      spam: Boolean(this.junkFolder)
    };
  }
  async enter(data, keep = false) {
    if (keep && this.view.hasMail()) {
      this.email = String(data.Email || this.email);
      this.composeData = { ...this.composeData, ...data };
      this.view.hideReauth();
      this.armLogout();
      return;
    }
    this.email = String(data.Email || "");
    this.mainEmail = String(data.mainEmail || data.Email || "");
    this.caps = readCaps(data);
    this.accountHash = String(data.accountHash || "");
    this.sentFolder = String(data.SentFolder || "");
    this.archiveFolder = String(data.ArchiveFolder || "");
    this.draftsFolder = String(data.DraftsFolder || "");
    this.trashFolder = String(data.TrashFolder || "");
    this.junkFolder = String(data.JunkFolder || "");
    this.readPrefs(data);
    this.composeData = data;
    this.checked.clear();
    this.inboxUid = 0;
    this.inboxUnread = -1;
    this.sort = this.prefs.defaultSort;
    this.threadUid = 0;
    this.folderFilter = "";
    this.collapsed = this.readCollapsed();
    const page = Number(data.MessagesPerPage || PAGE_FALLBACK);
    this.pageSize = Math.min(100, Math.max(10, page || PAGE_FALLBACK));
    document.title = this.email || String(data.title || "Postfach");
    this.assistFlags = await readAssist(data, async () => {
      const result = await plugin("AiGetSettings");
      return result.settings;
    });
    this.noticeAck = Boolean(this.assistFlags?.noticeAck);
    const cycle = String(data.hourCycle || "");
    hourCycle = cycle === "h12" || cycle === "h23" ? cycle : void 0;
    this.view.showMail(this.email, "Posteingang", this.assistFlags);
    const sync = data.ContactsSync;
    this.view.setBook(this.caps.contacts, Boolean(sync && typeof sync === "object"), Number(sync?.Mode || 0));
    this.view.setLayout(Number(data.Layout ?? 1));
    this.view.setChecks(this.prefs.useChecks);
    this.armLogout();
    if (this.assistFlags?.alerts) void this.loadAlerts();
    await this.loadFolders();
    await this.loadComposeIdentities();
    this.configureComposer();
    const mailto = String(data.mailToEmail || "");
    if (mailto) {
      const seed = parseMailto(mailto);
      this.view.openCompose({ title: "Neue Nachricht", to: seed.to, cc: seed.cc, bcc: seed.bcc, subject: seed.subject, body: seed.body, mode: "new" });
    }
    window.clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(() => {
      if (!document.hidden) void this.poll(false);
    }, this.prefs.checkInterval * 6e4);
  }
  async settings(name, data) {
    if (name.startsWith("folder-")) {
      await this.folderForm(name, data);
      return;
    }
    try {
      if (name === "export-key") {
        const row2 = this.desk?.keys[Number(data.index)];
        if (!row2) return;
        if (row2.source === "gnupg" && row2.id) {
          let pass = "";
          if (row2.secret) {
            pass = rememberedPass(row2.id);
            if (!pass) {
              const answer = await this.view.askSecret(t("CRYPTO.PASSPHRASE_TITLE", "Passphrase"), t("CRYPTO.PASSPHRASE", "Passphrase"));
              if (!answer) return;
              pass = answer.value;
              rememberPass(row2.id, pass, answer.remember);
            }
          }
          const pem = await call("GnupgExportKey", { keyId: row2.id, isPrivate: row2.secret ? 1 : 0, passphrase: pass });
          if (typeof pem === "string" && pem) downloadText(`${row2.email || row2.id}.asc`, pem);
          return;
        }
        if (row2.armored) downloadText(`${row2.email || "key"}.asc`, row2.armored);
        return;
      }
      if (name === "open") {
        this.desk = await loadDesk(this.caps, this.email, this.mainEmail, this.composeData);
        this.view.showSettings(this.desk);
        return;
      }
      if (name === "test-sync") {
        await call("TestContactsSyncData", { Mode: Number(data.Mode || 0), Url: data.Url || "", User: data.User || "", Password: data.Password || "" });
        this.view.settingsNotice(t("CONTACTS.TEST_OK", "Die Verbindung steht."));
        return;
      }
      if (name === "sync-now") {
        if (this.desk) {
          await applyDesk("save-sync", data, this.desk);
          this.view.showSettings(this.desk);
        }
        if (Number(data.Mode || 0) === 0) {
          this.view.settingsNotice("Die Synchronisierung ist aus.");
          this.view.setBook(this.caps.contacts, true, 0);
          return;
        }
        await syncContacts();
        this.view.setBook(this.caps.contacts, true, Number(data.Mode || 0));
        this.view.settingsNotice(t("CONTACTS.SYNC_OK", "Synchronisiert."));
        await this.view.reloadBook();
        return;
      }
      if (name === "pref") {
        await this.savePref(data.key || "", data.value || "");
        return;
      }
      if (!this.desk) return;
      const next = await applyDesk(name, data, this.desk);
      if (name === "assist-save") {
        this.assistFlags = await readAssist(this.composeData, async () => {
          const result = await plugin("AiGetSettings");
          return result.settings;
        });
        this.view.setAssist(this.assistFlags);
      }
      if (next === "session") {
        await this.enter(await loadApp());
        return;
      }
      if (next === "keep") {
        this.view.showSettings(this.desk);
        this.view.settingsSaved();
        const sync = this.desk.app.ContactsSync;
        if (sync && typeof sync === "object") this.view.setBook(this.caps.contacts, true, Number(sync.Mode || 0));
        return;
      }
      this.desk = await loadDesk(this.caps, this.email, this.mainEmail, this.composeData);
      this.view.showSettings(this.desk);
    } catch (error) {
      this.view.settingsNotice(explain(error));
    }
  }
  async loadFolders() {
    try {
      this.folderModel = parseFolders(await call("Folders"));
      this.folders = this.folderModel.folders;
      this.resolveSystemFolders(null);
      const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
      if (inbox) {
        this.inboxUid = inbox.uidNext;
        this.inboxUnread = inbox.unread;
      }
      this.paintTitle();
      await this.selectFolder(inbox?.fullName || this.folders.find((folder) => folder.selectable)?.fullName || "INBOX");
    } catch (error) {
      this.view.setList([], "", explain(error), false, false);
    }
  }
  /** Ordner nach einer Änderung neu laden; der offene Ordner bleibt, wenn es ihn noch gibt. */
  async reloadFolders(open = "") {
    try {
      this.folderModel = parseFolders(await call("Folders"));
      this.folders = this.folderModel.folders;
      this.resolveSystemFolders(null);
      const keep = open || this.folder;
      const target = this.folders.find((folder) => folder.fullName === keep && folder.selectable) || this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
      if (target && target.fullName !== this.folder) await this.selectFolder(target.fullName);
      else this.paintFolders();
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
  capability(name) {
    return this.folderModel.capabilities.includes(name);
  }
  threadsAvailable() {
    return this.folderModel.capabilities.some((capa) => capa.startsWith("THREAD="));
  }
  threadsOn() {
    return this.threadsAvailable() && this.prefs.useThreads;
  }
  collapseKey() {
    return `sm-folders-collapsed:${this.accountHash || this.email}`;
  }
  readCollapsed() {
    try {
      const raw = localStorage.getItem(this.collapseKey());
      const list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch {
      return /* @__PURE__ */ new Set();
    }
  }
  writeCollapsed() {
    try {
      localStorage.setItem(this.collapseKey(), JSON.stringify([...this.collapsed]));
    } catch {
    }
  }
  isSystem(folder) {
    const role = this.roleOf(folder);
    return Boolean(role) || [this.sentFolder, this.draftsFolder, this.trashFolder, this.junkFolder, this.archiveFolder].includes(folder.fullName);
  }
  aboCache = null;
  /** Bei „Nicht abonnierte ausblenden“ bleiben abonnierte Ordner und ihre Eltern stehen (wie `hasSubscriptions` alt). */
  subscribedTree() {
    if (this.aboCache?.source === this.folders) return this.aboCache.keep;
    const keep = /* @__PURE__ */ new Set();
    const byName = new Map(this.folders.map((folder) => [folder.fullName, folder]));
    this.folders.forEach((folder) => {
      if (!folder.subscribed && this.roleOf(folder) !== "inbox") return;
      let current = folder;
      while (current && !keep.has(current.fullName)) {
        keep.add(current.fullName);
        current = current.parent ? byName.get(current.parent) : void 0;
      }
    });
    this.aboCache = { source: this.folders, keep };
    return keep;
  }
  hiddenFolder(folder) {
    if (this.prefs.hideUnsubscribed && !this.subscribedTree().has(folder.fullName)) return true;
    return this.prefs.kolab && this.capability("METADATA") && Boolean(folder.kolabType) && !this.prefs.unhideKolab;
  }
  /** Aktionen im Ordnermenü; was nicht geht, fehlt. */
  folderActions(folder, hasChildren) {
    const role = this.roleOf(folder);
    const list = [];
    if (folder.exists && !folder.noInferiors) list.push("create-sub");
    if (folder.exists && folder.selectable && !this.isSystem(folder)) list.push("rename");
    if (folder.selectable && folder.unread > 0) list.push("read-all");
    if (folder.selectable && (role === "trash" || role === "junk" || role === "spam") && folder.total > 0) list.push("clear");
    if (folder.exists) list.push("settings");
    void hasChildren;
    return list;
  }
  folderDesk() {
    const roots = buildTree(this.folders, (folder) => this.roleOf(folder));
    const rows2 = flattenTree(roots, {
      collapsed: /* @__PURE__ */ new Set(),
      filter: "",
      hidden: () => false,
      current: this.folder,
      roleOf: (folder) => this.roleOf(folder),
      actions: () => []
    });
    return {
      rows: rows2.map((row2) => ({
        info: row2.info,
        depth: row2.depth,
        role: row2.role,
        hasChildren: row2.hasChildren,
        canDelete: row2.info.exists && row2.info.selectable && !this.isSystem(row2.info) && row2.info.total === 0 && !row2.hasChildren,
        canClear: row2.info.selectable && ["trash", "junk", "spam"].includes(row2.role) && row2.info.total > 0,
        canRename: row2.info.exists && row2.info.selectable && !this.isSystem(row2.info)
      })),
      hideUnsubscribed: this.prefs.hideUnsubscribed,
      kolab: this.prefs.kolab && this.capability("METADATA"),
      unhideKolab: this.prefs.unhideKolab,
      acl: this.capability("ACL"),
      system: { ...this.systemSettings },
      quota: this.quota(),
      notice: this.deskNotice
    };
  }
  quota() {
    const { quotaUsage, quotaLimit } = this.folderModel;
    return quotaLimit ? { used: quotaUsage || 0, limit: quotaLimit } : null;
  }
  folderName(folder) {
    if (!folder) return "";
    return displayName(folder, this.roleOf(folder));
  }
  /** Eltern für „Neuer Ordner“: vorhandene Ordner mit Unterordnern erlaubt. */
  parentChoices() {
    const roots = buildTree(this.folders, (folder) => this.roleOf(folder));
    const rows2 = flattenTree(roots, {
      collapsed: /* @__PURE__ */ new Set(),
      filter: "",
      hidden: (folder) => this.hiddenFolder(folder),
      current: "",
      roleOf: (folder) => this.roleOf(folder),
      actions: () => []
    });
    return [{ value: "", label: "Oberste Ebene" }].concat(rows2.filter((row2) => row2.info.exists && !row2.info.noInferiors).map((row2) => ({ value: row2.info.fullName, label: `${"\xA0\xA0".repeat(row2.depth)}${this.folderName(row2.info)}` })));
  }
  async createFolder(name, parent, subscribe) {
    if (!name.trim()) return;
    const delimiter = this.folders.find((folder) => folder.fullName === parent)?.delimiter || this.folders[0]?.delimiter || "/";
    if (delimiter && name.includes(delimiter)) {
      this.view.notice(`Der Name darf das Trennzeichen \u201E${delimiter}\u201C nicht enthalten.`);
      this.deskNotice = `Der Name darf das Trennzeichen \u201E${delimiter}\u201C nicht enthalten.`;
      return;
    }
    await call("FolderCreate", { folder: name.trim(), parent, subscribe: subscribe ? 1 : 0 });
    if (parent) {
      this.collapsed.delete(parent);
      this.writeCollapsed();
    }
    this.deskNotice = `Ordner \u201E${name.trim()}\u201C angelegt.`;
    this.view.notice(this.deskNotice);
    await this.reloadFolders();
  }
  /** Formulare aus dem Einstellungsabschnitt „Ordner“ und dem Freigabe-Dialog. */
  async folderForm(name, data) {
    try {
      this.deskNotice = "";
      if (name === "folder-create") {
        await this.createFolder(data.folder || "", data.parent || "", Boolean(data.subscribe));
        this.view.openFolderSettings("");
        return;
      }
      if (name === "folder-save") {
        const old = this.folders.find((folder) => folder.fullName === data.oldName);
        if (!old) return;
        const leaf = (data.name || old.name).trim();
        const delimiter = old.delimiter || "/";
        if (!leaf) throw new ApiError(0, "Name eintragen.");
        if (delimiter && leaf.includes(delimiter)) throw new ApiError(0, `Der Name darf das Trennzeichen \u201E${delimiter}\u201C nicht enthalten.`);
        const parent = data.parent ?? old.parent;
        const target = parent ? `${parent}${delimiter}${leaf}` : leaf;
        const kolab = this.prefs.kolab && this.capability("METADATA") ? { type: KOLAB_KEYS[0], value: data.kolab || "" } : null;
        if (target !== old.fullName) {
          await call("FolderRename", {
            oldName: old.fullName,
            newName: target,
            subscribe: data.subscribe ? 1 : 0,
            checkable: data.checkable ? 1 : 0,
            ...kolab ? { kolab } : {}
          });
          this.deskNotice = `\u201E${folderPath(old)}\u201C hei\xDFt jetzt \u201E${target}\u201C.`;
        } else {
          if (Boolean(data.subscribe) !== old.subscribed && this.roleOf(old) !== "inbox") await call("FolderSubscribe", { folder: old.fullName, subscribe: data.subscribe ? 1 : 0 });
          if (old.selectable && Boolean(data.checkable) !== old.checkable) await call("FolderCheckable", { folder: old.fullName, checkable: data.checkable ? 1 : 0 });
          if (kolab && (data.kolab || "") !== old.kolabType) await call("FolderSetMetadata", { folder: old.fullName, key: KOLAB_KEYS[0], value: data.kolab || "" });
          this.deskNotice = "Gespeichert.";
        }
        this.view.notice(this.deskNotice);
        await this.reloadFolders(this.folder === old.fullName ? target : "");
        this.view.openFolderSettings("");
        return;
      }
      if (name === "folder-system") {
        await call("SystemFoldersUpdate", { sent: data.sent || "", drafts: data.drafts || "", junk: data.junk || "", trash: data.trash || "", archive: data.archive || "" });
        const app = await loadApp();
        this.readPrefs(app);
        this.resolveSystemFolders(app);
        this.composeData = app;
        this.configureComposer();
        this.deskNotice = "Systemordner gespeichert.";
        this.view.notice(this.deskNotice);
        this.paintFolders();
        return;
      }
      if (name === "folder-options") {
        const params = { HideUnsubscribed: data.hideUnsubscribed ? 1 : 0 };
        if (this.prefs.kolab) params.UnhideKolabFolders = data.unhideKolab ? 1 : 0;
        await call("SettingsUpdate", params);
        this.prefs.hideUnsubscribed = Boolean(data.hideUnsubscribed);
        this.prefs.unhideKolab = Boolean(data.unhideKolab);
        this.deskNotice = "Gespeichert.";
        this.view.notice(this.deskNotice);
        await this.reloadFolders();
        return;
      }
      if (name === "folder-acl-set") {
        const rights = ["l", "r", "s", "w", "i", "p", "k", "x", "t", "e", "a"].filter((letter) => data[`r_${letter}`]).join("");
        if (!data.identifier?.trim()) throw new ApiError(0, "Benutzer oder Gruppe eintragen.");
        await call("FolderSetACL", { folder: data.folder, identifier: data.identifier.trim(), rights });
        await this.showAcl(data.folder || "", "");
        return;
      }
    } catch (error) {
      this.deskNotice = explain(error);
      if (name === "folder-acl-set") await this.showAcl(data.folder || "", explain(error));
      else {
        this.view.settingsNotice(explain(error));
        this.view.setFolderDesk(this.folderDesk());
        this.view.settingsNotice(explain(error));
      }
    }
  }
  async showAcl(folder, error) {
    try {
      const entries = parseAcl(await call("FolderACL", { folder }));
      this.view.showAcl(folder, renderAcl(folder, entries, error));
    } catch (failure) {
      this.view.showAcl(folder, renderAcl(folder, [], error || explain(failure)));
    }
  }
  /** Ordneraktionen aus Seitenleiste, Menü und Einstellungen. */
  async folderAction(name, data) {
    const folder = this.folders.find((item) => item.fullName === data.target);
    try {
      switch (name) {
        case "f-toggle":
          if (!data.target) return;
          if (this.collapsed.has(data.target)) this.collapsed.delete(data.target);
          else this.collapsed.add(data.target);
          this.writeCollapsed();
          this.paintFolders();
          return;
        case "f-filter":
          this.folderFilter = data.q || "";
          this.paintFolders();
          return;
        case "f-desk":
          this.view.setFolderDesk(this.folderDesk());
          return;
        case "f-create":
        case "f-create-sub": {
          const result = await this.view.folderDialog({
            title: name === "f-create" ? "Ordner anlegen" : `Neuer Unterordner in \u201E${this.folderName(folder)}\u201C`,
            parents: this.parentChoices(),
            parent: name === "f-create-sub" ? data.target || "" : ""
          });
          if (result) await this.createFolder(result.name, result.parent, result.subscribe);
          return;
        }
        case "f-rename": {
          if (!folder) return;
          const next = await this.view.ask("Ordner umbenennen", "Neuer Name", folder.name);
          if (!next || next === folder.name) return;
          if (folder.delimiter && next.includes(folder.delimiter)) {
            this.view.notice(`Der Name darf das Trennzeichen \u201E${folder.delimiter}\u201C nicht enthalten.`);
            return;
          }
          const target = folder.parent ? `${folder.parent}${folder.delimiter}${next}` : next;
          await call("FolderRename", { oldName: folder.fullName, newName: target, subscribe: folder.subscribed ? 1 : 0, checkable: folder.checkable ? 1 : 0 });
          if (this.collapsed.delete(folder.fullName)) {
            this.collapsed.add(target);
            this.writeCollapsed();
          }
          this.view.notice(`Umbenannt in \u201E${next}\u201C.`);
          await this.reloadFolders(this.folder === folder.fullName ? target : "");
          return;
        }
        case "f-read-all": {
          if (!folder) return;
          await call("MessageSetSeenToAll", { folder: folder.fullName, setAction: 1 });
          folder.unread = 0;
          if (folder.fullName === this.folder) this.messages.forEach((message) => {
            if (!seen(message.flags)) message.flags.push("\\Seen");
          });
          this.view.notice(`Alle Mails in \u201E${this.folderName(folder)}\u201C sind gelesen.`);
          this.paintFolders();
          if (folder.fullName === this.folder) this.paintList();
          return;
        }
        case "f-clear": {
          if (!folder) return;
          const ok = await this.view.confirm(
            `\u201E${this.folderName(folder)}\u201C leeren?`,
            `Alle ${folder.total} Mails in diesem Ordner werden endg\xFCltig gel\xF6scht. Das l\xE4sst sich nicht r\xFCckg\xE4ngig machen.`,
            "Endg\xFCltig leeren"
          );
          if (!ok) return;
          await call("FolderClear", { folder: folder.fullName });
          this.view.notice(`\u201E${this.folderName(folder)}\u201C ist leer.`);
          if (folder.fullName === this.folder) {
            this.current = null;
            this.selected = 0;
            this.checked.clear();
            this.view.setReader(null, "", "");
          }
          await this.reloadFolders();
          if (folder.fullName === this.folder) await this.loadList(false);
          return;
        }
        case "f-delete": {
          if (!folder || folder.total > 0 || this.isSystem(folder)) return;
          const ok = await this.view.confirm(`Ordner \u201E${folder.name}\u201C l\xF6schen?`, "Der leere Ordner wird auf dem Server gel\xF6scht.", "Ordner l\xF6schen");
          if (!ok) return;
          await call("FolderDelete", { folder: folder.fullName });
          this.collapsed.delete(folder.fullName);
          this.writeCollapsed();
          this.deskNotice = `Ordner \u201E${folder.name}\u201C gel\xF6scht.`;
          this.view.notice(this.deskNotice);
          await this.reloadFolders(this.folder === folder.fullName ? "INBOX" : "");
          return;
        }
        case "f-subscribe":
          if (!folder) return;
          await call("FolderSubscribe", { folder: folder.fullName, subscribe: folder.subscribed ? 0 : 1 });
          this.deskNotice = folder.subscribed ? `\u201E${folder.name}\u201C nicht mehr abonniert.` : `\u201E${folder.name}\u201C abonniert.`;
          await this.reloadFolders();
          return;
        case "f-checkable":
          if (!folder) return;
          await call("FolderCheckable", { folder: folder.fullName, checkable: folder.checkable ? 0 : 1 });
          this.deskNotice = folder.checkable ? `\u201E${folder.name}\u201C wird nicht mehr gepr\xFCft.` : `\u201E${folder.name}\u201C wird auf neue Mail gepr\xFCft.`;
          await this.reloadFolders();
          return;
        case "f-acl":
          if (folder) await this.showAcl(folder.fullName, "");
          return;
        case "f-acl-delete": {
          if (!data.target || !data.id) return;
          const ok = await this.view.confirm(`Freigabe f\xFCr \u201E${data.id}\u201C entfernen?`, "Diese Person oder Gruppe verliert den Zugriff auf den Ordner.", "Entfernen");
          if (!ok) return;
          await call("FolderDeleteACL", { folder: data.target, identifier: data.id });
          await this.showAcl(data.target, "");
          return;
        }
        default:
          return;
      }
    } catch (error) {
      this.deskNotice = explain(error);
      this.view.notice(explain(error));
      this.view.setFolderDesk(this.folderDesk());
    }
  }
  async selectFolder(fullName) {
    window.clearTimeout(this.readTimer);
    this.folder = fullName;
    this.offset = 0;
    this.search = "";
    this.threadUid = 0;
    this.view.setSearch("", /* @__PURE__ */ new Set());
    this.selected = 0;
    this.current = null;
    this.checked.clear();
    this.view.setReader(null, "", "");
    this.paintFolders();
    await this.loadList(false);
  }
  paintFolders() {
    const roots = buildTree(this.folders, (folder) => this.roleOf(folder));
    const rows2 = flattenTree(roots, {
      collapsed: this.collapsed,
      filter: this.folderFilter,
      hidden: (folder) => this.hiddenFolder(folder),
      current: this.folder,
      roleOf: (folder) => this.roleOf(folder),
      actions: (folder, children) => this.folderActions(folder, children)
    });
    const current = this.folders.find((folder) => folder.fullName === this.folder);
    this.view.setFolders({
      rows: rows2,
      count: this.folders.filter((folder) => !this.hiddenFolder(folder)).length,
      filter: this.folderFilter,
      currentName: this.folderName(current),
      quota: this.quota(),
      canCreate: true
    });
    this.view.setFolderDesk(this.folderDesk());
    this.paintMode();
    this.paintTitle();
  }
  paintMode() {
    const mode = {
      sortable: this.capability("SORT"),
      sort: this.sort,
      threadsAvailable: this.threadsAvailable(),
      useThreads: this.prefs.useThreads,
      grouped: this.prefs.listGrouped,
      threadOpen: this.threadUid ? this.threadSubject || "(ohne Betreff)" : ""
    };
    this.view.setListMode(mode);
  }
  /** Rolle für das Symbol: Server-Rolle oder die erkannten System-Ordner. */
  roleOf(folder) {
    if (folder.role) return folder.role === "spam" ? "junk" : folder.role;
    if (folder.fullName.toUpperCase() === "INBOX") return "inbox";
    if (folder.fullName === this.archiveFolder) return "archive";
    if (folder.fullName === this.sentFolder) return "sent";
    if (folder.fullName === this.draftsFolder) return "drafts";
    if (folder.fullName === this.trashFolder) return "trash";
    if (folder.fullName === this.junkFolder) return "junk";
    return "";
  }
  paintTitle() {
    if (!this.email) return;
    const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
    const count = this.prefs.showUnreadCount && inbox?.unread ? `(${inbox.unread}) ` : "";
    document.title = `${count}${this.email}`;
  }
  /** Suchstring, den der Server bekommt: KI-Kategorie oder die Suche (Format `name=wert&…` wie `AdvancedSearch.js`). */
  listQuery() {
    const keyword = (name) => `keyword=${encodeValue("$ai_" + name)}`;
    if (this.category === "needs_reply") return `${keyword("needs_reply")}&unanswered`;
    if (["personal", "newsletter", "notification", "invoice"].includes(this.category)) return keyword(this.category);
    return this.search;
  }
  /** Kennung des Listenkontexts; Antworten zu einem anderen Kontext werden verworfen. */
  listContext() {
    return JSON.stringify([this.accountHash, this.folder, this.listQuery(), this.sort, this.threadsOn(), this.threadUid]);
  }
  async loadList(append, quiet = false) {
    const start = append ? this.offset : 0;
    const query = this.listQuery();
    const context = this.listContext();
    const seq = ++this.listSeq;
    const stale = () => seq !== this.listSeq || context !== this.listContext();
    if (!append && !quiet) this.view.setList([], "Mails werden geladen \u2026", "", false, Boolean(query));
    try {
      const result = await call("MessageList", {
        folder: this.folder,
        offset: start,
        limit: quiet && !append ? Math.max(this.pageSize, this.messages.length) : this.pageSize,
        search: query,
        sort: this.capability("SORT") ? this.sort : "",
        uidNext: this.folders.find((folder) => folder.fullName === this.folder)?.uidNext || 0,
        ...this.threadsOn() ? { useThreads: 1, threadAlgorithm: this.prefs.threadAlgorithm, threadUid: this.threadUid } : {}
      });
      if (stale()) return;
      const batch = (result["@Collection"] || []).map((item) => this.parseMessage(item));
      this.messages = append ? this.messages.concat(batch) : batch;
      this.offset = start + batch.length;
      this.total = this.threadsOn() && !this.threadUid && Number(result.totalThreads) ? Number(result.totalThreads) : Number(result.totalEmails ?? result.folder?.totalEmails ?? this.messages.length);
      const known = this.folders.find((folder) => folder.fullName === this.folder);
      if (known && result.folder) {
        if (result.folder.unreadEmails != null) known.unread = Number(result.folder.unreadEmails);
        if (result.folder.uidNext) known.uidNext = Number(result.folder.uidNext);
        this.paintFolders();
      }
      const present = new Set(this.messages.map((message) => message.uid));
      [...this.checked].forEach((uid) => {
        if (!present.has(uid)) this.checked.delete(uid);
      });
      this.hasMore = query ? batch.length >= this.pageSize : this.offset < this.total;
      this.paintList();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (stale()) return;
      this.hasMore = false;
      this.view.setList(this.rows(), "", explain(error), false, Boolean(this.search));
    }
  }
  parseMessage(item, full = false) {
    const flags = Array.isArray(item.flags) ? item.flags.map((flag2) => String(flag2)) : [];
    const folder = String(item.folder || this.folder);
    const uid = Number(item.uid || 0);
    const rawFiles = collection2(item.attachments);
    const attachments = full ? rawFiles.map((file) => {
      const key = {
        folder,
        uid,
        mimeIndex: String(file.mimeIndex || ""),
        mimeType: String(file.mimeType || "application/octet-stream"),
        fileName: String(file.fileName || "anhang"),
        accountHash: this.accountHash
      };
      const hash = fileHash(key);
      return {
        name: String(file.fileName || "Anhang"),
        size: Number(file.estimatedSize || 0),
        mimeType: key.mimeType,
        mimeIndex: key.mimeIndex,
        cid: String(file.cId || "").replace(/^<|>$/g, ""),
        location: String(file.contentLocation || ""),
        inline: Boolean(file.isInline),
        hash,
        href: rawUrl("Download", hash)
      };
    }) : [];
    const headers = {};
    collection2(item.headers).forEach((header) => {
      const name = String(header.name || "").toLowerCase();
      if (name && !(name in headers)) headers[name] = String(header.value || "");
    });
    const contentType = (headers["content-type"] || "").toLowerCase();
    const references = Array.isArray(item.references) ? item.references.map(String).join(" ") : String(item.references || "");
    return {
      uid,
      folder,
      hash: String(item.hash || ""),
      subject: String(item.subject || ""),
      preview: String(item.preview || ""),
      from: people2(item.from),
      to: people2(item.to),
      cc: people2(item.cc),
      bcc: people2(item.bcc),
      replyTo: people2(item.replyTo),
      date: Number(item.dateTimestamp || 0),
      size: Number(item.size || 0),
      flags,
      messageId: String(item.messageId || ""),
      references,
      html: String(item.html || ""),
      plain: String(item.plain || ""),
      attachments,
      hasAttachment: rawFiles.some((file) => !file.isInline) || contentType.startsWith("multipart/mixed"),
      category: String(item.aiCategory || ""),
      spamScore: Number(item.spamScore || 0),
      spamResult: String(item.spamResult || ""),
      isSpam: Boolean(item.isSpam),
      hasVirus: Boolean(item.hasVirus),
      readReceipt: String(item.readReceipt || ""),
      threads: Array.isArray(item.threads) ? item.threads.map(Number).filter(Boolean) : [],
      threadUnseen: Array.isArray(item.threadUnseen) ? item.threadUnseen.map(Number).filter(Boolean) : [],
      headers,
      auth: { spf: authStatus(item.spf), dkim: authStatus(item.dkim), dmarc: authStatus(item.dmarc) },
      crypto: full ? readParts(item) : emptyParts(),
      autocrypt: full ? autocryptHeader(headers) : "",
      cryptoState: "",
      cryptoText: ""
    };
  }
  visible() {
    return this.prefs.hideDeleted ? this.messages.filter((message) => !hasFlag(message.flags, "\\deleted")) : this.messages;
  }
  /** Datumsgruppen nur bei Datumssortierung und nicht in einer geöffneten Unterhaltung. */
  grouping() {
    return this.prefs.listGrouped && !this.threadUid && (this.sort === "" || this.sort === "DATE");
  }
  groupOf(stamp) {
    if (!stamp) return "Ohne Datum";
    const date = new Date(stamp * 1e3);
    const start = /* @__PURE__ */ new Date();
    start.setHours(0, 0, 0, 0);
    const day = 864e5;
    if (date >= start) return "Heute";
    if (date.getTime() >= start.getTime() - day) return "Gestern";
    const weekStart = new Date(start.getTime() - (start.getDay() + 6) % 7 * day);
    if (date >= weekStart) return "Diese Woche";
    return date.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  }
  rows() {
    const grouped = this.grouping();
    let last = "";
    return this.visible().map((message) => {
      const group2 = grouped ? this.groupOf(message.date) : "";
      const start = group2 && group2 !== last ? group2 : "";
      if (group2) last = group2;
      const threaded = this.threadsOn() && !this.threadUid && message.threads.length > 1;
      return {
        group: start,
        threadCount: threaded ? message.threads.length : 0,
        threadUnseen: threaded ? message.threadUnseen.length : 0,
        uid: message.uid,
        who: label(message.from[0] || { name: "", email: "" }) || "(unbekannt)",
        subject: message.subject,
        preview: message.preview,
        when: when(message.date),
        unseen: !seen(message.flags),
        current: message.uid === this.selected && !this.checked.size,
        category: message.category,
        flagged: hasFlag(message.flags, "\\flagged"),
        answered: hasFlag(message.flags, "\\answered"),
        forwarded: hasFlag(message.flags, "$forwarded"),
        attachment: message.hasAttachment,
        checked: this.checked.has(message.uid),
        deleted: hasFlag(message.flags, "\\deleted")
      };
    });
  }
  paintList() {
    const empty = this.visible().length ? "" : this.category !== "all" ? "Keine Mails f\xFCr diesen Filter." : this.search ? "Keine Treffer. Suche anpassen oder Filter entfernen." : "Dieser Ordner ist leer.";
    this.view.setList(this.rows(), empty, "", this.hasMore, Boolean(this.search) || this.category !== "all");
  }
  async setSearch(query) {
    this.search = query;
    this.threadUid = 0;
    this.paintMode();
    this.view.setSearch(query, activeQuick(query));
    this.category = "all";
    this.view.pressCategory("all");
    this.offset = 0;
    this.selected = 0;
    this.current = null;
    this.checked.clear();
    this.view.setReader(null, "", "");
    await this.loadList(false);
  }
  async selectMessage(uid) {
    window.clearTimeout(this.readTimer);
    this.selected = uid;
    this.checked.clear();
    this.paintList();
    this.view.setReader(null, "Brief wird geladen \u2026", "");
    try {
      const result = await call("Message", { folder: this.folder, uid });
      if (this.selected !== uid) return;
      const message = this.parseMessage(result, true);
      this.current = message;
      this.letter = { uid, mode: this.prefs.viewHtml && message.html ? "html" : "plain", images: false, links: false, swap: false };
      const row2 = this.messages.find((item) => item.uid === uid);
      if (row2) row2.flags = message.flags.slice();
      this.scheduleSeen(message);
      await this.paintLetter();
      this.paintStrip();
      void this.loadCachedSummary();
    } catch (error) {
      if (this.selected === uid) this.view.setReader(null, "", explain(error));
    }
  }
  /** Gelesen nach `MessageReadDelay` Sekunden, nur wenn `messageReadAuto` an ist. */
  scheduleSeen(message) {
    if (seen(message.flags) || !this.prefs.readAuto) return;
    const mark = () => {
      if (this.selected !== message.uid || this.current?.uid !== message.uid) return;
      void this.setSeen([message.uid], true);
    };
    if (this.prefs.readDelay <= 0) mark();
    else this.readTimer = window.setTimeout(mark, this.prefs.readDelay * 1e3);
  }
  whitelisted(message) {
    const sender = (message.from[0]?.email || "").toLowerCase();
    if (!sender) return false;
    return this.prefs.whitelist.split(/[\s,;]+/).some((raw) => {
      const [rule, ...checks] = raw.trim().toLowerCase().split("+");
      if (!rule || !sender.includes(rule)) return false;
      return checks.every((check3) => {
        if (check3 === "spf") return message.auth.spf === "pass";
        if (check3 === "dkim") return message.auth.dkim === "pass";
        if (check3 === "dmarc") return message.auth.dmarc === "pass";
        return true;
      });
    });
  }
  imagesAllowed(message) {
    if (this.letter.images) return true;
    if (message.isSpam || this.junkFolder && this.folder === this.junkFolder) return false;
    if (this.prefs.viewImages === "always") return true;
    if (this.prefs.viewImages === "match") return this.whitelisted(message);
    return false;
  }
  /** Brief neu aufbauen: säubern, Inline-Bilder holen, freigegebene externe Bilder einsetzen, srcdoc bauen. */
  async paintLetter() {
    const message = this.current;
    if (!message || this.checked.size) return;
    const token2 = ++this.renderToken;
    const dark = document.documentElement.classList.contains("dark");
    let body = "";
    let blocked = 0;
    let failed = 0;
    let tracking = false;
    let remote = false;
    const linked = /* @__PURE__ */ new Set();
    if (this.letter.mode === "html" && message.html) {
      const byCid = /* @__PURE__ */ new Map();
      message.attachments.forEach((file) => {
        if (file.cid) byCid.set(file.cid.toLowerCase(), file.hash);
        if (file.location) byCid.set(file.location.toLowerCase(), file.hash);
      });
      const cleaned = cleanHtml(message.html, {
        allowStyles: this.prefs.allowStyles,
        removeColors: this.prefs.removeColors,
        minFontSize: this.prefs.minFontSize,
        maxBlockquotes: this.prefs.maxBlockquotes,
        collapseBlockquotes: this.prefs.collapseBlockquotes,
        inline: (ref) => byCid.get(ref.replace(/^<|>$/g, "").toLowerCase()) || null
      });
      tracking = cleaned.tracking;
      cleaned.linked.forEach((hash) => linked.add(hash));
      body = cleaned.html;
      if (cleaned.linked.length) {
        await Promise.all(cleaned.linked.map(async (hash) => {
          if (this.inlineCache.has(hash)) return;
          try {
            this.inlineCache.set(hash, await fetchDataUrl(rawUrl("View", hash)));
          } catch {
          }
        }));
        body = fillInline(body, this.inlineCache);
      }
      if (cleaned.externals) {
        if (this.imagesAllowed(message)) {
          if (this.prefs.proxy) {
            const loaded = /* @__PURE__ */ new Map();
            const urls = externalUrls(body).slice(0, 40);
            await Promise.all(urls.map(async (url) => {
              try {
                loaded.set(url, await fetchDataUrl(proxyUrl(url), 4 * 1024 * 1024));
              } catch {
              }
            }));
            failed = urls.length - loaded.size;
            const shown = revealExternals(body, (url) => loaded.has(url), (url) => loaded.get(url) || "");
            body = shown.html;
          } else {
            body = revealExternals(body, () => true, (url) => url).html;
            remote = true;
          }
        } else {
          blocked = cleaned.externals;
        }
      }
      if (this.letter.links) body = originalLinks(body);
    } else {
      body = plainToHtml(message.plain || plainFromHtml(message.html), this.prefs.collapseBlockquotes);
    }
    if (token2 !== this.renderToken || this.current !== message) return;
    const files = message.attachments.map((file, index) => ({ file, index })).filter(({ file }) => !file.inline || this.prefs.listInline || !linked.has(file.hash)).filter(({ file }) => this.prefs.listInline || !(file.inline && linked.has(file.hash))).map(({ file, index }) => {
      const kind = fileKind(file);
      return {
        index,
        name: file.name,
        size: sizeLabel2(file.size),
        href: file.href,
        view: rawUrl(kind === "text" || kind === "calendar" ? "ViewAsPlain" : "View", file.hash),
        thumb: kind === "image" && this.prefs.thumbs ? rawUrl("ViewThumbnail", file.hash) : "",
        kind
      };
    });
    const ics = message.attachments.find((file) => fileKind(file) === "calendar");
    let calendar = null;
    if (ics) {
      if (!this.calendarCache.has(ics.hash)) {
        try {
          this.calendarCache.set(ics.hash, parseIcs(await fetchText(rawUrl("ViewAsPlain", ics.hash))));
        } catch {
          this.calendarCache.set(ics.hash, null);
        }
      }
      calendar = this.calendarCache.get(ics.hash) || null;
      if (token2 !== this.renderToken || this.current !== message) return;
    }
    const virus = message.hasVirus || /infected|virus/i.test(message.headers["x-virus-status"] || message.headers["x-virus-scanned"] || "") && !/clean|no/i.test(message.headers["x-virus-status"] || "clean");
    const spam = virus ? "Virenwarnung: Der Server hat in dieser Mail einen Virus gemeldet." : message.isSpam ? `Als Spam erkannt${message.spamScore ? ` (Wert ${message.spamScore})` : ""}${message.spamResult ? ` \xB7 ${message.spamResult}` : ""}.` : message.spamScore > 0 ? `Spam-Wert ${message.spamScore}${message.spamResult ? ` \xB7 ${message.spamResult}` : ""}.` : "";
    const receiptKey = `${message.folder}:${message.uid}`;
    const data = {
      uid: message.uid,
      subject: message.subject,
      from: message.from,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      replyTo: message.replyTo.filter((person2) => !message.from.some((sender) => sender.email === person2.email)),
      when: when(message.date),
      whenFull: whenFull(message.date),
      size: sizeLabel2(message.size),
      flagged: hasFlag(message.flags, "\\flagged"),
      seen: seen(message.flags),
      deleted: hasFlag(message.flags, "\\deleted"),
      keywords: message.flags.filter((flag2) => !SYSTEM_FLAGS.test(flag2)),
      srcdoc: srcdoc(body, this.letter.mode === "html" && message.html ? "html" : "plain", {
        dark,
        swap: this.letter.swap,
        removeColors: this.prefs.removeColors,
        remote
      }),
      mode: this.letter.mode,
      canToggleMode: Boolean(message.html),
      blocked,
      failed,
      tracking,
      originalLinks: this.letter.links,
      swap: this.letter.swap,
      spam,
      receipt: message.readReceipt && !hasFlag(message.flags, "$mdnsent") && !this.receiptSkipped.has(receiptKey) && message.folder !== this.sentFolder ? message.readReceipt : "",
      unsubscribe: Boolean(parseUnsubscribe(message.headers["list-unsubscribe"] || "", message.headers["list-unsubscribe-post"] || "")),
      files,
      simpleFiles: this.prefs.simpleFiles,
      contacts: this.caps.contacts,
      zip: this.prefs.zip,
      calendar,
      place: this.place(),
      crypto: message.crypto.pgpEncrypted || message.crypto.pgpSigned || message.crypto.smimeEncrypted || message.crypto.smimeSigned || message.autocrypt ? {
        encrypted: Boolean(message.crypto.pgpEncrypted || message.crypto.smimeEncrypted),
        signed: Boolean(message.crypto.pgpSigned || message.crypto.smimeSigned),
        autocrypt: Boolean(message.autocrypt),
        smime: Boolean(message.crypto.smimeSigned || message.crypto.smimeEncrypted),
        state: message.cryptoState,
        text: message.cryptoText
      } : null
    };
    this.view.setReader(data, "", "");
  }
  async loadComposeIdentities() {
    try {
      const result = await call("AccountsAndIdentities");
      const rows2 = Array.isArray(result.Identities) ? result.Identities : Object.values(result.Identities || {});
      this.identities = rows2.map((value) => {
        const item = value;
        return {
          id: String(item.id || ""),
          label: String(item.label || ""),
          email: String(item.email || ""),
          name: String(item.name || ""),
          replyTo: String(item.replyTo || ""),
          bcc: String(item.bcc || ""),
          signature: String(item.signature || ""),
          signatureInsertBefore: Boolean(item.signatureInsertBefore),
          sentFolder: String(item.sentFolder || ""),
          pgpEncrypt: Boolean(item.pgpEncrypt),
          pgpSign: Boolean(item.pgpSign),
          smimeKey: String(item.smimeKey || ""),
          smimeCertificate: String(item.smimeCertificate || ""),
          smimeCertificateChain: String(item.smimeCertificateChain || "")
        };
      }).filter((item) => item.email);
    } catch {
      this.identities = [];
    }
    if (!this.identities.length) this.identities = [{ id: "", label: "", email: this.email, name: "", replyTo: "", bcc: "", signature: "", signatureInsertBefore: false, sentFolder: "", pgpEncrypt: false, pgpSign: false, smimeKey: "", smimeCertificate: "", smimeCertificateChain: "" }];
  }
  configureComposer() {
    const data = this.composeData;
    this.view.configureCompose({
      editor: String(data.EditorDefaultType || "Plain") === "Html" ? "Html" : "Plain",
      markdown: Boolean(data.markdown),
      spellcheck: Boolean(data.allowSpellcheck),
      autosave: Boolean(data.AllowDraftAutosave ?? true),
      draftsFolder: this.draftsFolder,
      sentFolder: this.sentFolder,
      replySameFolder: Boolean(data.ReplySameFolder),
      attachmentLimit: Number(data.attachmentLimit || 0),
      readReceipt: Boolean(data.requestReadReceipt),
      dsn: Boolean(data.requestDsn),
      requireTLS: Boolean(data.requireTLS),
      pgpSign: Boolean(data.pgpSign),
      pgpEncrypt: Boolean(data.pgpEncrypt),
      gnupg: this.caps.gnupg
    }, this.identities);
  }
  replyIdentity(message) {
    const recipients = [...message.to, ...message.cc, ...message.bcc];
    return this.identities.find((identity) => recipients.some((person2) => person2.email.toLowerCase() === identity.email.toLowerCase()))?.id || this.identities[0]?.id || "";
  }
  openNew() {
    this.replyKind = "";
    this.draftRef = null;
    this.view.openCompose({ title: "Neue Nachricht", to: "", cc: "", subject: "", body: "", mode: "new" });
  }
  openReply(all) {
    const message = this.current;
    if (!message) return;
    this.replyKind = all ? "reply-all" : "reply";
    this.draftRef = null;
    const author = message.replyTo[0] || message.from[0];
    const others = [...message.to, ...message.cc].filter((person2) => person2.email.toLowerCase() !== this.email.toLowerCase());
    const body = message.plain || plainFromHtml(message.html);
    const subject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;
    this.view.openCompose({
      title: all ? "Allen antworten" : "Antworten",
      mode: "reply",
      identityId: this.replyIdentity(message),
      sourceFolder: message.folder,
      to: author ? address(author) : "",
      cc: all ? others.map(address).join(", ") : "",
      subject,
      body: `

Am ${when(message.date)} schrieb ${author ? label(author) : ""}:
${quote2(body)}`
    });
  }
  openForward() {
    const message = this.current;
    if (!message) return;
    this.replyKind = "forward";
    this.draftRef = null;
    const body = message.plain || plainFromHtml(message.html);
    const subject = /^fw:/i.test(message.subject) ? message.subject : `Fw: ${message.subject}`;
    this.view.openCompose({
      title: "Weiterleiten",
      to: "",
      cc: "",
      subject,
      identityId: this.replyIdentity(message),
      sourceFolder: message.folder,
      body: `

-------- Weitergeleitete Nachricht --------
Von: ${message.from.map(label).join(", ")}
Betreff: ${message.subject}

${body}`
    });
    void this.view.attachCompose(message.attachments.filter((file) => !file.inline).map((file) => ({ key: file.hash, name: file.name, size: file.size })));
  }
  async saveDraft(values2) {
    const result = await call("SaveMessage", { ...values2 });
    if (result === true || !result.folder || !result.uid) throw new ApiError(0, "Der Entwurf konnte nicht gespeichert werden.");
    this.draftRef = { folder: result.folder, uid: result.uid };
    return this.draftRef;
  }
  async closeCompose(discard) {
    if (discard && this.draftRef) {
      try {
        await call("MessageDelete", { folder: this.draftRef.folder, uids: String(this.draftRef.uid) });
      } catch (error) {
        this.view.notice(explain(error));
      }
    }
    this.replyKind = "";
    this.draftRef = null;
    await this.loadList(false, true);
  }
  async send(values2) {
    const message = this.current;
    const params = { ...values2 };
    if (message && this.replyKind) {
      params.inReplyTo = message.messageId;
      params.references = [message.references, message.messageId].filter(Boolean).join(" ");
      params.draftInfo = [this.replyKind === "forward" ? "forward" : "reply", message.uid, message.folder];
    }
    if (this.draftRef) {
      params.messageFolder = this.draftRef.folder;
      params.messageUid = this.draftRef.uid;
    }
    try {
      await call("SendMessage", params);
      this.view.closeCompose();
      this.view.notice("Gesendet.");
      this.replyKind = "";
      const wasDraft = Boolean(this.draftRef);
      this.draftRef = null;
      this.offset = 0;
      if (wasDraft && this.current) {
        this.current = null;
        this.selected = 0;
        this.view.setReader(null, "", "");
      }
      await this.loadList(false, true);
    } catch (error) {
      this.view.setSendState(false, explain(error));
    }
  }
  /** Ziel der Aktion: die angehakten Mails, sonst die offene. */
  targets() {
    if (this.checked.size) return [...this.checked];
    return this.selected ? [this.selected] : [];
  }
  async archive() {
    const uids = this.targets();
    if (!uids.length) return;
    if (!this.archiveFolder) {
      this.view.notice("Kein Archiv-Ordner eingerichtet.");
      return;
    }
    if (this.folder === this.archiveFolder) {
      this.view.notice("Die Mail liegt schon im Archiv.");
      return;
    }
    await this.moveTo(uids, this.archiveFolder, false, uids.length === 1 ? "Archiviert." : `${uids.length} Mails archiviert.`);
  }
  /** Löschen: in den Papierkorb verschieben. Im Papierkorb oder ohne Papierkorb endgültig, dann mit Bestätigung. */
  async remove(forever = false) {
    const uids = this.targets();
    if (!uids.length) return;
    const permanent = forever || !this.trashFolder || this.folder === this.trashFolder;
    if (permanent) {
      const what = uids.length === 1 ? "diese Mail" : `diese ${uids.length} Mails`;
      const ok = await this.view.confirm("Endg\xFCltig l\xF6schen?", `Damit wird ${what} sofort entfernt. Das l\xE4sst sich nicht r\xFCckg\xE4ngig machen.`, "Endg\xFCltig l\xF6schen");
      if (!ok) return;
      try {
        await call("MessageDelete", { folder: this.folder, uids: uids.join(",") });
        this.view.notice(uids.length === 1 ? "Endg\xFCltig gel\xF6scht." : `${uids.length} Mails endg\xFCltig gel\xF6scht.`);
        await this.afterRemoval(uids);
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    await this.moveTo(uids, this.trashFolder, false, uids.length === 1 ? "In den Papierkorb verschoben." : `${uids.length} Mails in den Papierkorb verschoben.`);
  }
  async moveTo(uids, target, copy, done) {
    if (!target || !copy && target === this.folder) return;
    try {
      await call(copy ? "MessageCopy" : "MessageMove", { fromFolder: this.folder, toFolder: target, uids: uids.join(",") });
      this.view.notice(done);
      const unread = this.messages.filter((message) => uids.includes(message.uid) && !seen(message.flags)).length;
      const to = this.folders.find((folder) => folder.fullName === target);
      if (to) to.unread += unread;
      if (copy) {
        this.paintFolders();
        return;
      }
      const from = this.folders.find((folder) => folder.fullName === this.folder);
      if (from) from.unread = Math.max(0, from.unread - unread);
      await this.afterRemoval(uids);
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
  async afterRemoval(uids) {
    const order = this.visible().map((message) => message.uid);
    const openGone = uids.includes(this.selected);
    let next = 0;
    if (openGone && this.prefs.showNext && !this.checked.size) {
      const index = order.indexOf(this.selected);
      next = order.slice(index + 1).find((uid) => !uids.includes(uid)) || order.slice(0, index).reverse().find((uid) => !uids.includes(uid)) || 0;
    }
    this.messages = this.messages.filter((message) => !uids.includes(message.uid));
    uids.forEach((uid) => this.checked.delete(uid));
    this.offset = Math.max(0, this.offset - uids.length);
    if (openGone) {
      this.selected = 0;
      this.current = null;
      this.view.setReader(null, "", "");
    }
    this.paintFolders();
    await this.loadList(false, true);
    if (next) await this.selectMessage(next);
    else if (this.checked.size) this.paintBulk();
  }
  async setSeen(uids, value) {
    let delta = 0;
    this.messages.forEach((message) => {
      if (!uids.includes(message.uid)) return;
      const was = seen(message.flags);
      if (was === value) return;
      delta += value ? -1 : 1;
      message.flags = value ? message.flags.concat("\\seen") : message.flags.filter((flag2) => flag2.toLowerCase() !== "\\seen");
    });
    if (this.current && uids.includes(this.current.uid)) {
      this.current.flags = value ? [...new Set(this.current.flags.concat("\\seen"))] : this.current.flags.filter((flag2) => flag2.toLowerCase() !== "\\seen");
    }
    const folder = this.folders.find((item) => item.fullName === this.folder);
    if (folder) folder.unread = Math.max(0, folder.unread + delta);
    this.paintFolders();
    this.paintList();
    if (this.current && uids.includes(this.current.uid) && !this.checked.size) void this.paintLetter();
    try {
      await call("MessageSetSeen", { folder: this.folder, uids: uids.join(","), setAction: value ? 1 : 0 });
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
  async forceSeen(value) {
    const uids = this.targets();
    if (!uids.length) return;
    window.clearTimeout(this.readTimer);
    await this.setSeen(uids, value);
  }
  async toggleQuotes() {
    this.prefs.collapseBlockquotes = !this.prefs.collapseBlockquotes;
    this.composeData.CollapseBlockquotes = this.prefs.collapseBlockquotes;
    if (this.current) await this.paintLetter();
    try {
      await call("SettingsUpdate", { CollapseBlockquotes: this.prefs.collapseBlockquotes ? 1 : 0 });
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
  logoutWatch = false;
  armLogout() {
    window.clearTimeout(this.logoutTimer);
    const minutes = Number(this.composeData.AutoLogout ?? 0);
    if (!this.logoutWatch) {
      this.logoutWatch = true;
      const reset = () => this.armLogout();
      window.addEventListener("pointerdown", reset);
      window.addEventListener("keydown", reset);
    }
    if (!minutes || !this.email) return;
    this.logoutTimer = window.setTimeout(() => {
      void this.logout();
    }, minutes * 6e4);
  }
  async savePref(key, raw) {
    const numeric = ["MessagesPerPage", "CheckMailInterval", "MessageReadDelay", "MsgDefaultAction", "minFontSize", "MaxBlockquotesLevel", "Layout", "AutoLogout", "keyPassForget"];
    const bools = ["UseThreads", "UseCheckboxesInList", "listGrouped", "HideDeleted", "HideUnsubscribed", "ShowUnreadCount", "messageReadAuto", "showNextMessage", "messageNewWindow", "ViewHTML", "RemoveColors", "AllowStyles", "CollapseBlockquotes", "ListInlineAttachments", "simpleAttachmentsList", "markdown", "allowSpellcheck", "AllowDraftAutosave", "ReplySameFolder", "ContactsAutosave", "requestReadReceipt", "requestDsn", "requireTLS", "pgpSign", "pgpEncrypt", "DesktopNotifications", "SoundNotification"];
    const value = numeric.includes(key) ? Number(raw) : bools.includes(key) ? raw === "1" ? 1 : 0 : raw;
    await call("SettingsUpdate", { [key]: value });
    this.composeData[key] = numeric.includes(key) ? Number(raw) : bools.includes(key) ? raw === "1" : raw;
    if (key === "UseThreads") this.composeData.useThreads = raw === "1";
    if (key === "hourCycle") hourCycle = raw === "h12" || raw === "h23" ? raw : void 0;
    if (key === "Layout") this.view.setLayout(Number(raw));
    if (key === "UseCheckboxesInList") this.view.setChecks(raw === "1");
    if (key === "MessagesPerPage") this.pageSize = Math.min(100, Math.max(10, Number(raw) || 25));
    if (key === "defaultSort") this.sort = raw;
    if (key === "ShowUnreadCount" || key === "HideDeleted" || key === "HideUnsubscribed") await this.loadFolders();
    if (["MessagesPerPage", "defaultSort", "UseThreads", "threadAlgorithm", "listGrouped", "HideDeleted"].includes(key)) await this.loadList(false, true);
    if (key === "CheckMailInterval") {
      this.prefs.checkInterval = Math.max(1, Number(raw) || 15);
      window.clearInterval(this.pollTimer);
      this.pollTimer = window.setInterval(() => {
        if (!document.hidden) void this.poll(false);
      }, this.prefs.checkInterval * 6e4);
    }
    if (key === "AutoLogout") this.armLogout();
    if (key === "language") {
      await loadLanguage(raw);
      document.documentElement.lang = raw;
      if (!this.view.composerOpen()) location.reload();
      else this.view.notice("Die Sprache gilt vollst\xE4ndig nach dem n\xE4chsten Laden.");
    }
    const readKeys = ["RemoveColors", "AllowStyles", "minFontSize", "MaxBlockquotesLevel", "CollapseBlockquotes", "ViewHTML", "ViewImages", "ViewImagesWhitelist", "ListInlineAttachments", "simpleAttachmentsList"];
    if (readKeys.includes(key)) {
      this.readPrefs(this.composeData);
      if (this.current) await this.paintLetter();
    }
    const writeKeys = ["EditorDefaultType", "markdown", "allowSpellcheck", "AllowDraftAutosave", "ReplySameFolder", "requestReadReceipt", "requestDsn", "requireTLS", "pgpSign", "pgpEncrypt"];
    if (writeKeys.includes(key)) this.configureComposer();
    if (key === "NotificationSound") this.prefs.soundName = raw;
    if (key === "SoundNotification") this.prefs.sound = raw === "1";
    if (key === "DesktopNotifications") this.prefs.desktop = raw === "1";
    if (key === "messageReadAuto") this.prefs.readAuto = raw === "1";
    if (key === "MessageReadDelay") this.prefs.readDelay = Number(raw) || 0;
    if (key === "showNextMessage") this.prefs.showNext = raw === "1";
    if (key === "messageNewWindow") this.prefs.newWindow = raw === "1";
    this.view.settingsSaved();
  }
  async markUnread() {
    const uids = this.targets();
    if (!uids.length) return;
    if (this.checked.size) {
      await this.setSeen(uids, false);
      return;
    }
    window.clearTimeout(this.readTimer);
    const message = this.messages.find((item) => item.uid === uids[0]) || this.current;
    await this.setSeen(uids, !(message && seen(message.flags)) ? true : false);
  }
  async setFlag(uids, flag2, value, action) {
    const apply = (list) => value ? [...new Set(list.concat(flag2))] : list.filter((item) => item.toLowerCase() !== flag2.toLowerCase());
    this.messages.forEach((message) => {
      if (uids.includes(message.uid)) message.flags = apply(message.flags);
    });
    if (this.current && uids.includes(this.current.uid)) this.current.flags = apply(this.current.flags);
    this.paintList();
    if (this.current && uids.includes(this.current.uid) && !this.checked.size) void this.paintLetter();
    try {
      const params = { folder: this.folder, uids: uids.join(","), setAction: value ? 1 : 0 };
      if (action === "MessageSetKeyword") params.keyword = flag2;
      await call(action, params);
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
  pickerFolders() {
    const rows2 = flattenTree(buildTree(this.folders, (folder) => this.roleOf(folder)), {
      collapsed: /* @__PURE__ */ new Set(),
      filter: "",
      hidden: (folder) => this.hiddenFolder(folder),
      current: "",
      roleOf: (folder) => this.roleOf(folder),
      actions: () => []
    });
    return rows2.filter((row2) => row2.info.selectable).map((row2) => ({ fullName: row2.info.fullName, name: this.folderName(row2.info), depth: row2.depth, role: row2.role }));
  }
  paintBulk() {
    if (!this.checked.size) {
      if (this.current) void this.paintLetter();
      else this.view.setReader(null, "", "");
      return;
    }
    this.view.setBulk({ count: this.checked.size, place: this.place(), zip: this.prefs.zip });
  }
  letterPrint() {
    const message = this.current;
    if (!message) return null;
    let body;
    let kind = "plain";
    if (this.letter.mode === "html" && message.html) {
      kind = "html";
      const cleaned = cleanHtml(message.html, {
        allowStyles: false,
        removeColors: false,
        minFontSize: this.prefs.minFontSize,
        maxBlockquotes: 0,
        collapseBlockquotes: false,
        inline: (ref) => message.attachments.find((file) => file.cid.toLowerCase() === ref.replace(/^<|>$/g, "").toLowerCase())?.hash || null
      });
      body = fillInline(cleaned.html, this.inlineCache);
      if (this.imagesAllowed(message) && !this.prefs.proxy) body = revealExternals(body, () => true, (url) => url).html;
    } else {
      body = plainToHtml(message.plain || plainFromHtml(message.html), false);
    }
    return {
      subject: message.subject,
      from: message.from.map(address).join(", "),
      to: message.to.map(address).join(", "),
      cc: message.cc.map(address).join(", "),
      when: whenFull(message.date),
      body,
      kind,
      attachments: message.attachments.filter((file) => !file.inline).map((file) => ({ name: file.name, href: new URL(file.href, location.href).href }))
    };
  }
  messageKey(message) {
    return messageHash(message.folder, message.uid, message.subject, message.hash, this.accountHash);
  }
  /** Neue Mails prüfen: Ordnerzahlen, Liste des offenen Ordners, Hinweis und Ton bei neuer Mail im Posteingang. */
  async poll(manual) {
    if (!this.email) return;
    this.lastPoll = Date.now();
    if (manual) this.view.setRefreshing(true);
    try {
      const result = await call("Folders");
      const fresh = new Map((result["@Collection"] || []).map((item) => [String(item.fullName || ""), item]));
      let changed = manual;
      this.folders.forEach((folder) => {
        const item = fresh.get(folder.fullName);
        if (!item) return;
        const uidNext = Number(item.uidNext || 0);
        if (folder.fullName === this.folder && uidNext && uidNext !== folder.uidNext) changed = true;
        folder.unread = Number(item.unreadEmails || 0);
        folder.total = Number(item.totalEmails || 0);
        if (uidNext) folder.uidNext = uidNext;
      });
      if (result && typeof result === "object" && "quotaLimit" in result) {
        const raw = result;
        this.folderModel.quotaUsage = raw.quotaUsage == null ? null : Number(raw.quotaUsage);
        this.folderModel.quotaLimit = raw.quotaLimit == null ? null : Number(raw.quotaLimit);
      }
      const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
      if (inbox) {
        const item = fresh.get(inbox.fullName);
        const uidNext = Number(item?.uidNext || inbox.uidNext);
        if (this.inboxUid && uidNext > this.inboxUid && inbox.unread > this.inboxUnread && this.inboxUnread >= 0) {
          this.announce(Math.max(1, inbox.unread - this.inboxUnread));
        }
        this.inboxUid = uidNext;
        this.inboxUnread = inbox.unread;
      }
      this.paintFolders();
      if (changed) await this.loadList(false, true);
    } catch (error) {
      if (manual) this.view.notice(explain(error));
    } finally {
      if (manual) this.view.setRefreshing(false);
    }
  }
  announce(count) {
    if (this.prefs.sound && this.prefs.soundName) {
      try {
        const audio = new Audio(`${location.pathname.replace(/\/+$/, "")}/${this.prefs.webPath.replace(/^\/+/, "")}static/sounds/${encodeURIComponent(this.prefs.soundName)}.mp3`);
        void audio.play().catch(() => void 0);
      } catch {
      }
    }
    if (this.prefs.desktop && "Notification" in window && Notification.permission === "granted" && document.hidden) {
      try {
        const note2 = new Notification(count === 1 ? "Eine neue Mail" : `${count} neue Mails`, { body: this.email, tag: "sm-new-mail" });
        note2.onclick = () => {
          window.focus();
          note2.close();
        };
      } catch {
      }
    }
  }
  async loadAccounts() {
    try {
      const result = await call("AccountsAndIdentities");
      const list = Array.isArray(result.Accounts) ? result.Accounts : Object.values(result.Accounts || {});
      const main = this.mainEmail || this.email;
      const emails = [main, ...list.map((item) => String(item.email || ""))].filter((email, index, all) => email && all.indexOf(email) === index);
      const items = emails.map((email) => ({ email, unread: 0, current: email === this.email }));
      this.view.setAccounts(items);
      await Promise.all(items.filter((item) => !item.current && item.email !== main).map(async (item) => {
        try {
          const info = await call("AccountUnread", { email: item.email });
          item.unread = Number(info.unreadEmails || 0);
        } catch {
        }
      }));
      this.view.setAccounts(items);
    } catch {
      this.view.setAccounts([]);
    }
  }
  /** Mail-Aktionen aus der Oberfläche (Phase 1). */
  async passFor(id) {
    const known = rememberedPass(id);
    if (known) return known;
    const answer = await this.view.askSecret(t("CRYPTO.PASSPHRASE_TITLE", "Passphrase"), t("CRYPTO.PASSPHRASE", "Passphrase"));
    if (!answer) return null;
    rememberPass(id, answer.value, answer.remember);
    return answer.value;
  }
  async decryptOpen() {
    const message = this.current;
    if (!message) return;
    try {
      let raw = "";
      if (message.crypto.pgpEncrypted && this.caps.gnupg) {
        const keys = await loadGnuKeys();
        const secret = keys.find((key) => key.secret) || null;
        const pass = await this.passFor(secret?.id || "gnupg");
        if (pass == null) return;
        raw = await gnupgDecrypt(message.folder, message.uid, message.crypto.pgpEncrypted.partId, secret?.id || "", pass);
      } else if (message.crypto.smimeEncrypted) {
        const identity = this.identities.find((item) => item.smimeKey && item.smimeCertificate) || null;
        const pass = await this.passFor(`smime:${identity?.id || ""}`);
        if (pass == null) return;
        raw = await smimeDecrypt(message.folder, message.uid, message.crypto.smimeEncrypted.partId, identity?.smimeCertificate || "", identity?.smimeKey || "", pass);
      } else return;
      if (!raw) throw new ApiError(0, t("CRYPTO.DECRYPT_FAIL", "Die Mail lie\xDF sich nicht entschl\xFCsseln."));
      const body = bodyFromDecrypt(raw);
      if (body.html) {
        message.html = body.html;
        this.letter.mode = "html";
      }
      if (body.plain) message.plain = body.plain;
      message.cryptoState = "ok";
      message.cryptoText = t("CRYPTO.DECRYPTED", "Entschl\xFCsselt.");
      await this.paintLetter();
    } catch (error) {
      message.cryptoState = "bad";
      message.cryptoText = explain(error);
      await this.paintLetter();
    }
  }
  async verifyOpen() {
    const message = this.current;
    if (!message) return;
    try {
      const result = message.crypto.pgpSigned ? await pgpVerify(message.folder, message.uid, message.crypto.pgpSigned) : message.crypto.smimeSigned ? await smimeVerify(message.folder, message.uid, message.crypto.smimeSigned) : null;
      if (!result) return;
      message.cryptoState = result.ok ? "ok" : "bad";
      message.cryptoText = result.text;
    } catch (error) {
      message.cryptoState = "bad";
      message.cryptoText = explain(error);
    }
    await this.paintLetter();
  }
  async importAutocrypt() {
    const message = this.current;
    const parsed = message ? autocryptKey(message.autocrypt) : null;
    if (!message || !parsed) return;
    try {
      await call("PgpImportKey", { key: parsed.key, keyId: "", email: parsed.email, backup: 1, gnuPG: this.caps.gnupg ? 1 : 0 });
      this.view.notice(t("CRYPTO.KEY_IMPORTED", "Schl\xFCssel \xFCbernommen."));
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
  async importSmimeCerts() {
    const message = this.current;
    const part2 = message?.crypto.smimeSigned || message?.crypto.smimeEncrypted;
    if (!message || !part2) return;
    try {
      try {
        await call("SMimeImportCertificatesFromMessage", {
          folder: message.folder,
          uid: message.uid,
          partId: part2.partId,
          sigPartId: part2.sigPartId
        });
      } catch {
      }
      if (message.crypto.smimeSigned) await smimeVerify(message.folder, message.uid, message.crypto.smimeSigned);
      this.view.notice(t("SMIME.IMPORTED", "Zertifikate \xFCbernommen, soweit der Server sie lesen konnte."));
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
  async act(name, data) {
    const message = this.current;
    const ref = Number(data.ref || data.uid || 0);
    switch (name) {
      case "login-lang": {
        if (!data.language) return;
        try {
          await loadLanguage(data.language);
          document.documentElement.lang = data.language;
          if (!this.view.hasMail()) {
            const system = this.boot.System || {};
            this.view.showLogin(String(this.boot.title || "SnappyMail"), {
              languages: this.boot.allowLanguagesOnLogin ? system.languages : void 0,
              language: data.language,
              twoFactor: "RequireTwoFactor" in this.boot
            });
          }
        } catch (error) {
          this.view.setLoginError(explain(error));
        }
        return;
      }
      case "select": {
        const uid = Number(data.uid || 0);
        if (!uid) return;
        const order = this.visible().map((item) => item.uid);
        if (!this.checked.size && this.selected && this.selected !== uid && data.mode !== "range") this.checked.add(this.selected);
        if (data.mode === "range" && (this.anchor || this.selected)) {
          const from = order.indexOf(this.anchor || this.selected);
          const to = order.indexOf(uid);
          if (from >= 0 && to >= 0) order.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((item) => this.checked.add(item));
        } else if (this.checked.has(uid)) this.checked.delete(uid);
        else this.checked.add(uid);
        this.anchor = uid;
        window.clearTimeout(this.readTimer);
        this.paintList();
        this.paintBulk();
        return;
      }
      case "select-all": {
        const order = this.visible().map((item) => item.uid);
        if (order.length && order.every((uid) => this.checked.has(uid))) this.checked.clear();
        else order.forEach((uid) => this.checked.add(uid));
        this.paintList();
        this.paintBulk();
        return;
      }
      case "clear-selection":
        this.checked.clear();
        this.paintList();
        this.paintBulk();
        return;
      case "refresh":
        await this.poll(true);
        return;
      case "flag": {
        const uids = ref ? [ref] : this.targets();
        if (!uids.length) return;
        const all = uids.every((uid) => hasFlag((this.messages.find((item) => item.uid === uid) || message)?.flags || [], "\\flagged"));
        await this.setFlag(uids, "\\flagged", !all, "MessageSetFlagged");
        return;
      }
      case "flag-all":
      case "unflag-all":
        await this.setFlag(this.targets(), "\\flagged", name === "flag-all", "MessageSetFlagged");
        return;
      case "read":
        await this.setSeen(this.targets(), true);
        return;
      case "unread-all":
        await this.setSeen(this.targets(), false);
        return;
      case "move":
      case "copy": {
        const uids = this.targets();
        if (!uids.length) return;
        const copy = name === "copy";
        const target = await this.view.pickFolder(copy ? "Kopieren nach" : "Verschieben nach", this.pickerFolders(), copy ? "" : this.folder);
        if (!target) return;
        const n = uids.length === 1 ? "Mail" : `${uids.length} Mails`;
        await this.moveTo(uids, target, copy, `${n} ${copy ? "kopiert" : "verschoben"} nach ${target}.`);
        return;
      }
      case "drop": {
        const uid = Number(data.uid || 0);
        const uids = this.checked.has(uid) ? [...this.checked] : [uid];
        const copy = data.copy === "1";
        if (!data.folder || !copy && data.folder === this.folder) return;
        const n = uids.length === 1 ? "Mail" : `${uids.length} Mails`;
        await this.moveTo(uids, data.folder, copy, `${n} ${copy ? "kopiert" : "verschoben"} nach ${data.folder}.`);
        return;
      }
      case "archive":
        await this.archive();
        return;
      case "spam":
      case "notspam": {
        const uids = this.targets();
        const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX")?.fullName || "INBOX";
        const target = name === "spam" ? this.junkFolder : inbox;
        if (!uids.length || !target) return;
        await this.moveTo(uids, target, false, name === "spam" ? "Als Spam verschoben." : "In den Posteingang verschoben.");
        return;
      }
      case "delete-forever":
        await this.remove(true);
        return;
      case "restore": {
        const uids = this.targets();
        await this.setFlag(uids, "\\deleted", false, "MessageSetDeleted");
        this.view.notice("Wiederhergestellt.");
        return;
      }
      case "tag": {
        if (!message) return;
        const value = await this.view.ask("Schlagwort hinzuf\xFCgen", "Schlagwort");
        const keyword = (value || "").replace(/[\s\\()"{}%*\]]+/g, "");
        if (!keyword) return;
        await this.setFlag([message.uid], keyword, true, "MessageSetKeyword");
        return;
      }
      case "untag":
        if (message && data.tag) await this.setFlag([message.uid], data.tag, false, "MessageSetKeyword");
        return;
      case "images":
        this.letter.images = true;
        await this.paintLetter();
        return;
      case "images-always": {
        const sender = message?.from[0]?.email;
        if (!sender) return;
        this.letter.images = true;
        const list = this.prefs.whitelist.split(/[\s,;]+/).filter(Boolean);
        if (!list.includes(sender)) list.push(sender);
        this.prefs.whitelist = list.join("\n");
        if (this.prefs.viewImages === "ask") this.prefs.viewImages = "match";
        await this.paintLetter();
        try {
          await call("SettingsUpdate", { ViewImagesWhitelist: this.prefs.whitelist, ViewImages: this.prefs.viewImages });
          this.view.notice(`Bilder von ${sender} werden k\xFCnftig angezeigt.`);
        } catch (error) {
          this.view.notice(explain(error));
        }
        return;
      }
      case "links":
        this.letter.links = !this.letter.links;
        await this.paintLetter();
        return;
      case "mode":
        this.letter.mode = this.letter.mode === "html" ? "plain" : "html";
        await this.paintLetter();
        return;
      case "swap":
        this.letter.swap = !this.letter.swap;
        await this.paintLetter();
        return;
      case "decrypt":
        await this.decryptOpen();
        return;
      case "verify":
        await this.verifyOpen();
        return;
      case "autocrypt":
        await this.importAutocrypt();
        return;
      case "smime-certs":
        await this.importSmimeCerts();
        return;
      case "receipt":
      case "receipt-skip": {
        if (!message) return;
        this.receiptSkipped.add(`${message.folder}:${message.uid}`);
        if (name === "receipt") {
          try {
            await call("SendReadReceiptMessage", {
              messageFolder: message.folder,
              messageUid: message.uid,
              readReceipt: message.readReceipt,
              subject: `Gelesen: ${message.subject}`,
              plain: `Ihre Nachricht an ${this.email} wurde gelesen.`
            });
            message.flags.push("$mdnsent");
            this.view.notice("Lesebest\xE4tigung gesendet.");
          } catch (error) {
            this.receiptSkipped.delete(`${message.folder}:${message.uid}`);
            this.view.notice(explain(error));
          }
        }
        await this.paintLetter();
        return;
      }
      case "unsubscribe": {
        if (!message) return;
        const info = parseUnsubscribe(message.headers["list-unsubscribe"] || "", message.headers["list-unsubscribe-post"] || "");
        if (!info) return;
        if (info.mailto) {
          const seed = parseMailto(info.mailto);
          this.replyKind = "";
          this.draftRef = null;
          this.view.openCompose({ title: "Vom Verteiler abmelden", to: seed.to, cc: seed.cc, bcc: seed.bcc, subject: seed.subject || "unsubscribe", body: seed.body, mode: "new" });
          return;
        }
        const host = (() => {
          try {
            return new URL(info.http).host;
          } catch {
            return info.http;
          }
        })();
        const ok = await this.view.confirm("Vom Verteiler abmelden?", `Die Abmeldeseite von ${host} \xF6ffnet sich in einem neuen Tab.`, "Seite \xF6ffnen", false);
        if (ok) window.open(info.http, "_blank", "noopener,noreferrer");
        return;
      }
      case "print":
      case "window": {
        const print = this.letterPrint();
        if (!print) return;
        if (!openLetterWindow(print, name === "print")) this.view.notice("Das Fenster wurde vom Browser blockiert.");
        return;
      }
      case "source":
        if (message) window.open(rawUrl("ViewAsPlain", this.messageKey(message)), "_blank", "noopener");
        return;
      case "eml":
        if (message) {
          const link = document.createElement("a");
          link.href = rawUrl("Download", this.messageKey(message));
          link.download = `${message.subject || "mail"}.eml`;
          document.body.append(link);
          link.click();
          link.remove();
        }
        return;
      case "edit-draft":
      case "edit-new": {
        if (!message) return;
        this.replyKind = "";
        this.draftRef = name === "edit-draft" ? { folder: message.folder, uid: message.uid } : null;
        this.view.openCompose({
          title: name === "edit-draft" ? "Entwurf" : "Neue Nachricht",
          to: message.to.map(address).join(", "),
          cc: message.cc.map(address).join(", "),
          bcc: message.bcc.map(address).join(", "),
          replyTo: message.replyTo.map(address).join(", "),
          subject: message.subject,
          body: message.plain || plainFromHtml(message.html),
          html: message.html,
          mode: name === "edit-draft" ? "draft" : "new",
          draftRef: this.draftRef,
          identityId: this.identities.find((identity) => message.from.some((person2) => person2.email.toLowerCase() === identity.email.toLowerCase()))?.id
        });
        void this.view.attachCompose(message.attachments.filter((file) => !file.inline).map((file) => ({ key: file.hash, name: file.name, size: file.size })));
        return;
      }
      case "forward-att": {
        const uids = this.targets();
        const list = uids.map((uid) => message && message.uid === uid ? message : this.messages.find((item) => item.uid === uid)).filter(Boolean);
        if (!list.length) return;
        this.replyKind = "";
        this.draftRef = null;
        const subject = list.length === 1 ? /^fw:/i.test(list[0].subject) ? list[0].subject : `Fw: ${list[0].subject}` : "Weitergeleitete Nachrichten";
        this.view.openCompose({ title: "Als Anhang weiterleiten", to: "", cc: "", subject, body: "", mode: "new" });
        void this.view.attachCompose(list.map((item) => ({ key: this.messageKey(item), name: `${(item.subject || "Mail").slice(0, 60)}.eml`, size: item.size })));
        return;
      }
      case "preview": {
        const file = message?.attachments[Number(data.index || -1)];
        if (!file) return;
        const kind = fileKind(file);
        if (kind === "pdf") {
          window.open(rawUrl("View", file.hash), "_blank", "noopener");
          return;
        }
        this.view.preview(file.name, rawUrl(kind === "image" ? "View" : "ViewAsPlain", file.hash), kind === "image" ? "image" : "text");
        return;
      }
      case "zip":
      case "zip-mails": {
        const hashes = name === "zip" ? message?.attachments.filter((file) => !file.inline).map((file) => file.hash) || [] : this.targets().map((uid) => this.messages.find((item) => item.uid === uid)).filter(Boolean).map((item) => this.messageKey(item));
        if (!hashes.length) return;
        try {
          const result = await call("AttachmentsActions", {
            target: "zip",
            filename: name === "zip" ? message?.subject || "Anh\xE4nge" : "Mails",
            hashes,
            folder: this.folder
          });
          if (!result.fileHash) throw new ApiError(1, "ZIP konnte nicht erstellt werden.");
          const link = document.createElement("a");
          link.href = rawUrl("Download", result.fileHash);
          link.download = `${result.fileHash}.zip`;
          document.body.append(link);
          link.click();
          link.remove();
        } catch (error) {
          this.view.notice(explain(error));
        }
        return;
      }
      case "prev":
      case "next": {
        const order = this.visible().map((item) => item.uid);
        const index = order.indexOf(this.selected);
        const uid = order[index + (name === "next" ? 1 : -1)];
        if (uid) await this.selectMessage(uid);
        else if (name === "next" && this.hasMore) {
          await this.loadList(true);
          const more = this.visible().map((item) => item.uid)[index + 1];
          if (more) await this.selectMessage(more);
        }
        return;
      }
      case "addr-write":
        this.replyKind = "";
        this.draftRef = null;
        this.view.openCompose({ title: "Neue Nachricht", to: address({ name: data.name || "", email: data.email || "" }), cc: "", subject: "", body: "", mode: "new" });
        return;
      case "addr-copy":
        try {
          await navigator.clipboard.writeText(data.email || "");
          this.view.notice("Adresse kopiert.");
        } catch {
          this.view.notice(data.email || "");
        }
        return;
      case "addr-search":
        if (data.email) {
          const input2 = document.querySelector("#search");
          const query = `from=${encodeValue(data.email)}`;
          if (input2) input2.value = query;
          await this.setSearch(query);
        }
        return;
      case "addr-contact":
        if (data.email && this.caps.contacts) {
          try {
            let card = writeProp(void 0, "fn", (data.name || "").trim() || data.email);
            card = writeProp(card, "email", data.email);
            await call("ContactSave", { uid: "", jCard: card });
            this.view.notice(`${data.name || data.email} wurde zu den Kontakten hinzugef\xFCgt.`);
            await this.view.reloadBook();
          } catch (error) {
            this.view.notice(explain(error));
          }
        }
        return;
      case "compose-to":
        this.replyKind = "";
        this.draftRef = null;
        this.view.openCompose({ title: "Neue Nachricht", to: data.to || "", cc: "", subject: "", body: "", mode: "new" });
        return;
      case "accounts":
        await this.loadAccounts();
        return;
      case "sort":
        if (!this.capability("SORT")) return;
        this.sort = data.sort || "";
        await this.reloadList();
        return;
      case "threads-toggle":
        if (!this.threadsAvailable()) return;
        this.prefs.useThreads = !this.prefs.useThreads;
        this.threadUid = 0;
        try {
          await call("SettingsUpdate", { UseThreads: this.prefs.useThreads ? 1 : 0 });
        } catch (error) {
          this.view.notice(explain(error));
        }
        await this.reloadList();
        return;
      case "group-toggle":
        this.prefs.listGrouped = !this.prefs.listGrouped;
        try {
          await call("SettingsUpdate", { listGrouped: this.prefs.listGrouped ? 1 : 0 });
        } catch (error) {
          this.view.notice(explain(error));
        }
        this.paintMode();
        this.paintList();
        return;
      case "thread": {
        if (!this.threadsOn() || this.threadUid) return;
        const uid = ref || this.selected;
        const row2 = this.messages.find((item) => item.uid === uid);
        if (!row2 || row2.threads.length < 2) return;
        this.threadUid = row2.uid;
        this.threadSubject = row2.subject;
        await this.reloadList();
        return;
      }
      case "thread-back":
        if (!this.threadUid) return;
        this.threadUid = 0;
        await this.reloadList();
        return;
      case "quick": {
        const flag2 = data.flag;
        if (!["unseen", "flagged", "attachment"].includes(flag2)) return;
        const base = data.query ?? this.search;
        await this.setSearch(toggleQuick(base, flag2, this.capability("MULTISEARCH")));
        return;
      }
      case "adv-search": {
        const query = data.query ?? this.search;
        const keywords = [...new Set(this.messages.flatMap((item) => item.flags).filter((flag2) => !SYSTEM_FLAGS.test(flag2)))].sort();
        this.view.openSearch(parseSearch(query), { multisearch: this.capability("MULTISEARCH"), keywords });
        return;
      }
      case "switch":
        if (!data.email) return;
        try {
          await call("AccountSwitch", { Email: data.email });
          await this.enter(await loadApp());
        } catch (error) {
          this.view.notice(explain(error));
        }
        return;
      default:
        if (name.startsWith("f-")) await this.folderAction(name, data);
        return;
    }
  }
  /** Liste ab Offset 0 neu laden; Suche und Ordner bleiben. */
  async reloadList() {
    this.offset = 0;
    this.selected = 0;
    this.current = null;
    this.checked.clear();
    this.view.setReader(null, "", "");
    this.paintMode();
    await this.loadList(false);
  }
  strip() {
    return {
      loading: "",
      error: "",
      tldr: this.tldr,
      cached: this.summaryCached,
      decisions: [],
      actions: [],
      next: "",
      replies: this.replies,
      model: this.summaryModel,
      showSummarize: Boolean(this.assistFlags?.summarize),
      showReplies: Boolean(this.assistFlags?.replies)
    };
  }
  tldr = "";
  summaryCached = false;
  summaryModel = "";
  paintStrip() {
    if (!this.assistFlags?.summarize && !this.assistFlags?.replies) return;
    this.view.setStrip(this.current ? this.strip() : null);
  }
  async loadCachedSummary() {
    if (!this.assistFlags?.summarize || !this.current) return;
    try {
      const result = await plugin("AiSummarize", {
        folder: this.folder,
        uids: [this.current.uid],
        cacheOnly: true,
        sent: this.sentFolder
      });
      this.tldr = result.summary?.tldr || "";
      this.summaryCached = Boolean(result.cached);
      this.summaryModel = result.summary?.model || "";
      this.paintStrip();
    } catch {
      this.paintStrip();
    }
  }
  async consent(kind = "mail") {
    if (this.noticeAck) return true;
    const name = this.assistFlags?.providerName || "den Anbieter";
    const text2 = kind === "query" ? `Nur die Suchanfrage geht an ${name}. Die Mails selbst bleiben auf dem Server. Fortfahren?` : `Diese KI-Funktion sendet den Inhalt der betroffenen Mails an ${name}. Es wird nur gesendet, wenn Sie eine KI-Aktion anklicken. Fortfahren?`;
    const ok = await this.view.confirmConsent(text2);
    if (!ok) return false;
    try {
      await plugin("AiSaveSettings", { settings: { notice_ack: true } });
    } catch {
    }
    this.noticeAck = true;
    return true;
  }
  async loadAlerts() {
    const inbox = this.folders.find((folder) => folder.role === "inbox")?.fullName || "INBOX";
    try {
      const result = await plugin("AiAlerts", {
        inbox,
        sent: this.sentFolder
      });
      this.alertItems = result.alerts || [];
      const count = (type) => this.alertItems.filter((item) => item.type === type).length;
      this.view.setAlerts(count("reply"), count("followup"), count("invoice"), "");
    } catch {
    }
  }
  async assist(name, data) {
    if (name === "cat") {
      this.category = data.cat || "all";
      if (this.category !== "all" && this.assistFlags?.triage && !this.tagged.has(this.folder)) {
        try {
          await plugin("AiTriageTag", { folder: this.folder, sent: this.sentFolder });
          this.tagged.add(this.folder);
        } catch (error) {
          this.view.notice(explain(error));
          return;
        }
      }
      this.offset = 0;
      await this.loadList(false);
      return;
    }
    if (name === "alert") {
      if (data.kind === "follow") {
        const sent = this.folders.find((folder) => folder.role === "sent")?.fullName || this.sentFolder;
        if (sent) await this.selectFolder(sent);
        return;
      }
      await this.assist("cat", { cat: data.kind === "invoice" ? "invoice" : "needs_reply" });
      this.view.pressCategory(data.kind === "invoice" ? "invoice" : "needs_reply");
      return;
    }
    if (name === "ask") {
      if (this.chatBusy) return;
      this.chatBusy = true;
      if (!await this.consent()) {
        this.chatBusy = false;
        this.view.setChat(this.turns, "", this.contextLabel());
        return;
      }
    }
    if (name === "summarize" || name === "replies" || name === "generate" || name === "triage" || name === "deadlines") {
      if (!await this.consent()) return;
    }
    if (name === "lang-search") {
      if (!await this.consent("query")) return;
      const query = data.text || "";
      const input2 = document.querySelector("#search");
      const text2 = query || input2?.value.trim() || "";
      if (!text2) return;
      try {
        const result = await plugin("AiSearch", {
          query: text2,
          folders: this.folders.map((folder) => folder.fullName),
          currentFolder: this.folder,
          sent: this.sentFolder
        });
        if (result.folder && result.folder !== this.folder) await this.selectFolder(result.folder);
        this.view.showTranslation(result.search, result.explanation || "");
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "run-search") {
      const field2 = document.querySelector("#translate-q");
      this.category = "all";
      this.view.pressCategory("all");
      await this.setSearch(field2?.value.trim() || "");
      return;
    }
    if (name === "summarize" && this.current) {
      this.view.setStrip({ ...this.strip(), loading: "Verlauf wird zusammengefasst \u2026", tldr: "" });
      try {
        const result = await plugin("AiSummarize", {
          folder: this.folder,
          uids: [this.current.uid],
          force: data.force === "1",
          sent: this.sentFolder
        });
        this.tldr = result.summary?.tldr || "";
        this.summaryCached = Boolean(result.cached);
        this.summaryModel = result.summary?.model || this.assistFlags?.provider || "";
        this.paintStrip();
      } catch (error) {
        this.view.setStrip({ ...this.strip(), error: explain(error) });
      }
      return;
    }
    if (name === "replies" && this.current) {
      this.view.setStrip({ ...this.strip(), loading: "Antwortvorschl\xE4ge werden erstellt \u2026" });
      try {
        const result = await plugin("AiQuickReplies", {
          folder: this.folder,
          uids: [this.current.uid],
          sent: this.sentFolder
        });
        this.replies = (result.replies || []).slice(0, 3);
        this.paintStrip();
      } catch (error) {
        this.view.setStrip({ ...this.strip(), error: explain(error) });
      }
      return;
    }
    if (name === "use-reply") {
      const reply = this.replies[Number(data.index || 0)];
      if (!reply || !this.current) return;
      this.replyKind = "reply";
      const author = this.current.replyTo[0] || this.current.from[0];
      this.view.openCompose({
        title: reply.label || "Antworten",
        mode: "reply",
        to: author ? address(author) : "",
        cc: "",
        subject: /^re:/i.test(this.current.subject) ? this.current.subject : `Re: ${this.current.subject}`,
        body: reply.body
      });
      return;
    }
    if (name === "triage") {
      this.view.notice("Absender, Betreff und Vorschau dieser Seite gehen an das Modell.");
      try {
        const result = await plugin("AiTriageLlm", {
          folder: this.folder,
          items: this.messages.map((message) => ({
            uid: message.uid,
            from: message.from.map(label).join(", "),
            subject: message.subject,
            preview: message.preview
          }))
        });
        this.view.notice(result.warning || `${result.stored || 0} Mails eingeordnet.`);
        await this.loadList(false);
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "deadlines") {
      const items = this.alertItems.filter((item) => item.type !== "followup").slice(0, 8);
      if (!items.length) {
        this.view.notice("Keine Mails f\xFCr eine Frist.");
        return;
      }
      try {
        const result = await plugin("AiAlertsLlm", { items });
        const dues = (result.alerts || []).filter((item) => item.due).map((item) => `${item.due} ${item.title}`).join(" \xB7 ");
        this.view.setAlerts(
          this.alertItems.filter((item) => item.type === "reply").length,
          this.alertItems.filter((item) => item.type === "followup").length,
          this.alertItems.filter((item) => item.type === "invoice").length,
          dues
        );
      } catch (error) {
        this.view.notice(explain(error));
      }
      return;
    }
    if (name === "ask") {
      const text2 = (data.text || "").trim();
      if (!text2) {
        this.chatBusy = false;
        return;
      }
      const area = document.querySelector("#ask");
      if (area) area.value = "";
      this.chat.push({ role: "user", content: text2 });
      this.turns.push({ role: "user", text: text2, trace: [], actions: [] });
      this.view.setChat(this.turns, "Copilot arbeitet \u2026", this.contextLabel());
      try {
        const result = await plugin("AiChat", {
          messages: this.chat,
          context: this.useContext && this.current ? { folder: this.folder, uid: this.current.uid } : {},
          folders: this.folders.map((folder) => folder.fullName),
          sent: this.sentFolder
        });
        this.chat.push({ role: "assistant", content: result.reply || "" });
        this.chatActions = result.actions || [];
        this.turns.push({
          role: "assistant",
          text: result.reply || "",
          trace: (result.trace || []).map((item) => item.summary || "").filter(Boolean),
          actions: this.chatActions.map((action) => ({ label: String(action.label || action.type || ""), state: "" }))
        });
        this.view.setChat(this.turns, "", this.contextLabel());
      } catch (error) {
        this.view.setChat(this.turns, "!" + explain(error), this.contextLabel());
      } finally {
        this.chatBusy = false;
      }
      return;
    }
    if (name === "drop-context") {
      this.useContext = false;
      this.view.setChat(this.turns, "", "");
      return;
    }
    if (name === "dismiss-action") {
      const index = Number(data.index || 0);
      const turn = [...this.turns].reverse().find((item) => item.role === "assistant");
      if (turn?.actions[index]) turn.actions[index].state = "Verworfen";
      this.view.setChat(this.turns, "", this.contextLabel());
      return;
    }
    if (name === "run-action") {
      await this.runChatAction(Number(data.index || 0));
      return;
    }
    if (name === "generate") await this.generate();
    if (name === "stop-generate") this.draftAbort?.abort();
    if (name === "revert-draft") this.view.setDraftBody(this.draftBackup);
    if (name === "apply-subject") {
      const hint = document.querySelector("#subject-hint");
      const subject = hint?.dataset.subject || "";
      const field2 = document.querySelector("input[name='subject']");
      if (field2 && subject) field2.value = subject;
    }
  }
  contextLabel() {
    if (!this.useContext || !this.current) return "";
    return this.current.subject || "(ohne Betreff)";
  }
  async generate() {
    const options2 = this.view.draftOptions();
    this.draftBackup = options2.body;
    this.draftAbort = new AbortController();
    this.view.setDraftBusy(true, "Entwurf wird geschrieben \u2026");
    let streamed = "";
    try {
      await streamEvents("AiStream", {
        mode: options2.mode,
        tone: options2.tone,
        instruction: options2.instruction,
        current: options2.body,
        wantSubject: options2.mode === "new" || options2.mode === "reply",
        folder: this.folder,
        uids: this.current ? [this.current.uid] : [],
        sent: this.sentFolder
      }, (event, payload) => {
        if (event === "delta") {
          streamed += String(payload.text || "");
          this.view.setDraftBody(streamed);
        }
        if (event === "done") {
          this.view.setDraftBody(String(payload.body || streamed));
          this.view.setSubjectHint(String(payload.subject || ""));
          this.summaryModel = String(payload.model || "");
        }
        if (event === "error") throw new ApiError(1, String(payload.error || "Verbindung unterbrochen."));
      }, this.draftAbort.signal);
      this.view.setDraftBusy(false, `Entwurf eingef\xFCgt.${this.summaryModel ? ` \xB7 ${this.summaryModel}` : ""}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.view.setDraftBusy(false, "Abgebrochen.");
        return;
      }
      this.view.setDraftBusy(false, explain(error));
    }
  }
  async runChatAction(index) {
    const action = this.chatActions[index];
    const turn = [...this.turns].reverse().find((item) => item.role === "assistant");
    if (!action || !turn?.actions[index] || turn.actions[index].state) return;
    const type = String(action.type || "");
    const folder = String(action.folder || this.folder);
    const uids = Array.isArray(action.uids) ? action.uids.map(String).join(",") : "";
    try {
      if (type === "delete") {
        if (!await this.view.confirmDelete()) return;
        await call("MessageDelete", { folder, uids });
      } else if (type === "archive") {
        if (!this.archiveFolder) throw new ApiError(1, "Kein Archiv-Ordner eingerichtet.");
        await call("MessageMove", { fromFolder: folder, toFolder: this.archiveFolder, uids });
      } else if (type === "move") {
        await call("MessageMove", { fromFolder: folder, toFolder: String(action.to || ""), uids });
      } else if (type === "mark_read" || type === "mark_unread") {
        await call("MessageSetSeen", { folder, uids, setAction: type === "mark_read" ? 1 : 0 });
      } else if (type === "flag" || type === "unflag") {
        await call("MessageSetFlagged", { folder, uids, setAction: type === "flag" ? 1 : 0 });
      } else if (type === "open" || type === "reply") {
        await this.selectFolder(folder);
        await this.selectMessage(Number(action.uid || 0));
        if (type === "reply") this.openReply(false);
        this.view.closeSheet();
      } else if (type === "compose") {
        this.openNew();
        this.view.openCompose({
          title: "Neue Nachricht",
          mode: "new",
          to: String(action.to || ""),
          cc: "",
          subject: String(action.subject || ""),
          body: ""
        });
      } else if (type === "search") {
        if (folder) await this.selectFolder(folder);
        await this.setSearch(String(action.search || ""));
      }
      turn.actions[index].state = "Erledigt";
      this.view.setChat(this.turns, "", this.contextLabel());
      if (uids) await this.loadList(false);
    } catch (error) {
      turn.actions[index].state = explain(error);
      this.view.setChat(this.turns, "", this.contextLabel());
    }
  }
};

// src/main.ts
applyAppearance(readAppearance());
watchSystemTheme(() => applyAppearance(readAppearance()));
var root2 = document.getElementById("app");
if (root2) void boot(root2);
