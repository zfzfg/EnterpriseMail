/* AI Copilot: Zusammenfassung und Antwortvorschlaege in der Nachrichtenansicht */
(rl => {
	if (!rl || rl.adminArea()) return;
	const AI = window.AiCopilot;

	addEventListener('rl-view-model.create', e => {
		const view = e.detail;
		if ('MailMessageView' !== view.viewModelTemplateID) return;

		const template = document.getElementById('MailMessageView'),
			place = template.content.querySelector('.attachmentsPlace');
		if (!place) return;

		const I = AI.ICONS, t = AI.i18n;

		place.before(Element.fromHTML(`
<div class="ai-msg" data-bind="visible: aiVisible">
	<div class="ai-msg-bar">
		<button type="button" class="btn btn-small ai-btn" data-bind="visible: aiOn('summarize'), click: aiSummarize, enable: !aiSumLoading()"
			title="${AI.esc(t('SUMMARIZE_HINT', 'Verlauf mit KI zusammenfassen'))}">${I.summary}<span>${AI.esc(t('SUMMARIZE', 'Zusammenfassen'))}</span></button>
		<button type="button" class="btn btn-small ai-btn" data-bind="visible: aiOn('quick_replies'), click: aiQuickReplies, enable: !aiQrLoading()"
			title="${AI.esc(t('QUICK_REPLIES_HINT', 'Drei Antwortvorschläge erzeugen'))}">${I.replies}<span>${AI.esc(t('QUICK_REPLIES', 'Antwortvorschläge'))}</span></button>
		<button type="button" class="btn btn-small ai-btn" data-bind="visible: aiOn('chat'), click: aiAskCopilot"
			title="${AI.esc(t('ASK_COPILOT_HINT', 'Im Copilot-Chat zu dieser Mail fragen'))}">${I.chat}<span>${AI.esc(t('ASK_COPILOT', 'Copilot fragen'))}</span></button>
	</div>

	<div class="ai-card ai-summary" data-bind="visible: aiSumLoading() || aiSummary() || aiSumError()">
		<div class="ai-card-head">
			${I.sparkle}<strong>${AI.esc(t('SUMMARY', 'Zusammenfassung'))}</strong>
			<span class="ai-muted" data-bind="text: aiSumMeta"></span>
			<span class="ai-spacer"></span>
			<button type="button" class="btn btn-small btn-transparent" data-bind="visible: aiSummary() && !aiSumLoading(), click: aiSummarizeForce"
				title="${AI.esc(t('REGENERATE', 'Neu erzeugen'))}">${I.refresh}</button>
			<button type="button" class="btn btn-small btn-transparent" data-bind="click: aiSummaryClose" title="${AI.esc(t('CLOSE', 'Schließen'))}">${I.close}</button>
		</div>
		<div class="ai-loading" data-bind="visible: aiSumLoading"><span class="ai-spinner"></span>${AI.esc(t('WORKING', 'Wird erstellt …'))}</div>
		<div class="ai-error" data-bind="visible: aiSumError, text: aiSumError"></div>
		<!-- ko with: aiSummary -->
		<p class="ai-tldr" data-bind="visible: tldr, text: tldr"></p>
		<ul class="ai-points" data-bind="visible: points.length, foreach: points"><li data-bind="text: t"></li></ul>
		<div data-bind="visible: decisions.length">
			<div class="ai-label">${AI.esc(t('DECISIONS', 'Entscheidungen'))}</div>
			<ul data-bind="foreach: decisions"><li data-bind="text: t"></li></ul>
		</div>
		<div data-bind="visible: actions.length">
			<div class="ai-label">${AI.esc(t('ACTION_ITEMS', 'Aufgaben'))}</div>
			<ul class="ai-actions" data-bind="foreach: actions">
				<li><span data-bind="text: what"></span>
					<span class="ai-muted" data-bind="visible: who || due, text: $root.aiJoin(who, due)"></span></li>
			</ul>
		</div>
		<p class="ai-next" data-bind="visible: next"><span class="ai-label">${AI.esc(t('NEXT_STEP', 'Nächster Schritt'))}:</span> <span data-bind="text: next"></span></p>
		<!-- /ko -->
	</div>

	<div class="ai-card ai-quick" data-bind="visible: aiQrLoading() || aiReplies().length || aiQrError()">
		<div class="ai-card-head">
			${I.replies}<strong>${AI.esc(t('QUICK_REPLIES', 'Antwortvorschläge'))}</strong>
			<span class="ai-spacer"></span>
			<button type="button" class="btn btn-small btn-transparent" data-bind="visible: aiReplies().length && !aiQrLoading(), click: aiQuickRepliesForce"
				title="${AI.esc(t('REGENERATE', 'Neu erzeugen'))}">${I.refresh}</button>
			<button type="button" class="btn btn-small btn-transparent" data-bind="click: aiQuickClose" title="${AI.esc(t('CLOSE', 'Schließen'))}">${I.close}</button>
		</div>
		<div class="ai-loading" data-bind="visible: aiQrLoading"><span class="ai-spinner"></span>${AI.esc(t('WORKING', 'Wird erstellt …'))}</div>
		<div class="ai-error" data-bind="visible: aiQrError, text: aiQrError"></div>
		<div class="ai-reply-cards" data-bind="foreach: aiReplies">
			<button type="button" class="ai-reply-card" data-bind="click: $root.aiUseReply, attr: {title: body}">
				<span class="ai-reply-label" data-bind="text: label"></span>
				<span class="ai-reply-preview" data-bind="text: body"></span>
				<span class="ai-reply-use">${I.edit}<span>${AI.esc(t('USE_REPLY', 'Als Antwort öffnen'))}</span></span>
			</button>
		</div>
	</div>
</div>`));

		const uidsOf = msg => {
			const threads = msg.threads?.() || [];
			const uids = threads.length ? threads.slice() : [];
			uids.includes(msg.uid) || uids.push(msg.uid);
			return uids;
		};

		Object.assign(view, {
			aiSummary: ko.observable(null),
			aiSumLoading: ko.observable(false),
			aiSumError: ko.observable(''),
			aiSumMeta: ko.observable(''),
			aiReplies: ko.observableArray(),
			aiQrLoading: ko.observable(false),
			aiQrError: ko.observable(''),
			aiOn: feature => AI.on(feature),
			aiJoin: (...parts) => parts.filter(p => p).join(' · '),
			aiVisible: ko.computed(() => !!view.message() && (AI.on('summarize') || AI.on('quick_replies') || AI.on('chat')))
		});

		let currentKey = '';
		const keyOf = msg => msg ? msg.folder + '|' + msg.uid : '';

		const summarize = (force, cacheOnly) => {
			const msg = view.message();
			if (!msg) return;
			const key = keyOf(msg);
			const run = () => {
				view.aiSumLoading(!cacheOnly);
				view.aiSumError('');
				AI.request('AiSummarize', {folder: msg.folder, uids: uidsOf(msg), sent: AI.systemFolder(2), force: !!force, cacheOnly: !!cacheOnly})
					.then(r => {
						if (key !== currentKey) return;
						if (r.summary) {
							const s = r.summary;
							view.aiSummary({
								tldr: s.tldr || '',
								points: (s.points || []).map(x => ({t: x})),
								decisions: (s.decisions || []).map(x => ({t: x})),
								actions: s.actions || [], next: s.next || ''
							});
							view.aiSumMeta((s.count > 1 ? s.count + ' ' + t('MESSAGES', 'Nachrichten') + ' · ' : '')
								+ (r.cached ? t('CACHED', 'aus dem Zwischenspeicher') : (s.model || '')));
						}
					})
					.catch(err => key === currentKey && !cacheOnly && view.aiSumError(err.message))
					.finally(() => key === currentKey && view.aiSumLoading(false));
			};
			cacheOnly ? run() : AI.consent('default').then(run).catch(() => 0);
		};

		const quickReplies = force => {
			const msg = view.message();
			if (!msg) return;
			const key = keyOf(msg);
			AI.consent('default').then(() => {
				view.aiQrLoading(true);
				view.aiQrError('');
				view.aiReplies([]);
				AI.request('AiQuickReplies', {folder: msg.folder, uids: uidsOf(msg), sent: AI.systemFolder(2), force: !!force})
					.then(r => key === currentKey && view.aiReplies(r.replies || []))
					.catch(err => key === currentKey && view.aiQrError(err.message))
					.finally(() => key === currentKey && view.aiQrLoading(false));
			}).catch(() => 0);
		};

		Object.assign(view, {
			aiSummarize: () => summarize(false),
			aiSummarizeForce: () => summarize(true),
			aiSummaryClose: () => { view.aiSummary(null); view.aiSumError(''); },
			aiQuickReplies: () => quickReplies(false),
			aiQuickRepliesForce: () => quickReplies(true),
			aiQuickClose: () => { view.aiReplies([]); view.aiQrError(''); },
			aiUseReply: reply => {
				const msg = view.message();
				msg && AI.compose({message: msg, body: reply.body, how: 'prepend'});
			},
			aiAskCopilot: () => AI.sidebar?.openWithContext(view.message())
		});

		// Beim Wechsel der Mail zuruecksetzen; gespeicherte Zusammenfassung ohne Anfrage zeigen
		view.message.subscribe(msg => {
			currentKey = keyOf(msg);
			view.aiSummary(null);
			view.aiSumError('');
			view.aiSumMeta('');
			view.aiReplies([]);
			view.aiQrError('');
			view.aiSumLoading(false);
			view.aiQrLoading(false);
			if (msg && AI.on('summarize')) {
				// nur Cache lesen, nichts an den Anbieter senden
				setTimeout(() => currentKey === keyOf(msg) && summarize(false, true), 300);
			}
		});
	});

})(window.rl);
