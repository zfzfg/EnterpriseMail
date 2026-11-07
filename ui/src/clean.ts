// HTML einer Mail für die Anzeige säubern. Übertragen aus dem alten Frontend (dev/Common/Html.js, cleanHtml).
// Externe Bilder werden nie direkt geladen: Sie landen in data-x-src und werden erst nach Freigabe eingesetzt.

export interface CleanOptions {
  allowStyles: boolean;
  removeColors: boolean;
  minFontSize: number;
  maxBlockquotes: number;
  collapseBlockquotes: boolean;
  /** Content-ID oder Content-Location → Schlüssel des Anhangs, sonst null. */
  inline: (ref: string) => string | null;
}

export interface CleanResult {
  html: string;
  externals: number;
  tracking: boolean;
  /** Anhänge, die im Text als Bild stehen (Schlüssel aus `inline`). */
  linked: string[];
}

const ALLOWED_TAGS = [
  "blockquote", "br", "div", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hgroup", "hr", "p", "wbr",
  "article", "aside", "header", "footer", "main", "section", "details", "summary", "nav",
  "dd", "dl", "dt", "li", "ol", "ul",
  "a", "abbr", "address", "b", "bdi", "bdo", "cite", "code", "del", "dfn", "em", "i", "ins", "kbd", "mark", "pre", "q",
  "rp", "rt", "ruby", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var",
  "acronym", "big", "center", "dir", "font", "marquee", "nobr", "plaintext", "rb", "rtc", "strike", "tt",
  "img",
  "caption", "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
  "style", "xmp"
].join(",");

const ALLOWED_ATTRS = new Set([
  "data-x-src", "name", "dir", "lang", "style", "title",
  "background", "bgcolor", "alt", "height", "width", "src", "href", "border", "bordercolor", "charset", "direction",
  "download", "hreflang", "alink", "bottommargin", "leftmargin", "link", "rightmargin", "text", "topmargin", "vlink",
  "align", "valign", "color", "face", "size", "noshade", "hspace", "vspace", "low", "high", "optimum", "value",
  "reversed", "start", "cols", "rows", "frame", "rules", "summary", "cellpadding", "cellspacing", "abbr", "scope",
  "colspan", "rowspan", "headers"
]);

const SCHEMES = /^(http|https|geo|irc|nntp|mailto|sms|tel|intent|itms-apps|msteams|slack|spotify|steam|zoommtg):/i;
const HTTP = /^(https?:)?\/\//i;
const NON_EMPTY = ["A", "B", "EM", "I", "SPAN", "STRONG"];
const TRACKERS = ["email.microsoftemail.com/open", "github.com/notifications/beacon/", "/track/open", "google-analytics.com"];
const STRIP_PARAMS = /^(utm_|ec_|fbclid|mc_eid|mkt_tok|_hsenc|vero_id|oly_enc_id|oly_anon_id|__s|Referrer|mailing|elq|bch|trc|ref|correlation_id|pd_|pf_|email_hash)/i;

const px = (value: string) => parseInt(value, 10) || 0;

function urlParam(url: string, name: string): string {
  try {
    return new URL(url).searchParams.get(name) || url;
  } catch {
    return url;
  }
}

function base64Url(data: string): string {
  return atob(data.replace(/_/g, "/").replace(/-/g, "+"));
}

/** Entfernt bekannte Weiterleitungen und Tracking-Parameter aus Links. */
export function stripTracking(url: string): string {
  try {
    const decode = decodeURIComponent;
    let next = url
      .replace(/^.+\/(https%253A[^/?&]+).*$/i, (...m) => decode(decode(String(m[1]))))
      .replace(/^.+(awstrack\.me|redditmail\.com)\/.+(https:%2F%2F[^/]+).*/i, (...m) => decode(String(m[2])))
      .replace(/^.+(www\.google|safelinks\.protection\.outlook\.com|mailchimp\.com).+url=.+$/i, () => urlParam(url, "url"))
      .replace(/^.+click\.godaddy\.com.+$/i, () => urlParam(url, "redir"))
      .replace(/^.+delivery-status\.com.+$/i, () => urlParam(url, "fb"))
      .replace(/^.+go\.dhlparcel\.nl.+\/([A-Za-z0-9_-]+)$/i, (...m) => base64Url(String(m[1])))
      .replace(/^.+sellercentral\.amazon\.com\/nms\/redirect.+$/i, () => base64Url(urlParam(url, "u")))
      .replace(/^.+amazon\.com\/gp\/r\.html.+$/i, () => urlParam(url, "U"))
      .replace(/[\s<>]+/g, "");
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

function cleanCss(source: string): string {
  return source.trim()
    .replace(/;\s*-[^;]+/g, "")
    .replace(/^\s*-[^;]+(;|$)/g, "")
    .replace(/white-space[^;]+/g, "");
}

/** Stylesheet der Mail auf den Brief begrenzen (nur wenn Stile erlaubt sind). */
function scopeCss(source: string): string {
  const css = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[\s\S]*/g, "");
  const out: string[] = [];
  const rule = /(?:(\s*?@media[\s\S]*?){([\s\S]*?)}\s*?})|(?:([\s\S]*?){([\s\S]*?)})/gi;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(css))) {
    if (match[2] !== undefined) {
      out.push(`${match[1].trim()} {\n${scopeCss(match[2] + "\n}")}}\n`);
      continue;
    }
    const selector = (match[3] || "").trim().replace(/\s+/g, " ").split(" ").map((item) => item.replace(/^(:root|html)$/, "")).join(" ").trim();
    if (!selector || selector.includes("@")) continue;
    const scoped = selector.split(",").map((item) => `.mail-body ${item.trim().replace(/\./g, ".msg-")}`.replace(/\sbody/gi, "")).join(",");
    out.push(`${scoped} {${cleanCss(match[4] || "")}}\n`);
  }
  return out.join("");
}

export function cleanHtml(source: string, options: CleanOptions): CleanResult {
  const result: CleanResult = { html: "", externals: 0, tracking: false, linked: [] };
  const tmpl = document.createElement("template");
  let linkColor = "";
  tmpl.innerHTML = source
    .replace(/<(\/?)x-html(\s[^>]*)?>/gi, "")
    .replace(/<(\/?)head(\s[^>]*)?>/gi, "")
    .replace(/<body(\s[^>]*)?>/i, '<div class="mail-body"$1>')
    .replace(/<(\/?)body(\s[^>]*)?>/gi, "<$1div$2>")
    .replace(/<span class="preview-text"[\s\S]+?<\/span>/, "")
    .replace(/\u2028/g, " ")
    .replace(/<br>\s*<\/p>/gi, "</p>")
    .trim();
  const root = tmpl.content;

  const comments = document.createNodeIterator(root, NodeFilter.SHOW_COMMENT);
  const dead: Node[] = [];
  while (comments.nextNode()) dead.push(comments.referenceNode);
  dead.forEach((node) => node.parentNode?.removeChild(node));

  root.querySelectorAll("form,button,data").forEach((node) => node.replaceWith(...node.childNodes));
  const depth = options.maxBlockquotes > 0 ? "," + new Array(options.maxBlockquotes + 1).fill("blockquote").join(" ") : "";
  root.querySelectorAll(`:not(${ALLOWED_TAGS}),a:empty,span:empty${depth}`).forEach((node) => node.remove());

  [...root.querySelectorAll<HTMLElement>("*")].forEach((node) => {
    if (!node.isConnected && !root.contains(node)) return;
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
    const get = (attr: string) => (node.getAttribute(attr) || "").trim();
    const take = (attr: string) => { const value = get(attr); node.removeAttribute(attr); return value; };

    if (className === "mail-body") {
      if (node.hasAttribute("link")) linkColor = take("link");
      if (node.hasAttribute("text")) style.color = take("text");
      (["topmargin", "leftmargin", "bottommargin", "rightmargin"] as const).forEach((attr) => {
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
      (["width", "height"] as const).forEach((key) => {
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
        } else if (
          (style.maxHeight && px(style.maxHeight) < 3)
          || (style.maxWidth && px(style.maxWidth) < 3)
          || (style.width && px(style.width) < 2)
          || TRACKERS.some((uri) => src.toLowerCase().includes(uri))
        ) {
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
      const remote: [string, string][] = [];
      (["background-image", "list-style-image", "content"] as const).forEach((property) => {
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
    [...root.querySelectorAll("blockquote")].reverse().forEach((node) => {
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

/** Freigegebene externe Bilder einsetzen. `allow` entscheidet pro Adresse, `rewrite` liefert die Ladeadresse. */
export function revealExternals(html: string, allow: (url: string) => boolean, rewrite: (url: string) => string): { html: string; blocked: number } {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html;
  let blocked = 0;
  tmpl.content.querySelectorAll<HTMLImageElement>("img[data-x-src]").forEach((node) => {
    const url = node.getAttribute("data-x-src") || "";
    if (allow(url)) {
      node.setAttribute("src", rewrite(url));
      node.removeAttribute("data-x-src");
    } else blocked += 1;
  });
  tmpl.content.querySelectorAll<HTMLElement>("[data-x-style-url]").forEach((node) => {
    let list: [string, string][] = [];
    try { list = JSON.parse(node.getAttribute("data-x-style-url") || "[]"); } catch { /* kaputt */ }
    const rest = list.filter(([property, url]) => {
      if (!allow(url)) { blocked += 1; return true; }
      node.style.setProperty(property, `url("${rewrite(url)}")`);
      return false;
    });
    if (rest.length) node.setAttribute("data-x-style-url", JSON.stringify(rest));
    else node.removeAttribute("data-x-style-url");
  });
  return { html: tmpl.innerHTML, blocked };
}

/** Inline-Bilder (cid:) durch fertige Adressen ersetzen. */
export function fillInline(html: string, urls: Map<string, string>): string {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html;
  tmpl.content.querySelectorAll<HTMLElement>("[data-x-inline]").forEach((node) => {
    const url = urls.get(node.getAttribute("data-x-inline") || "");
    if (url) node.setAttribute("src", url);
    node.removeAttribute("data-x-inline");
  });
  tmpl.content.querySelectorAll<HTMLElement>("[data-x-style-inline]").forEach((node) => {
    try {
      const [property, key] = JSON.parse(node.getAttribute("data-x-style-inline") || "[]") as [string, string];
      const url = urls.get(key);
      if (url) node.style.setProperty(property, `url("${url}")`);
    } catch { /* kaputt */ }
    node.removeAttribute("data-x-style-inline");
  });
  return tmpl.innerHTML;
}

/** Links wieder auf die Originaladressen mit Tracking setzen. */
export function originalLinks(html: string): string {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html;
  tmpl.content.querySelectorAll<HTMLAnchorElement>("a[data-x-href-tracking]").forEach((node) => {
    node.setAttribute("href", node.getAttribute("data-x-href-tracking") || node.href);
  });
  return tmpl.innerHTML;
}

/** Externe Adressen sammeln, die freigegeben werden müssten (für den Proxy-Abruf). */
export function externalUrls(html: string): string[] {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html;
  const urls = new Set<string>();
  tmpl.content.querySelectorAll("img[data-x-src]").forEach((node) => urls.add(node.getAttribute("data-x-src") || ""));
  tmpl.content.querySelectorAll("[data-x-style-url]").forEach((node) => {
    try {
      (JSON.parse(node.getAttribute("data-x-style-url") || "[]") as [string, string][]).forEach(([, url]) => urls.add(url));
    } catch { /* kaputt */ }
  });
  urls.delete("");
  return [...urls];
}

/** Text einer Mail als HTML mit anklickbaren Links und Zitatebenen. */
export function plainToHtml(text: string, collapse: boolean): string {
  const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] ?? c));
  const linkify = (value: string) => esc(value).replace(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g, (url) => {
    const clean = stripTracking(url.replace(/&amp;/g, "&")).replace(/&/g, "&amp;");
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let level = 0;
  let out = "";
  const open = () => collapse ? "<details class=\"sm-bq\"><summary>Zitat</summary><blockquote>" : "<blockquote>";
  const close = () => collapse ? "</blockquote></details>" : "</blockquote>";
  for (const line of lines) {
    const match = line.match(/^((?:>\s?)+)/);
    const depth = match ? (match[1].match(/>/g) || []).length : 0;
    while (level < depth) { out += open(); level += 1; }
    while (level > depth) { out += close(); level -= 1; }
    out += linkify(match ? line.slice(match[1].length) : line) + "\n";
  }
  while (level > 0) { out += close(); level -= 1; }
  return out;
}
