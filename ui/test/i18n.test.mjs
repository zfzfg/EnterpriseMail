import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../..", import.meta.url));
const source = path.join(root, "ui/src");

function pack(language, file) {
  return JSON.parse(fs.readFileSync(path.join(root, "snappymail/v/0.0.0/app/localization", language, file), "utf8"));
}

function flatten(tree, prefix = "", into = {}) {
  for (const [key, value] of Object.entries(tree)) {
    if (value && typeof value === "object") flatten(value, `${prefix}${key}.`, into);
    else into[prefix + key] = value;
  }
  return into;
}

// The server sends langs.json and static.json with either the user or the admin pack.
const names = flatten(JSON.parse(fs.readFileSync(path.join(root, "snappymail/v/0.0.0/app/localization/langs.json"), "utf8")));
const packs = Object.fromEntries(["de", "en"].map((language) => {
  const shared = { ...names, ...flatten(pack(language, "static.json")) };
  return [language, {
    user: { ...shared, ...flatten(pack(language, "user.json")) },
    admin: { ...shared, ...flatten(pack(language, "admin.json")) }
  }];
}));

function sources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sources(file);
    return file.endsWith(".ts") && !file.endsWith("icons.ts") ? [file] : [];
  });
}

const KEY = /^[A-Z][A-Z_]+\.[A-Za-z][A-Za-z_0-9]*$/;
/** Module tables whose German text is only the fallback of a key built at render time. */
const FALLBACK_TABLES = new Set(["CATEGORY", "KOLAB_LABEL", "ACL_RIGHTS", "ACL_LABELS", "ASSIST_FEATURES", "ASSIST_TONES", "modes", "tones", "cats", "SYSTEM_NAMES", "SECURE"]);
/** Matching foreign-language folder names; never shown to the user. */
const NOT_UI = new Set(["entwürfe", "entwurf", "gelöschte elemente", "gesendete elemente", "papierkorb", "gesendet"]);
const GERMAN = /[äöüÄÖÜß]|\b(und|oder|nicht|keine?|wird|werden|wurde|bitte|ist|sind|kann|konnte|der|die|das|dem|den|von|mit|auf|beim|eintragen|einfügen|suchen|laden|löschen)\b|\b(Ohne|Fehler|Ordner|Suche|Datei|Konto|Betreff|Antwort|Weitere|Alle)\b/;

function scan() {
  const found = { keys: [], german: [] };
  for (const file of sources(source)) {
    const relative = path.relative(source, file).split(path.sep).join("/");
    const scope = relative.startsWith("admin") ? "admin" : "user";
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const at = (node) => `${relative}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const visit = (node, inTable) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isCallExpression(node) && node.expression.getText() === "t") {
        const [key, fallback] = node.arguments;
        if (key && ts.isStringLiteralLike(key)) found.keys.push({ key: key.text, scope, at: at(node) });
        if (fallback && !ts.isStringLiteralLike(fallback)) visit(fallback, true);
        return;
      }
      if (ts.isVariableDeclaration(node) && FALLBACK_TABLES.has(node.name.getText())) inTable = true;
      if (ts.isArrayLiteralExpression(node)) {
        node.elements.forEach((element, index) => {
          const next = node.elements[index + 1];
          if (ts.isStringLiteralLike(element) && KEY.test(element.text) && next && ts.isStringLiteralLike(next)) {
            found.keys.push({ key: element.text, scope, at: at(element) });
            inTable = inTable || index + 1 === node.elements.length - 1;
          }
        });
      }
      if (!inTable && (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) {
        const text = (node.text || "").replace(/<[^>]*>?/g, " ").replace(/%[A-Z]+%/g, " ").trim();
        const css = /[{};]/.test(text) && /:/.test(text);
        if (text && !css && !NOT_UI.has(text) && GERMAN.test(text) && /[A-Za-zÄÖÜäöüß]{2}/.test(text) && !/^[a-z_-]+$/.test(text)) {
          found.german.push(`${at(node)} ${text.slice(0, 70)}`);
        }
      }
      ts.forEachChild(node, (child) => visit(child, inTable));
    };
    visit(sf, false);
  }
  return found;
}

const { keys, german } = scan();

for (const language of ["de", "en"]) {
  test(`every UI text key exists in the ${language} pack`, () => {
    const missing = [...new Set(keys.filter(({ key, scope }) => !(key in packs[language][scope])).map(({ key, scope, at }) => `${scope} ${key} (${at})`))];
    assert.deepEqual(missing, []);
  });

  test(`keys built at render time exist in the ${language} pack`, () => {
    const built = [
      ...["SENT", "DRAFTS", "JUNK", "SPAM", "TRASH", "ARCHIVE"].map((role) => `FOLDERS_UI.ROLE_${role}`),
      ..."LRSWIPKXTEA".split("").map((right) => `IMAP.ACL_${right}`),
      ...["NEEDS_REPLY", "PERSONAL", "NEWSLETTER", "NOTIFICATION", "INVOICE"].map((category) => `AI_COPILOT.CAT_${category}`),
      ...["PROFESSIONAL", "FRIENDLY", "CASUAL", "CONCISE", "FORMAL"].map((tone) => `AI_COPILOT.TONE_${tone}`),
      ...["NEW", "REPLY", "REWRITE", "PROOFREAD"].map((mode) => `AI_COPILOT.MODE_${mode}`),
      ...["SUMMARIZE", "DRAFT", "QUICK_REPLIES", "SEARCH", "TRIAGE", "TRIAGE_LLM", "CHAT", "ALERTS"].map((feature) => `AI_COPILOT.FEATURE_${feature}`),
      ...["SEARCH", "SEARCH_QUERY", "READ", "FOLDER_UNKNOWN", "FAILED", "UNKNOWN_TOOL"].map((code) => `AI_COPILOT.TRACE_${code}`),
      ...["CONFIGURATION", "CALENDAR", "CONTACTS", "TASKS", "NOTES", "FILES", "JOURNAL"].map((type) => `SETTINGS_FOLDERS.TYPE_${type}`)
    ];
    assert.deepEqual(built.filter((key) => !(key in packs[language].user)), []);
  });
}

test("every plugin error code has English text, so German server messages stay out of the English UI", () => {
  const plugin = path.join(root, "plugins/ai-copilot");
  const php = ["index.php", ...fs.readdirSync(path.join(plugin, "src")).map((name) => `src/${name}`)]
    .map((name) => fs.readFileSync(path.join(plugin, name), "utf8")).join("\n");
  const raised = [...php.matchAll(/new LlmException\([^;]*?,\s*[^,;]+,\s*'([a-z_]+)'\)/g)].map((match) => match[1]);
  assert.ok(raised.length > 40, "error codes were not found");
  const untyped = [...php.matchAll(/new LlmException\((?:'[^']*'|[^;,]*(?:\.[^;,]*)*),\s*\d+\)/g)].map((match) => match[0]);
  assert.deepEqual(untyped, [], "An LlmException has no code");
  const silent = new Set(["client_disconnected"]);
  const missing = [...new Set(raised)].filter((code) => !silent.has(code) && !(`AI_COPILOT.ERROR_${code.toUpperCase()}` in packs.en.user));
  assert.deepEqual(missing, []);
});

test("the English packs contain no German", () => {
  for (const scope of ["user", "admin"]) {
    const leaked = Object.entries(packs.en[scope])
      .filter(([key, value]) => !key.startsWith("LANGS_NAMES") && typeof value === "string" && /[äöüÄÖÜß]|\b(und|nicht|bitte|für|oder|keine|wird)\b/i.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    assert.deepEqual(leaked, []);
  }
});

test("no German UI text is hardcoded outside the language packs", () => {
  assert.deepEqual(german, []);
});
