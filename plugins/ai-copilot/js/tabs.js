/* AI Copilot: Kategorie-Tabs und Badges in der Nachrichtenliste */
(rl => {
	if (!rl || rl.adminArea()) return;
	const AI = window.AiCopilot, I = AI.ICONS, t = AI.i18n;

	const TAB_SEARCH = {
		needs_reply: 'keyword:$ai_needs_reply is:unanswered',
		personal: 'keyword:$ai_personal',
		newsletter: 'keyword:$ai_newsletter',
		notification: 'keyword:$ai_notification',
		invoice: 'keyword:$ai_invoice'
	};

	const tagged = {}; // Ordner -> Zeitpunkt der letzten Regel-Einordnung

	addEventListener('rl-view-model.create', e => {
		const view = e.detail;
		if ('MailMessageList' !== view.viewModelTemplateID) return;

		const template = document.getElementById('MailMessageList');

		// Badges hinter dem Betreff (normale und gruppierte Liste)
		template.content.querySelectorAll('.messageListItem .subjectParent').forEach(el => {
			el.after(Element.fromHTML(`<span class="ai-badge" data-bind="visible: $data.aiCategory && $root.aiTriageOn(), attr: {'data-ai': $data.aiCategory || ''}, text: $root.aiCatLabel($data.aiCategory)"></span>`));
		});

		// Copilot-Knopf in der oberen Leiste
		const toolbar = template.content.querySelector('.btn-toolbar');
		toolbar && toolbar.append(Element.fromHTML(`<a class="btn ai-sidebar-toggle onCheckedHide" data-bind="visible: aiChatOn, click: aiToggleSidebar, css: {active: aiSidebarOpen}"
	title="${AI.esc(t('COPILOT_TOGGLE', 'Copilot ein- oder ausblenden'))}">${I.sparkle}<span class="hide-mobile">Copilot</span></a>`));

		// Tab-Leiste
		const second = template.content.querySelector('.second-toolbar');
		second && second.after(Element.fromHTML(`<div class="ai-tabs" data-bind="visible: aiTabsVisible">
	<!-- ko foreach: aiTabs -->
	<button type="button" class="ai-tab" data-bind="css: {active: $parent.aiActiveTab() === id}, attr: {'data-ai': id}, click: $parent.aiSelectTab, enable: !$parent.aiTabBusy()">
		<span data-bind="text: label"></span>
	</button>
	<!-- /ko -->
	<span class="ai-spacer"></span>
	<button type="button" class="ai-tab ai-tab-action" data-bind="visible: aiDoneVisible, click: aiDone" title="${AI.esc(t('DONE_HINT', 'Als gelesen markieren und archivieren'))}">${I.check}<span>${AI.esc(t('DONE', 'Erledigt'))}</span></button>
	<button type="button" class="ai-tab ai-tab-action" data-bind="visible: aiTriageLlmOn, click: aiTriageLlm, enable: !aiTabBusy()" title="${AI.esc(t('TRIAGE_LLM_HINT', 'Mails dieser Seite mit KI einordnen (Absender, Betreff, Vorschau gehen an das Modell)'))}">${I.tag}<span>${AI.esc(t('TRIAGE_LLM', 'Mit KI einordnen'))}</span></button>
	<span class="ai-spinner" data-bind="visible: aiTabBusy"></span>
</div>`));
		const content = template.content.querySelector('.b-content');
		content && content.prepend(Element.fromHTML(`<div class="ai-search-info" data-bind="visible: aiTabMsg">
	${I.tag}<span data-bind="text: aiTabMsg"></span>
	<a href="#" class="ai-search-info-close" data-bind="click: aiTabMsgClose">${I.close}</a>
</div>`));

		const list = rl.app.messageList;
		const excluded = () => [AI.systemFolder(2), AI.systemFolder(3), AI.systemFolder(4), AI.systemFolder(5)].filter(Boolean);

		Object.assign(view, {
			aiTabs: [{id: 'all', label: t('TAB_ALL', 'Alle')}].concat(AI.categories.map(c => ({id: c, label: AI.categoryLabel(c)}))),
			aiTabBusy: ko.observable(false),
			aiTabMsg: ko.observable(''),
			aiTabMsgClose: () => view.aiTabMsg(''),
			aiTriageOn: ko.computed(() => AI.on('triage')),
			aiCatLabel: cat => AI.categoryLabel(cat),
			aiChatOn: ko.computed(() => AI.on('chat') || AI.on('alerts')),
			aiSidebarOpen: ko.computed(() => AI.sidebar?.open?.() || false),
			aiToggleSidebar: () => AI.sidebar?.toggle(),
			aiTabsVisible: ko.computed(() => AI.on('triage') && false !== AI.cfg('storeKeywords')
				&& !excluded().includes(AI.currentFolder())),
			aiActiveTab: ko.computed(() => {
				const s = (list.mainSearch() || '').trim();
				if (!s) return 'all';
				const hit = Object.entries(TAB_SEARCH).find(([, v]) => v === s);
				return hit ? hit[0] : '';
			}),
			aiTriageLlmOn: ko.computed(() => AI.on('triage') && AI.on('triage_llm')),

			aiSelectTab: tab => {
				if ('all' === tab.id) {
					list.mainSearch('');
					return;
				}
				const folder = AI.currentFolder(), search = TAB_SEARCH[tab.id];
				const go = () => list.mainSearch(search);
				// Regel-Einordnung hoechstens alle 2 Minuten je Ordner
				if (tagged[folder] && Date.now() - tagged[folder] < 120000) {
					go();
					return;
				}
				view.aiTabBusy(true);
				AI.request('AiTriageTag', {folder: folder, sent: AI.systemFolder(2)}, 120000)
					.then(r => {
						tagged[folder] = Date.now();
						r.tagged && view.aiTabMsg(t('TAGGED', '%N% Mails eingeordnet.').replace('%N%', r.tagged));
						go();
						setTimeout(() => view.aiTabMsg(''), 4000);
					})
					.catch(err => view.aiTabMsg(err.message))
					.finally(() => view.aiTabBusy(false));
			},

			aiTriageLlm: () => {
				const folder = AI.currentFolder();
				const items = list().slice(0, 60).map(m => ({
					uid: m.uid,
					from: m.from?.toString?.() || m.senderEmailsString || '',
					to: m.to?.toString?.() || '',
					cc: m.cc?.toString?.() || '',
					subject: m.subject?.() || '',
					preview: m.preview || '',
					bulk: ['newsletter', 'notification'].includes(m.aiCategory)
				}));
				if (!items.length) return;
				AI.consent('triage').then(() => {
					view.aiTabBusy(true);
					view.aiTabMsg('');
					AI.request('AiTriageLlm', {folder: folder, items: items}, 180000)
						.then(r => {
							const n = Object.keys(r.categories || {}).length;
							view.aiTabMsg(r.warning || t('TRIAGE_DONE', '%N% Mails mit KI eingeordnet.').replace('%N%', n));
							list.reload(false, true);
						})
						.catch(err => view.aiTabMsg(err.message))
						.finally(() => view.aiTabBusy(false));
				}).catch(() => 0);
			},

			aiDone: () => {
				const msgs = list.listCheckedOrSelected();
				if (!msgs.length) return;
				const folder = msgs[0].folder, uids = msgs.map(m => m.uid);
				const archive = AI.systemFolder(6);
				rl.app.Remote.request('MessageSetSeen', () => {
					if (archive && archive !== folder) {
						rl.app.Remote.request('MessageMove', () => list.reload(false, true), {
							fromFolder: folder, toFolder: archive, uids: uids.join(',')
						});
					} else {
						list.reload(false, true);
					}
				}, {folder: folder, uids: uids.join(','), setAction: 1});
			}
		});
		view.aiDoneVisible = ko.computed(() => 'needs_reply' === view.aiActiveTab() && list.hasCheckedOrSelected());
	});

})(window.rl);
