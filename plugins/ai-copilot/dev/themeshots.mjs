// Screenshots der Kernansichten in einem Theme, ohne KI-Aufrufe (puppeteer-core noetig).
// Aufruf: node themeshots.mjs <Theme> [Theme ...]   z. B. node themeshots.mjs Slate SlateDark Default
// Theme-Name wie in Einstellungen > Themes angezeigt (CamelCase wird getrennt: SlateDark -> "Slate Dark").
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const OUT = new URL('./shots/themes/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
fs.mkdirSync(OUT, {recursive: true});
const themes = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!themes.length) {
	console.log('Theme angeben, z. B. node themeshots.mjs Slate SlateDark');
	process.exit(1);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'http://localhost:8888/';

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
// Fehlerhafte Antworten mit Pfad (ohne Query, darin koennen Token stehen)
page.on('response', r => r.status() >= 400 && logs.push(`[http ${r.status()}] ${r.url().split('?')[0]}${r.url().includes('?') ? '?' + r.url().split('?')[1].split('/').slice(0, 3).join('/') : ''}`));

// Nur Anmeldeseite (Theme kommt aus webmail.theme der Konfiguration): node themeshots.mjs --login <Name>
if ('--login' === process.argv[2]) {
	const ctx = await browser.createBrowserContext();
	const p = await ctx.newPage();
	await p.setViewport({width: 1500, height: 950});
	await p.goto(BASE, {waitUntil: 'networkidle2'});
	await sleep(1500);
	await p.screenshot({path: `${OUT}login-${process.argv[3] || 'theme'}.png`});
	await p.setViewport({width: 390, height: 844, isMobile: true});
	await sleep(800);
	await p.screenshot({path: `${OUT}login-${process.argv[3] || 'theme'}-mobile.png`});
	console.log('Login-Screenshots gespeichert');
	await browser.close();
	process.exit(0);
}
page.on('dialog', d => d.accept());

let prefix = '';
const shot = async name => {
	const f = `${OUT}${prefix}-${name}.png`;
	await page.screenshot({path: f});
	console.log('screenshot', f);
};
const clickText = async (sel, text) => {
	const ok = await page.evaluate((sel, text) => {
		const el = [...document.querySelectorAll(sel)].find(e => e.offsetParent && e.textContent.includes(text));
		el && el.click();
		return !!el;
	}, sel, text);
	if (!ok) throw new Error('nicht gefunden: ' + sel + ' ' + text);
};
const toList = async () => {
	await page.goto(BASE + '#/mailbox/INBOX', {waitUntil: 'networkidle2'});
	await page.waitForSelector('.messageListItem', {timeout: 30000});
	await sleep(1200);
};
const closeDialogs = async () => {
	await page.keyboard.press('Escape');
	await sleep(500);
};

try {
	await page.goto(BASE, {waitUntil: 'networkidle2'});
	if (await page.evaluate(() => !!document.querySelector('input[name=Email]')?.offsetParent)) {
		await page.type('input[name=Email]', 'test@example.com');
		await page.type('input[name=Password]', 'test1234');
		await page.click('.buttonLogin');
	}
	await page.waitForSelector('.messageListItem', {timeout: 30000});
	await sleep(1500);
	if (await page.evaluate(() => !!document.querySelector('#V-PopupsIdentity')?.open)) {
		await page.type('#V-PopupsIdentity input[type=text]', 'Test Nutzer');
		await clickText('#V-PopupsIdentity button, #V-PopupsIdentity .btn', 'Speichern');
		await sleep(1500);
	}

	for (const theme of themes) {
		prefix = theme.toLowerCase();
		const display = theme.replace(/([A-Z])/g, ' $1').trim();
		console.log('=== ' + theme);
		await page.setViewport({width: 1500, height: 950});

		// Theme setzen
		await page.goto(BASE + '#/settings/themes', {waitUntil: 'networkidle2'});
		await page.waitForSelector('figure figcaption', {timeout: 15000});
		const found = await page.evaluate(display => {
			const f = [...document.querySelectorAll('figure')].find(f => f.querySelector('figcaption')?.textContent.trim() === display);
			f && f.click();
			return !!f;
		}, display);
		if (!found) throw new Error('Theme nicht in der Liste: ' + display);
		await page.waitForFunction(t => (document.getElementById('app-theme-style')?.dataset.name || '').replace(/@[a-z]+$/, '') === t, {timeout: 15000}, theme)
			.catch(() => console.log('Hinweis: data-name nicht aktualisiert, weiter nach Wartezeit'));
		await sleep(2000);
		await shot('01-settings-themes');

		await page.goto(BASE + '#/settings/general', {waitUntil: 'networkidle2'});
		await sleep(1500);
		await shot('02-settings-general');

		// Liste
		await toList();
		await shot('03-list');

		// Tastaturfokus
		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		await sleep(300);
		await shot('04-focus');

		// Mails oeffnen (Testmails aus seed.py --theme-mails, sonst die erste)
		const openMail = async (re, name) => {
			const opened = await page.evaluate(src => {
				const items = [...document.querySelectorAll('.messageListItem')];
				const el = items.find(i => new RegExp(src).test(i.textContent)) || items[0];
				el?.querySelector('.subjectParent')?.click();
				return el?.querySelector('.subjectParent')?.textContent.trim();
			}, re);
			console.log('geoeffnet:', opened);
			await sleep(2500);
			await shot(name);
		};
		await openMail('HTML-Newsletter', '05-message-html');
		await openMail('Sehr langer Betreff', '05b-message-attachments');
		await openMail('Protokoll Baubesprechung', '05c-message-text');

		// Dropdown
		await page.click('#top-system-dropdown-id').catch(() => 0);
		await sleep(600);
		await shot('06-dropdown');
		await closeDialogs();

		// Verfassen
		await page.evaluate(() => rl.app.showMessageComposer());
		await page.waitForSelector('#V-PopupsCompose', {visible: true, timeout: 15000});
		await sleep(1200);
		await page.type('#V-PopupsCompose .emailaddresses input', 'kunde@example.com,');
		await sleep(400);
		await shot('07-compose');
		await page.evaluate(() => {
			const d = document.getElementById('V-PopupsCompose');
			d?.querySelector('header .close')?.click();
		});
		await sleep(1000);
		await page.evaluate(() => document.querySelector('dialog[open] footer .btn')?.click());
		await sleep(800);

		// Kontakte (nur wenn in der Konfiguration erlaubt)
		if (await page.evaluate(() => { const b = document.querySelector('.buttonContacts'); b?.offsetParent && b.click(); return !!b?.offsetParent; })) {
			await sleep(2000);
			await shot('08-contacts');
			await closeDialogs();
		}

		// Bestaetigungsdialog (Ordner anlegen)
		await page.goto(BASE + '#/settings/folders', {waitUntil: 'networkidle2'});
		await sleep(1500);
		await shot('09-settings-folders');
		await clickText('.btn', 'Ordner').catch(() => 0);
		await sleep(800);
		await shot('10-dialog');
		await closeDialogs();

		// Mobil
		await toList();
		await page.setViewport({width: 390, height: 844, isMobile: true});
		await sleep(1500);
		await shot('11-mobile-list');
		await page.evaluate(() => document.querySelector('.messageListItem .subjectParent')?.click());
		await sleep(2000);
		await shot('12-mobile-message');
	}
} catch (e) {
	console.log('FEHLER:', e.message);
	await shot('zz-error').catch(() => 0);
} finally {
	console.log('Konsole:', logs.length ? '\n' + logs.join('\n') : 'keine Fehler');
	await browser.close();
}
