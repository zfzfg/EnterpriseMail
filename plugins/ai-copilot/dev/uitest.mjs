// UI-Smoke-Test fuer ai-copilot (puppeteer-core noetig: npm i puppeteer-core).
// Aufruf: node uitest.mjs open summary quick usequick closecompose compose draft closecompose search tabs sidebar chat chataction chatreply settings mobile
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
fs.mkdirSync(OUT, {recursive: true});
const steps = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
	headless: true,
	args: ['--lang=de-DE', '--window-size=1500,950'],
	defaultViewport: {width: 1500, height: 950}
});
const page = await browser.newPage();
const logs = [];
page.on('console', m => {
	const t = m.type();
	if (['error', 'warning'].includes(t) && !/Undefined MessageModel/.test(m.text())) logs.push(`[${t}] ${m.text()}`);
});
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('dialog', d => d.accept());

const shot = async name => {
	await page.screenshot({path: OUT + name + '.png'});
	console.log('screenshot', OUT + name + '.png');
};
const clickText = async (sel, text) => {
	const ok = await page.evaluate((sel, text) => {
		const el = [...document.querySelectorAll(sel)].find(e => e.offsetParent && e.textContent.includes(text));
		el && el.click();
		return !!el;
	}, sel, text);
	if (!ok) throw new Error('nicht gefunden: ' + sel + ' ' + text);
};
const waitGone = async (sel, timeout = 120000) => page.waitForFunction(s => {
	const el = document.querySelector(s);
	return !el || !el.offsetParent;
}, {timeout}, sel);

try {
	await page.goto('http://localhost:8888/', {waitUntil: 'networkidle2'});
	const needLogin = await page.$('input[name=Email]');
	if (needLogin && await page.evaluate(() => !!document.querySelector('input[name=Email]')?.offsetParent)) {
		await page.type('input[name=Email]', 'test@example.com');
		await page.type('input[name=Password]', 'test1234');
		await page.click('.buttonLogin');
	}
	await page.waitForSelector('.messageListItem', {timeout: 30000});
	await sleep(1500);
	// Erstanmeldung: Identitaet benennen
	if (await page.evaluate(() => !!document.querySelector('#V-PopupsIdentity')?.open)) {
		await page.type('#V-PopupsIdentity input[type=text]', 'Test Nutzer');
		await clickText('#V-PopupsIdentity button, #V-PopupsIdentity .btn', 'Speichern');
		await sleep(1500);
	}
	await shot('01-list');

	for (const step of steps) {
		console.log('--- ' + step);
		if ('ack' === step) {
			// Hinweis vorab bestaetigen, damit keine Dialoge stoeren
			await page.evaluate(() => new Promise(r => rl.pluginRemoteRequest(() => r(), 'AiSaveSettings', {settings: {notice_ack: true}})));
			await page.reload({waitUntil: 'networkidle2'});
			await page.waitForSelector('.messageListItem', {timeout: 30000});
			await sleep(1500);
		} else if ('open' === step) {
			await clickText('.messageListItem .subjectParent', 'Re: Anfrage Geländer');
			await page.waitForSelector('.ai-msg-bar', {visible: true, timeout: 15000});
			await sleep(1000);
			await shot('02-message');
		} else if ('summary' === step) {
			await clickText('.ai-msg-bar button', 'Zusammenfassen');
			await page.waitForFunction(() => document.querySelector('.ai-summary .ai-tldr')?.offsetParent || document.querySelector('.ai-summary .ai-error')?.textContent, {timeout: 120000});
			await sleep(500);
			await shot('03-summary');
		} else if ('quick' === step) {
			await clickText('.ai-msg-bar button', 'Antwortvorschläge');
			await page.waitForFunction(() => document.querySelectorAll('.ai-reply-card').length || document.querySelector('.ai-quick .ai-error')?.textContent, {timeout: 120000});
			await sleep(500);
			await shot('04-quick');
		} else if ('usequick' === step) {
			await page.click('.ai-reply-card');
			await page.waitForSelector('#V-PopupsCompose', {visible: true, timeout: 15000});
			await sleep(2500);
			await shot('05-compose-quick');
		} else if ('compose' === step) {
			await page.click('.buttonCompose, a.buttonCompose').catch(() => 0);
			await page.evaluate(() => rl.app.showMessageComposer([0]));
			await page.waitForSelector('.ai-compose-bar', {visible: true, timeout: 15000});
			await sleep(1000);
			await shot('06-compose');
		} else if ('draft' === step) {
			await clickText('.ai-compose-bar button', 'KI-Entwurf');
			await page.waitForSelector('.ai-draft', {visible: true, timeout: 10000});
			await page.type('textarea.ai-instruction', 'Lieferant bitten, die Lieferung Flachstahl auf Mittwoch nächste Woche zu verschieben');
			await shot('07-draft-popup');
			await clickText('.ai-draft ~ footer button, footer button', 'Erzeugen');
			await page.waitForFunction(() => {
				const ta = document.querySelector('.ai-output');
				const busy = [...document.querySelectorAll('footer button')].some(b => b.offsetParent && /Stopp/.test(b.textContent));
				return (ta && ta.value.length > 40 && !busy) || document.querySelector('.ai-draft .ai-error')?.textContent;
			}, {timeout: 120000});
			await sleep(500);
			await shot('08-draft-result');
			await clickText('footer button.btn-success', 'Übernehmen');
			await sleep(1500);
			await shot('09-draft-applied');
		} else if ('closecompose' === step) {
			await page.evaluate(() => { const vm = window.AiCopilot.composeVm; vm && vm.close(); });
			await sleep(800);
		} else if ('search' === step) {
			await page.click('.inputSearch');
			await page.type('.inputSearch', 'Rechnungen der letzten 30 Tage');
			await page.click('.ai-search-btn');
			await sleep(500);
			await page.waitForFunction(() => !document.querySelector('.ai-search-btn.ai-busy'), {timeout: 120000});
			await sleep(2500);
			await shot('10-search');
		} else if ('tabs' === step) {
			await page.evaluate(() => rl.app.messageList.mainSearch(''));
			await sleep(1500);
			await clickText('.ai-tab', 'Antwort nötig');
			await sleep(3000);
			await shot('11-tab-needs-reply');
			await clickText('.ai-tab', 'Alle');
			await sleep(2000);
		} else if ('sidebar' === step) {
			await page.click('.ai-sidebar-toggle');
			await page.waitForSelector('#ai-sidebar', {visible: true, timeout: 10000});
			await page.waitForFunction(() => !document.querySelector('.ai-sb-alerts .ai-loading')?.offsetParent, {timeout: 60000});
			await sleep(800);
			await shot('12-sidebar');
		} else if ('chat' === step) {
			await page.type('.ai-chat-input textarea', 'Welche Mails warten auf meine Antwort?');
			await page.click('.ai-chat-input .btn');
			await page.waitForFunction(() => document.querySelectorAll('.ai-chat-assistant').length, {timeout: 180000});
			await sleep(800);
			await shot('13-chat');
		} else if ('chataction' === step) {
			const before = await page.evaluate(() => document.querySelectorAll('.ai-chat-assistant').length);
			await page.type('.ai-chat-input textarea', 'Archiviere den Newsletter.');
			await page.click('.ai-chat-input .btn');
			await page.waitForFunction(n => document.querySelectorAll('.ai-chat-assistant').length > n, {timeout: 180000}, before);
			await sleep(500);
			await shot('14-chat-action');
			// Aktion ausfuehren
			const ran = await page.evaluate(() => {
				const b = [...document.querySelectorAll('.ai-action .btn-success')].pop();
				b && b.click();
				return !!b;
			});
			console.log('Aktion geklickt:', ran);
			await sleep(3000);
			await shot('14b-chat-action-done');
		} else if ('chatreply' === step) {
			const before = await page.evaluate(() => document.querySelectorAll('.ai-chat-assistant').length);
			await page.type('.ai-chat-input textarea', 'Antworte dem Kollegen, dass ich am Donnerstag mitkomme und den Akkuschrauber mitbringe.');
			await page.click('.ai-chat-input .btn');
			await page.waitForFunction(n => document.querySelectorAll('.ai-chat-assistant').length > n, {timeout: 180000}, before);
			await sleep(500);
			await shot('18-chat-reply');
			const ran = await page.evaluate(() => {
				const card = [...document.querySelectorAll('.ai-action')].pop();
				const b = card?.querySelector('.btn-success');
				b && b.click();
				return card?.textContent.trim().slice(0, 80);
			});
			console.log('Aktion:', ran);
			await page.waitForSelector('.ai-draft', {visible: true, timeout: 30000});
			await page.waitForFunction(() => {
				const ta = document.querySelector('.ai-output');
				const busy = [...document.querySelectorAll('footer button')].some(b => b.offsetParent && /Stopp/.test(b.textContent));
				return (ta && ta.value.length > 30 && !busy) || document.querySelector('.ai-draft .ai-error')?.textContent;
			}, {timeout: 120000});
			await sleep(500);
			await shot('19-chat-reply-draft');
			await clickText('footer button.btn-success', 'Übernehmen');
			await sleep(1500);
			await shot('20-chat-reply-compose');
		} else if ('settings' === step) {
			await page.goto('http://localhost:8888/#/settings/ai-copilot', {waitUntil: 'networkidle2'});
			await sleep(2000);
			await shot('15-settings');
		} else if ('mobile' === step) {
			await page.setViewport({width: 390, height: 844, isMobile: true});
			await sleep(1500);
			await shot('16-mobile');
			await page.evaluate(() => AiCopilot.sidebar.open(true));
			await sleep(800);
			await shot('16b-mobile-sidebar');
			await page.evaluate(() => AiCopilot.sidebar.open(false));
		} else if ('dark' === step) {
			await page.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'dark'}]);
			await sleep(800);
			await shot('17-dark');
		}
	}
} catch (e) {
	console.log('FEHLER:', e.message);
	await shot('zz-error').catch(() => 0);
} finally {
	console.log('Konsole:', logs.length ? '\n' + logs.join('\n') : 'keine Fehler');
	await browser.close();
}
