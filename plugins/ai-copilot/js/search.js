/* AI Copilot: Suche in natuerlicher Sprache (nur die Anfrage geht an das Modell) */
(rl => {
	if (!rl || rl.adminArea()) return;
	const AI = window.AiCopilot, I = AI.ICONS, t = AI.i18n;

	addEventListener('rl-view-model.create', e => {
		const view = e.detail;
		if ('MailMessageList' !== view.viewModelTemplateID) return;

		const template = document.getElementById('MailMessageList'),
			wrp = template.content.querySelector('.search-input-wrp');
		if (!wrp) return;

		wrp.after(Element.fromHTML(`<a class="btn ai-search-btn" data-bind="visible: aiSearchOn, click: aiSearch, css: {'ai-busy': aiSearchBusy}"
	title="${AI.esc(t('SEARCH_HINT', 'Suchtext als natürliche Sprache verstehen (KI)'))}">${I.search}</a>`));

		const content = template.content.querySelector('.b-content');
		content && content.prepend(Element.fromHTML(`<div class="ai-search-info" data-bind="visible: aiSearchInfo() || aiSearchError()">
	${I.sparkle}<span data-bind="text: aiSearchInfo"></span><span class="ai-error" data-bind="text: aiSearchError"></span>
	<a href="#" class="ai-search-info-close" data-bind="click: aiSearchInfoClose">${I.close}</a>
</div>`));

		// Hinweis ausblenden, sobald eine andere Suche aktiv ist
		let lastAiSearch = '';
		rl.app.messageList.mainSearch.subscribe(value => {
			if (lastAiSearch && (value || '').trim() !== lastAiSearch) {
				lastAiSearch = '';
				view.aiSearchInfo('');
			}
		});

		Object.assign(view, {
			aiSearchOn: ko.computed(() => AI.on('search')),
			aiSearchBusy: ko.observable(false),
			aiSearchInfo: ko.observable(''),
			aiSearchError: ko.observable(''),
			aiSearchInfoClose: () => {
				view.aiSearchInfo('');
				view.aiSearchError('');
			},
			aiSearch: () => {
				if (view.aiSearchBusy()) return;
				const input = view.viewModelDom?.querySelector('.inputSearch');
				const query = (input?.value || '').trim();
				if (!query) {
					view.aiSearchError(t('SEARCH_EMPTY', 'Bitte zuerst eine Anfrage ins Suchfeld schreiben, z. B. „Rechnungen vom letzten Monat mit Anhang“.'));
					input?.focus();
					return;
				}
				const p = AI.provider('search');
				const run = () => {
					lastAiSearch = '';
					view.aiSearchBusy(true);
					view.aiSearchInfo('');
					view.aiSearchError('');
					AI.request('AiSearch', {
						query: query,
						folders: AI.folders(),
						currentFolder: AI.currentFolder(),
						sent: AI.systemFolder(2)
					}, 60000)
						.then(r => {
							view.aiSearchInfo((r.explanation ? r.explanation + ' · ' : '') + r.search + (r.folder ? ' (' + r.folder + ')' : ''));
							lastAiSearch = r.search;
							AI.setSearch(r.search, r.folder);
						})
						.catch(err => view.aiSearchError(err.message))
						.finally(() => view.aiSearchBusy(false));
				};
				// Bei der Suche geht nur der Suchtext raus; Hinweis trotzdem einmalig
				(p.local ? Promise.resolve() : AI.consent('search')).then(run).catch(() => 0);
			}
		});
	});

})(window.rl);
