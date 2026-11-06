/* AI Copilot: Seitenleiste mit Chat, Hinweisen und bestaetigungspflichtigen Aktionen */
(rl => {
	if (!rl || rl.adminArea()) return;
	const AI = window.AiCopilot, I = AI.ICONS, t = AI.i18n;

	const STORE_KEY = 'ai-copilot-sidebar';
	const store = {
		get: () => { try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; } },
		set: v => { try { localStorage.setItem(STORE_KEY, v); } catch (e) { /* egal */ } }
	};

	const remote = (action, params) => new Promise((resolve, reject) =>
		rl.app.Remote.request(action, (iError, oData) => iError
			? reject(new Error(oData?.messageAdditional || oData?.message || (t('ERROR_REQUEST', 'Anfrage fehlgeschlagen') + ' (' + iError + ')')))
			: resolve(oData?.Result), params));

	const waitFor = (fn, timeout = 8000) => new Promise((resolve, reject) => {
		const start = Date.now();
		const tick = () => {
			if (fn()) resolve();
			else if (Date.now() - start > timeout) reject(new Error(t('ERROR_TIMEOUT', 'Zeitüberschreitung. Bitte erneut versuchen.')));
			else setTimeout(tick, 150);
		};
		tick();
	});

	const ACTION_ICONS = {
		archive: I.check, delete: I.close, mark_read: I.mail, mark_unread: I.mail, flag: I.tag, unflag: I.tag,
		move: I.mail, open: I.mail, reply: I.replies, compose: I.edit, search: I.search
	};

	class Sidebar {
		constructor() {
			this.open = ko.observable('1' === store.get());
			this.messages = ko.observableArray();
			this.input = ko.observable('');
			this.busy = ko.observable(false);
			this.useContext = ko.observable(true);
			this.contextMsg = ko.observable(null);
			this.alerts = ko.observableArray();
			this.alertsBusy = ko.observable(false);
			this.alertsError = ko.observable('');
			this.alertsLoaded = ko.observable(false);
			this.alertsOpen = ko.observable(true);
			this.dueBusy = ko.observable(false);

			this.chatOn = ko.computed(() => AI.on('chat'));
			this.alertsOn = ko.computed(() => AI.on('alerts'));
			this.visible = ko.computed(() => this.open() && (this.chatOn() || this.alertsOn()));
			this.providerLabel = ko.computed(() => AI.providerLabel('chat'));
			this.contextLabel = ko.computed(() => {
				const m = this.contextMsg();
				return m ? (m.subject?.() || t('NO_SUBJECT', '(ohne Betreff)')) : '';
			});

			this.visible.subscribe(v => {
				this.el && (this.el.hidden = !v);
				document.documentElement.classList.toggle('ai-sidebar-open', !!v);
				v && this.alertsOn() && !this.alertsLoaded() && this.refreshAlerts();
			});
			this.open.subscribe(v => store.set(v ? '1' : '0'));
		}

		toggle() { this.open(!this.open()); }
		toggleAlerts() { this.alertsOpen(!this.alertsOpen()); }
		close() { this.open(false); }

		openWithContext(message) {
			this.open(true);
			if (message) {
				this.contextMsg(message);
				this.useContext(true);
			}
			setTimeout(() => this.el?.querySelector('.ai-chat-input textarea')?.focus(), 100);
		}

		clearContext() { this.useContext(false); }
		clearChat() { this.messages([]); }

		keydown(data, ev) {
			if ('Enter' === ev.key && !ev.shiftKey && !ev.isComposing) {
				ev.preventDefault();
				this.send();
				return false;
			}
			return true;
		}

		history() {
			return this.messages()
				.filter(m => !m.error && ('user' === m.role || 'assistant' === m.role) && m.text)
				.map(m => ({role: m.role, content: m.text}));
		}

		send() {
			const text = this.input().trim();
			if (!text || this.busy()) return;
			const ctx = this.useContext() ? this.contextMsg() : null;
			AI.consent('chat').then(() => {
				this.messages.push({role: 'user', text: text, html: AI.renderText(text), actions: ko.observableArray(), trace: []});
				this.input('');
				this.busy(true);
				this.scroll();
				AI.request('AiChat', {
					messages: this.history(),
					context: ctx ? {folder: ctx.folder, uid: ctx.uid} : {},
					folders: AI.folders(),
					sent: AI.systemFolder(2)
				}, 180000)
					.then(r => {
						this.messages.push({
							role: 'assistant',
							text: r.reply || '',
							html: AI.renderText(r.reply || ''),
							actions: ko.observableArray((r.actions || []).map(a => Object.assign({
								state: ko.observable(''), // '', 'running', 'done', 'dismissed', 'error'
								stateText: ko.observable(''),
								icon: ACTION_ICONS[a.type] || I.check
							}, a))),
							trace: r.trace || []
						});
					})
					.catch(err => this.messages.push({role: 'assistant', error: true, text: err.message, html: AI.esc(err.message), actions: ko.observableArray(), trace: []}))
					.finally(() => {
						this.busy(false);
						this.scroll();
					});
			}).catch(() => 0);
		}

		scroll() {
			setTimeout(() => {
				const log = this.el?.querySelector('.ai-chat-log');
				log && (log.scrollTop = log.scrollHeight);
			}, 30);
		}

		dismissAction(action) {
			action.state('dismissed');
		}

		runAction(action) {
			if (action.state()) return;
			const destructive = 'delete' === action.type;
			const go = () => {
				action.state('running');
				this.exec(action)
					.then(msg => {
						action.state('done');
						action.stateText(msg || t('ACTION_DONE', 'Erledigt'));
					})
					.catch(err => {
						action.state('error');
						action.stateText(err.message);
					});
			};
			if (destructive) {
				AI.confirm(t('CONFIRM_DELETE', 'Wirklich löschen?') + ' (' + (action.uids || []).length + ')').then(ok => ok && go());
			} else {
				go();
			}
		}

		exec(a) {
			const list = rl.app.messageList, uids = (a.uids || []).join(','), reload = () => list.reload(false, true);
			switch (a.type) {
				case 'archive': {
					const to = AI.systemFolder(6);
					if (!to) return Promise.reject(new Error(t('NO_ARCHIVE', 'Kein Archiv-Ordner eingerichtet.')));
					return remote('MessageMove', {fromFolder: a.folder, toFolder: to, uids: uids}).then(reload);
				}
				case 'delete': {
					const trash = AI.systemFolder(5);
					return (trash && trash !== a.folder
						? remote('MessageMove', {fromFolder: a.folder, toFolder: trash, uids: uids})
						: remote('MessageDelete', {folder: a.folder, uids: uids})).then(reload);
				}
				case 'move':
					return remote('MessageMove', {fromFolder: a.folder, toFolder: a.to, uids: uids}).then(reload);
				case 'mark_read':
				case 'mark_unread':
					return remote('MessageSetSeen', {folder: a.folder, uids: uids, setAction: 'mark_read' === a.type ? 1 : 0}).then(reload);
				case 'flag':
				case 'unflag':
					return remote('MessageSetFlagged', {folder: a.folder, uids: uids, setAction: 'flag' === a.type ? 1 : 0}).then(reload);
				case 'open':
					AI.openMessage(a.folder, a.uid);
					return Promise.resolve(t('OPENED', 'Geöffnet'));
				case 'search':
					AI.setSearch(a.search, a.folder);
					return Promise.resolve(t('SEARCHED', 'Suche gesetzt'));
				case 'compose':
					AI.compose({to: a.to, subject: a.subject, draft: {mode: 'new', instruction: a.instruction || '', autostart: !!a.instruction}});
					return Promise.resolve(t('COMPOSE_OPENED', 'Entwurf geöffnet'));
				case 'reply': {
					AI.openMessage(a.folder, a.uid);
					const mv = AI.messageVm;
					return waitFor(() => {
						const m = mv?.message?.();
						return m && m.folder === a.folder && m.uid == a.uid && mv.messageVisible?.() && !mv.messageLoadingThrottle?.();
					}).then(() => {
						AI.compose({message: mv.message(), draft: {mode: 'reply', instruction: a.instruction || '', autostart: true}});
						return t('COMPOSE_OPENED', 'Entwurf geöffnet');
					});
				}
			}
			return Promise.reject(new Error('?'));
		}

		/* ---------- Hinweise ---------- */

		refreshAlerts() {
			if (this.alertsBusy()) return;
			this.alertsBusy(true);
			this.alertsError('');
			AI.request('AiAlerts', {inbox: AI.systemFolder(1) || 'INBOX', sent: AI.systemFolder(2)}, 90000)
				.then(r => {
					this.alerts((r.alerts || []).map(a => Object.assign({due: ko.observable(''), dueTitle: ko.observable('')}, a)));
					this.alertsLoaded(true);
				})
				.catch(err => this.alertsError(err.message))
				.finally(() => this.alertsBusy(false));
		}

		openAlert(alert) {
			AI.openMessage(alert.folder, alert.uid);
		}

		alertIcon(alert) {
			return {reply: I.replies, followup: I.clock, invoice: I.invoice}[alert.type] || I.bell;
		}

		checkDue() {
			const items = this.alerts().filter(a => 'followup' !== a.type).slice(0, 8).map(a => ({folder: a.folder, uid: a.uid}));
			if (!items.length || this.dueBusy()) return;
			AI.consent('default').then(() => {
				this.dueBusy(true);
				AI.request('AiAlertsLlm', {items: items}, 120000)
					.then(r => (r.alerts || []).forEach(x => {
						const a = this.alerts().find(y => y.uid === x.uid && y.folder === x.folder);
						if (a) {
							a.dueTitle(x.title || '');
							a.due(x.due || '');
						}
					}))
					.catch(err => this.alertsError(err.message))
					.finally(() => this.dueBusy(false));
			}).catch(() => 0);
		}

		formatDate(ts) {
			if (!ts) return '';
			try { return new Date(ts * 1000).toLocaleDateString(); } catch (e) { return ''; }
		}

		mount() {
			const host = document.getElementById('rl-content');
			if (!host || this.el) return;
			const tpl = document.createElement('template');
			tpl.id = 'AiCopilotSidebar';
			tpl.innerHTML = `
	<header class="ai-sb-head">
		${I.sparkle}<strong>Copilot</strong>
		<span class="ai-muted ai-sb-provider" data-bind="text: providerLabel"></span>
		<span class="ai-spacer"></span>
		<button type="button" class="btn btn-small btn-transparent" data-bind="visible: chatOn() && messages().length, click: clearChat" title="${AI.esc(t('CLEAR_CHAT', 'Chat leeren'))}">${I.refresh}</button>
		<button type="button" class="btn btn-small btn-transparent" data-bind="click: close" title="${AI.esc(t('CLOSE', 'Schließen'))}">${I.close}</button>
	</header>

	<section class="ai-sb-alerts" data-bind="visible: alertsOn">
		<div class="ai-sb-section-head">
			<button type="button" class="ai-link" data-bind="click: toggleAlerts">${I.bell}<span>${AI.esc(t('ALERTS', 'Hinweise'))}</span>
				<span class="ai-count" data-bind="visible: alerts().length, text: alerts().length"></span></button>
			<span class="ai-spacer"></span>
			<button type="button" class="btn btn-small btn-transparent" data-bind="click: checkDue, visible: alerts().length && alertsOpen(), enable: !dueBusy()"
				title="${AI.esc(t('CHECK_DUE_HINT', 'Fristen und Fälligkeiten mit KI aus den Mails lesen'))}">${I.sparkle}</button>
			<button type="button" class="btn btn-small btn-transparent" data-bind="click: refreshAlerts, enable: !alertsBusy()" title="${AI.esc(t('REFRESH', 'Aktualisieren'))}">${I.refresh}</button>
		</div>
		<div data-bind="visible: alertsOpen">
			<div class="ai-loading" data-bind="visible: alertsBusy() || dueBusy()"><span class="ai-spinner"></span><span>${AI.esc(t('WORKING', 'Wird erstellt …'))}</span></div>
			<div class="ai-error" data-bind="visible: alertsError, text: alertsError"></div>
			<div class="ai-muted ai-empty" data-bind="visible: alertsLoaded() && !alertsBusy() && !alerts().length">${AI.esc(t('NO_ALERTS', 'Keine offenen Punkte.'))}</div>
			<ul class="ai-alert-list" data-bind="foreach: alerts">
				<li class="ai-alert" data-bind="click: $root.openAlert.bind($root), attr: {'data-type': type}">
					<span class="ai-alert-icon" data-bind="html: $root.alertIcon($data)"></span>
					<span class="ai-alert-body">
						<span class="ai-alert-title" data-bind="text: title"></span>
						<span class="ai-alert-sub" data-bind="text: subtitle"></span>
						<span class="ai-alert-detail" data-bind="text: detail"></span>
						<span class="ai-alert-due" data-bind="visible: dueTitle, text: dueTitle() + (due() ? ' · ' + due() : '')"></span>
					</span>
				</li>
			</ul>
		</div>
	</section>

	<section class="ai-sb-chat" data-bind="visible: chatOn">
		<div class="ai-chat-log">
			<div class="ai-muted ai-empty" data-bind="visible: !messages().length">${AI.esc(t('CHAT_EMPTY', 'Fragen Sie zum Beispiel: „Welche Mails warten auf meine Antwort?“, „Zeig mir Rechnungen vom letzten Monat“ oder „Fasse die geöffnete Mail zusammen“.'))}</div>
			<!-- ko foreach: messages -->
			<div class="ai-chat-msg" data-bind="css: {'ai-chat-user': 'user' === role, 'ai-chat-assistant': 'assistant' === role, 'ai-chat-error': error}">
				<div class="ai-chat-trace" data-bind="foreach: trace"><span>${I.search}<span data-bind="text: summary"></span></span></div>
				<div class="ai-chat-text" data-bind="html: html"></div>
				<div class="ai-action-list" data-bind="foreach: actions">
					<div class="ai-action" data-bind="css: {'ai-action-done': 'done' === state(), 'ai-action-off': 'dismissed' === state(), 'ai-action-error': 'error' === state()}">
						<div class="ai-action-main">
							<span class="ai-action-icon" data-bind="html: icon"></span>
							<span class="ai-action-label" data-bind="text: label"></span>
							<span class="ai-action-count" data-bind="visible: $data.uids && uids.length > 1, text: ($data.uids || []).length"></span>
						</div>
						<div class="ai-action-btns">
							<span class="ai-spinner" data-bind="visible: 'running' === state()"></span>
							<span class="ai-action-state" data-bind="visible: stateText, text: stateText"></span>
							<!-- ko if: !state() -->
							<button type="button" class="btn btn-small" data-bind="click: $root.dismissAction.bind($root)">${AI.esc(t('DISMISS', 'Verwerfen'))}</button>
							<button type="button" class="btn btn-small btn-success" data-bind="click: $root.runAction.bind($root)">${AI.esc(t('RUN', 'Ausführen'))}</button>
							<!-- /ko -->
						</div>
					</div>
				</div>
			</div>
			<!-- /ko -->
			<div class="ai-loading" data-bind="visible: busy"><span class="ai-spinner"></span><span>${AI.esc(t('THINKING', 'Copilot arbeitet …'))}</span></div>
		</div>
		<div class="ai-context-chip" data-bind="visible: useContext() && contextMsg()">
			${I.mail}<span data-bind="text: contextLabel"></span>
			<button type="button" class="btn btn-small btn-transparent" data-bind="click: clearContext" title="${AI.esc(t('CONTEXT_REMOVE', 'Ohne Bezug auf diese Mail fragen'))}">${I.close}</button>
		</div>
		<div class="ai-chat-input">
			<textarea rows="2" data-bind="textInput: input, event: {keydown: keydown}, enable: !busy()" placeholder="${AI.esc(t('CHAT_PLACEHOLDER', 'Nachricht an Copilot …'))}"></textarea>
			<button type="button" class="btn btn-success" data-bind="click: send, enable: !busy() && input().trim()" title="${AI.esc(t('SEND', 'Senden'))}">${I.send}</button>
		</div>
	</section>`;
			document.body.append(tpl);
			const el = document.createElement('aside');
			el.id = 'ai-sidebar';
			el.className = 'ai-sidebar';
			el.setAttribute('aria-label', 'Copilot');
			host.append(el);
			this.el = el;
			ko.applyBindingAccessorsToNode(el, {
				template: () => ({name: 'AiCopilotSidebar'})
			}, this);
			el.hidden = !this.visible();
			document.documentElement.classList.toggle('ai-sidebar-open', !!this.visible());
			this.visible() && this.alertsOn() && this.refreshAlerts();
		}
	}

	const sidebar = AI.sidebar = new Sidebar();

	// Kontext: aktuell geoeffnete Mail
	addEventListener('rl-view-model', e => {
		const vm = e.detail;
		if ('MailMessageView' === vm.viewModelTemplateID && vm.message) {
			vm.message.subscribe(m => {
				if (m) {
					sidebar.contextMsg(m);
					sidebar.useContext(true);
				}
			});
		}
		if ('MailMessageList' === vm.viewModelTemplateID) {
			sidebar.mount();
		}
	});

})(window.rl);
