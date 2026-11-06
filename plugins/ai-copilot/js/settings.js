/* AI Copilot: Benutzer-Einstellungen (Tab "KI") */
(rl => {
	if (!rl || rl.adminArea()) return;
	const AI = window.AiCopilot, t = AI.i18n;

	const FEATURE_LABELS = {
		summarize: ['FEATURE_SUMMARIZE', 'Zusammenfassungen'],
		draft: ['FEATURE_DRAFT', 'Entwürfe, Umschreiben, Korrekturlesen'],
		quick_replies: ['FEATURE_QUICK_REPLIES', 'Antwortvorschläge'],
		search: ['FEATURE_SEARCH', 'Suche in natürlicher Sprache'],
		triage: ['FEATURE_TRIAGE', 'Kategorien und Tabs'],
		triage_llm: ['FEATURE_TRIAGE_LLM', 'Kategorien mit KI einordnen'],
		chat: ['FEATURE_CHAT', 'Copilot-Chat'],
		alerts: ['FEATURE_ALERTS', 'Hinweise']
	};

	class AiCopilotSettings {
		constructor() {
			this.enabled = ko.observable(true);
			this.tone = ko.observable('professional');
			this.language = ko.observable('auto');
			this.name = ko.observable('');
			this.style = ko.observable('');
			this.addresses = ko.observable('');
			this.noticeAck = ko.observable(false);
			this.saving = ko.observable(false);
			this.status = ko.observable('');
			this.features = Object.keys(FEATURE_LABELS)
				.filter(f => (AI.cfg('features') || {})[f])
				.map(f => ({id: f, label: t(...FEATURE_LABELS[f]), value: ko.observable(true)}));
			this.tones = [
				{id: 'professional', name: t('TONE_PROFESSIONAL', 'Professionell')},
				{id: 'friendly', name: t('TONE_FRIENDLY', 'Freundlich')},
				{id: 'casual', name: t('TONE_CASUAL', 'Locker')},
				{id: 'concise', name: t('TONE_CONCISE', 'Knapp')},
				{id: 'formal', name: t('TONE_FORMAL', 'Förmlich')}
			];
			this.languages = [
				{id: 'auto', name: t('LANG_AUTO', 'Wie die Mail')},
				{id: 'de', name: 'Deutsch'},
				{id: 'en', name: 'English'}
			];
			this.providers = ['default', 'search', 'triage', 'chat'].map(f => {
				const p = AI.provider(f);
				return {
					label: t('PROVIDER_' + f.toUpperCase(), f),
					value: (p.name || '?') + (p.model ? ' · ' + p.model : '') + (p.local ? ' · ' + t('LOCAL', 'lokal') : '')
						+ (p.ready === false ? ' · ' + t('NOT_READY', 'kein API-Key') : '')
				};
			});
		}

		load(s) {
			if (!s) return;
			this.enabled(false !== s.enabled);
			this.tone(s.tone || 'professional');
			this.language(s.language || 'auto');
			this.name(s.name || '');
			this.style(s.style || '');
			this.addresses(s.addresses || '');
			this.noticeAck(!!s.notice_ack);
			this.features.forEach(f => f.value(false !== (s.features || {})[f.id]));
		}

		onBuild() {
			AI.userSettings() ? this.load(AI.userSettings()) : AI.loadSettings().then(() => this.load(AI.userSettings()));
		}

		onShow() {
			this.status('');
			this.load(AI.userSettings());
		}

		save() {
			if (this.saving()) return;
			this.saving(true);
			this.status('');
			const features = {};
			this.features.forEach(f => features[f.id] = !!f.value());
			AI.request('AiSaveSettings', {settings: {
				enabled: this.enabled(),
				features: features,
				tone: this.tone(),
				language: this.language(),
				name: this.name(),
				style: this.style(),
				addresses: this.addresses(),
				notice_ack: this.noticeAck()
			}}, 30000)
				.then(r => {
					r.settings && AI.userSettings(r.settings);
					this.status(t('SAVED', 'Gespeichert.'));
				})
				.catch(err => this.status(err.message))
				.finally(() => this.saving(false));
		}
	}

	rl.addSettingsViewModel(AiCopilotSettings, 'AiCopilotSettingsTab', 'AI_COPILOT/TAB_NAME', 'ai-copilot');

})(window.rl);
