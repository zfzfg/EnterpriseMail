/** Sieve-Teilmenge für das Filterformular. Alles andere bleibt Rohtext. */

export type Field = "from" | "to" | "subject" | "header" | "body" | "size";
export type Op = "contains" | "is" | "starts" | "ends" | "regex" | "over" | "under";
export type ActionType = "move" | "copy" | "forward" | "forward-drop" | "reject" | "discard" | "seen" | "flag" | "stop";

export interface Condition {
  field: Field;
  header: string;
  op: Op;
  value: string;
}

export interface Action {
  type: ActionType;
  value: string;
}

export interface Rule {
  name: string;
  enabled: boolean;
  match: "all" | "any";
  conditions: Condition[];
  actions: Action[];
}

export interface Vacation {
  on: boolean;
  from: string;
  until: string;
  days: string;
  subject: string;
  text: string;
  addresses: string;
}

export interface FilterScript {
  rules: Rule[];
  vacation: Vacation | null;
}

export type ParseResult = { ok: true; script: FilterScript } | { ok: false; reason: string };

const EMPTY_VACATION: Vacation = { on: false, from: "", until: "", days: "7", subject: "", text: "", addresses: "" };

type Tok =
  | { k: "id" | "str" | "num" | "tag" | "name"; v: string }
  | { k: "off" | "lpar" | "rpar" | "lbrace" | "rbrace" | "lbrack" | "rbrack" | "comma" | "semi" };

export function parseFilterScript(source: string): ParseResult {
  try {
    const tokens = tokenize(source);
    const script = walk(tokens);
    return { ok: true, script };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Das Skript lässt sich nicht in Regeln lesen." };
  }
}

export function compileFilterScript(script: FilterScript, capa: string[]): string {
  const need = new Set<string>();
  const has = (name: string) => !capa.length || capa.includes(name);
  const blocks: string[] = [];
  const rules = script.rules.filter((rule) => rule.actions.length || rule.conditions.length);
  rules.forEach((rule, index) => {
    if (!rule.actions.length) throw new Error(`Regel ${index + 1} braucht eine Aktion.`);
    blocks.push(compileRule(rule, index, need));
  });
  if (script.vacation?.on) blocks.unshift(compileVacation(script.vacation, need));
  for (const name of need) {
    if (!has(name)) throw new Error(`Der Server nennt die Erweiterung „${name}“ nicht.`);
  }
  const require = need.size ? `require [${[...need].map(quote).join(", ")}];\r\n\r\n` : "";
  return `${require}# This is SnappyMail sieve script.\r\n${blocks.join("\r\n")}`;
}

/** Liest das Formular im Einstellungsdialog und baut das Skript. */
export function compileFilterForm(form: HTMLFormElement, capa: string[]): string {
  if (form.querySelector<HTMLInputElement>("[data-part='use-raw']")?.checked) {
    return form.querySelector<HTMLTextAreaElement>("textarea[name='body']")?.value || "";
  }
  const vacationOn = Boolean(form.querySelector<HTMLInputElement>("[data-part='vacation-on']")?.checked);
  const vacation: Vacation = {
    on: vacationOn,
    from: valueOf(form, "vacation-from"),
    until: valueOf(form, "vacation-until"),
    days: valueOf(form, "vacation-days") || "7",
    subject: valueOf(form, "vacation-subject"),
    text: valueOf(form, "vacation-text"),
    addresses: valueOf(form, "vacation-addresses")
  };
  const rules = [...form.querySelectorAll<HTMLElement>("[data-rule]")].map((node) => readRule(node));
  return compileFilterScript({ rules, vacation: vacationOn || vacation.text ? vacation : null }, capa);
}

export function blankRule(): Rule {
  return {
    name: "",
    enabled: true,
    match: "all",
    conditions: [{ field: "from", header: "", op: "contains", value: "" }],
    actions: [{ type: "move", value: "" }]
  };
}

function valueOf(form: ParentNode, part: string): string {
  const node = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-part='${part}']`);
  return node?.value.trim() || "";
}

function readRule(node: HTMLElement): Rule {
  const conditions = [...node.querySelectorAll<HTMLElement>("[data-cond]")].map((row) => ({
    field: (row.querySelector<HTMLSelectElement>("[data-part='field']")?.value || "from") as Field,
    header: row.querySelector<HTMLInputElement>("[data-part='header']")?.value.trim() || "",
    op: (row.querySelector<HTMLSelectElement>("[data-part='op']")?.value || "contains") as Op,
    value: row.querySelector<HTMLInputElement>("[data-part='value']")?.value.trim() || ""
  })).filter((item) => item.value || item.field === "size");
  const actions = [...node.querySelectorAll<HTMLElement>("[data-act]")].map((row) => ({
    type: (row.querySelector<HTMLSelectElement>("[data-part='type']")?.value || "stop") as ActionType,
    value: row.querySelector<HTMLInputElement>("[data-part='avalue']")?.value.trim() || ""
  }));
  return {
    name: node.querySelector<HTMLInputElement>("[data-part='name']")?.value.trim() || "",
    enabled: Boolean(node.querySelector<HTMLInputElement>("[data-part='on']")?.checked),
    match: node.querySelector<HTMLSelectElement>("[data-part='match']")?.value === "any" ? "any" : "all",
    conditions,
    actions
  };
}

function compileVacation(vacation: Vacation, need: Set<string>): string {
  if (!vacation.text.trim()) throw new Error("Die Abwesenheitsnotiz braucht einen Text.");
  need.add("vacation");
  const days = Math.max(1, Number.parseInt(vacation.days, 10) || 7);
  const addresses = vacation.addresses.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean);
  addresses.forEach((email) => {
    if (!email.includes("@")) throw new Error("Jede Adresse der Abwesenheitsnotiz braucht ein @.");
  });
  const lines: string[] = [];
  if (vacation.from || vacation.until) {
    if (vacation.from && !/^\d{4}-\d{2}-\d{2}$/.test(vacation.from)) throw new Error("Der Beginn braucht das Format JJJJ-MM-TT.");
    if (vacation.until && !/^\d{4}-\d{2}-\d{2}$/.test(vacation.until)) throw new Error("Das Ende braucht das Format JJJJ-MM-TT.");
    need.add("relational");
    need.add("date");
    const tests = [
      vacation.from ? `currentdate :value "ge" "date" ${quote(vacation.from)}` : "",
      vacation.until ? `currentdate :value "le" "date" ${quote(vacation.until)}` : ""
    ].filter(Boolean);
    lines.push(tests.length > 1 ? `if allof (\r\n    ${tests.join(",\r\n    ")}\r\n)` : `if ${tests[0]}`);
    lines.push("{");
    lines.push(`    ${vacationCommand(vacation, days, addresses)}`);
    lines.push("}");
  } else {
    lines.push(vacationCommand(vacation, days, addresses));
  }
  return lines.join("\r\n");
}

function vacationCommand(vacation: Vacation, days: number, addresses: string[]): string {
  const subject = vacation.subject ? ` :subject ${quote(vacation.subject.replace(/\s+/g, " "))}` : "";
  const list = addresses.length ? ` :addresses [${addresses.map(quote).join(", ")}]` : "";
  return `vacation :days ${days}${list}${subject} ${quote(vacation.text)};`;
}

function compileRule(rule: Rule, index: number, need: Set<string>): string {
  const name = rule.name.trim() || `Regel ${index + 1}`;
  const tests = rule.conditions.map((condition) => conditionToTest(condition, need));
  const actions = rule.actions.map((action) => actionToCommand(action, need));
  const body = actions.map((line) => `    ${line}`).join("\r\n");
  let block: string;
  if (!tests.length) block = `if true {\r\n${body}\r\n}`;
  else if (tests.length === 1) block = `if ${tests[0]} {\r\n${body}\r\n}`;
  else block = `if ${rule.match === "any" ? "anyof" : "allof"} (\r\n    ${tests.join(",\r\n    ")}\r\n) {\r\n${body}\r\n}`;
  const wrapped = rule.enabled ? block : `/* @disabled\r\n${block}\r\n*/`;
  return `# ${name.replace(/[\r\n]+/g, " ")}\r\n${wrapped}\r\n`;
}

function conditionToTest(condition: Condition, need: Set<string>): string {
  if (!condition.value) throw new Error("Eine Bedingung braucht einen Wert.");
  if (condition.field === "size") {
    if (condition.op !== "over" && condition.op !== "under") throw new Error("Die Größe vergleicht nur größer oder kleiner.");
    if (!/^[0-9]+[KkMmGg]?$/.test(condition.value)) throw new Error("Die Größe ist eine Zahl, optional mit K, M oder G.");
    return `size :${condition.op} ${condition.value}`;
  }
  let tag = ":contains";
  if (condition.op === "is") tag = ":is";
  else if (condition.op === "regex") { tag = ":regex"; need.add("regex"); }
  else if (condition.op === "starts") tag = ":matches";
  else if (condition.op === "ends") tag = ":matches";
  else if (condition.op !== "contains") throw new Error("Dieser Vergleich gilt nur für die Größe.");
  const written = condition.op === "starts" ? `${condition.value}*` : condition.op === "ends" ? `*${condition.value}` : condition.value;
  if (condition.field === "body") {
    need.add("body");
    return `body ${tag} ${quote(written)}`;
  }
  const header = condition.field === "from" ? "From"
    : condition.field === "to" ? "To"
    : condition.field === "subject" ? "Subject"
    : condition.header.trim();
  if (!header) throw new Error("Die Kopfzeile braucht einen Namen.");
  const list = condition.field === "to" ? `["To", "Cc"]` : `[${quote(header)}]`;
  return `header ${tag} ${list} ${quote(written)}`;
}

function actionToCommand(action: Action, need: Set<string>): string {
  if (action.type === "move" || action.type === "copy") {
    if (!action.value) throw new Error("Der Ordner fehlt.");
    need.add("fileinto");
    if (action.type === "copy") need.add("copy");
    return `fileinto${action.type === "copy" ? " :copy" : ""} ${quote(action.value)};`;
  }
  if (action.type === "forward" || action.type === "forward-drop") {
    if (!action.value.includes("@")) throw new Error("Die Weiterleitung braucht eine E-Mail-Adresse.");
    const redirect = `redirect ${quote(action.value)};`;
    return action.type === "forward-drop" ? `${redirect}\r\n    discard;` : redirect;
  }
  if (action.type === "reject") {
    if (!action.value) throw new Error("Die Ablehnung braucht einen Text.");
    need.add("reject");
    return `reject ${quote(action.value)};`;
  }
  if (action.type === "discard") return "discard;";
  if (action.type === "seen") { need.add("imap4flags"); return 'addflag "\\\\Seen";'; }
  if (action.type === "flag") {
    if (!action.value || /\s/.test(action.value)) throw new Error("Die Markierung ist ein Wort ohne Leerzeichen.");
    need.add("imap4flags");
    return `addflag ${quote(action.value)};`;
  }
  return "stop;";
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tokenize(source: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) { i += 1; continue; }
    if (char === "#") {
      const end = source.indexOf("\n", i);
      const text = source.slice(i + 1, end < 0 ? source.length : end).trim();
      if (text && !text.startsWith("This is SnappyMail") && !text.startsWith("Please") && !text.startsWith("RAINLOOP")) out.push({ k: "name", v: text });
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
        if (source[i] === "\\") { v += source[i + 1] || ""; i += 2; continue; }
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
      while (i < source.length && /[A-Za-z0-9_-]/.test(source[i])) { v += source[i]; i += 1; }
      if (!v) throw new Error("Ein Schlüsselwort nach dem Doppelpunkt fehlt.");
      out.push({ k: "tag", v: v.toLowerCase() });
      continue;
    }
    if (/[0-9]/.test(char)) {
      let v = "";
      while (i < source.length && /[0-9]/.test(source[i])) { v += source[i]; i += 1; }
      if (i < source.length && /[KkMmGg]/.test(source[i])) { v += source[i]; i += 1; }
      out.push({ k: "num", v });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let v = "";
      while (i < source.length && /[A-Za-z0-9_\\]/.test(source[i])) { v += source[i]; i += 1; }
      out.push({ k: "id", v: v.toLowerCase() });
      continue;
    }
    const punct: Record<string, "lpar" | "rpar" | "lbrace" | "rbrace" | "lbrack" | "rbrack" | "comma" | "semi"> = { "(": "lpar", ")": "rpar", "{": "lbrace", "}": "rbrace", "[": "lbrack", "]": "rbrack", ",": "comma", ";": "semi" };
    const kind = punct[char];
    if (!kind) throw new Error(`Unbekanntes Zeichen „${char}“.`);
    out.push({ k: kind });
    i += 1;
  }
  return out;
}

class Cursor {
  constructor(private readonly tokens: Tok[], private at = 0) {}
  peek(): Tok | null { return this.tokens[this.at] || null; }
  take(): Tok { const tok = this.tokens[this.at]; if (!tok) throw new Error("Das Skript endet zu früh."); this.at += 1; return tok; }
  eat(kind: Tok["k"]): boolean { if (this.peek()?.k === kind) { this.at += 1; return true; } return false; }
}

function walk(tokens: Tok[]): FilterScript {
  const cur = new Cursor(tokens);
  const rules: Rule[] = [];
  let vacation: Vacation | null = null;
  let pending = "";
  let disabled = false;
  while (cur.peek()) {
    const tok = cur.peek();
    if (tok?.k === "name") { pending = tok.v; cur.take(); continue; }
    if (tok?.k === "off") { disabled = true; cur.take(); continue; }
    if (tok?.k !== "id") throw new Error("An dieser Stelle steht kein Befehl.");
    const word = tok.v;
    cur.take();
    if (word === "require") { skipRequire(cur); pending = ""; disabled = false; continue; }
    if (word === "if") {
      const test = readTest(cur);
      if (cur.take().k !== "lbrace") throw new Error("Dem Vergleich fehlt der Block.");
      const commands = readCommands(cur);
      if (isVacation(test, commands)) {
        if (vacation) throw new Error("Mehr als eine Abwesenheitsnotiz.");
        vacation = vacationFrom(test, commands);
      } else rules.push(ruleFrom(pending, !disabled, test, commands));
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

function skipRequire(cur: Cursor): void {
  if (cur.peek()?.k === "str" || cur.peek()?.k === "lbrack") {
    if (cur.peek()?.k === "lbrack") {
      cur.take();
      while (cur.peek() && cur.peek()?.k !== "rbrack") cur.take();
      if (cur.take().k !== "rbrack") throw new Error("require ist nicht geschlossen.");
    } else cur.take();
  }
  if (!cur.eat("semi")) throw new Error("require endet nicht mit einem Strichpunkt.");
}

interface Test { kind: "all" | "any" | "one"; tests: OneTest[] }
type OneTest =
  | { kind: "header"; name: string; extra: string; op: Op; value: string }
  | { kind: "size"; op: "over" | "under"; value: string }
  | { kind: "date"; which: "from" | "until"; value: string }
  | { kind: "true" };

interface Cmd { name: string; copy: boolean; args: string[] }

function readTest(cur: Cursor): Test {
  const tok = cur.take();
  if (tok.k !== "id") throw new Error("Dem if fehlt der Vergleich.");
  if (tok.v === "allof" || tok.v === "anyof") {
    if (cur.take().k !== "lpar") throw new Error("allof oder anyof braucht Klammern.");
    const tests: OneTest[] = [];
    while (!cur.eat("rpar")) {
      tests.push(readOneTest(cur));
      cur.eat("comma");
    }
    if (!tests.length) throw new Error("Der Vergleich ist leer.");
    return { kind: tok.v === "anyof" ? "any" : "all", tests };
  }
  return { kind: "one", tests: [readOneTest(cur, tok)] };
}

function readOneTest(cur: Cursor, first?: Tok): OneTest {
  const tok = first || cur.take();
  if (tok.k !== "id") throw new Error("Unbekannter Vergleich.");
  if (tok.v === "true") return { kind: "true" };
  if (tok.v === "size") {
    const tag = cur.take();
    if (tag.k !== "tag" || (tag.v !== "over" && tag.v !== "under")) throw new Error("size kennt hier nur :over und :under.");
    const num = cur.take();
    if (num.k !== "num") throw new Error("size braucht eine Zahl.");
    return { kind: "size", op: tag.v, value: num.v };
  }
  if (tok.v === "currentdate") {
    const tags: string[] = [];
    const strings: string[] = [];
    while (cur.peek() && cur.peek()?.k !== "comma" && cur.peek()?.k !== "rpar" && cur.peek()?.k !== "lbrace") {
      const item = cur.take();
      if (item.k === "tag") tags.push(item.v);
      else if (item.k === "str") strings.push(item.v);
      else throw new Error("currentdate hat eine unbekannte Form.");
    }
    if (!tags.includes("value") || strings[1] !== "date" || !strings[2]) throw new Error("Der Zeitraum nutzt currentdate :value.");
    if (strings[0] === "ge") return { kind: "date", which: "from", value: strings[2] };
    if (strings[0] === "le") return { kind: "date", which: "until", value: strings[2] };
    throw new Error("Der Zeitraum vergleicht nur ab und bis.");
  }
  if (tok.v !== "header" && tok.v !== "body" && tok.v !== "address") throw new Error(`Der Vergleich „${tok.v}“ steht nicht im Formular.`);
  const tags: string[] = [];
  const strings: string[][] = [];
  while (cur.peek() && !["comma", "rpar", "lbrace"].includes(cur.peek()?.k || "")) {
    const item = cur.peek();
    if (item?.k === "tag") { tags.push(item.v); cur.take(); continue; }
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
  const values = strings[1];
  if (values.length !== 1) throw new Error("Ein Vergleich mit mehreren Werten bleibt im Rohtext.");
  const known = names.length === 1 && names[0].toLowerCase() === "from" ? "from"
    : names.length === 1 && names[0].toLowerCase() === "subject" ? "subject"
    : (names.length === 1 && names[0].toLowerCase() === "to") || (names.length === 2 && names.map((item) => item.toLowerCase()).sort().join() === "cc,to") ? "to"
    : names.length === 1 ? "header" : "";
  if (!known) throw new Error("Diese Kopfzeilen bleiben im Rohtext.");
  return { kind: "header", name: known, extra: known === "header" ? names[0] : "", op, value: values[0] };
}

function opFromTags(tags: string[]): Op | null {
  if (tags.includes("contains")) return "contains";
  if (tags.includes("is")) return "is";
  if (tags.includes("regex")) return "regex";
  if (tags.includes("matches")) return "starts";
  return null;
}

function readStringList(cur: Cursor): string[] {
  if (cur.peek()?.k === "lbrack") {
    cur.take();
    const list: string[] = [];
    while (!cur.eat("rbrack")) {
      const tok = cur.take();
      if (tok.k !== "str") throw new Error("In der Liste steht keine Zeichenkette.");
      list.push(tok.v);
      cur.eat("comma");
    }
    return list;
  }
  const tok = cur.take();
  if (tok.k !== "str") throw new Error("Hier steht keine Zeichenkette.");
  return [tok.v];
}

function readCommands(cur: Cursor): Cmd[] {
  const list: Cmd[] = [];
  while (cur.peek() && cur.peek()?.k !== "rbrace") {
    const tok = cur.take();
    if (tok.k !== "id") throw new Error("In der Regel steht kein Befehl.");
    if (tok.v === "if") throw new Error("Verschachtelte Regeln bleiben im Rohtext.");
    list.push(readOneCommand(tok.v, cur)[0]);
  }
  if (cur.take().k !== "rbrace") throw new Error("Der Block ist nicht geschlossen.");
  return list;
}

function readOneCommand(name: string, cur: Cursor): Cmd[] {
  const next = cur.peek();
  const copy = next?.k === "tag" && next.v === "copy";
  if (copy) cur.take();
  const args: string[] = [];
  const tags: string[] = [];
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
    if (tok?.k === "str" || tok?.k === "num") { args.push(tok.v); cur.take(); continue; }
    throw new Error(`Der Befehl „${name}“ bleibt im Rohtext.`);
  }
  if (!cur.eat("semi")) throw new Error(`„${name}“ endet nicht mit einem Strichpunkt.`);
  if (!["fileinto", "redirect", "reject", "ereject", "discard", "stop", "addflag", "vacation"].includes(name)) {
    throw new Error(`Der Befehl „${name}“ bleibt im Rohtext.`);
  }
  return [{ name, copy: copy || tags.includes("copy"), args }];
}

function isVacation(test: Test | null, commands: Cmd[]): boolean {
  const dates = test?.tests.every((item) => item.kind === "date") && test.tests.length > 0;
  const only = commands.every((cmd) => cmd.name === "vacation" || cmd.name === "stop");
  return Boolean(dates && only && commands.some((cmd) => cmd.name === "vacation"));
}

function vacationFrom(test: Test | null, commands: Cmd[]): Vacation {
  const cmd = commands.find((item) => item.name === "vacation");
  if (!cmd) throw new Error("Die Abwesenheitsnotiz hat keinen Text.");
  const text = [...cmd.args].reverse().find((item) => !/^(days|subject|addresses|from|handle):/.test(item)) || "";
  const pick = (key: string) => cmd.args.find((item) => item.startsWith(`${key}:`))?.slice(key.length + 1) || "";
  const from = test?.tests.find((item) => item.kind === "date" && item.which === "from");
  const until = test?.tests.find((item) => item.kind === "date" && item.which === "until");
  return {
    on: true,
    from: from && from.kind === "date" ? from.value : "",
    until: until && until.kind === "date" ? until.value : "",
    days: pick("days") || "7",
    subject: pick("subject"),
    text,
    addresses: pick("addresses")
  };
}

function ruleFrom(name: string, enabled: boolean, test: Test | null, commands: Cmd[]): Rule {
  const conditions: Condition[] = [];
  if (test) {
    test.tests.forEach((item) => {
      if (item.kind === "true") return;
      if (item.kind === "date") throw new Error("Ein Zeitraum gehört zur Abwesenheitsnotiz.");
      if (item.kind === "size") {
        conditions.push({ field: "size", header: "", op: item.op, value: item.value });
        return;
      }
      let op = item.op;
      let value = item.value;
      if (op === "starts") {
        if (value.endsWith("*") && !value.slice(0, -1).includes("*")) { op = "starts"; value = value.slice(0, -1); }
        else if (value.startsWith("*") && !value.slice(1).includes("*")) { op = "ends"; value = value.slice(1); }
        else throw new Error("Dieser Platzhalter bleibt im Rohtext.");
      }
      conditions.push({
        field: item.name === "body" ? "body" : item.name as Field,
        header: item.extra,
        op,
        value
      });
    });
  }
  const actions: Action[] = [];
  for (let i = 0; i < commands.length; i += 1) {
    const cmd = commands[i];
    if (cmd.name === "vacation") throw new Error("Die Abwesenheitsnotiz steht für sich.");
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
      const flag = cmd.args[0] || "";
      actions.push(flag === "\\Seen" ? { type: "seen", value: "" } : { type: "flag", value: flag });
    }
  }
  if (!actions.length) throw new Error("Die Regel hat keine Aktion.");
  return { name, enabled, match: test?.kind === "any" ? "any" : "all", conditions, actions };
}

export { EMPTY_VACATION };
