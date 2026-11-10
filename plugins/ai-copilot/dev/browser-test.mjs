#!/usr/bin/env node
/**
 * Reusable Chrome Headless verification for the local ai-copilot dev fixture.
 *
 * Required: TEST_PASSWORD (and ADMIN_PASSWORD for the admin scenario).
 * Optional: BASE_URL, TEST_EMAIL, CHROME_PATH, HEADFUL=1.
 * No provider-backed AI action is invoked. Artifacts go to dev/shots/browser-*.
 */
import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "shots");
const DOWNLOADS = path.join(SHOTS, "browser-downloads");
const BASE_URL = process.env.BASE_URL || "http://localhost:8888/";
const EMAIL = process.env.TEST_EMAIL || "test@example.com";
const PASSWORD = process.env.TEST_PASSWORD || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const CHROME_PATH = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const startedAt = new Date().toISOString();
const draftSubject = `Browser-Verifikation Entwurf ${startedAt.slice(0, 19)}`;
const report = {
  startedAt,
  baseUrl: BASE_URL,
  chromePath: CHROME_PATH,
  scenarios: [],
  unverified: []
};

await mkdir(SHOTS, { recursive: true });
await mkdir(DOWNLOADS, { recursive: true });
if (!PASSWORD) {
  console.error("TEST_PASSWORD is required; credentials are read from the environment, not stored here.");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
const errorText = (error) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);

async function screenshot(page, name) {
  const target = path.join(SHOTS, `browser-${slug(name)}.png`);
  await page.screenshot({ path: target, fullPage: false });
  return target;
}

async function installInstrumentation(page, scenario) {
  await page.evaluateOnNewDocument(() => {
    // Instrument only the application document. Injecting into a scriptless
    // letter srcdoc would itself produce a sandbox console error.
    if (window !== window.top) return;
    const vitals = { lcpMs: 0, cls: 0, longtasks: [], events: [], eventTimingSupported: false, droppedSamples: 0 };
    Object.defineProperty(window, "__smBrowserVitals", { value: vitals, configurable: true });
    const sample = (collection, value) => {
      if (collection.length >= 2000) { vitals.droppedSamples += 1; return; }
      collection.push(value);
    };
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) vitals.lcpMs = entries[entries.length - 1].startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch { /* Metric is reported as unavailable. */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) vitals.cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch { /* Metric is reported as unavailable. */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) sample(vitals.longtasks, { startMs: entry.startTime, durationMs: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch { /* Metric is reported as unavailable. */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) sample(vitals.events, {
          name: entry.name,
          interactionId: entry.interactionId || 0,
          startMs: entry.startTime,
          durationMs: entry.duration,
          inputDelayMs: Math.max(0, entry.processingStart - entry.startTime),
          processingMs: Math.max(0, entry.processingEnd - entry.processingStart),
          presentationDelayMs: Math.max(0, entry.duration - (entry.processingEnd - entry.startTime))
        });
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
      vitals.eventTimingSupported = true;
    } catch { /* INP is explicitly null when Event Timing is unavailable. */ }
  });
  page.on("console", (message) => {
    if (message.type() === "error") scenario.consoleErrors.push({ text: message.text(), url: message.location().url || "" });
  });
  page.on("pageerror", (error) => scenario.pageErrors.push(errorText(error)));
  page.on("requestfailed", (request) => scenario.failedRequests.push({
    method: request.method(),
    url: request.url(),
    error: request.failure()?.errorText || "unknown"
  }));
  page.on("response", (response) => {
    if (response.status() >= 400) scenario.httpErrors.push({ status: response.status(), url: response.url() });
  });
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && !["localhost", "127.0.0.1"].includes(url.hostname)) {
        scenario.externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      }
      if (url.pathname.includes("/AiStream/") || url.search.includes("/AiStream/")) scenario.aiStreamRequests.push(url.pathname);
    } catch { /* Non-URL requests are irrelevant to this audit. */ }
  });
}

async function traceScripts(cdp, action) {
  const samples = [];
  let eventsSeen = 0;
  const onData = ({ value }) => {
    for (const event of value || []) {
      eventsSeen += 1;
      if (["v8.compile", "v8.compileModule", "EvaluateScript", "v8.evaluateModule"].includes(event.name) && Number.isFinite(event.dur)) samples.push(event);
    }
  };
  let complete;
  const completed = new Promise((resolve) => { complete = resolve; });
  cdp.on("Tracing.dataCollected", onData);
  cdp.once("Tracing.tracingComplete", complete);
  await cdp.send("Tracing.start", { categories: "devtools.timeline", transferMode: "ReportEvents" });
  let result;
  try {
    result = await action();
  } finally {
    await cdp.send("Tracing.end");
    await completed;
    cdp.off("Tracing.dataCollected", onData);
    cdp.off("Tracing.tracingComplete", complete);
  }
  const timing = (names) => {
    const durations = samples.filter((event) => names.includes(event.name)).map((event) => event.dur / 1000);
    return {
      count: durations.length,
      totalMs: durations.reduce((sum, value) => sum + value, 0),
      maxMs: durations.reduce((max, value) => Math.max(max, value), 0)
    };
  };
  return { result, timing: { source: "Chrome DevTools tracing: v8.compile/v8.compileModule and EvaluateScript/v8.evaluateModule", eventsSeen, parseCompile: timing(["v8.compile", "v8.compileModule"]), evaluate: timing(["EvaluateScript", "v8.evaluateModule"]) } };
}

async function collectMetrics(page, cdp, label) {
  await sleep(700);
  const web = await page.evaluate(() => {
    const vitals = window.__smBrowserVitals || { lcpMs: 0, cls: 0, longtasks: [], events: [], eventTimingSupported: false, droppedSamples: 0 };
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const transfer = (entry) => Number(entry?.transferSize || 0);
    const interactions = new Set(vitals.events.map((entry) => entry.interactionId).filter(Boolean));
    return {
      lcpMs: vitals.lcpMs || null,
      inpMs: vitals.eventTimingSupported ? vitals.events.reduce((max, item) => Math.max(max, item.durationMs), 0) : null,
      inpMethod: "Maximum observed Event Timing duration; short-session approximation, not field INP",
      eventTimingSupported: vitals.eventTimingSupported,
      eventTimingCount: vitals.events.length,
      eventTimingInteractionCount: interactions.size,
      droppedPerformanceSamples: vitals.droppedSamples,
      cls: vitals.cls,
      longtaskCount: vitals.longtasks.length,
      longtaskTotalMs: vitals.longtasks.reduce((sum, item) => sum + item.durationMs, 0),
      longtaskMaxMs: vitals.longtasks.reduce((max, item) => Math.max(max, item.durationMs), 0),
      domNodes: document.getElementsByTagName("*").length,
      transferredBytes: transfer(navigation) + resources.reduce((sum, entry) => sum + transfer(entry), 0),
      decodedBodyBytes: Number(navigation?.decodedBodySize || 0) + resources.reduce((sum, entry) => sum + Number(entry.decodedBodySize || 0), 0),
      resourceCount: resources.length + (navigation ? 1 : 0),
      domContentLoadedMs: navigation?.domContentLoadedEventEnd || null,
      loadMs: navigation?.loadEventEnd || null,
      jsHeapUsedBytes: performance.memory?.usedJSHeapSize || null
    };
  });
  let nodes = null;
  let documents = null;
  try {
    const counters = await cdp.send("Memory.getDOMCounters");
    nodes = counters.nodes;
    documents = counters.documents;
  } catch { /* DOM counters remain null when unsupported. */ }
  const performanceMetrics = await cdp.send("Performance.getMetrics");
  const values = Object.fromEntries(performanceMetrics.metrics.map((item) => [item.name, item.value]));
  return {
    label,
    ...web,
    scriptDurationMs: Number.isFinite(values.ScriptDuration) ? values.ScriptDuration * 1000 : null,
    cdpDomNodes: nodes,
    cdpDocuments: documents,
    cdpJsHeapUsedBytes: values.JSHeapUsedSize ? Math.round(values.JSHeapUsedSize) : null,
    cdpJsHeapTotalBytes: values.JSHeapTotalSize ? Math.round(values.JSHeapTotalSize) : null
  };
}

async function authenticate(page, navigate = true) {
  if (navigate) await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector(".login-card input[name='email'], .shell", { visible: true, timeout: 60_000 });
  if (await page.$(".shell")) {
    await page.waitForSelector("#rows [data-uid]", { visible: true, timeout: 60_000 });
    return;
  }
  await page.type(".login-card input[name='email']", EMAIL);
  await page.type(".login-card input[name='password']", PASSWORD);
  await page.click(".login-card button[type='submit']");
  await page.waitForFunction(() => {
    if (document.querySelector(".shell")) return true;
    const error = document.querySelector(".login-card [data-for='form']");
    return Boolean(error && !error.hidden && (error.textContent || "").trim());
  }, { timeout: 60_000 });
  if (!await page.$(".shell")) {
    const message = await page.$eval(".login-card [data-for='form']", (node) => (node.textContent || "").trim());
    throw new Error(`Login rejected: ${message}`);
  }
  await page.waitForSelector("#rows [data-uid]", { visible: true, timeout: 60_000 });
}

async function clickContaining(page, selector, text) {
  const elements = await page.$$(selector);
  for (const element of elements) {
    const value = await element.evaluate((node) => node.textContent || "");
    if (value.includes(text) && await element.isIntersectingViewport()) {
      await element.click();
      return;
    }
  }
  throw new Error(`No visible ${selector} containing ${JSON.stringify(text)}`);
}

async function openMessage(page, subject) {
  await clickContaining(page, "#rows .msg", subject);
  await page.waitForFunction((wanted) => {
    const title = document.querySelector(".letter-head h2");
    return title && (title.textContent || "").includes(wanted) && document.querySelector("iframe.letter");
  }, { timeout: 60_000 }, subject);
}

async function openSettings(page, section = "look") {
  const dialog = await page.$("#settings[open]");
  if (!dialog) {
    await page.click("[data-action='account']");
    await page.waitForSelector("#account-menu:not([hidden])", { visible: true });
    await page.click("#account-menu [data-action='settings']");
    await page.waitForSelector("#settings[open]", { visible: true, timeout: 60_000 });
  }
  await page.click(`#settings [data-action='settings-section'][data-section='${section}']`);
  await page.waitForFunction(() => (document.querySelector("#settings-panel")?.textContent || "").trim().length > 20);
}

async function layoutAudit(page) {
  const layout = await page.evaluate(() => {
    const measure = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        selector,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflow: style.overflow,
        hidden: element.hidden
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      activeElement: document.activeElement ? {
        tag: document.activeElement.tagName,
        className: document.activeElement.className,
        action: document.activeElement.getAttribute("data-action"),
        compose: document.activeElement.getAttribute("data-compose")
      } : null,
      elements: ["html", "body", ".shell", ".reader"].map(measure).filter(Boolean)
    };
  });
  for (const item of layout.elements) {
    assert.ok(item.scrollWidth <= item.clientWidth + 1, `Horizontal overflow on ${item.selector}: ${item.scrollWidth} > ${item.clientWidth}`);
  }
  assert.ok(layout.elements.find((item) => item.selector === "html")?.scrollHeight <= layout.viewport.height + 1, "Document exceeds viewport vertically");
  return layout;
}

async function auditScenario(scenario) {
  assert.deepEqual(scenario.pageErrors, [], `Page errors: ${scenario.pageErrors.join(" | ")}`);
  assert.deepEqual(scenario.consoleErrors, [], `Console errors: ${scenario.consoleErrors.map((item) => item.text).join(" | ")}`);
  assert.deepEqual(scenario.httpErrors, [], `HTTP errors: ${scenario.httpErrors.map((item) => `${item.status} ${item.url}`).join(" | ")}`);
  assert.deepEqual(scenario.aiStreamRequests, [], "An AI streaming endpoint was called unexpectedly");
  assert.deepEqual(scenario.externalRequests, [], `Unexpected external requests: ${scenario.externalRequests.join(" | ")}`);
  const unexpectedAborts = scenario.failedRequests.filter((item) => !["net::ERR_ABORTED"].includes(item.error));
  assert.deepEqual(unexpectedAborts, [], `Failed requests: ${unexpectedAborts.map((item) => `${item.error} ${item.url}`).join(" | ")}`);
}

async function performDownload(page, cdp, action, expectedName) {
  const events = [];
  const willBegin = (event) => events.push({ type: "begin", ...event });
  const progress = (event) => events.push({ type: "progress", ...event });
  cdp.on("Browser.downloadWillBegin", willBegin);
  cdp.on("Browser.downloadProgress", progress);
  try {
    await action();
    const deadline = Date.now() + 15_000;
    let completed;
    while (Date.now() < deadline && !completed) {
      completed = events.find((event) => event.type === "progress" && event.state === "completed");
      const canceled = events.find((event) => event.type === "progress" && event.state === "canceled");
      if (canceled) return { verificationStatus: "unverified", reason: `Chrome canceled the download: ${JSON.stringify(events)}` };
      if (!completed) await sleep(100);
    }
    assert.ok(completed, `Download did not complete within 15 s: ${JSON.stringify(events)}`);
    const begin = events.find((event) => event.type === "begin" && event.guid === completed.guid);
    assert.ok(begin, "Download begin event missing");
    if (expectedName) assert.equal(begin.suggestedFilename, expectedName);
    const downloadedPath = path.join(DOWNLOADS, begin.suggestedFilename);
    const file = await stat(downloadedPath);
    assert.ok(file.size > 0, `Downloaded file is empty: ${begin.suggestedFilename}`);
    return { filename: begin.suggestedFilename, bytes: file.size, path: downloadedPath };
  } finally {
    cdp.off("Browser.downloadWillBegin", willBegin);
    cdp.off("Browser.downloadProgress", progress);
  }
}

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: !process.env.HEADFUL,
    protocolTimeout: 90_000,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update"]
  });

  async function scenario(name, viewport, body) {
    const selected = (process.env.BROWSER_SCENARIOS || "").split(",").map((value) => value.trim()).filter(Boolean);
    if (selected.length && !selected.includes(name)) return;
    const result = {
      name,
      status: "running",
      viewport,
      steps: [],
      metrics: [],
      downloads: [],
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      httpErrors: [],
      externalRequests: [],
      aiStreamRequests: [],
      screenshots: []
    };
    report.scenarios.push(result);
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport(viewport);
    await installInstrumentation(page, result);
    const cdp = await page.createCDPSession();
    await cdp.send("Performance.enable");
    const shot = async (label) => {
      const file = await screenshot(page, `${name}-${label}`);
      result.screenshots.push(file);
      return file;
    };
    const step = async (label, callback, continueOnFailure = false) => {
      const entry = { name: label, status: "running" };
      result.steps.push(entry);
      try {
        const details = await callback();
        entry.status = details?.verificationStatus === "unverified" ? "unverified" : "passed";
        if (details !== undefined) entry.details = details;
        if (entry.status === "unverified") entry.reason = details.reason;
        return details;
      } catch (error) {
        entry.status = "failed";
        entry.error = errorText(error);
        try {
          entry.screenshot = await shot(`failure-${slug(label)}`);
        } catch (shotError) {
          entry.screenshotError = errorText(shotError);
        }
        if (!continueOnFailure) throw error;
        return undefined;
      }
    };
    try {
      await body({ page, cdp, result, step, shot });
      await step("Audit console, page, HTTP, external, and failed-request errors", () => auditScenario(result));
      const unverified = result.steps.some((item) => item.status === "unverified");
      const failed = result.steps.some((item) => item.status === "failed");
      result.status = unverified ? "unverified" : failed ? "failed" : "passed";
      if (failed) result.error = "One or more steps failed; see the step details";
    } catch (error) {
      result.status = "failed";
      result.error = errorText(error);
    } finally {
      await context.close().catch(() => undefined);
    }
    console.log(`${result.status === "passed" ? "PASS" : result.status === "unverified" ? "UNVERIFIED" : "FAIL"} ${name}${result.error ? `: ${result.error}` : ""}`);
  }

  const desktop = { width: 1440, height: 960, deviceScaleFactor: 1 };
  const mobile = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

  await scenario("desktop-login-folders-read", desktop, async ({ page, step, shot }) => {
    await step("Cold login renders the mailbox and seeded list", async () => {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".login-card", { visible: true, timeout: 60_000 });
      await shot("login");
      await authenticate(page, false);
      const rows = await page.$$eval("#rows [data-uid]", (nodes) => nodes.length);
      assert.ok(rows >= 10, `Expected seeded inbox rows, got ${rows}`);
      await shot("inbox");
      return { rows };
    });
    await step("Folder tree and Sent/INBOX navigation work", async () => {
      const folders = await page.$$eval("[data-folder]", (nodes) => nodes.map((node) => node.getAttribute("data-folder")));
      for (const folder of ["INBOX", "Sent", "Drafts"]) assert.ok(folders.includes(folder), `Missing folder ${folder}`);
      await page.click("[data-folder='Sent']");
      await page.waitForFunction(() => document.querySelector("[data-folder='Sent']")?.getAttribute("aria-current") === "page");
      await page.waitForSelector("#rows [data-uid]", { visible: true });
      const sentRows = await page.$$eval("#rows [data-uid]", (nodes) => nodes.length);
      assert.ok(sentRows >= 2);
      await page.click("[data-folder='INBOX']");
      await page.waitForFunction(() => document.querySelector("[data-folder='INBOX']")?.getAttribute("aria-current") === "page");
      await page.waitForSelector("#rows [data-uid]", { visible: true });
      return { folders, sentRows };
    });
    await step("HTML message reads in a scriptless sandbox with external images blocked", async () => {
      await openMessage(page, "Funktionstest: HTML, Bilder, Tracking, Abmelden");
      const frameElement = await page.waitForSelector("iframe.letter", { visible: true });
      const sandbox = await frameElement.evaluate((node) => node.getAttribute("sandbox") || "");
      assert.ok(sandbox.split(/\s+/).includes("allow-same-origin"));
      assert.ok(!sandbox.split(/\s+/).includes("allow-scripts"), "Letter sandbox unexpectedly allows scripts");
      const frame = await frameElement.contentFrame();
      assert.ok(frame, "Letter frame is unavailable");
      await frame.waitForSelector("body", { timeout: 30_000 });
      const content = await frame.evaluate(() => ({
        text: document.body.textContent || "",
        csp: document.querySelector("meta[http-equiv='Content-Security-Policy']")?.getAttribute("content") || "",
        externalImages: [...document.images].map((image) => ({ src: image.getAttribute("src") || "", loaded: image.complete && image.naturalWidth > 0 })),
        scripts: document.scripts.length
      }));
      assert.ok(content.text.includes("Funktionstest: HTML mit externen Bildern"));
      assert.ok(content.csp.includes("default-src"), "Letter CSP is missing");
      assert.equal(content.scripts, 0, "Sanitizer left script elements in the letter");
      assert.ok(content.externalImages.every((image) => !/^https:/.test(image.src) && !image.loaded || image.src.startsWith("data:")), `Unexpected external image: ${JSON.stringify(content.externalImages)}`);
      await shot("html-message");
      return { sandbox, csp: content.csp, images: content.externalImages };
    });
    await step("Desktop shell, reader, and focus/overflow invariants hold", () => layoutAudit(page));
  });

  await scenario("desktop-downloads", desktop, async ({ page, cdp, result, step, shot }) => {
    let downloadControl;
    await step("Login and open attachment fixture", async () => {
      await authenticate(page);
      await openMessage(page, "Funktionstest: Anhänge und Termin");
      await page.waitForSelector(".file-list a[download]", { visible: true });
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS, eventsEnabled: true });
      await shot("attachments");
    });
    await step("Attachment URL returns a complete PNG response", async () => {
      const response = await page.evaluate(async () => {
        const href = document.querySelector(".file-list a[download]")?.href || "";
        const reply = await fetch(href);
        const bytes = new Uint8Array(await reply.arrayBuffer());
        return { status: reply.status, bytes: bytes.length, signature: [...bytes.slice(0, 8)], headers: Object.fromEntries(reply.headers.entries()) };
      });
      assert.equal(response.status, 200);
      assert.deepEqual(response.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
      return response;
    });
    await step("Control: Chrome completes a local data-URL download", async () => {
      await page.evaluate(() => {
        const link = document.createElement("a");
        link.id = "browser-download-control";
        link.href = "data:text/plain;base64,QnJvd3NlciBkb3dubG9hZCBjb250cm9sCg==";
        link.download = "browser-control.txt";
        link.textContent = "Browser download control";
        link.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99999;background:white;color:black";
        document.body.append(link);
      });
      try {
        downloadControl = await performDownload(page, cdp, () => page.click("#browser-download-control"), "browser-control.txt");
        result.downloads.push(downloadControl);
        return downloadControl;
      } finally {
        await page.evaluate(() => document.querySelector("#browser-download-control")?.remove());
      }
    });
    const recordDownload = (downloaded) => {
      if (downloaded.verificationStatus === "unverified") {
        assert.ok(downloadControl?.verificationStatus === "unverified", "An application download failed although the local Chrome control worked");
        return { verificationStatus: "unverified", reason: "File saving is unverified because Chrome also canceled the local control", chrome: downloaded.reason };
      }
      result.downloads.push(downloaded);
      return { filename: downloaded.filename, bytes: downloaded.bytes };
    };
    await step("Attachment downloads as a non-empty file", async () => {
      const downloaded = await performDownload(page, cdp, () => page.click(".file-list a[download]"), "Foto_Treppe.png");
      return recordDownload(downloaded);
    });
    await step("Complete message downloads as .eml", async () => {
      await page.click("[data-direct='1'][data-action='m-more']");
      await page.waitForSelector("#more-menu:not([hidden])", { visible: true });
      const downloaded = await performDownload(page, cdp, () => page.click("#more-menu [data-action='m-eml']"));
      if (!downloaded.verificationStatus) assert.ok(downloaded.filename.endsWith(".eml"), `Expected .eml, got ${downloaded.filename}`);
      return recordDownload(downloaded);
    });
  });

  await scenario("desktop-draft-save-reopen", desktop, async ({ page, step, shot }) => {
    await step("Login and open composer with keyboard shortcut", async () => {
      await authenticate(page);
      await page.keyboard.press("c");
      await page.waitForSelector(".composer:not([hidden])", { visible: true });
      const focus = await page.evaluate(() => ({
        recipient: Boolean(document.activeElement?.closest("[data-recipient='to']")),
        insideComposer: Boolean(document.activeElement?.closest(".composer")),
        scrollX: scrollX,
        scrollY: scrollY
      }));
      assert.ok(focus.recipient && focus.insideComposer, `New composer did not focus its recipient field: ${JSON.stringify(focus)}`);
      assert.deepEqual([focus.scrollX, focus.scrollY], [0, 0]);
      return focus;
    });
    await step("Fill and explicitly save a new test draft", async () => {
      await page.type("[data-recipient='to'] input", "kollege@example.com");
      await page.keyboard.press("Enter");
      await page.waitForSelector("[data-recipient='to'] .recipient-chip");
      await page.type(".composer input[name='subject']", draftSubject);
      const htmlVisible = await page.$eval(".compose-html", (node) => Boolean(node.offsetParent));
      await page.click(htmlVisible ? ".compose-html" : ".compose-plain");
      await page.keyboard.type("Dies ist ein ausgedachter Browser-Testentwurf.");
      await shot("compose-filled");
      await page.click("[data-compose='save']");
      await page.waitForFunction(() => /Gespeichert|Saved at/i.test(document.querySelector("#compose-status")?.textContent || ""), { timeout: 60_000 });
      const error = await page.$eval("#send-error", (node) => node.hidden ? "" : node.textContent || "");
      assert.equal(error, "");
      await shot("draft-saved");
      await page.click("[data-compose='close']");
      await page.waitForSelector(".composer", { hidden: true });
    });
    await step("Draft appears in Drafts and reopens with saved content", async () => {
      await page.click("[data-folder='Drafts']");
      await page.waitForFunction(() => document.querySelector("[data-folder='Drafts']")?.getAttribute("aria-current") === "page");
      await page.waitForSelector("#rows [data-uid]", { visible: true, timeout: 60_000 });
      await openMessage(page, draftSubject);
      await page.waitForSelector("[data-direct='1'][data-action='m-edit-draft']", { visible: true });
      await page.click("[data-direct='1'][data-action='m-edit-draft']");
      await page.waitForSelector(".composer:not([hidden])", { visible: true });
      const values = await page.evaluate(() => ({
        subject: document.querySelector(".composer input[name='subject']")?.value || "",
        body: document.querySelector(".composer .compose-html")?.textContent || document.querySelector(".composer .compose-plain")?.value || ""
      }));
      assert.equal(values.subject, draftSubject);
      assert.ok(values.body.includes("ausgedachter Browser-Testentwurf"), values.body);
      await shot("draft-reopened");
      await page.click("[data-compose='close']");
      await page.waitForSelector(".composer", { hidden: true });
      return values;
    });
  });

  await scenario("desktop-settings", desktop, async ({ page, step, shot }) => {
    await step("Login and open appearance settings", async () => {
      await authenticate(page);
      await openSettings(page, "look");
      await page.waitForSelector("#settings .theme-cards", { visible: true });
      await shot("settings-appearance");
    });
    await step("Design switches live between classic and Office", async () => {
      const state = () => page.evaluate(() => ({
        design: document.documentElement.dataset.design,
        sprite: document.getElementById("icon-sprite")?.dataset.set,
        symbols: document.querySelectorAll("#icon-sprite symbol").length,
        action: getComputedStyle(document.documentElement).getPropertyValue("--action").trim()
      }));
      const before = await state();
      await page.click("#settings .theme-card:has(input[name='design'][value='office'])");
      await page.waitForFunction(() => document.documentElement.dataset.design === "office");
      const office = await state();
      assert.equal(office.sprite, "office");
      assert.equal(office.symbols, before.symbols);
      assert.ok(office.symbols > 100, "the icon sprite is empty");
      await shot("settings-design-office");
      await page.click("#settings .theme-card:has(input[name='design'][value='mistral'])");
      await page.waitForFunction(() => document.documentElement.dataset.design === "mistral");
      assert.equal((await state()).sprite, "mistral");
      // Leave no stored choice behind: later scenarios follow the administrator's default again.
      await page.evaluate(() => localStorage.removeItem("sm-design"));
      return { before, office };
    });
    await step("General and folder sections render fixture data", async () => {
      await page.click("#settings [data-section='general']");
      await page.waitForSelector("#settings-panel [data-pref]", { visible: true });
      await shot("settings-general");
      await page.click("#settings [data-section='folders']");
      await page.waitForFunction(() => /inbox/i.test(document.querySelector("#settings-panel")?.textContent || ""), { timeout: 60_000 });
      const text = await page.$eval("#settings-panel", (node) => node.textContent || "");
      assert.ok(/drafts/i.test(text));
      await shot("settings-folders");
    });
    await step("Settings close without page overflow", async () => {
      await page.click("#settings [data-action='close-dialog']");
      await page.waitForSelector("#settings", { hidden: true });
      return layoutAudit(page);
    });
  });

  await scenario("desktop-logout-reauthentication", desktop, async ({ page, step, shot }) => {
    await step("Login and logout through the account menu", async () => {
      await authenticate(page);
      await page.click("[data-action='account']");
      await page.click("#account-menu [data-action='logout']");
      await page.waitForSelector(".login-card", { visible: true, timeout: 60_000 });
      const values = await page.evaluate(() => ({
        email: document.querySelector("input[name='email']")?.value,
        password: document.querySelector("input[name='password']")?.value
      }));
      assert.deepEqual(values, { email: "", password: "" });
      await shot("logged-out");
    });
    await step("The same fixture account can authenticate again", async () => {
      await authenticate(page, false);
      assert.ok(await page.$(".shell"));
      await shot("reauthenticated");
    });
  });

  await scenario("desktop-cold-warm-cache", desktop, async ({ page, cdp, result, step, shot }) => {
    await step("Measure cold authenticated startup", async () => {
      const traced = await traceScripts(cdp, () => authenticate(page));
      const metrics = await collectMetrics(page, cdp, "cold-new-browser-context-after-login");
      metrics.scriptTiming = traced.timing;
      assert.ok(metrics.scriptTiming.parseCompile.count > 0 && metrics.scriptTiming.evaluate.count > 0, "Chrome emitted no script compile/evaluate events for cold navigation");
      result.metrics.push(metrics);
      await shot("cold-mailbox");
      return metrics;
    });
    await step("Measure warm authenticated reload", async () => {
      const traced = await traceScripts(cdp, async () => {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForSelector(".shell", { visible: true, timeout: 60_000 });
        await page.waitForSelector("#rows [data-uid]", { visible: true, timeout: 60_000 });
      });
      const metrics = await collectMetrics(page, cdp, "warm-same-context-reload");
      metrics.scriptTiming = traced.timing;
      assert.ok(metrics.scriptTiming.parseCompile.count > 0 && metrics.scriptTiming.evaluate.count > 0, "Chrome emitted no script compile/evaluate events for warm navigation");
      result.metrics.push(metrics);
      await shot("warm-mailbox");
      return metrics;
    });
  });

  await scenario("desktop-memory-lifecycle", desktop, async ({ page, cdp, result, step, shot }) => {
    await cdp.send("HeapProfiler.enable");
    const measure = async (label) => {
      await cdp.send("HeapProfiler.collectGarbage");
      const metrics = await collectMetrics(page, cdp, label);
      result.metrics.push(metrics);
      return metrics;
    };
    await step("Repeated HTML/plain reads keep DOM and heap bounded after GC", async () => {
      await authenticate(page);
      await openMessage(page, "Funktionstest: HTML, Bilder, Tracking, Abmelden");
      const baseline = await measure("memory-after-initial-html-open");
      for (let index = 0; index < 24; index += 1) {
        await openMessage(page, index % 2 ? "Funktionstest: HTML, Bilder, Tracking, Abmelden" : "Rechnung 2026-1043");
      }
      await openMessage(page, "Funktionstest: HTML, Bilder, Tracking, Abmelden");
      const final = await measure("memory-after-24-additional-opens");
      assert.ok(final.cdpDocuments <= baseline.cdpDocuments + 1, `Detached documents accumulated: ${baseline.cdpDocuments} -> ${final.cdpDocuments}`);
      assert.ok(final.domNodes <= baseline.domNodes + 100, `DOM nodes accumulated: ${baseline.domNodes} -> ${final.domNodes}`);
      assert.ok(final.cdpJsHeapUsedBytes < baseline.cdpJsHeapUsedBytes * 1.5 + 1_000_000, `Unexpected retained heap growth: ${baseline.cdpJsHeapUsedBytes} -> ${final.cdpJsHeapUsedBytes}`);
      await shot("memory-repeated-open");
      return { baseline, final };
    });
    await step("Logout clears the account view and reauthentication reuses no old reader", async () => {
      await page.click("[data-action='account']");
      await page.click("#account-menu [data-action='logout']");
      await page.waitForSelector(".login-card", { visible: true, timeout: 60_000 });
      const loggedOut = await measure("memory-after-logout-gc");
      assert.equal(await page.$(".shell"), null);
      assert.equal(await page.$("iframe.letter"), null);
      await authenticate(page, false);
      const restored = await measure("memory-after-reauthentication-gc");
      assert.equal(await page.$("iframe.letter"), null);
      return { loggedOut, restored };
    });
  });

  await scenario("desktop-soak", desktop, async ({ page, cdp, result, step, shot }) => {
    await cdp.send("HeapProfiler.enable");
    const requestedMs = Number(process.env.SOAK_DURATION_MS || 1_800_000);
    const intervalMs = Number(process.env.SOAK_INTERVAL_MS || 10_000);
    assert.ok(Number.isFinite(requestedMs) && requestedMs >= 1_000 && requestedMs <= 3_600_000, "SOAK_DURATION_MS must be between 1 second and 60 minutes");
    assert.ok(Number.isFinite(intervalMs) && intervalMs >= 100 && intervalMs <= 60_000, "SOAK_INTERVAL_MS must be between 100 ms and 60 seconds");
    const started = Date.now();
    const deadline = started + requestedMs;
    result.soak = { requestedMs, intervalMs, startedAt: new Date(started).toISOString(), iterations: 0, polls: 0, navigations: 0, logins: 0 };
    const measure = async (label) => {
      await cdp.send("HeapProfiler.collectGarbage");
      const metrics = await collectMetrics(page, cdp, label);
      result.metrics.push(metrics);
      return metrics;
    };
    await step("Sustain polling, navigation, and repeated authentication for the configured soak", async () => {
      await authenticate(page);
      result.soak.logins += 1;
      await openMessage(page, "Funktionstest: Anhänge und Termin");
      const baseline = await measure("soak-start");
      while (Date.now() < deadline && result.soak.iterations < 10_000) {
        await openMessage(page, result.soak.iterations % 2 ? "Rechnung 2026-1043" : "Funktionstest: HTML, Bilder, Tracking, Abmelden");
        await openMessage(page, "Funktionstest: Anhänge und Termin");
        result.soak.navigations += 2;
        const folders = page.waitForResponse((response) => (response.request().postData() || "").includes('"Action":"Folders"'), { timeout: 60_000 });
        await page.click("[data-action='m-refresh']");
        const polled = await folders;
        const envelope = await polled.json();
        assert.equal(polled.status(), 200);
        assert.ok(envelope.Result, `Soak mailbox refresh failed: ${JSON.stringify(envelope)}`);
        await page.waitForSelector("[data-action='m-refresh']:not([disabled])", { visible: true, timeout: 60_000 });
        result.soak.polls += 1;
        if (result.soak.iterations % 5 === 4) {
          await page.click("[data-action='account']");
          await page.click("#account-menu [data-action='logout']");
          await page.waitForSelector(".login-card", { visible: true, timeout: 60_000 });
          assert.equal(await page.$("iframe.letter"), null, "Reader survived soak logout");
          await authenticate(page, false);
          result.soak.logins += 1;
        }
        result.soak.iterations += 1;
        if (result.soak.iterations % 10 === 0) {
          await measure(`soak-iteration-${result.soak.iterations}`);
          console.log(`SOAK ${result.soak.iterations} iterations, ${result.soak.logins} logins, ${Math.round((Date.now() - started) / 1000)} s elapsed`);
        }
        const waitMs = Math.min(deadline - Date.now(), Math.max(0, intervalMs - (Date.now() - started) % intervalMs));
        if (waitMs > 0) await sleep(waitMs);
      }
      const final = await measure("soak-end");
      result.soak.finishedAt = new Date().toISOString();
      result.soak.actualMs = Date.now() - started;
      assert.ok(result.soak.actualMs >= requestedMs, "Soak ended before the configured duration");
      assert.ok(final.cdpDocuments <= baseline.cdpDocuments + 1, `Soak detached documents accumulated: ${baseline.cdpDocuments} -> ${final.cdpDocuments}`);
      assert.ok(final.domNodes <= baseline.domNodes + 100, `Soak DOM nodes accumulated: ${baseline.domNodes} -> ${final.domNodes}`);
      assert.ok(final.cdpJsHeapUsedBytes < baseline.cdpJsHeapUsedBytes * 1.5 + 1_000_000, `Soak retained heap grew unexpectedly: ${baseline.cdpJsHeapUsedBytes} -> ${final.cdpJsHeapUsedBytes}`);
      await shot("soak-final");
      return result.soak;
    });
  });

  await scenario("desktop-account-switch-lifecycle", desktop, async ({ page, cdp, result, step, shot }) => {
    const other = "kollege@example.com";
    const switchTo = async (email) => {
      await openSettings(page, "accounts");
      await page.waitForSelector(`#settings [data-action='settings-switch'][data-email='${email}']`, { visible: true, timeout: 60_000 });
      const switched = page.waitForResponse((response) => (response.request().postData() || "").includes('"Action":"AccountSwitch"'), { timeout: 15_000 });
      const refreshed = page.waitForResponse((response) => new URL(response.url()).search.includes("/AppData/"), { timeout: 15_000 });
      const responses = Promise.all([switched, refreshed]);
      responses.catch(() => undefined); // Preserve a click/navigation error without an orphan rejection.
      const transition = { requested: email, switchAccount: null, switchResult: null, appDataAccount: null };
      result.accountTransitions ||= [];
      result.accountTransitions.push(transition);
      await page.click(`#settings [data-action='settings-switch'][data-email='${email}']`);
      const [response, appResponse] = await responses;
      const envelope = await response.json();
      transition.switchResult = envelope.Result;
      transition.switchAccount = envelope.Result?.Email || null;
      assert.equal(response.status(), 200);
      assert.ok(envelope.Result, `AccountSwitch to ${email} was rejected: code ${envelope.code || "unknown"}`);
      const appData = await appResponse.json();
      transition.appDataAccount = appData.Email || null;
      assert.equal(appData.Email, email, "AppData did not switch to the selected account");
      await page.waitForFunction((wanted) => (document.querySelector("[data-action='account']")?.textContent || "").includes(wanted), { timeout: 15_000 }, email);
      await page.waitForSelector("#rows", { visible: true, timeout: 60_000 });
    };
    const removeOther = async () => {
      await openSettings(page, "accounts");
      const button = await page.$(`#settings [data-action='settings-delete'][data-email='${other}']`);
      if (!button) return;
      await button.click();
      await page.waitForSelector("#confirm[open]", { visible: true });
      const deleted = page.waitForResponse((response) => (response.request().postData() || "").includes('"Action":"AccountDelete"'), { timeout: 60_000 });
      await page.click("#confirm-ok");
      assert.equal((await deleted).status(), 200);
      await page.waitForFunction((email) => !document.querySelector(`#settings [data-action='settings-delete'][data-email='${email}']`), { timeout: 60_000 }, other);
    };
    await step("Add or recover the isolated second fixture account", async () => {
      await authenticate(page);
      await openSettings(page, "accounts");
      if (!await page.$(`#settings [data-action='settings-switch'][data-email='${other}']`)) {
        await page.type("form[data-kind='save-account'] input[name='email']", other);
        await page.type("form[data-kind='save-account'] input[name='password']", PASSWORD);
        const added = page.waitForResponse((response) => (response.request().postData() || "").includes('"Action":"AccountSetup"'), { timeout: 60_000 });
        await page.click("form[data-kind='save-account'] button[type='submit']");
        assert.equal((await added).status(), 200);
      }
      await page.waitForSelector(`#settings [data-action='settings-switch'][data-email='${other}']`, { visible: true, timeout: 60_000 });
      await page.click("#settings [data-action='close-dialog']");
      await page.waitForSelector("#settings", { hidden: true, timeout: 60_000 });
    });
    let primaryError;
    try {
      await step("Switch accounts, invalidate reader state, and return to the primary account", async () => {
        await openMessage(page, "Funktionstest: HTML, Bilder, Tracking, Abmelden");
        await cdp.send("HeapProfiler.collectGarbage");
        result.metrics.push(await collectMetrics(page, cdp, "before-account-switch"));
        await switchTo(other);
        assert.equal(await page.$("iframe.letter"), null, "Previous account's reader remained mounted");
        await shot("second-account");
        await switchTo(EMAIL);
        await shot("primary-account-restored");
        await cdp.send("HeapProfiler.collectGarbage");
        result.metrics.push(await collectMetrics(page, cdp, "after-account-roundtrip"));
      });
    } catch (error) {
      primaryError = error;
    } finally {
      try {
        await step("Remove the temporary additional-account link", async () => {
          const current = await page.$eval("[data-action='account']", (node) => node.textContent || "");
          if (!current.includes(EMAIL)) await switchTo(EMAIL);
          await removeOther();
        });
      } catch (cleanupError) {
        result.cleanupError = errorText(cleanupError);
        if (!primaryError) throw cleanupError;
      }
    }
    if (primaryError) throw primaryError;
  });

  await scenario("static-cache-negotiation", desktop, async ({ page, step }) => {
    await step("Cold, warm, conditional 304, and encoding variants are consistent", async () => {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector(".login-card", { visible: true, timeout: 60_000 });
      const paths = await page.evaluate(() => [
        ...[...document.querySelectorAll("script[src]")].map((node) => node.src),
        ...[...document.querySelectorAll("link[rel='stylesheet'][href]")].map((node) => node.href)
      ]);
      assert.ok(paths.some((url) => /\/app\.js$/.test(new URL(url).pathname)));
      assert.ok(paths.some((url) => /\/app\.css$/.test(new URL(url).pathname)));
      const { request } = await import("node:http");
      const { gunzipSync } = await import("node:zlib");
      const rawGet = (url, headers = {}) => new Promise((resolve, reject) => {
        const req = request(url, { headers }, (response) => {
          const chunks = [];
          let bytes = 0;
          response.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > 2_000_000) { req.destroy(new Error("Unexpectedly large static asset")); return; }
            chunks.push(chunk);
          });
          response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
          response.on("error", reject);
        });
        req.on("error", reject);
        req.end();
      });
      const measurements = [];
      for (const url of paths) {
        const cold = await rawGet(url, { "Accept-Encoding": "gzip" });
        assert.equal(cold.status, 200);
        assert.equal(cold.headers["content-encoding"], "gzip");
        assert.match(cold.headers.vary || "", /Accept-Encoding/i);
        assert.match(cold.headers["cache-control"] || "", /max-age=\d+/);
        const etag = cold.headers.etag;
        assert.ok(etag, `ETag missing for ${new URL(url).pathname}`);
        const warm = await rawGet(url, { "Accept-Encoding": "gzip", "If-None-Match": etag });
        assert.equal(warm.status, 304, `Conditional request did not return 304 for ${url}`);
        assert.equal(warm.body.length, 0);
        assert.match(warm.headers.vary || "", /Accept-Encoding/i);
        const identity = await rawGet(url, { "Accept-Encoding": "identity" });
        assert.equal(identity.status, 200);
        assert.ok(!identity.headers["content-encoding"]);
        assert.match(identity.headers.vary || "", /Accept-Encoding/i);
        assert.deepEqual(gunzipSync(cold.body), identity.body, `Compressed and identity assets differ for ${url}`);
        assert.ok(cold.body.length < identity.body.length);
        measurements.push({ path: new URL(url).pathname, coldStatus: cold.status, warmStatus: warm.status, gzipBytes: cold.body.length, identityBytes: identity.body.length, etag, cacheControl: cold.headers["cache-control"], vary: cold.headers.vary });
      }
      return measurements;
    });
  });

  await scenario("mobile-folders-read-compose", mobile, async ({ page, step, shot }) => {
    await step("Mobile login and inbox fit the viewport", async () => {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".login-card", { visible: true, timeout: 60_000 });
      await shot("login");
      await authenticate(page, false);
      assert.equal(await page.$eval(".shell", (node) => node.dataset.pane), "list");
      await shot("inbox");
      return layoutAudit(page);
    });
    await step("Mobile folder pane opens and search returns to the list", async () => {
      await page.click("[data-action='toggle-sidebar']");
      await page.waitForFunction(() => document.querySelector(".shell")?.dataset.pane === "folders");
      await shot("folders");
      await page.click(".tabbar [data-action='pane-search']");
      await page.waitForFunction(() => document.querySelector(".shell")?.dataset.pane === "list");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "search");
    });
    await step("Mobile message reader and sandbox render", async () => {
      await openMessage(page, "Funktionstest: HTML, Bilder, Tracking, Abmelden");
      assert.equal(await page.$eval(".shell", (node) => node.dataset.pane), "reader");
      const sandbox = await page.$eval("iframe.letter", (node) => node.getAttribute("sandbox") || "");
      assert.ok(!sandbox.includes("allow-scripts"));
      await shot("message");
      return layoutAudit(page);
    });
    await step("Mobile compose focuses recipient and close restores focus without scrolling", async () => {
      await page.click(".reader .bar-navigation [data-action='back']");
      await page.waitForFunction(() => document.querySelector(".shell")?.dataset.pane === "list");
      await page.click(".tabbar [data-action='compose']");
      await page.waitForSelector(".composer:not([hidden])", { visible: true });
      const focus = await page.evaluate(() => ({
        recipient: Boolean(document.activeElement?.closest("[data-recipient='to']")),
        insideComposer: Boolean(document.activeElement?.closest(".composer")),
        scrollX: scrollX,
        scrollY: scrollY
      }));
      assert.ok(focus.recipient && focus.insideComposer, `Composer focus incorrect: ${JSON.stringify(focus)}`);
      assert.deepEqual([focus.scrollX, focus.scrollY], [0, 0]);
      await shot("compose");
      const layout = await layoutAudit(page);
      await page.click("[data-compose='close']");
      await page.waitForSelector(".composer", { hidden: true });
      const restored = await page.evaluate(() => ({
        action: document.activeElement?.getAttribute("data-action"),
        scrollX: scrollX,
        scrollY: scrollY
      }));
      assert.equal(restored.action, "compose");
      assert.deepEqual([restored.scrollX, restored.scrollY], [0, 0]);
      return { focus, layout, restored };
    });
  });

  await scenario("desktop-assistant-disabled", desktop, async ({ page, step, shot }) => {
    const setEnabled = async (enabled) => {
      const selector = "form[data-kind='assist-save'] input[name='enabled']";
      await page.waitForSelector(selector, { visible: true });
      if (await page.$eval(selector, (node) => node.checked) === enabled) return;
      await page.click(selector);
      const saved = page.waitForResponse((response) => (response.request().postData() || "").includes('"Action":"PluginAiSaveSettings"'), { timeout: 60_000 });
      await page.click("form[data-kind='assist-save'] button[type='submit']");
      assert.equal((await saved).status(), 200);
      await page.waitForFunction((wanted) => {
        const field = document.querySelector("form[data-kind='assist-save'] input[name='enabled']");
        return Boolean(field && field.checked === wanted);
      }, { timeout: 60_000 }, enabled);
    };
    await step("Login and establish the seeded assistant-enabled baseline", async () => {
      await authenticate(page);
      await openSettings(page, "assistant");
      const wasEnabled = await page.$eval("input[name='enabled']", (node) => node.checked);
      if (!wasEnabled) await setEnabled(true); // Recover from an interrupted earlier run.
      assert.equal(await page.$eval("input[name='enabled']", (node) => node.checked), true);
      return { recoveredInterruptedState: !wasEnabled };
    });
    try {
      await step("Disable assistant for this account without calling a provider", async () => {
        await setEnabled(false);
        await page.click("#settings [data-action='close-dialog']");
        await page.waitForSelector("#settings", { hidden: true });
        await openMessage(page, "Funktionstest: HTML, Bilder, Tracking, Abmelden");
        const visibleActions = await page.$$eval(".ai-action", (nodes) => nodes.filter((node) => node.offsetParent !== null && !node.hidden).length);
        assert.equal(visibleActions, 0, "Assistant controls remain visible while disabled");
        await shot("assistant-disabled-message");
      });
    } finally {
      await step("Restore the assistant-enabled fixture setting", async () => {
        await openSettings(page, "assistant");
        await setEnabled(true);
      });
    }
  });

  // Only against mock_llm.py: this scenario makes real assistant requests.
  if (process.env.BROWSER_AI_MOCK === "1") await scenario("desktop-assistant-flows", desktop, async ({ page, result, step, shot }) => {
    const first = "Funktionstest: Sie haben gewonnen";
    const second = "Funktionstest: HTML, Bilder, Tracking, Abmelden";
    const sent = [];
    page.on("request", (request) => {
      const match = /"Action":"(\w+)"/.exec(request.postData() || "");
      if (match) sent.push({ action: match[1], body: request.postData() });
    });
    const count = (action) => sent.filter((entry) => entry.action === action).length;
    const acceptConsent = async () => {
      const dialog = await page.waitForSelector("#consent[open]", { timeout: 4_000 }).catch(() => null);
      if (dialog) await page.click("#consent button[value='ok']");
    };
    const composerBody = () => page.evaluate(() => document.querySelector(".composer .compose-html:not([hidden])")?.innerText
      || document.querySelector(".composer .compose-plain")?.value || "");
    const closeComposer = async () => {
      await page.click("[data-compose='close']");
      const dialog = await page.waitForSelector("#compose-close[open]", { timeout: 2_000 }).catch(() => null);
      if (dialog) await page.$eval("#compose-close button[value='discard']", (button) => button.click());
      await page.waitForSelector(".composer", { hidden: true });
    };

    await step("A summary shows every generated field", async () => {
      await authenticate(page);
      await openMessage(page, first);
      await page.click("#strip [data-action='summarize']");
      await acceptConsent();
      await page.waitForSelector("#strip .assist-result", { visible: true, timeout: 30_000 });
      const text = await page.$eval("#strip .assist-result", (node) => node.textContent || "");
      for (const part of ["Mock-Kurzfassung", "Mock-Punkt", "Mock-Entscheidung", "Anna: Mock-Aufgabe (2026-12-01)", "Mock-Schritt"]) assert.ok(text.includes(part), `${part} missing: ${text}`);
      await shot("assistant-summary");
    });
    await step("Reopening a mail reuses the session result without a request", async () => {
      const before = count("PluginAiSummarize");
      await openMessage(page, second);
      await openMessage(page, first);
      await page.waitForSelector("#strip .assist-result", { visible: true, timeout: 10_000 });
      assert.equal(count("PluginAiSummarize"), before, "Reopening asked the provider again");
    });
    await step("A late reply suggestion never lands on another mail", async () => {
      await openMessage(page, second);
      await page.click("#strip [data-action='replies']");
      await openMessage(page, first);
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      assert.equal(await page.$("#strip .assist-replies"), null, "Suggestions for another mail were painted");
    });
    await step("A suggestion opens a real reply with quote and threading", async () => {
      await openMessage(page, second);
      await page.click("#strip [data-action='replies']").catch(() => undefined);
      await page.waitForSelector("#strip .assist-replies .prompt", { visible: true, timeout: 30_000 });
      await page.click("#strip .assist-replies .prompt");
      await page.waitForSelector(".composer:not([hidden])", { visible: true });
      const body = await composerBody();
      assert.ok(body.includes("Mock-Antwort") && /schrieb|wrote/.test(body), body);
      assert.equal(await page.$eval(".draft-tools [data-mode][aria-pressed='true']", (node) => node.dataset.mode), "reply");
      await page.click("[data-compose='save']");
      await page.waitForFunction(() => /Gespeichert|Saved at/i.test(document.querySelector("#compose-status")?.textContent || ""), { timeout: 60_000 });
      const saved = sent.filter((entry) => entry.action === "SaveMessage").pop();
      assert.ok(saved && /"inReplyTo":"[^"]+"/.test(saved.body) && /"draftInfo":\["reply/.test(saved.body), "Reply lost its threading");
    });
    await step("A generated draft replaces only the own text", async () => {
      await page.click(".draft-tools [data-action='generate']");
      await page.waitForFunction(() => /eingefügt|inserted/i.test(document.querySelector("#draft-status")?.textContent || ""), { timeout: 30_000 });
      const body = await composerBody();
      assert.ok(body.includes("Mock-Entwurf"), body);
      assert.ok(/schrieb|wrote/.test(body), `Quote was lost: ${body}`);
      assert.ok(!body.includes("Mock-Antwort"), `Old own text was kept: ${body}`);
      assert.ok(!/interne Überlegung/.test(body), body);
      // The audit forbids streaming elsewhere; here exactly this one request is expected.
      assert.equal(result.aiStreamRequests.length, 1, "Draft generation did not stream exactly once");
      result.aiStreamRequests.length = 0;
      await shot("assistant-draft");
      await closeComposer();
    });
    await step("An action from an older chat turn stays bound to that turn", async () => {
      await page.click("[data-action='open-sheet']");
      await page.waitForSelector("#ask", { visible: true });
      const ask = async (text, cards) => {
        await page.type("#ask", text);
        await page.click(".sheet-form button[type='submit']");
        await page.waitForFunction((wanted) => document.querySelectorAll("#chat-log .action").length === wanted, { timeout: 30_000 }, cards);
      };
      await ask("markiere die erste Mail", 1);
      await ask("lese die erste Mail", 2);
      const cards = await page.$$eval("#chat-log .action", (nodes) => nodes.map((node) => node.textContent || ""));
      assert.ok(/Markieren|Flag/.test(cards[0]) && /1 mail/i.test(cards[0]) && cards[0].includes("INBOX"), cards[0]);
      assert.ok(/Als gelesen|Mark as read/.test(cards[1]), cards[1]);
      await shot("assistant-chat-actions");
      await page.click("#chat-log [data-action='run-action'][data-turn='1']");
      await page.waitForFunction(() => /Erledigt|Done/.test(document.querySelector("#chat-log .action")?.textContent || ""), { timeout: 30_000 });
      assert.equal(count("MessageSetFlagged"), 1, "The older turn's action did not run");
      assert.ok(await page.$("#chat-log [data-action='run-action'][data-turn='3']"), "The newer action was consumed");
      await page.click("[data-action='close-sheet']");
    });
  });

  await scenario("admin-login-logout", desktop, async ({ page, step, shot }) => {
    if (!ADMIN_PASSWORD) {
      report.unverified.push({ scenario: "admin-login-logout", reason: "ADMIN_PASSWORD was not supplied" });
      const entry = { name: "Admin fixture login", status: "unverified", reason: "ADMIN_PASSWORD was not supplied" };
      report.scenarios.find((item) => item.name === "admin-login-logout").steps.push(entry);
      return;
    }
    await step("Admin fixture accepts generated password and renders settings", async () => {
      await page.goto(`${BASE_URL}?admin`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector(".login-card input[name='login']", { visible: true, timeout: 60_000 });
      await page.type("input[name='login']", "admin");
      await page.type("input[name='password']", ADMIN_PASSWORD.trim());
      await page.click(".login-card button[type='submit']");
      await page.waitForSelector("main.admin #admin-slot", { visible: true, timeout: 60_000 });
      await page.waitForFunction(() => (document.querySelector("#admin-slot")?.textContent || "").trim().length > 20, { timeout: 60_000 });
      await shot("general");
    });
    await step("Admin domain section renders and logout returns to login", async () => {
      await page.click("main.admin [data-section='domains']");
      await page.waitForFunction(() => (document.querySelector("#admin-slot")?.textContent || "").includes("example.com"), { timeout: 60_000 });
      await shot("domains");
      await page.click("main.admin [data-action='logout']");
      await page.waitForSelector(".login-card input[name='login']", { visible: true, timeout: 60_000 });
    });
  });

  await scenario("global-plugin-disabled", desktop, async ({ page, result, step, shot }) => {
    const adminLogin = async () => {
      await page.goto(`${BASE_URL}?admin`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector(".login-card input[name='login'], main.admin #admin-slot", { visible: true, timeout: 60_000 });
      if (await page.$(".login-card input[name='login']")) {
        if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is required for the global plugin-disabled scenario");
        await page.type("input[name='login']", "admin");
        await page.type("input[name='password']", ADMIN_PASSWORD.trim());
        await page.click(".login-card button[type='submit']");
      }
      await page.waitForSelector("main.admin #admin-slot", { visible: true, timeout: 60_000 });
      await page.click("main.admin [data-section='packages']");
      await page.waitForSelector("#package-lists [data-action='toggle'][data-id='ai-copilot']", { visible: true, timeout: 60_000 });
    };
    const setPlugin = async (disabled) => {
      const selector = "#package-lists [data-action='toggle'][data-id='ai-copilot']";
      const enabled = await page.$eval(selector, (node) => node.dataset.enabled === "1");
      if (enabled === !disabled) return;
      const saved = page.waitForResponse((response) => (response.request().postData() || "").includes('"Action":"AdminPluginDisable"'), { timeout: 60_000 });
      await page.click(selector);
      const response = await saved;
      const envelope = await response.json();
      assert.equal(response.status(), 200);
      assert.equal(envelope.Result, true, "Admin plugin toggle was rejected");
      await page.waitForSelector(`${selector}[data-enabled='${disabled ? "0" : "1"}']`, { visible: true, timeout: 60_000 });
    };
    await step("Establish the assistant-enabled mailbox baseline", async () => {
      await authenticate(page);
      await openMessage(page, "Funktionstest: HTML, Bilder, Tracking, Abmelden");
      assert.ok(await page.$(".ai-action"), "Assistant baseline is unavailable");
    });
    await step("Disable ai-copilot through the real admin package action", async () => {
      await adminLogin();
      await setPlugin(true);
      await shot("plugin-disabled-admin");
    });
    let disabled = true;
    try {
      await step("Global disable removes assistant UI without any AI calls", async () => {
        await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await authenticate(page, false);
        await page.waitForSelector(".shell", { visible: true, timeout: 60_000 });
        await openMessage(page, "Funktionstest: HTML, Bilder, Tracking, Abmelden");
        assert.equal(await page.$$eval(".ai-action", (nodes) => nodes.length), 0);
        await openSettings(page);
        assert.equal(await page.$eval("#settings [data-section='assistant']", (node) => node.hidden || node.offsetParent === null), true);
        await page.click("#settings [data-action='close-dialog']");
        await shot("plugin-disabled-mailbox");
        assert.deepEqual(result.aiStreamRequests, []);
      });
    } finally {
      await step("Restore the global ai-copilot fixture through admin", async () => {
        await adminLogin();
        await setPlugin(false);
        disabled = false;
        await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await authenticate(page, false);
        await openSettings(page);
        assert.ok(await page.$("#settings [data-section='assistant']"), "Assistant capability was not restored");
        await shot("plugin-restored-mailbox");
      });
    }
    assert.equal(disabled, false, "Global plugin fixture was not restored");
  });
} catch (error) {
  report.fatalError = errorText(error);
  console.error(report.fatalError);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.scenarios.filter((item) => item.status === "passed").length,
    failed: report.scenarios.filter((item) => item.status === "failed").length,
    unverified: report.scenarios.filter((item) => item.status === "unverified").length,
    unverifiedSteps: report.scenarios.flatMap((item) => item.steps.filter((step) => step.status === "unverified").map((step) => ({ scenario: item.name, step: step.name, reason: step.reason })))
  };
  const reportPath = path.join(SHOTS, "browser-results.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Results: ${reportPath}`);
  console.log(JSON.stringify(report.summary));
  if (report.fatalError || report.summary.failed) process.exitCode = 1;
}
