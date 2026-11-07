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
    throw new ApiError(data.code || 999, data.message || "", data.messageAdditional || "");
  }
  return data.Result;
}
function call(action, params = {}) {
  return postJson(`${root()}?/Json/&q[]=/0/`, action, params);
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
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => {
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
function cleanHtml(source, options) {
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
  const depth = options.maxBlockquotes > 0 ? "," + new Array(options.maxBlockquotes + 1).fill("blockquote").join(" ") : "";
  root3.querySelectorAll(`:not(${ALLOWED_TAGS}),a:empty,span:empty${depth}`).forEach((node) => node.remove());
  [...root3.querySelectorAll("*")].forEach((node) => {
    if (!node.isConnected && !root3.contains(node)) return;
    const name = node.tagName;
    const style = node.style;
    if (name === "STYLE") {
      if (options.allowStyles) {
        let css = scopeCss(node.textContent || "");
        if (options.removeColors) css = css.replace(/(background-)?color:[^};]+;?/g, "");
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
    } else if (options.allowStyles && className) {
      node.setAttribute("class", className.replace(/(^|\s+)/g, "$1msg-"));
    }
    for (let i = node.attributes.length - 1; i >= 0; i--) {
      const attr = node.attributes[i].name.toLowerCase();
      const keepClass = attr === "class" && (className === "mail-body" || options.allowStyles);
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
        const local = cid ? options.inline(cid) : options.inline(src);
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
          const local = options.inline(url.slice(4));
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
      if (style.fontSize && px(style.fontSize) < options.minFontSize) style.fontSize = options.minFontSize + "px";
      if (options.removeColors) {
        style.removeProperty("background-color");
        style.removeProperty("background-image");
        style.removeProperty("color");
      }
      if (style.cssText) style.cssText = cleanCss(style.cssText);
    }
  });
  if (options.collapseBlockquotes) {
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
  const esc5 = (value) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  const linkify = (value) => esc5(value).replace(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g, (url) => {
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
    `body{margin:0;padding:16px;${paper};font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}`,
    kind === "plain" ? "body{white-space:pre-wrap}" : "",
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
    subject: params.get("subject") || "",
    body: params.get("body") || ""
  };
}

// src/icons.ts
var bodies = {
  "account-add": '<rect x="7.5" y="1.5" width="9" height="3"/><rect x="4.5" y="4.5" width="3" height="3"/><rect x="16.5" y="4.5" width="3" height="3"/><rect x="4.5" y="7.5" width="3" height="3"/><rect x="16.5" y="7.5" width="3" height="3"/><rect x="7.5" y="10.5" width="9" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="19.5" y="13.5" width="9" height="3"/><rect x="1.5" y="16.5" width="12" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="1.5" y="19.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="1.5" y="22.5" width="3" height="3"/><rect x="13.5" y="22.5" width="3" height="3"/>',
  "answered": '<rect x="10.5" y="4.5" width="3" height="3"/><rect x="7.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="18" height="3"/><rect x="7.5" y="13.5" width="3" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="10.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="22.5" y="22.5" width="3" height="3"/>',
  "archive": '<rect x="1.5" y="1.5" width="27" height="3"/><rect x="1.5" y="4.5" width="3" height="3"/><rect x="25.5" y="4.5" width="3" height="3"/><rect x="1.5" y="7.5" width="27" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="4.5" y="13.5" width="3" height="3"/><rect x="10.5" y="13.5" width="9" height="3"/><rect x="22.5" y="13.5" width="3" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="4.5" y="19.5" width="3" height="3"/><rect x="22.5" y="19.5" width="3" height="3"/><rect x="4.5" y="22.5" width="21" height="3"/>',
  "assist": '<rect x="13.5" y="1.5" width="3" height="3"/><rect x="10.5" y="4.5" width="9" height="3"/><rect x="13.5" y="7.5" width="3" height="3"/><rect x="4.5" y="10.5" width="3" height="3"/><rect x="22.5" y="10.5" width="3" height="3"/><rect x="1.5" y="13.5" width="9" height="3"/><rect x="19.5" y="13.5" width="9" height="3"/><rect x="4.5" y="16.5" width="3" height="3"/><rect x="22.5" y="16.5" width="3" height="3"/><rect x="13.5" y="19.5" width="3" height="3"/><rect x="10.5" y="22.5" width="9" height="3"/><rect x="13.5" y="25.5" width="3" height="3"/>',
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
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object" || !(part in cur)) return void 0;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : void 0;
}
function t(path, fallback) {
  const bag = window.rl?.I18N;
  return dig(bag, path) ?? fallback;
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
function propText(card, names) {
  if (!Array.isArray(card) || !Array.isArray(card[1])) return "";
  const wanted = new Set(names);
  for (const row2 of card[1]) {
    if (!Array.isArray(row2) || !wanted.has(String(row2[0]).toLowerCase())) continue;
    const value = row2[3];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map((part) => typeof part === "string" ? part : "").filter(Boolean).join(" ");
    }
  }
  return "";
}
function writeProp(card, name, value) {
  const rows = Array.isArray(card) && card[0] === "vcard" && Array.isArray(card[1]) ? card[1].map((row2) => Array.isArray(row2) ? row2.slice() : row2) : [["version", {}, "text", "4.0"]];
  const index = rows.findIndex((row2) => Array.isArray(row2) && String(row2[0]).toLowerCase() === name);
  const next = [name, {}, "text", value];
  if (index >= 0) rows[index] = next;
  else rows.push(next);
  const extra = Array.isArray(card) && Array.isArray(card[2]) ? [card[2]] : [];
  return ["vcard", rows, ...extra];
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
function keyRow(armored) {
  const head = armored.split("\n")[0] || "";
  const kind = /PRIVATE/i.test(head) ? t("SETTINGS_OPENPGP.TITLE_PRIVATE", "Privat") : /PUBLIC/i.test(head) ? t("SETTINGS_OPENPGP.TITLE_PUBLIC", "\xD6ffentlich") : t("SETTINGS_DESK.KEYS", "Schl\xFCssel");
  const body = armored.replace(/-----.*?-----/g, "").replace(/\s+/g, "");
  return { kind, preview: body.slice(0, 32) };
}
async function tryCall(action, params = {}) {
  try {
    return { value: await call(action, params), error: "" };
  } catch (error) {
    return { value: null, error: explain(error) };
  }
}
async function loadDesk(caps, currentEmail, mainEmail, contactSearch = "") {
  const main = mainEmail || currentEmail;
  const snap = {
    caps,
    mainEmail: main,
    currentEmail,
    accounts: [{ email: main, name: "", current: currentEmail === main, main: true }],
    identities: [],
    contacts: caps.contacts ? [] : null,
    contactCount: 0,
    contactSearch,
    scripts: caps.sieve ? [] : null,
    keys: [],
    certs: [],
    notes: { accounts: "", contacts: "", filters: "", keys: "", certs: "" }
  };
  const desk = await tryCall("AccountsAndIdentities");
  if (desk.error) snap.notes.accounts = desk.error;
  else if (desk.value) {
    const extra = values(desk.value.Accounts).map((item) => {
      const row2 = item;
      const email = text(row2.email);
      return { email, name: text(row2.name), current: email === currentEmail, main: false };
    }).filter((row2) => row2.email && row2.email !== main);
    snap.accounts = snap.accounts.concat(extra);
    snap.identities = values(desk.value.Identities).map((item) => identityOf(item));
    const named = snap.identities.find((item) => item.email === main && item.name);
    if (named) snap.accounts[0].name = named.name;
  }
  if (caps.contacts) {
    const book = await tryCall("Contacts", { Search: contactSearch, Offset: 0, Limit: 50 });
    if (book.error) snap.notes.contacts = book.error;
    else if (book.value) {
      snap.contactCount = Number(book.value.Count || 0);
      snap.contacts = values(book.value.List).map((item) => {
        const row2 = item;
        return {
          id: text(row2.id),
          name: propText(row2.jCard, ["fn", "n"]),
          email: propText(row2.jCard, ["email"]),
          readOnly: Boolean(row2.readOnly),
          jCard: row2.jCard
        };
      });
    }
  }
  if (caps.sieve) {
    const filters = await tryCall("Filters");
    if (filters.error) snap.notes.filters = filters.error;
    else if (filters.value) {
      snap.scripts = values(filters.value.Scripts).map((item) => {
        const row2 = item;
        return { name: text(row2.name), active: Boolean(row2.active), body: text(row2.body) };
      }).filter((row2) => row2.name);
    }
  }
  const keys = await tryCall("GetPGPKeys");
  if (keys.error) snap.notes.keys = keys.error;
  else snap.keys = values(keys.value).map((item) => text(item)).filter(Boolean).map((item) => keyRow(item));
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
  return snap;
}
async function applyDesk(name, data, snap) {
  if (name === "save-account") {
    if (!data.email?.trim() || !data.password) throw new ApiError(0, "Adresse und Passwort eintragen.");
    await call("AccountSetup", { email: data.email.trim(), password: data.password, name: data.name || "", new: 1 });
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
  if (name === "save-contact") {
    const nameText = (data.name || "").trim();
    const email = (data.email || "").trim();
    if (!nameText && !email) throw new ApiError(0, "Name oder E-Mail eintragen.");
    const existing = snap.contacts?.find((item) => item.id === data.id);
    let card = writeProp(existing?.jCard, "fn", nameText || email);
    card = writeProp(card, "email", email);
    await call("ContactSave", { uid: data.id || "", jCard: card });
    return "reload";
  }
  if (name === "delete-contact") {
    await call("ContactsDelete", { uids: data.id });
    return "reload";
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
  return "reload";
}
function esc2(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function field(label2, name, value, type = "text", extra = "") {
  const control = type === "area" ? `<textarea name="${name}" class="${extra}">${esc2(value)}</textarea>` : `<input name="${name}" type="${type}" value="${esc2(value)}" ${extra}>`;
  return `<label class="field"><span>${esc2(label2)}</span>${control}</label>`;
}
function check(name, label2, on2) {
  return `<label class="check"><input type="checkbox" name="${name}"${on2 ? " checked" : ""}> ${esc2(label2)}</label>`;
}
var BUTTON_ICON = {
  "settings-edit": "compose",
  "settings-delete": "delete",
  "settings-switch": "user",
  "settings-activate": "check"
};
function button(action, label2, attrs, danger = false) {
  const extra = Object.entries(attrs).map(([key, value]) => ` data-${key}="${esc2(value)}"`).join("");
  const name = attrs.fresh ? "plus" : BUTTON_ICON[action] || "chevron-right";
  return `<button type="button" class="${danger ? "danger" : "text-btn"}" data-action="${action}"${extra}>${icon(name)}<span class="btn-label">${esc2(label2)}</span></button>`;
}
function row(title, meta, actions) {
  return `<li class="set-row"><span class="grow"><strong title="${esc2(title)}">${esc2(title)}</strong>${meta ? `<span class="quiet">${esc2(meta)}</span>` : ""}</span>${actions}</li>`;
}
function form(kind, inner, submit, cancel) {
  const back = cancel ? `<button type="button" class="text-btn" data-action="settings-cancel">${esc2(t("GLOBAL.CANCEL", "Abbrechen"))}</button>` : "";
  return `<form class="fields" data-action="settings-form" data-kind="${kind}">${inner}<div class="dialog-actions">${back}<button type="submit" class="ink-btn">${icon(kind === "search-contacts" ? "search" : kind.startsWith("import") ? "upload" : kind === "save-account" ? "account-add" : "save")}<span class="btn-label">${esc2(submit)}</span></button></div></form>`;
}
function note(textValue, error = false) {
  if (!textValue) return "";
  return `<p class="${error ? "error" : "quiet"}">${esc2(textValue)}</p>`;
}
function loading() {
  return `<p class="quiet">${esc2(t("GLOBAL.LOADING", "Wird geladen"))} \u2026</p>`;
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
  const crypto = caps.openpgp || caps.gnupg ? `${check("pgpSign", t("CRYPTO.SIGN", "Unterschreiben"), item.pgpSign)}${check("pgpEncrypt", t("CRYPTO.ENCRYPT", "Verschl\xFCsseln"), item.pgpEncrypt)}` : "";
  const smimeOpen = item.smimeCertificate || item.smimeKey || item.smimeCertificateChain ? " open" : "";
  return form("save-identity", `
    <input type="hidden" name="id" value="${esc2(item.id)}">
    ${field(t("POPUPS_IDENTITY.LABEL", "Label"), "label", item.label)}
    ${field(t("GLOBAL.NAME", "Name"), "name", item.name)}
    ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", item.email, "email", 'autocomplete="email" required')}
    ${field(t("GLOBAL.REPLY_TO", "Antwort an"), "replyTo", item.replyTo, "email", 'autocomplete="email"')}
    ${field(t("GLOBAL.BCC", "BCC"), "bcc", item.bcc)}
    ${field(t("SETTINGS_DESK.SENT_FOLDER", "Ordner f\xFCr Gesendet"), "sentFolder", item.sentFolder)}
    ${field(t("POPUPS_IDENTITY.SIGNATURE", "Signatur"), "signature", item.signature, "area", "short")}
    ${check("signatureInsertBefore", t("POPUPS_IDENTITY.LABEL_SIGNATURE_INSERT_BEFORE", "Diese Signatur in Antworten vor dem zitierten Text einf\xFCgen"), item.signatureInsertBefore)}
    ${crypto}
    <details${smimeOpen}>
      <summary>${esc2(t("SMIME.CERTIFICATES", "S/MIME-Zertifikate"))}</summary>
      ${field(t("SMIME.CERTIFICATE", "Zertifikat"), "smimeCertificate", item.smimeCertificate, "area", "code")}
      ${field(t("CRYPTO.PRIVATE_KEY", "Privater Schl\xFCssel"), "smimeKey", item.smimeKey, "area", "code")}
      ${field(t("SMIME.CERTIFICATECHAIN", "Zwischenzertifikat(e)"), "smimeCertificateChain", item.smimeCertificateChain, "area", "code")}
    </details>
  `, t("GLOBAL.SAVE", "Speichern"), true);
}
function lookSection() {
  const current = readAppearance();
  const choice = (value, label2) => `<label class="check"><input type="radio" name="appearance" value="${value}"${current === value ? " checked" : ""}> ${label2}</label>`;
  return `
    <p class="mono">${esc2(t("SETTINGS_DESK.APPEARANCE", "Erscheinungsbild"))}</p>
    <fieldset class="choices">
      ${choice("system", t("SETTINGS_DESK.SYSTEM", "System"))}
      ${choice("light", t("SETTINGS_DESK.LIGHT", "Hell"))}
      ${choice("dark", t("SETTINGS_DESK.DARK", "Dunkel"))}
    </fieldset>`;
}
function renderDesk(section, snap, edit) {
  const error = `<p class="error" id="settings-error" hidden></p>`;
  if (section === "look") return error + lookSection();
  if (!snap) return error + loading();
  if (section === "accounts") {
    const rows = snap.accounts.map((item) => {
      const meta = [item.main ? t("SETTINGS_DESK.MAIN", "Hauptkonto") : item.name, item.current ? t("SETTINGS_DESK.ACTIVE", "Aktiv") : ""].filter(Boolean).join(" \xB7 ");
      const actions = [
        item.current ? "" : button("settings-switch", t("SETTINGS_DESK.SWITCH", "Wechseln"), { email: item.email }),
        item.main ? "" : button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "account", email: item.email }, true)
      ].join("");
      return row(item.email, meta, actions);
    }).join("");
    const add = snap.caps.accounts ? form("save-account", `
          ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", "", "email", 'autocomplete="email" required')}
          ${field(t("GLOBAL.PASSWORD", "Passwort"), "password", "", "password", 'autocomplete="current-password" required')}
          ${field(t("GLOBAL.NAME", "Name"), "name", "")}
        `, t("POPUPS_ADD_ACCOUNT.BUTTON_ADD_ACCOUNT", "Hinzuf\xFCgen"), false) : "";
    return `${error}<p class="mono">${esc2(t("SETTINGS_ACCOUNTS.LEGEND_ACCOUNTS", "Konten"))}</p>${note(snap.notes.accounts, true)}<ul class="set-list">${rows}</ul>${add}`;
  }
  if (section === "identities") {
    const rows = snap.identities.map((item) => row(
      item.name || item.email || item.label,
      [item.email, item.label].filter(Boolean).join(" \xB7 "),
      [
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "identity", id: item.id }),
        item.id && snap.caps.identities ? button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "identity", id: item.id }, true) : ""
      ].join("")
    )).join("");
    const adding = edit?.kind === "identity";
    const current = edit?.kind === "identity" ? edit.fresh ? blankIdentity() : snap.identities.find((item) => item.id === edit.id) || blankIdentity() : null;
    const editor = current ? identityForm(current, snap.caps) : "";
    const add = snap.caps.identities && !adding ? button("settings-edit", t("SETTINGS_ACCOUNTS.BUTTON_ADD_IDENTITY", "Identit\xE4t hinzuf\xFCgen"), { kind: "identity", fresh: "1" }) : "";
    return `${error}<p class="mono">${esc2(t("SETTINGS_ACCOUNTS.LEGEND_IDENTITIES", "Identit\xE4ten"))}</p>${note(snap.notes.accounts, true)}<ul class="set-list">${rows || ""}</ul>${rows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}${add}${editor}`;
  }
  if (section === "contacts") {
    if (!snap.contacts) return error + note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verf\xFCgbar."));
    const rows = snap.contacts.map((item) => row(
      item.name || item.email || item.id,
      item.name ? item.email : "",
      item.readOnly ? "" : [
        button("settings-edit", t("SETTINGS_DESK.EDIT", "Bearbeiten"), { kind: "contact", id: item.id }),
        button("settings-delete", t("GLOBAL.DELETE", "L\xF6schen"), { kind: "contact", id: item.id }, true)
      ].join("")
    )).join("");
    const search = form("search-contacts", field(t("GLOBAL.SEARCH", "Suchen"), "search", snap.contactSearch, "search"), t("GLOBAL.SEARCH", "Suchen"), false);
    const adding = edit?.kind === "contact";
    const current = edit?.kind === "contact" && !edit.fresh ? snap.contacts.find((item) => item.id === edit.id) : null;
    const editor = adding ? form("save-contact", `
      <input type="hidden" name="id" value="${esc2(current?.id || "")}">
      ${field(t("CONTACTS.DISPLAY_NAME", "Anzeigename"), "name", current?.name || "")}
      ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", current?.email || "", "email", 'autocomplete="email"')}
    `, t("GLOBAL.SAVE", "Speichern"), true) : "";
    const more = snap.contactCount > snap.contacts.length ? note(`${snap.contacts.length} / ${snap.contactCount}`) : "";
    const add = adding ? "" : button("settings-edit", t("CONTACTS.BUTTON_ADD_CONTACT", "Kontakt hinzuf\xFCgen"), { kind: "contact", fresh: "1" });
    return `${error}<p class="mono">${esc2(t("SETTINGS_LABELS.CONTACTS", "Kontakte"))}</p>${note(snap.notes.contacts, true)}${search}<ul class="set-list">${rows}</ul>${rows ? "" : note(snap.contactSearch ? t("CONTACTS.EMPTY_SEARCH", "Keine Kontakte gefunden") : t("CONTACTS.EMPTY_LIST", "Keine Kontakte"))}${more}${add}${editor}`;
  }
  if (section === "filters") {
    if (!snap.scripts) return error + note(t("SETTINGS_DESK.UNAVAILABLE", "Nicht verf\xFCgbar."));
    const rows = snap.scripts.map((item) => row(
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
    const editor = adding ? form("save-script", `
      ${field(t("GLOBAL.NAME", "Name"), "name", current?.name || "", "text", current ? "readonly" : "required")}
      ${field(t("SETTINGS_DESK.SCRIPT", "Skript"), "body", current?.body || "", "area", "code")}
    `, t("GLOBAL.SAVE", "Speichern"), true) : "";
    const add = adding ? "" : button("settings-edit", t("SETTINGS_FILTERS.BUTTON_ADD_SCRIPT", "Skript hinzuf\xFCgen"), { kind: "script", fresh: "1" });
    return `${error}<p class="mono">${esc2(t("SETTINGS_LABELS.FILTERS", "Filter"))}</p>${note(snap.notes.filters, true)}<ul class="set-list">${rows}</ul>${rows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}${add}${editor}`;
  }
  const keyRows = snap.keys.map((item) => row(item.kind, item.preview, "")).join("");
  const certRows = snap.certs.map((item) => row(
    item.name || item.email || item.id,
    [item.email, item.until ? `${t("CRYPTO.VALID_UNTIL", "G\xFCltig bis")} ${item.until}` : ""].filter(Boolean).join(" \xB7 "),
    ""
  )).join("");
  const keyImport = form("import-key", `
    ${field(t("SETTINGS_OPENPGP.BUTTON_IMPORT_KEY", "Schl\xFCssel importieren"), "key", "", "area", "code")}
    ${field(t("GLOBAL.EMAIL", "E-Mail"), "email", "", "email", 'autocomplete="email"')}
    ${check("backup", t("OPENPGP.BACKUP_ON_SERVER", "Auf dem Server verschl\xFCsselt speichern"), true)}
    ${snap.caps.gnupg ? check("gnupg", t("OPENPGP.STORE_IN_GNUPG", "Auf dem Server in GnuPG speichern"), false) : ""}
  `, t("OPENPGP.POPUP_IMPORT_BUTTON", "Importieren"), false);
  const certImport = form("import-cert", `
    ${field(t("SMIME.CERTIFICATE", "Zertifikat"), "pem", "", "area", "code")}
  `, t("OPENPGP.POPUP_IMPORT_BUTTON", "Importieren"), false);
  return `${error}
    <p class="mono">${esc2(t("SETTINGS_DESK.KEYS", "Schl\xFCssel"))}</p>
    <p class="quiet">${esc2(t("SETTINGS_DESK.KEY_HINT", "Signieren und Verschl\xFCsseln stehen an der Identit\xE4t."))}</p>
    ${note(snap.notes.keys, true)}
    <ul class="set-list">${keyRows}</ul>
    ${keyRows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}
    <details><summary>${esc2(t("SETTINGS_OPENPGP.BUTTON_IMPORT_KEY", "Schl\xFCssel importieren"))}</summary>${keyImport}</details>
    <p class="mono">${esc2(t("SMIME.CERTIFICATES", "S/MIME-Zertifikate"))}</p>
    ${note(snap.notes.certs, true)}
    <ul class="set-list">${certRows}</ul>
    ${certRows ? "" : note(t("SETTINGS_DESK.EMPTY", "Nichts vorhanden."))}
    <details><summary>${esc2(t("SMIME.POPUP_IMPORT_TITLE", "S/MIME-Zertifikat importieren"))}</summary>${certImport}</details>`;
}

// src/reader.ts
function esc3(value) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
function person(item) {
  const text2 = item.name ? `${item.name} <${item.email}>` : item.email;
  return `<button type="button" class="addr" data-action="m-address" data-email="${esc3(item.email)}" data-name="${esc3(item.name)}" title="${esc3(item.email)}">${esc3(item.name || item.email)}</button><span class="sr">${esc3(text2)}</span>`;
}
function people(list) {
  return list.map(person).join('<span class="sep">, </span>');
}
function line(label2, list) {
  if (!list.length) return "";
  return `<div class="head-line"><span class="head-key mono">${esc3(label2)}</span><span class="head-val">${people(list)}</span></div>`;
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
  return `<div class="note-bar" data-kind="${kind}" role="status">${icon(iconName)}<span class="grow">${esc3(text2)}</span>${actions}</div>`;
}
function textButton(action, label2, extra = "") {
  return `<button type="button" class="text-btn" data-action="${action}"${extra}>${esc3(label2)}</button>`;
}
function renderReader(body, data, expanded) {
  const tags = data.keywords.map(
    (tag) => `<span class="tag">${icon("tag")}<span>${esc3(tag)}</span><button type="button" class="tag-x" data-action="m-untag" data-tag="${esc3(tag)}" aria-label="Schlagwort ${esc3(tag)} entfernen">${icon("close")}</button></span>`
  ).join("");
  const from = data.from[0];
  const summary = `
    <div class="head-line head-main">
      <span class="head-val">${from ? person(from) : '<span class="quiet">(unbekannt)</span>'}</span>
      <span class="spacer"></span>
      <time class="quiet" title="${esc3(data.whenFull)}">${esc3(data.when)}</time>
      <button type="button" class="icon-btn" data-action="m-details" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "Details ausblenden" : "Details anzeigen"}" title="Details">${icon(expanded ? "chevron-up" : "chevron-down")}</button>
    </div>`;
  const details = expanded ? `
    <div class="head-details">
      ${line("Von", data.from)}
      ${line("An", data.to)}
      ${line("Cc", data.cc)}
      ${line("Bcc", data.bcc)}
      ${line("Antwort an", data.replyTo)}
      <div class="head-line"><span class="head-key mono">Datum</span><span class="head-val">${esc3(data.whenFull)}</span></div>
      ${data.size ? `<div class="head-line"><span class="head-key mono">Gr\xF6\xDFe</span><span class="head-val">${esc3(data.size)}</span></div>` : ""}
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
  const cal = data.calendar ? `
    <section class="cal-card" aria-label="Termin">
      ${icon("calendar", "Termin")}
      <div class="grow">
        <p class="cal-title">${esc3(data.calendar.summary || "Termin")}</p>
        <p class="quiet">${esc3([data.calendar.start, data.calendar.end].filter(Boolean).join(" \u2013 "))}</p>
        ${data.calendar.location ? `<p class="quiet">${esc3(data.calendar.location)}</p>` : ""}
        ${data.calendar.organizer ? `<p class="quiet">Organisiert von ${esc3(data.calendar.organizer)}</p>` : ""}
      </div>
    </section>` : "";
  const files = data.files.length ? `
    <section class="files" aria-label="Anh\xE4nge">
      <div class="files-head"><span class="mono">${data.files.length === 1 ? "1 Anhang" : `${data.files.length} Anh\xE4nge`}</span><span class="spacer"></span>
        ${data.zip && data.files.length > 1 ? `<button type="button" class="text-btn" data-action="m-zip">${icon("download-zip")}<span class="btn-label">Alle als ZIP</span></button>` : ""}
      </div>
      <ul class="file-list">
        ${data.files.map((file) => `
          <li class="file">
            ${file.thumb ? `<button type="button" class="file-thumb" data-action="m-preview" data-index="${file.index}" aria-label="${esc3(file.name)} ansehen"><img src="${esc3(file.thumb)}" alt="" loading="lazy"></button>` : `<span class="file-icon">${icon(FILE_ICON[file.kind])}</span>`}
            <span class="file-meta">
              ${file.kind === "image" || file.kind === "pdf" || file.kind === "text" ? `<button type="button" class="file-name" data-action="m-preview" data-index="${file.index}" title="${esc3(file.name)}">${esc3(file.name)}</button>` : `<span class="file-name" title="${esc3(file.name)}">${esc3(file.name)}</span>`}
              <span class="quiet">${esc3(file.size)}</span>
            </span>
            <a class="icon-btn" href="${esc3(file.href)}" download="${esc3(file.name)}" aria-label="${esc3(file.name)} laden" title="Laden">${icon("download")}</a>
          </li>`).join("")}
      </ul>
    </section>` : "";
  body.innerHTML = `
    <header class="letter-head">
      <h2 class="title title-md">${data.flagged ? `<span class="flag-mark">${icon("flag-filled", "Markiert")}</span>` : ""}${esc3(data.subject || "(ohne Betreff)")}</h2>
      ${summary}
      ${details}
      <div class="tags">${tags}<button type="button" class="text-btn tag-add" data-action="m-tag">${icon("plus")}<span class="btn-label">Schlagwort</span></button></div>
    </header>
    ${bars.join("")}
    ${cal}
    ${files}`;
  const frame = document.createElement("iframe");
  frame.className = "letter";
  frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy = "no-referrer";
  frame.title = "Brief";
  frame.srcdoc = data.srcdoc;
  body.append(frame);
}
function renderBulk(body, data) {
  const b = (action, name, label2, danger = false) => `<button type="button" class="${danger ? "danger" : "text-btn"} bulk-btn" data-action="${action}">${icon(name)}<span class="btn-label">${esc3(label2)}</span></button>`;
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

// src/view.ts
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
  return `<span class="cat">${mark}${esc4(t("AI_COPILOT.CAT_" + category.toUpperCase(), CATEGORY[category]))}</span>`;
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
function esc4(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}
function withIcon(name, label2) {
  return `${icon(name)}<span class="btn-label">${esc4(label2)}</span>`;
}
var ROLE_ICON = {
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
  const wide = () => matchMedia("(min-width: 800px)").matches;
  const docked = () => matchMedia("(min-width: 1280px)").matches;
  const showLogin = (title) => {
    document.title = title;
    root3.innerHTML = `
      <main class="login">
        <form class="login-card" novalidate>
          <h1 class="title">${esc4(title)}</h1>
          <label class="field"><span>${esc4(t("GLOBAL.EMAIL", "E-Mail"))}</span>
            <input name="email" type="email" autocomplete="email" inputmode="email" required>
          </label>
          <p class="error" data-for="email" hidden></p>
          <label class="field"><span>${esc4(t("GLOBAL.PASSWORD", "Passwort"))}</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <p class="error" data-for="password" hidden></p>
          <label class="stay"><input name="stay" type="checkbox"> ${esc4(t("LOGIN.LABEL_SIGN_ME", "Anmeldung merken"))}</label>
          <p class="error" data-for="form" hidden></p>
          <button type="submit" class="ink-btn">${esc4(t("LOGIN.BUTTON_SIGN_IN", "Anmelden"))}</button>
        </form>
      </main>`;
    const form2 = root3.querySelector("form");
    form2.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form2);
      actions.login(String(data.get("email") || ""), String(data.get("password") || ""), data.get("stay") === "on");
    });
  };
  const setLoginBusy = (busy) => {
    const button2 = root3.querySelector(".login-card button");
    if (button2) button2.disabled = busy;
  };
  const setLoginError = (text2) => {
    const slot = root3.querySelector("[data-for='form']");
    if (!slot) return;
    slot.hidden = !text2;
    slot.textContent = text2;
  };
  const showMail = (email, folderName, assist) => {
    root3.innerHTML = `
      <div class="shell" data-pane="list" data-sidebar="${docked() ? "open" : "closed"}">
        <button type="button" class="scrim" data-action="close-sidebar" aria-label="Ordner schlie\xDFen"></button>
        <aside class="sidebar" aria-label="Ordner">
          <div class="account">
            <button type="button" class="account-btn" data-action="account" aria-expanded="false" aria-controls="account-menu" aria-haspopup="menu"></button>
            <div class="menu" id="account-menu" role="menu" hidden>
              <div id="account-list"></div>
              <button type="button" class="menu-item" role="menuitem" data-action="settings">${icon("settings")}<span>${esc4(t("GLOBAL.SETTINGS", "Einstellungen"))}</span></button>
              <button type="button" class="menu-item" role="menuitem" data-action="logout">${icon("logout")}<span>${esc4(t("GLOBAL.LOGOUT", "Abmelden"))}</span></button>
            </div>
          </div>
          <p class="group-label mono">${esc4(t("FOLDER_LIST.INBOX_NAME", "Posteingang"))}</p>
          <div id="folder-inbox"></div>
          <p class="group-label mono">Ordner</p>
          <div id="folder-rest"></div>
        </aside>
        <section class="list-pane" aria-label="Mails">
          <div class="pane-head">
            <button type="button" class="icon-btn" data-action="toggle-sidebar" aria-label="Ordner ein- oder ausblenden">${icon("menu")}</button>
            <h1 class="title title-md" id="folder-title"></h1>
            <span class="spacer"></span>
            <button type="button" class="icon-btn" data-action="m-select-all" aria-label="Alle ausw\xE4hlen" title="Alle ausw\xE4hlen (Strg+A)">${icon("select-all")}</button>
            <button type="button" class="icon-btn" data-action="m-refresh" aria-label="Aktualisieren" title="Aktualisieren">${icon("refresh")}</button>
          </div>
          <form class="search-wrap" data-action="search">
            <label class="sr" for="search">Suche</label>
            <input class="search" id="search" type="search" placeholder="" autocomplete="off">
          </form>
          <div class="pane-body" id="list-body">
            <div id="rows"></div>
            <p class="empty" id="list-empty" hidden></p>
            <button type="button" class="text-btn" data-action="clear-search" hidden>Suche aufheben</button>
            <button type="button" class="text-btn" data-action="more" hidden>Weitere</button>
            <p class="error" id="list-error" hidden></p>
          </div>
        </section>
        <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Breite der Liste" tabindex="0" aria-valuemin="288" aria-valuemax="640" aria-valuenow="384"></div>
        <section class="reader" aria-label="Brief">
          <div class="reader-bar">
            <button type="button" class="text-btn bar-btn" data-action="back" title="${esc4(t("GLOBAL.BACK", "Zur\xFCck"))}" hidden>${withIcon("back", t("GLOBAL.BACK", "Zur\xFCck"))}</button>
            <span class="quiet" id="reader-place"></span>
            <span class="spacer"></span>
            <button type="button" class="text-btn bar-btn primary" data-action="reply" title="${esc4(t("MESSAGE.BUTTON_REPLY", "Antworten"))}" hidden>${withIcon("reply", t("MESSAGE.BUTTON_REPLY", "Antworten"))}</button>
            <button type="button" class="text-btn bar-btn primary wide-only" data-action="reply-all" title="${esc4(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}" hidden>${withIcon("reply-all", t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</button>
            <button type="button" class="text-btn bar-btn primary" data-action="forward" title="${esc4(t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}" hidden>${withIcon("forward", t("MESSAGE.BUTTON_FORWARD", "Weiterleiten"))}</button>
            <button type="button" class="text-btn bar-btn primary" data-action="archive" title="${esc4(t("GLOBAL.TO_ARCHIVE", "Archivieren"))}" hidden>${withIcon("archive", t("GLOBAL.TO_ARCHIVE", "Archivieren"))}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="unread" title="Ungelesen" hidden>${withIcon("mark-unread", "Ungelesen")}</button>
            <button type="button" class="text-btn bar-btn primary" data-action="delete" title="${esc4(t("GLOBAL.DELETE", "L\xF6schen"))}" hidden>${withIcon("delete", t("GLOBAL.DELETE", "L\xF6schen"))}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-flag" data-one="1" title="Markieren (I)" aria-pressed="false" hidden>${withIcon("flag", "Markieren")}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-move" data-one="1" title="Verschieben (M)" hidden>${withIcon("move", "Verschieben")}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-spam" data-one="1" title="Spam" hidden>${withIcon("spam", "Spam")}</button>
            <button type="button" class="text-btn bar-btn wide-only" data-action="m-notspam" data-one="1" title="Kein Spam" hidden>${withIcon("not-spam", "Kein Spam")}</button>
            <div class="bar-more">
              <button type="button" class="icon-btn" data-action="m-more" data-one="1" aria-label="Weitere Aktionen" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu" title="Weitere Aktionen" hidden>${icon("more")}</button>
              <div class="menu menu-right" id="more-menu" role="menu" hidden>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="reply-all">${icon("reply-all")}<span>${esc4(t("MESSAGE.BUTTON_REPLY_ALL", "Allen antworten"))}</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="unread" data-narrow="unread">${icon("mark-unread")}<span>Gelesen / ungelesen</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-flag">${icon("flag")}<span>Markieren</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-move">${icon("move")}<span>Verschieben \u2026</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-spam" data-narrow="spam">${icon("spam")}<span>Spam</span></button>
                <button type="button" class="menu-item narrow" role="menuitem" data-action="m-notspam" data-narrow="notspam">${icon("not-spam")}<span>Kein Spam</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-edit-draft" hidden>${icon("compose")}<span>Entwurf bearbeiten</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-edit-new">${icon("edit-as-new")}<span>Als neu bearbeiten</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-forward-att">${icon("forward-attachment")}<span>Als Anhang weiterleiten</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-copy">${icon("copy")}<span>Kopieren nach \u2026</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-tag">${icon("tag")}<span>Schlagwort hinzuf\xFCgen</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-mode" data-mode-item="1">${icon("source")}<span>Nur Text anzeigen</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-swap">${icon("eye")}<span>Farben umkehren</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-unsubscribe" hidden>${icon("unsubscribe")}<span>Vom Verteiler abmelden</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-print">${icon("print")}<span>Drucken</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-window">${icon("external")}<span>In neuem Fenster</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-fullscreen">${icon("fullscreen")}<span>Vollbild</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-source">${icon("code")}<span>Quelltext anzeigen</span></button>
                <button type="button" class="menu-item" role="menuitem" data-action="m-eml">${icon("download")}<span>Als .eml laden</span></button>
                <button type="button" class="menu-item danger-item" role="menuitem" data-action="m-delete-forever">${icon("delete-forever")}<span>Endg\xFCltig l\xF6schen</span></button>
              </div>
            </div>
            <button type="button" class="icon-btn wide-only" data-action="m-prev" data-one="1" aria-label="Vorige Mail (K)" title="Vorige Mail (K)" hidden>${icon("chevron-up")}</button>
            <button type="button" class="icon-btn wide-only" data-action="m-next" data-one="1" aria-label="N\xE4chste Mail (J)" title="N\xE4chste Mail (J)" hidden>${icon("chevron-down")}</button>
          </div>
          <p class="quiet live" id="notice"></p>
          <div class="pane-body" id="reader-body">
            <p class="empty" id="reader-empty">W\xE4hlen Sie eine Mail.</p>
          </div>
        </section>
        <section class="composer" hidden aria-label="Neue Mail">
          <form class="composer-form">
            <div class="composer-bar">
              <button type="button" class="icon-btn" data-action="close-compose" aria-label="${esc4(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
              <span class="title title-md" id="compose-title">Neue Mail</span>
              <span class="spacer"></span>
              <button type="submit" class="ink-btn">${withIcon("send", t("COMPOSE.BUTTON_SEND", "Senden"))}</button>
            </div>
            <div class="fields">
              <p class="quiet" id="compose-from"></p>
              <label class="field"><span>${esc4(t("GLOBAL.TO", "An"))}</span><input name="to" type="text" autocomplete="email"></label>
              <label class="field"><span>${esc4(t("GLOBAL.CC", "Cc"))}</span><input name="cc" type="text" autocomplete="email"></label>
              <label class="field"><span>${esc4(t("GLOBAL.SUBJECT", "Betreff"))}</span><input name="subject" type="text"></label>
              <ul class="compose-files" id="compose-files" aria-label="Anh\xE4nge" hidden></ul>
              <label class="field"><span>Text</span><textarea name="body"></textarea></label>
              <p class="error" id="send-error" hidden></p>
            </div>
          </form>
        </section>
        <nav class="tabbar" aria-label="Navigation">
          <button type="button" class="text-btn" data-action="pane-folders">${withIcon("folder", "Ordner")}</button>
          <button type="button" class="text-btn" data-action="pane-search">${withIcon("search", "Suche")}</button>
          <button type="button" class="ink-btn" data-action="compose">${withIcon("compose", t("FOLDER_LIST.BUTTON_NEW_MESSAGE", "Neue Nachricht"))}</button>
        </nav>
        <dialog id="settings" class="dialog-wide" aria-labelledby="settings-title">
          <div class="dialog-body">
            <div class="settings-sticky">
              <div class="sheet-head" style="padding:0;border:0;min-height:0">
                <h2 id="settings-title" class="title title-md">${esc4(t("GLOBAL.SETTINGS", "Einstellungen"))}</h2>
                <span class="spacer"></span>
                <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc4(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
              </div>
              <nav class="settings-nav" aria-label="${esc4(t("GLOBAL.SETTINGS", "Einstellungen"))}">
                <button type="button" class="text-btn" data-action="settings-section" data-section="look" aria-pressed="true">${withIcon("eye", t("SETTINGS_DESK.APPEARANCE", "Erscheinungsbild"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="accounts">${withIcon("users", t("SETTINGS_LABELS.ACCOUNTS", "Konten"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="identities">${withIcon("identity", t("SETTINGS_ACCOUNTS.LEGEND_IDENTITIES", "Identit\xE4ten"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="contacts" hidden>${withIcon("contacts", t("SETTINGS_LABELS.CONTACTS", "Kontakte"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="filters" hidden>${withIcon("filter", t("SETTINGS_LABELS.FILTERS", "Filter"))}</button>
                <button type="button" class="text-btn" data-action="settings-section" data-section="keys">${withIcon("key", t("SETTINGS_DESK.KEYS", "Schl\xFCssel"))}</button>
              </nav>
            </div>
            <div id="settings-panel"></div>
          </div>
        </dialog>
        <dialog id="keys" aria-labelledby="keys-title">
          <div class="dialog-body">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="keys-title" class="title title-md">Tasten</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc4(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
            </div>
            <ul class="keys">
              <li><span>N\xE4chste, vorige Mail</span><kbd>J</kbd> <kbd>K</kbd></li>
              <li><span>\xD6ffnen</span><kbd>Enter</kbd></li>
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
              <button type="button" class="text-btn" value="cancel">${esc4(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
              <button type="button" class="danger" value="ok" id="confirm-ok">${withIcon("delete", t("GLOBAL.DELETE", "L\xF6schen"))}</button>
            </div>
          </div>
        </dialog>
        <dialog id="picker" aria-labelledby="picker-title">
          <form class="dialog-body" method="dialog" data-action="picker">
            <div class="sheet-head" style="padding:0;border:0;min-height:0">
              <h2 id="picker-title" class="title title-md">Verschieben nach</h2>
              <span class="spacer"></span>
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc4(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
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
            <div class="dialog-actions">
              <button type="button" class="text-btn" data-action="close-dialog">${esc4(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
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
              <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${esc4(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
            </div>
            <div class="lightbox-body" id="lightbox-body"></div>
          </div>
        </dialog>
        <ul class="menu addr-menu" id="addr-menu" role="menu" hidden>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-write">${icon("compose")}<span>Mail schreiben</span></button></li>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-copy">${icon("copy")}<span>Adresse kopieren</span></button></li>
          <li><button type="button" class="menu-item" role="menuitem" data-action="m-addr-search">${icon("search")}<span>Mails von dieser Adresse</span></button></li>
        </ul>
      </div>`;
    const next = root3.querySelector(".shell");
    if (!next) return;
    shell = next;
    const account = next.querySelector(".account-btn");
    account.textContent = email;
    next.querySelector("#compose-from").textContent = `${t("GLOBAL.FROM", "Von")} ${email}`;
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
      shell?.querySelectorAll(`.reader-bar > [data-action='${name}'], .reader-bar > .bar-more > [data-action='${name}']`).forEach((button2) => {
        button2.hidden = !on2;
      });
    };
    const one = Boolean(data);
    ["reply", "reply-all", "forward", "delete", "m-flag", "m-move", "m-more", "m-prev", "m-next", "unread"].forEach((name) => show(name, one));
    show("archive", one && Boolean(data?.place.archive));
    show("m-spam", one && Boolean(data?.place.spam) && !data?.place.inSpam);
    show("m-notspam", one && Boolean(data?.place.inSpam));
    if (!data) return;
    const flag = shell.querySelector(".reader-bar > [data-action='m-flag']");
    if (flag) {
      flag.setAttribute("aria-pressed", data.flagged ? "true" : "false");
      flag.innerHTML = withIcon(data.flagged ? "flag-filled" : "flag", data.flagged ? "Markiert" : "Markieren");
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
    shell?.querySelectorAll("#account-menu, #more-menu, #addr-menu").forEach((menu) => {
      menu.hidden = true;
    });
    shell?.querySelectorAll("[data-action='account'], [data-action='m-more']").forEach((button2) => {
      button2.setAttribute("aria-expanded", "false");
    });
  }
  function anyMenuOpen() {
    return Boolean(shell?.querySelector("#account-menu:not([hidden]), #more-menu:not([hidden]), #addr-menu:not([hidden])"));
  }
  let addrTarget = { email: "", name: "" };
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
    layer.dataset.open = "false";
    requestAnimationFrame(() => {
      layer.dataset.open = "true";
    });
  }
  function closeLayer(layer) {
    layer.dataset.open = "false";
    const finish = () => {
      layer.hidden = true;
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else layer.addEventListener("transitionend", finish, { once: true });
    opener?.focus();
    opener = null;
  }
  function toggleFullscreen(force) {
    if (!shell) return;
    const on2 = force ?? shell.dataset.full !== "true";
    shell.dataset.full = on2 ? "true" : "false";
    const button2 = shell.querySelector("[data-action='m-fullscreen']");
    if (button2) button2.innerHTML = `${icon(on2 ? "fullscreen-exit" : "fullscreen")}<span>${on2 ? "Vollbild beenden" : "Vollbild"}</span>`;
    if (on2 && !wide()) pane("reader");
  }
  function wireShell() {
    if (!shell) return;
    const menu = shell.querySelector("#account-menu");
    const accountBtn = shell.querySelector("[data-action='account']");
    const list = shell.querySelector(".list-pane");
    const separator = shell.querySelector(".splitter");
    const composer = shell.querySelector(".composer");
    const setListWidth = (px2) => {
      const next = Math.min(640, Math.max(288, Math.round(px2)));
      shell?.style.setProperty("--list-w", `${next}px`);
      separator.setAttribute("aria-valuenow", String(next));
    };
    shell.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action], [data-folder], [data-uid]");
      if (anyMenuOpen() && !target?.closest(".account, .bar-more, #addr-menu")) closeMenu();
      if (!target) return;
      const action = target.dataset.action;
      if (target.classList.contains("menu-item") && target.closest("#more-menu")) closeMenu();
      if (target.dataset.folder) {
        actions.selectFolder(target.dataset.folder);
        if (!wide()) pane("list");
        if (!docked()) setSidebar(false);
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
      } else if (action === "m-address") {
        openAddrMenu(target);
      } else if (action === "m-addr-write" || action === "m-addr-copy" || action === "m-addr-search") {
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
      } else if (action === "settings-section") {
        section = target.dataset.section || "look";
        edit = null;
        paintSettings();
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
          name: target.dataset.name || ""
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
      } else if (action === "clear-search") actions.clearSearch();
      else if (action === "more") actions.more();
      else if (action === "back") pane("list");
      else if (action === "pane-folders") pane("folders");
      else if (action === "pane-search") {
        pane("list");
        (shell?.querySelector("#search")).focus();
      } else if (action === "compose") actions.compose();
      else if (action === "reply") actions.reply(false);
      else if (action === "reply-all") actions.reply(true);
      else if (action === "forward") actions.forward();
      else if (action === "archive") actions.archive();
      else if (action === "unread") actions.unread();
      else if (action === "delete") actions.askDelete();
      else if (action === "close-compose") {
        closeLayer(composer);
        if (!wide()) pane("list");
        actions.closeCompose();
      } else if (action === "close-sheet") {
        const sheet = shell?.querySelector(".sheet");
        if (sheet) closeLayer(sheet);
      } else if (action === "open-sheet") {
        if (!wide()) pane("reader");
        const sheet = shell?.querySelector(".sheet");
        if (sheet) openLayer(sheet, target);
      } else if (action === "cat") {
        shell?.querySelectorAll(".filter").forEach((button2) => {
          button2.setAttribute("aria-pressed", button2.dataset.cat === target.dataset.cat ? "true" : "false");
        });
        actions.assist?.("cat", target.dataset);
      } else if (action === "mode" || action === "tone") {
        target.parentElement?.querySelectorAll("button").forEach((button2) => {
          button2.setAttribute("aria-pressed", button2 === target ? "true" : "false");
        });
      } else if (action === "prompt") {
        const area = shell?.querySelector("#ask");
        if (area) area.value = target.textContent || "";
        actions.assist?.("ask", { text: target.textContent || "" });
      } else if (action) actions.assist?.(action, target.dataset);
    });
    shell.addEventListener("submit", (event) => {
      const form2 = event.target;
      if (form2.classList.contains("composer-form")) {
        event.preventDefault();
        const data = new FormData(form2);
        actions.send({
          title: "",
          to: String(data.get("to") || ""),
          cc: String(data.get("cc") || ""),
          subject: String(data.get("subject") || ""),
          body: String(data.get("body") || "")
        });
      } else if (form2.dataset.action === "search") {
        event.preventDefault();
        actions.search(form2.querySelector("#search").value.trim());
      } else if (form2.dataset.action === "ask") {
        event.preventDefault();
        const area = form2.querySelector("textarea");
        actions.assist?.("ask", { text: area.value });
        area.value = "";
      } else if (form2.dataset.action === "settings-form") {
        event.preventDefault();
        const data = {};
        new FormData(form2).forEach((value, key) => {
          data[key] = String(value);
        });
        form2.querySelectorAll("input[type='checkbox']").forEach((box) => {
          data[box.name] = box.checked ? "1" : "";
        });
        void actions.settings?.(form2.dataset.kind || "", data);
      }
    });
    shell.addEventListener("change", (event) => {
      const input = event.target;
      if (input.name === "appearance") applyAppearance(input.value);
    });
    if (keyHandler) document.removeEventListener("keydown", keyHandler);
    keyHandler = (event) => {
      if (!shell?.isConnected) return;
      const typing = event.target instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(event.target.type) || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLElement && event.target.isContentEditable;
      if (event.key === "Escape") {
        if (shell?.querySelector("dialog[open]")) return;
        if (anyMenuOpen()) {
          closeMenu();
          return;
        }
        if (shell?.dataset.full === "true") {
          toggleFullscreen(false);
          return;
        }
        if (!composer.hidden) {
          closeLayer(composer);
          if (!wide()) pane("list");
          actions.closeCompose();
          return;
        }
        if (!docked() && shell?.dataset.sidebar === "open") setSidebar(false);
        return;
      }
      if (typing || shell.querySelector("dialog[open]")) return;
      const focusedControl = event.target instanceof HTMLButtonElement && !event.target.dataset.uid && !event.target.dataset.folder;
      if (focusedControl && (event.key === "Enter" || event.key === " ")) return;
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
        actions.compose();
      } else if (key === "r") {
        event.preventDefault();
        actions.reply(false);
      } else if (key === "a") {
        event.preventDefault();
        actions.reply(true);
      } else if (key === "f") {
        event.preventDefault();
        actions.forward();
      } else if (key === "e") actions.archive();
      else if (key === "i") actions.act("flag", {});
      else if (key === "u") actions.unread();
      else if (key === "m") {
        event.preventDefault();
        actions.act("move", {});
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
      const button2 = event.target.closest("button");
      if (button2) confirm.close(button2.value);
    });
  }
  function moveSelection(delta) {
    const rows = [...shell?.querySelectorAll("[data-uid]") ?? []];
    if (!rows.length) return;
    const index = rows.findIndex((row3) => row3.getAttribute("aria-current") === "true");
    const next = delta === 0 ? Math.max(index, 0) : Math.min(rows.length - 1, Math.max(0, index + delta));
    const row2 = rows[next];
    if (!row2) return;
    actions.selectMessage(Number(row2.dataset.uid));
    row2.scrollIntoView({ block: "nearest" });
    if (!wide()) pane("reader");
  }
  function installAssist(flags) {
    if (!shell) return;
    if (flags.alerts) {
      const block = document.createElement("div");
      block.innerHTML = `
        <p class="group-label mono">Heute</p>
        <button type="button" class="count-row" data-action="alert" data-kind="reply"><span>Offene Antworten</span><span class="count" data-count="reply">0</span></button>
        <button type="button" class="count-row" data-action="alert" data-kind="follow"><span>Ohne Antwort</span><span class="count" data-count="follow">0</span></button>
        <button type="button" class="count-row" data-action="alert" data-kind="invoice"><span>Rechnungen</span><span class="count" data-count="invoice">0</span></button>
        <p class="quiet" id="dues"></p>
        <button type="button" class="text-btn" data-action="deadlines">Fristen lesen</button>`;
      shell.querySelector(".account")?.after(block);
    }
    const searchForm = shell.querySelector(".search-wrap");
    if (flags.triage && searchForm) {
      const filters = document.createElement("div");
      filters.className = "filters";
      filters.setAttribute("role", "toolbar");
      filters.setAttribute("aria-label", "Filter");
      const cats = [["all", "Alle"], ...Object.entries(CATEGORY)];
      filters.innerHTML = cats.map(
        ([id, label2], index) => `<button type="button" class="filter" data-action="cat" data-cat="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc4(id === "all" ? t("AI_COPILOT.TAB_ALL", label2) : t("AI_COPILOT.CAT_" + id.toUpperCase(), label2))}</button>`
      ).join("") + (flags.triageLlm ? `<button type="button" class="text-btn" data-action="triage">${esc4(t("AI_COPILOT.TRIAGE_LLM", "Mit KI einordnen"))}</button>` : "");
      searchForm.after(filters);
    }
    if (flags.search && searchForm) {
      const button2 = document.createElement("button");
      button2.type = "button";
      button2.className = "text-btn";
      button2.dataset.action = "lang-search";
      button2.hidden = true;
      button2.textContent = "Als Sprache verstehen";
      searchForm.append(button2);
      const hint = document.createElement("div");
      hint.id = "translated";
      hint.hidden = true;
      hint.className = "translate";
      hint.innerHTML = `<p class="quiet" id="translate-why"></p><input class="search" id="translate-q" aria-label="\xDCbersetzte Suche"><button type="button" class="text-btn" data-action="run-search">Suchen</button>`;
      searchForm.after(hint);
      const input = shell.querySelector("#search");
      input.addEventListener("input", () => {
        button2.hidden = !input.value.trim();
      });
    }
    if (flags.summarize || flags.replies) {
      const strip = document.createElement("div");
      strip.id = "strip";
      shell.querySelector("#reader-body")?.before(strip);
    }
    if (flags.chat) {
      const ask = document.createElement("button");
      ask.type = "button";
      ask.className = "text-btn";
      ask.dataset.action = "open-sheet";
      ask.innerHTML = withIcon("assist", t("AI_COPILOT.ASK_COPILOT", "Copilot fragen"));
      ask.classList.add("bar-btn", "primary");
      ask.title = t("AI_COPILOT.ASK_COPILOT", "Copilot fragen");
      shell.querySelector(".reader-bar")?.append(ask);
      const sheet = document.createElement("aside");
      sheet.className = "sheet";
      sheet.hidden = true;
      sheet.innerHTML = `
        <div class="sheet-head">
          <span class="title title-md">${esc4(t("AI_COPILOT.ASK_COPILOT", "Copilot fragen"))}</span>
          <span class="mono quiet">${esc4(flags.provider)}</span>
          <span class="spacer"></span>
          <button type="button" class="icon-btn" data-action="close-sheet" aria-label="${esc4(t("GLOBAL.CLOSE", "Schlie\xDFen"))}">${icon("close")}</button>
        </div>
        <div class="sheet-log" id="chat-log">
          <p class="quiet">${esc4(t("AI_COPILOT.CHAT_EMPTY", "Fragen Sie zum Beispiel, welche Mails auf eine Antwort warten."))}</p>
          <div class="prompts">
            <button type="button" class="prompt" data-action="prompt">Welche Mails warten auf meine Antwort?</button>
            <button type="button" class="prompt" data-action="prompt">Zeig mir Rechnungen vom letzten Monat</button>
            <button type="button" class="prompt" data-action="prompt">Fasse die ge\xF6ffnete Mail zusammen</button>
          </div>
        </div>
        <button type="button" class="text-btn" data-action="drop-context" id="context-chip" hidden></button>
        <form class="sheet-form" data-action="ask">
          <textarea id="ask" rows="2" placeholder="${esc4(t("AI_COPILOT.CHAT_PLACEHOLDER", "Nachricht an Copilot \u2026"))}"></textarea>
          <button type="submit" class="ink-btn">${esc4(t("AI_COPILOT.SEND", "Senden"))}</button>
        </form>
        <p class="error" id="chat-error" hidden></p>`;
      shell.querySelector(".reader")?.append(sheet);
    }
    if (flags.draft) {
      const tools = document.createElement("div");
      tools.className = "draft-tools";
      const tones = [["professional", "Professionell"], ["friendly", "Freundlich"], ["casual", "Locker"], ["concise", "Knapp"], ["formal", "F\xF6rmlich"]];
      tools.innerHTML = `
        <div class="modes" role="toolbar" aria-label="Art">
          <button type="button" class="seg" data-action="mode" data-mode="new" aria-pressed="true">Neue Mail</button>
          <button type="button" class="seg" data-action="mode" data-mode="reply" aria-pressed="false">Antwort</button>
          <button type="button" class="seg" data-action="mode" data-mode="rewrite" aria-pressed="false">Umschreiben</button>
          <button type="button" class="seg" data-action="mode" data-mode="proofread" aria-pressed="false">Korrektur</button>
        </div>
        <label class="field"><span>Anweisung</span><input id="instruction" type="text" placeholder="${esc4(t("AI_COPILOT.INSTRUCTION_PLACEHOLDER", "Was soll die Mail sagen?"))}"></label>
        <div class="tones" role="toolbar" aria-label="Ton">
          ${tones.map(([id, label2], index) => `<button type="button" class="seg" data-action="tone" data-tone="${id}" aria-pressed="${index === 0 ? "true" : "false"}">${esc4(t("AI_COPILOT.TONE_" + id.toUpperCase(), label2))}</button>`).join("")}
        </div>
        <div class="draft-actions">
          <button type="button" class="text-btn" data-action="generate">${withIcon("assist", t("AI_COPILOT.GENERATE", "Erzeugen"))}</button>
          <button type="button" class="text-btn" data-action="stop-generate" hidden>${withIcon("stop", t("AI_COPILOT.STOP", "Stopp"))}</button>
          <button type="button" class="text-btn" data-action="revert-draft" hidden>Zur\xFCck</button>
        </div>
        <p class="subject-hint" id="subject-hint" hidden><span></span><button type="button" class="text-btn" data-action="apply-subject">${esc4(t("AI_COPILOT.APPLY_SUBJECT", "\xDCbernehmen"))}</button></p>
        <p class="quiet" id="draft-status"></p>`;
      shell.querySelector(".fields")?.prepend(tools);
    }
    const consent = document.createElement("dialog");
    consent.id = "consent";
    consent.innerHTML = `
      <div class="dialog-body">
        <h2 class="title title-md">Assistent</h2>
        <p id="consent-text"></p>
        <div class="dialog-actions">
          <button type="button" class="text-btn" value="cancel">${esc4(t("GLOBAL.CANCEL", "Abbrechen"))}</button>
          <button type="button" class="ink-btn" value="ok">Fortfahren</button>
        </div>
      </div>`;
    consent.addEventListener("click", (event) => {
      const button2 = event.target.closest("button");
      if (button2) consent.close(button2.value);
    });
    shell.append(consent);
  }
  function paintSettings() {
    const panel = shell?.querySelector("#settings-panel");
    if (!panel) return;
    shell?.querySelectorAll("[data-section]").forEach((button2) => {
      const id = button2.dataset.section || "";
      button2.setAttribute("aria-pressed", id === section ? "true" : "false");
      if (id === "contacts") button2.hidden = !snap?.caps.contacts;
      if (id === "filters") button2.hidden = !snap?.caps.sieve;
    });
    panel.innerHTML = renderDesk(section, snap, edit);
    if (edit) {
      const field2 = panel.querySelector("input:not([type='hidden']), textarea");
      field2?.focus({ preventScroll: true });
    }
  }
  function folderButton(row2) {
    const count = row2.unread > 0 ? `<span class="count">${row2.unread}</span>` : "";
    return `<button type="button" class="folder" data-folder="${esc4(row2.fullName)}" aria-current="${row2.current ? "page" : "false"}" style="padding-left:${8 + row2.depth * 12}px">${icon(ROLE_ICON[row2.role] || (row2.inbox ? "inbox" : "folder"))}<span class="folder-name">${esc4(row2.name)}</span>${count}</button>`;
  }
  return {
    showLogin,
    setLoginBusy,
    setLoginError,
    showMail,
    setFolders(rows) {
      const inbox = rows.filter((row2) => row2.inbox);
      const rest = rows.filter((row2) => !inbox.includes(row2));
      const inboxEl = shell?.querySelector("#folder-inbox");
      const restEl = shell?.querySelector("#folder-rest");
      if (inboxEl) inboxEl.innerHTML = inbox.map(folderButton).join("") || `<button type="button" class="folder" data-folder="INBOX">${icon("inbox")}<span class="folder-name">Posteingang</span></button>`;
      if (restEl) restEl.innerHTML = rest.map(folderButton).join("");
      const current = rows.find((row2) => row2.current);
      if (current && shell) {
        shell.querySelector("#folder-title").textContent = current.name;
        shell.querySelector("#reader-place").textContent = current.name;
        const search = shell.querySelector("#search");
        if (document.activeElement !== search) search.placeholder = `In ${current.name} suchen`;
      }
    },
    setList(rows, empty, error, more, searching) {
      const box = shell?.querySelector("#rows");
      const emptyEl = shell?.querySelector("#list-empty");
      const errorEl = shell?.querySelector("#list-error");
      const moreBtn = shell?.querySelector("[data-action='more']");
      const clearBtn = shell?.querySelector("[data-action='clear-search']");
      if (box) {
        box.innerHTML = rows.map((row2) => {
          const subject = row2.subject || "(ohne Betreff)";
          return `
          <div class="msg-row${row2.checked ? " checked" : ""}${row2.deleted ? " deleted" : ""}">
            <input type="checkbox" class="msg-check" data-action="m-check" data-ref="${row2.uid}"${row2.checked ? " checked" : ""} aria-label="Ausw\xE4hlen: ${esc4(subject)}">
            <button type="button" class="msg${row2.unseen ? " unseen" : ""}" data-uid="${row2.uid}" draggable="true" aria-current="${row2.current ? "true" : "false"}">
              <span class="who">${esc4(row2.who)}</span>
              <span class="when">${rowMarks({ ...row2, flagged: false })}${esc4(row2.when)}</span>
              <span class="subj">${esc4(subject)}${categoryMark(row2.category)}</span>
              <span class="peek">${esc4(row2.preview)}</span>
            </button>
            <button type="button" class="msg-flag" data-action="m-flag" data-ref="${row2.uid}" aria-pressed="${row2.flagged ? "true" : "false"}" aria-label="${row2.flagged ? "Markierung entfernen" : "Markieren"}: ${esc4(subject)}" title="${row2.flagged ? "Markierung entfernen" : "Markieren"}">${icon(row2.flagged ? "flag-filled" : "flag")}</button>
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
    },
    setReader(data, loading2, error) {
      const body = shell?.querySelector("#reader-body");
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
      if (!data) return say("empty", "W\xE4hlen Sie eine Mail.");
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
      const button2 = shell?.querySelector("[data-action='m-refresh']");
      if (!button2) return;
      button2.disabled = busy;
      button2.innerHTML = icon(busy ? "loading" : "refresh");
    },
    setAccounts(items) {
      const box = shell?.querySelector("#account-list");
      if (!box) return;
      const others = items.filter((item) => !item.current);
      box.innerHTML = others.length ? `<p class="menu-label mono">Konten</p>` + others.map(
        (item) => `<button type="button" class="menu-item" role="menuitem" data-action="m-switch" data-email="${esc4(item.email)}">${icon("user")}<span class="grow">${esc4(item.email)}</span>${item.unread ? `<span class="count">${item.unread}</span>` : ""}</button>`
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
        const rows = folders.filter((folder) => folder.fullName !== exclude && (!q || folder.fullName.toLowerCase().includes(q)));
        list.innerHTML = rows.map(
          (folder) => `<button type="button" class="folder" role="option" data-pick="${esc4(folder.fullName)}" style="padding-left:${8 + (q ? 0 : folder.depth) * 12}px">${icon(ROLE_ICON[folder.role] || (folder.fullName.toUpperCase() === "INBOX" ? "inbox" : "folder"))}<span class="folder-name">${esc4(q ? folder.fullName : folder.name)}</span></button>`
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
          const button2 = event.target.closest("[data-pick]");
          if (button2) dialog.close(button2.dataset.pick || "");
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
      const dialog = shell?.querySelector("#prompt-dlg");
      if (!dialog) return Promise.resolve(null);
      const input = dialog.querySelector("#prompt-input");
      const form2 = dialog.querySelector("form");
      dialog.querySelector("#prompt-title").textContent = title;
      dialog.querySelector("#prompt-label").textContent = label2;
      input.value = value;
      dialog.returnValue = "";
      dialog.showModal();
      input.focus({ preventScroll: true });
      return new Promise((resolve) => {
        const onSubmit = (event) => {
          event.preventDefault();
          event.stopPropagation();
          dialog.close("ok");
        };
        form2.addEventListener("submit", onSubmit);
        dialog.addEventListener("close", () => {
          form2.removeEventListener("submit", onSubmit);
          resolve(dialog.returnValue === "ok" ? input.value.trim() : null);
        }, { once: true });
      });
    },
    confirm(title, text2, ok, danger = true) {
      const dialog = shell?.querySelector("#confirm");
      if (!dialog) return Promise.resolve(false);
      dialog.querySelector("#confirm-title").textContent = title;
      const p = dialog.querySelector("#confirm-text");
      p.hidden = !text2;
      p.textContent = text2;
      const button2 = dialog.querySelector("#confirm-ok");
      button2.className = danger ? "danger" : "ink-btn";
      button2.innerHTML = withIcon(danger ? "delete" : "check", ok);
      dialog.returnValue = "";
      dialog.showModal();
      return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      });
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
    openCompose(seed) {
      if (!shell) return;
      const composer = shell.querySelector(".composer");
      shell.querySelector("#compose-title").textContent = seed.title;
      const form2 = shell.querySelector(".composer-form");
      form2.elements.namedItem("to").value = seed.to;
      form2.elements.namedItem("cc").value = seed.cc;
      form2.elements.namedItem("subject").value = seed.subject;
      form2.elements.namedItem("body").value = seed.body;
      this.setComposeFiles(seed.files || []);
      shell.querySelectorAll("[data-mode]").forEach((button2) => {
        button2.setAttribute("aria-pressed", button2.dataset.mode === (seed.mode || "new") ? "true" : "false");
      });
      this.setSendState(false, "");
      if (!wide()) pane("compose");
      openLayer(composer, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      form2.elements.namedItem("to").focus({ preventScroll: true });
    },
    closeCompose() {
      const composer = shell?.querySelector(".composer");
      if (composer && !composer.hidden) closeLayer(composer);
    },
    setComposeFiles(files) {
      const box = shell?.querySelector("#compose-files");
      if (!box) return;
      box.hidden = !files.length;
      box.innerHTML = files.map(
        (file, index) => `<li class="compose-file">${icon(file.state === "busy" ? "loading" : file.state === "error" ? "error" : "attachment")}<span class="grow" title="${esc4(file.name)}">${esc4(file.name)}</span><span class="quiet">${esc4(file.state === "error" ? "Fehler" : file.size)}</span><button type="button" class="icon-btn" data-action="m-compose-drop" data-index="${index}" aria-label="${esc4(file.name)} entfernen" title="Entfernen">${icon("close")}</button></li>`
      ).join("");
    },
    setSendState(busy, error) {
      const button2 = shell?.querySelector(".composer-form button[type='submit']");
      const slot = shell?.querySelector("#send-error");
      if (button2) {
        button2.disabled = busy;
        button2.innerHTML = busy ? withIcon("loading", "Wird gesendet \u2026") : withIcon("send", t("COMPOSE.BUTTON_SEND", "Senden"));
      }
      if (slot) {
        slot.hidden = !error;
        slot.textContent = error;
      }
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
      shell?.querySelectorAll(".filter").forEach((button2) => {
        button2.setAttribute("aria-pressed", button2.dataset.cat === id ? "true" : "false");
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
        p.className = "quiet";
        p.textContent = state.loading;
        strip.append(p);
        return;
      }
      if (state.error) {
        const p = document.createElement("p");
        p.className = "error";
        p.textContent = state.error;
        strip.append(p);
      }
      const row2 = document.createElement("div");
      row2.className = "strip-row";
      if (!state.tldr && state.showSummarize) {
        const button2 = document.createElement("button");
        button2.type = "button";
        button2.className = "text-btn";
        button2.dataset.action = "summarize";
        button2.textContent = t("AI_COPILOT.SUMMARIZE", "Zusammenfassen");
        row2.append(button2);
      } else if (state.tldr) {
        const label2 = document.createElement("span");
        label2.className = "mono";
        label2.textContent = "Zusammenfassung";
        const text2 = document.createElement("p");
        text2.textContent = state.tldr;
        const again = document.createElement("button");
        again.type = "button";
        again.className = "text-btn";
        again.dataset.action = "summarize";
        again.dataset.force = "1";
        again.textContent = t("AI_COPILOT.REGENERATE", "Neu erzeugen");
        row2.append(label2, text2, again);
        if (state.cached) {
          const note2 = document.createElement("p");
          note2.className = "quiet";
          note2.textContent = "aus dem Zwischenspeicher";
          row2.append(note2);
        }
        const caveat = document.createElement("p");
        caveat.className = "quiet";
        caveat.textContent = "Kann Angaben enthalten, die so nicht in der Mail stehen. Der Brief darunter ist die Quelle.";
        row2.append(caveat);
      }
      if (state.showReplies && !state.replies.length) {
        const replies = document.createElement("button");
        replies.type = "button";
        replies.className = "text-btn";
        replies.dataset.action = "replies";
        replies.textContent = t("AI_COPILOT.QUICK_REPLIES", "Antwortvorschl\xE4ge");
        row2.append(replies);
      }
      state.replies.forEach((reply, index) => {
        const button2 = document.createElement("button");
        button2.type = "button";
        button2.className = "prompt";
        button2.dataset.action = "use-reply";
        button2.dataset.index = String(index);
        button2.textContent = reply.label;
        row2.append(button2);
      });
      if (state.model) {
        const model = document.createElement("p");
        model.className = "mono quiet";
        model.textContent = state.model;
        row2.append(model);
      }
      strip.append(row2);
    },
    setChat(turns, thinking, context = "") {
      const log = shell?.querySelector("#chat-log");
      const chip = shell?.querySelector("#context-chip");
      const error = shell?.querySelector("#chat-error");
      if (chip) {
        chip.hidden = !context;
        chip.textContent = context ? `${context} \xB7 ohne Bezug` : "";
      }
      if (error) {
        error.hidden = !thinking.startsWith("!");
        error.textContent = thinking.startsWith("!") ? thinking.slice(1) : "";
      }
      if (!log) return;
      log.replaceChildren();
      if (!turns.length && !thinking) {
        const p = document.createElement("p");
        p.className = "quiet";
        p.textContent = t("AI_COPILOT.CHAT_EMPTY", "Fragen Sie zum Beispiel, welche Mails auf eine Antwort warten.");
        const prompts = document.createElement("div");
        prompts.className = "prompts";
        ["Welche Mails warten auf meine Antwort?", "Zeig mir Rechnungen vom letzten Monat", "Fasse die ge\xF6ffnete Mail zusammen"].forEach((text2) => {
          const button2 = document.createElement("button");
          button2.type = "button";
          button2.className = "prompt";
          button2.dataset.action = "prompt";
          button2.textContent = text2;
          prompts.append(button2);
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
            run.className = "text-btn";
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
      if (thinking && !thinking.startsWith("!")) {
        const p = document.createElement("p");
        p.className = "quiet";
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
        body: shell?.querySelector("textarea[name='body']")?.value || "",
        subject: shell?.querySelector("input[name='subject']")?.value || ""
      };
    },
    setDraftBody(text2) {
      const area = shell?.querySelector("textarea[name='body']");
      if (area) area.value = text2;
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
    showSettings(next) {
      snap = next;
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
function collection(value) {
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
function when(stamp) {
  if (!stamp) return "";
  const date = new Date(stamp * 1e3);
  const now = /* @__PURE__ */ new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}
function whenFull(stamp) {
  if (!stamp) return "";
  return new Date(stamp * 1e3).toLocaleString([], { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function hasFlag(flags, name) {
  return flags.some((flag) => flag.toLowerCase() === name);
}
function seen(flags) {
  return hasFlag(flags, "\\seen");
}
function plainFromHtml(html) {
  return new DOMParser().parseFromString(html, "text/html").body.textContent || "";
}
function quote(body) {
  return body.replace(/\r\n/g, "\n").split("\n").map((line2) => `> ${line2}`).join("\n");
}
function sizeLabel(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  replies = [];
  draftBackup = "";
  draftAbort = null;
  tagged = /* @__PURE__ */ new Set();
  alertItems = [];
  category = "all";
  mainEmail = "";
  caps = { accounts: false, identities: false, contacts: false, sieve: false, openpgp: false, gnupg: false };
  desk = null;
  contactSearch = "";
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
    newWindow: false,
    zip: false,
    thumbs: false,
    webPath: ""
  };
  trashFolder = "";
  junkFolder = "";
  draftsFolder = "";
  checked = /* @__PURE__ */ new Set();
  anchor = 0;
  readTimer = 0;
  pollTimer = 0;
  lastPoll = 0;
  inboxUid = 0;
  inboxUnread = -1;
  letter = { uid: 0, mode: "html", images: false, links: false, swap: false };
  inlineCache = /* @__PURE__ */ new Map();
  calendarCache = /* @__PURE__ */ new Map();
  receiptSkipped = /* @__PURE__ */ new Set();
  composeFiles = [];
  draftRef = null;
  renderToken = 0;
  constructor(root3) {
    window.addEventListener("sm-appearance", () => {
      if (this.current) void this.paintLetter();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.email && Date.now() - this.lastPoll > 6e4) void this.poll(false);
    });
    this.view = createView(root3, {
      login: (email, password, stay) => void this.login(email, password, stay),
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
      askDelete: () => void this.remove(),
      send: (values2) => void this.send(values2),
      closeCompose: () => {
        this.replyKind = "";
      },
      back: () => void 0,
      assist: (name, data) => void this.assist(name, data),
      settings: (name, data) => this.settings(name, data),
      act: (name, data) => void this.act(name, data)
    });
  }
  async start(data) {
    const title = String(data.title || "SnappyMail");
    if (data.Auth) await this.enter(data);
    else this.view.showLogin(title);
  }
  async login(email, password, stay) {
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
        signMe: stay ? 1 : 0
      });
      await this.enter(result);
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
    const num = (value, fallback) => Number.isFinite(Number(value)) && value !== "" && value != null ? Number(value) : fallback;
    const bool = (value, fallback) => value == null ? fallback : Boolean(value);
    const capa = data.Capa || {};
    const system = data.System || {};
    const minInterval = Math.max(1, num(data.minRefreshInterval, 5));
    this.prefs = {
      viewImages: String(data.ViewImages || "ask"),
      whitelist: String(data.ViewImagesWhitelist || ""),
      proxy: Boolean(data.proxyExternalImages),
      removeColors: bool(data.RemoveColors, false),
      allowStyles: bool(data.AllowStyles, false),
      minFontSize: num(data.minFontSize, 5),
      maxBlockquotes: num(data.MaxBlockquotesLevel, 0),
      collapseBlockquotes: bool(data.CollapseBlockquotes, true),
      viewHtml: bool(data.ViewHTML, true),
      hideDeleted: bool(data.HideDeleted, true),
      showNext: bool(data.showNextMessage, false),
      readAuto: bool(data.messageReadAuto, true),
      readDelay: Math.max(0, num(data.MessageReadDelay, 5)),
      checkInterval: Math.max(minInterval, num(data.CheckMailInterval, 15)),
      showUnreadCount: bool(data.ShowUnreadCount, false),
      desktop: bool(data.DesktopNotifications, true),
      sound: bool(data.SoundNotification, true),
      soundName: String(data.NotificationSound || "new-mail"),
      useChecks: bool(data.UseCheckboxesInList, true),
      listInline: bool(data.ListInlineAttachments, false),
      newWindow: bool(data.messageNewWindow, false),
      zip: Boolean(capa.AttachmentsActions),
      thumbs: Boolean(capa.AttachmentThumbnails),
      webPath: String(system.webVersionPath || "snappymail/v/0.0.0/")
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
  async enter(data) {
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
    this.checked.clear();
    this.inboxUid = 0;
    this.inboxUnread = -1;
    const page = Number(data.MessagesPerPage || PAGE_FALLBACK);
    this.pageSize = Math.min(50, Math.max(10, page || PAGE_FALLBACK));
    document.title = this.email || String(data.title || "Postfach");
    this.assistFlags = await readAssist(data, async () => {
      const result = await plugin("AiGetSettings");
      return result.settings;
    });
    this.noticeAck = Boolean(this.assistFlags?.noticeAck);
    this.view.showMail(this.email, "Posteingang", this.assistFlags);
    this.view.setChecks(this.prefs.useChecks);
    if (this.assistFlags?.alerts) void this.loadAlerts();
    await this.loadFolders();
    window.clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(() => {
      if (!document.hidden) void this.poll(false);
    }, this.prefs.checkInterval * 6e4);
  }
  async settings(name, data) {
    try {
      if (name === "open") this.contactSearch = "";
      if (name === "search-contacts") this.contactSearch = data.search || "";
      if (name === "open" || name === "search-contacts") {
        this.desk = await loadDesk(this.caps, this.email, this.mainEmail, this.contactSearch);
        this.view.showSettings(this.desk);
        return;
      }
      if (!this.desk) return;
      const next = await applyDesk(name, data, this.desk);
      if (next === "session") {
        await this.enter(await loadApp());
        return;
      }
      this.desk = await loadDesk(this.caps, this.email, this.mainEmail, this.contactSearch);
      this.view.showSettings(this.desk);
    } catch (error) {
      this.view.settingsNotice(explain(error));
    }
  }
  async loadFolders() {
    try {
      const result = await call("Folders");
      this.folders = (result["@Collection"] || []).map((item) => ({
        fullName: String(item.fullName || ""),
        name: String(item.name || item.fullName || ""),
        delimiter: String(item.delimiter || "/"),
        role: String(item.role || ""),
        unread: Number(item.unreadEmails || 0),
        total: Number(item.totalEmails || 0),
        uidNext: Number(item.uidNext || 0)
      })).filter((folder) => folder.fullName);
      this.resolveSystemFolders(null);
      const inbox = this.folders.find((folder) => folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX");
      if (inbox) {
        this.inboxUid = inbox.uidNext;
        this.inboxUnread = inbox.unread;
      }
      this.paintTitle();
      await this.selectFolder(inbox?.fullName || this.folders[0]?.fullName || "INBOX");
    } catch (error) {
      this.view.setList([], "", explain(error), false, false);
    }
  }
  async selectFolder(fullName) {
    window.clearTimeout(this.readTimer);
    this.folder = fullName;
    this.offset = 0;
    this.search = "";
    this.selected = 0;
    this.current = null;
    this.checked.clear();
    this.view.setReader(null, "", "");
    this.paintFolders();
    await this.loadList(false);
  }
  paintFolders() {
    const rows = this.folders.slice().sort((a, b) => Number(b.role === "inbox") - Number(a.role === "inbox") || a.fullName.localeCompare(b.fullName)).map((folder) => {
      const parts = folder.delimiter ? folder.fullName.split(folder.delimiter).filter(Boolean) : [folder.fullName];
      return {
        fullName: folder.fullName,
        name: folder.name,
        depth: Math.min(2, Math.max(0, parts.length - 1)),
        unread: folder.unread,
        current: folder.fullName === this.folder,
        inbox: folder.role === "inbox" || folder.fullName.toUpperCase() === "INBOX",
        role: this.roleOf(folder)
      };
    });
    this.view.setFolders(rows);
    this.paintTitle();
  }
  /** Rolle für das Symbol: Server-Rolle oder die erkannten System-Ordner. */
  roleOf(folder) {
    if (folder.role) return folder.role;
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
  async loadList(append, quiet = false) {
    const start = append ? this.offset : 0;
    if (!append && !quiet) this.view.setList([], "Mails werden geladen \u2026", "", false, Boolean(this.search));
    try {
      const result = await call("MessageList", {
        folder: this.folder,
        offset: start,
        limit: quiet && !append ? Math.max(this.pageSize, this.messages.length) : this.pageSize,
        search: this.category === "needs_reply" ? "keyword:$ai_needs_reply is:unanswered" : this.category === "personal" ? "keyword:$ai_personal" : this.category === "newsletter" ? "keyword:$ai_newsletter" : this.category === "notification" ? "keyword:$ai_notification" : this.category === "invoice" ? "keyword:$ai_invoice" : this.search,
        sort: "",
        uidNext: this.folders.find((folder) => folder.fullName === this.folder)?.uidNext || 0
      });
      const batch = (result["@Collection"] || []).map((item) => this.parseMessage(item));
      this.messages = append ? this.messages.concat(batch) : batch;
      this.offset = start + batch.length;
      this.total = Number(result.folder?.totalEmails ?? result.totalEmails ?? this.messages.length);
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
      this.hasMore = this.search ? batch.length >= this.pageSize : this.offset < this.total;
      this.paintList();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      this.hasMore = false;
      this.view.setList(this.rows(), "", explain(error), false, Boolean(this.search));
    }
  }
  parseMessage(item, full = false) {
    const flags = Array.isArray(item.flags) ? item.flags.map((flag) => String(flag)) : [];
    const folder = String(item.folder || this.folder);
    const uid = Number(item.uid || 0);
    const rawFiles = collection(item.attachments);
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
    collection(item.headers).forEach((header) => {
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
      readReceipt: String(item.readReceipt || ""),
      headers,
      auth: { spf: authStatus(item.spf), dkim: authStatus(item.dkim), dmarc: authStatus(item.dmarc) }
    };
  }
  visible() {
    return this.prefs.hideDeleted ? this.messages.filter((message) => !hasFlag(message.flags, "\\deleted")) : this.messages;
  }
  rows() {
    return this.visible().map((message) => ({
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
    }));
  }
  paintList() {
    const empty = this.visible().length ? "" : this.category !== "all" ? "Keine Mails f\xFCr diesen Filter." : this.search ? "Keine Mails f\xFCr diese Suche." : "Dieser Ordner ist leer.";
    this.view.setList(this.rows(), empty, "", this.hasMore, Boolean(this.search) || this.category !== "all");
  }
  async setSearch(query) {
    this.search = query;
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
      return checks.every((check2) => {
        if (check2 === "spf") return message.auth.spf === "pass";
        if (check2 === "dkim") return message.auth.dkim === "pass";
        if (check2 === "dmarc") return message.auth.dmarc === "pass";
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
        size: sizeLabel(file.size),
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
    const virus = /infected|virus/i.test(message.headers["x-virus-status"] || message.headers["x-virus-scanned"] || "") && !/clean|no/i.test(message.headers["x-virus-status"] || "clean");
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
      size: sizeLabel(message.size),
      flagged: hasFlag(message.flags, "\\flagged"),
      seen: seen(message.flags),
      deleted: hasFlag(message.flags, "\\deleted"),
      keywords: message.flags.filter((flag) => !SYSTEM_FLAGS.test(flag)),
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
      zip: this.prefs.zip,
      calendar,
      place: this.place()
    };
    this.view.setReader(data, "", "");
  }
  openNew() {
    this.replyKind = "";
    this.draftRef = null;
    this.composeFiles = [];
    this.view.openCompose({ title: "Neue Nachricht", to: "", cc: "", subject: "", body: "", mode: "new" });
  }
  openReply(all) {
    const message = this.current;
    if (!message) return;
    this.replyKind = all ? "reply-all" : "reply";
    this.draftRef = null;
    this.composeFiles = [];
    const author = message.replyTo[0] || message.from[0];
    const others = [...message.to, ...message.cc].filter((person2) => person2.email.toLowerCase() !== this.email.toLowerCase());
    const body = message.plain || plainFromHtml(message.html);
    const subject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;
    this.view.openCompose({
      title: all ? "Allen antworten" : "Antworten",
      mode: "reply",
      to: author ? address(author) : "",
      cc: all ? others.map(address).join(", ") : "",
      subject,
      body: `

Am ${when(message.date)} schrieb ${author ? label(author) : ""}:
${quote(body)}`
    });
  }
  openForward() {
    const message = this.current;
    if (!message) return;
    this.replyKind = "forward";
    this.draftRef = null;
    const body = message.plain || plainFromHtml(message.html);
    const subject = /^fw:/i.test(message.subject) ? message.subject : `Fw: ${message.subject}`;
    this.composeFiles = [];
    this.view.openCompose({
      title: "Weiterleiten",
      to: "",
      cc: "",
      subject,
      body: `

-------- Weitergeleitete Nachricht --------
Von: ${message.from.map(label).join(", ")}
Betreff: ${message.subject}

${body}`
    });
    void this.attachFrom(message.attachments.filter((file) => !file.inline).map((file) => ({ key: file.hash, name: file.name, size: file.size })));
  }
  /** Dateien vom Server als Anhänge in den Editor holen (Original-Anhänge oder ganze Mails als .eml). */
  async attachFrom(items) {
    if (!items.length) return;
    const added = items.map((item) => ({ name: item.name, size: sizeLabel(item.size), state: "busy", tempName: "", type: "" }));
    this.composeFiles = this.composeFiles.concat(added);
    this.view.setComposeFiles(this.composeFiles);
    try {
      const result = await call("MessageUploadAttachments", {
        attachments: items.map((item) => item.key)
      });
      added.forEach((file, index) => {
        const row2 = Array.isArray(result) ? result[index] : null;
        if (row2 && row2.tempName) {
          file.tempName = row2.tempName;
          file.type = String(row2.mimeType || "");
          file.state = "";
        } else file.state = "error";
      });
    } catch {
      added.forEach((file) => {
        file.state = "error";
      });
    }
    this.view.setComposeFiles(this.composeFiles);
  }
  async send(values2) {
    if (!values2.to.trim()) {
      this.view.setSendState(false, "Geben Sie bitte mindestens einen Empf\xE4nger an.");
      return;
    }
    if (this.composeFiles.some((file) => file.state === "busy")) {
      this.view.setSendState(false, "Anh\xE4nge werden noch vorbereitet.");
      return;
    }
    this.view.setSendState(true, "");
    const message = this.current;
    const attachments = {};
    this.composeFiles.filter((file) => file.tempName && file.state !== "error").forEach((file) => {
      attachments[file.tempName] = { name: file.name, inline: false, cId: "", location: "", type: file.type };
    });
    const params = {
      from: this.email,
      to: values2.to,
      cc: values2.cc,
      bcc: "",
      subject: values2.subject,
      plain: values2.body,
      html: "",
      saveFolder: this.sentFolder,
      attachments
    };
    if (message && this.replyKind) {
      params.inReplyTo = message.messageId;
      params.references = [message.references, message.messageId].filter(Boolean).join(" ");
      params.draftInfo = [this.replyKind === "forward" ? "forward" : "reply", message.uid, this.folder];
    }
    if (this.draftRef) {
      params.messageFolder = this.draftRef.folder;
      params.messageUid = this.draftRef.uid;
    }
    try {
      await call("SendMessage", params);
      this.view.closeCompose();
      this.view.setSendState(false, "");
      this.view.notice("Gesendet.");
      this.replyKind = "";
      this.composeFiles = [];
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
      message.flags = value ? message.flags.concat("\\seen") : message.flags.filter((flag) => flag.toLowerCase() !== "\\seen");
    });
    if (this.current && uids.includes(this.current.uid)) {
      this.current.flags = value ? [...new Set(this.current.flags.concat("\\seen"))] : this.current.flags.filter((flag) => flag.toLowerCase() !== "\\seen");
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
  async setFlag(uids, flag, value, action) {
    const apply = (list) => value ? [...new Set(list.concat(flag))] : list.filter((item) => item.toLowerCase() !== flag.toLowerCase());
    this.messages.forEach((message) => {
      if (uids.includes(message.uid)) message.flags = apply(message.flags);
    });
    if (this.current && uids.includes(this.current.uid)) this.current.flags = apply(this.current.flags);
    this.paintList();
    if (this.current && uids.includes(this.current.uid) && !this.checked.size) void this.paintLetter();
    try {
      const params = { folder: this.folder, uids: uids.join(","), setAction: value ? 1 : 0 };
      if (action === "MessageSetKeyword") params.keyword = flag;
      await call(action, params);
    } catch (error) {
      this.view.notice(explain(error));
    }
  }
  pickerFolders() {
    return this.folders.slice().sort((a, b) => Number(b.role === "inbox") - Number(a.role === "inbox") || a.fullName.localeCompare(b.fullName)).map((folder) => {
      const parts = folder.delimiter ? folder.fullName.split(folder.delimiter).filter(Boolean) : [folder.fullName];
      return { fullName: folder.fullName, name: folder.name, depth: Math.min(4, parts.length - 1), role: this.roleOf(folder) };
    });
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
      });
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
  async act(name, data) {
    const message = this.current;
    const ref = Number(data.ref || data.uid || 0);
    switch (name) {
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
          this.composeFiles = [];
          this.view.openCompose({ title: "Vom Verteiler abmelden", to: seed.to, cc: "", subject: seed.subject || "unsubscribe", body: seed.body, mode: "new" });
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
        this.composeFiles = [];
        this.draftRef = name === "edit-draft" ? { folder: message.folder, uid: message.uid } : null;
        this.view.openCompose({
          title: name === "edit-draft" ? "Entwurf" : "Neue Nachricht",
          to: message.to.map(address).join(", "),
          cc: message.cc.map(address).join(", "),
          subject: message.subject,
          body: message.plain || plainFromHtml(message.html),
          mode: "new"
        });
        void this.attachFrom(message.attachments.filter((file) => !file.inline).map((file) => ({ key: file.hash, name: file.name, size: file.size })));
        return;
      }
      case "forward-att": {
        const uids = this.targets();
        const list = uids.map((uid) => message && message.uid === uid ? message : this.messages.find((item) => item.uid === uid)).filter(Boolean);
        if (!list.length) return;
        this.replyKind = "";
        this.draftRef = null;
        this.composeFiles = [];
        const subject = list.length === 1 ? /^fw:/i.test(list[0].subject) ? list[0].subject : `Fw: ${list[0].subject}` : "Weitergeleitete Nachrichten";
        this.view.openCompose({ title: "Als Anhang weiterleiten", to: "", cc: "", subject, body: "", mode: "new" });
        void this.attachFrom(list.map((item) => ({ key: this.messageKey(item), name: `${(item.subject || "Mail").slice(0, 60)}.eml`, size: item.size })));
        return;
      }
      case "compose-drop": {
        const index = Number(data.index || -1);
        if (index >= 0) this.composeFiles.splice(index, 1);
        this.view.setComposeFiles(this.composeFiles);
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
        this.composeFiles = [];
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
          const input = document.querySelector("#search");
          if (input) input.value = `from:${data.email}`;
          await this.setSearch(`from:${data.email}`);
        }
        return;
      case "accounts":
        await this.loadAccounts();
        return;
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
        return;
    }
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
    if (name === "summarize" || name === "replies" || name === "generate" || name === "triage" || name === "deadlines" || name === "ask") {
      if (!await this.consent()) return;
    }
    if (name === "lang-search") {
      if (!await this.consent("query")) return;
      const query = data.text || "";
      const input = document.querySelector("#search");
      const text2 = query || input?.value.trim() || "";
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
      if (!text2) return;
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
    const options = this.view.draftOptions();
    this.draftBackup = options.body;
    this.draftAbort = new AbortController();
    this.view.setDraftBusy(true, "Entwurf wird geschrieben \u2026");
    let streamed = "";
    try {
      await streamEvents("AiStream", {
        mode: options.mode,
        tone: options.tone,
        instruction: options.instruction,
        current: options.body,
        wantSubject: options.mode === "new" || options.mode === "reply",
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
      this.view.setDraftBusy(false, this.summaryModel);
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
