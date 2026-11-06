/* AI Copilot: Entwuerfe, Ton, Umschreiben, Korrekturlesen im Compose-Fenster */
(rl => {
	if (!rl || rl.adminArea()) return;
	const AI = window.AiCopilot, I = AI.ICONS, t = AI.i18n;

	const TONES = [
		['professional', 'TONE_PROFESSIONAL', 'Professionell'],
		['friendly', 'TONE_FRIENDLY', 'Freundlich'],
		['casual', 'TONE_CASUAL', 'Locker'],
		['concise', 'TONE_CONCISE', 'Knapp'],
		['formal', 'TONE_FORMAL', 'Förmlich'],
		['custom', 'TONE_CUSTOM', 'Eigener']
	];

	// SSE ueber fetch lesen (POST mit Token)
	const streamDraft = (params, handlers, signal) => rl.fetch('./?/AiStream/', {signal: signal, headers: {Accept: 'text/event-stream'}}, params)
		.then(response => {
			if (!response.ok || !response.body) {
				throw new Error(t('ERROR_REQUEST', 'Anfrage fehlgeschlagen') + ' (HTTP ' + response.status + ')');
			}
			const reader = response.body.getReader(), decoder = new TextDecoder();
			let buffer = '', finished = false;
			const handle = block => {
				let event = 'message', data = '';
				block.split('\n').forEach(line => {
					if (line.startsWith('event:')) event = line.slice(6).trim();
					else if (line.startsWith('data:')) data += line.slice(5).trim();
				});
				if (!data) return;
				let json;
				try { json = JSON.parse(data); } catch (e) { return; }
				if ('done' === event || 'error' === event) finished = true;
				handlers[event]?.(json);
			};
			const pump = () => reader.read().then(({done, value}) => {
				buffer += value ? decoder.decode(value, {stream: true}) : '';
				let idx;
				while ((idx = buffer.indexOf('\n\n')) >= 0) {
					handle(buffer.slice(0, idx));
					buffer = buffer.slice(idx + 2);
				}
				if (done) {
					buffer.trim() && handle(buffer);
					if (!finished) throw new Error(t('ERROR_STREAM', 'Verbindung unterbrochen.'));
					return;
				}
				return pump();
			});
			return pump();
		});

	class AiDraftPopupView extends rl.pluginPopupView {
		constructor() {
			super('AiDraft');
			this.tones = TONES.map(([id, key, def]) => ({id: id, label: t(key, def)}));
			Object.assign(this, {
				mode: ko.observable('new'),
				instruction: ko.observable(''),
				tone: ko.observable('professional'),
				customTone: ko.observable(''),
				output: ko.observable(''),
				subject: ko.observable(''),
				busy: ko.observable(false),
				error: ko.observable(''),
				model: ko.observable(''),
				hasSelection: ko.observable(false),
				subjectApplied: ko.observable(false),
				canReply: ko.observable(false)
			});
			this.title = ko.computed(() => ({
				'new': t('DRAFT_TITLE_NEW', 'Neue Mail mit KI'),
				reply: t('DRAFT_TITLE_REPLY', 'Antwort mit KI'),
				rewrite: t('DRAFT_TITLE_REWRITE', 'Text umschreiben'),
				proofread: t('DRAFT_TITLE_PROOFREAD', 'Korrekturlesen')
			})[this.mode()]);
			this.showInstruction = ko.computed(() => 'proofread' !== this.mode());
			this.showTone = ko.computed(() => 'proofread' !== this.mode());
			this.canApply = ko.computed(() => !this.busy() && !!this.output().trim());
			this.generateLabel = ko.computed(() => this.output() ? t('REGENERATE', 'Neu erzeugen') : t('GENERATE', 'Erzeugen'));
			this.providerLabel = ko.computed(() => AI.providerLabel('default'));
			this.composeVm = null;
			this.controller = null;
			this.sourceText = '';
		}

		onShow(composeVm, opts = {}) {
			this.composeVm = composeVm;
			const s = AI.userSettings() || {};
			const isReply = 'reply' === composeVm.aDraftInfo?.[0];
			this.canReply(isReply);
			this.mode(opts.mode || (isReply ? 'reply' : 'new'));
			this.instruction(opts.instruction || '');
			this.tone(opts.tone || s.tone || 'professional');
			this.customTone('');
			this.output('');
			this.subject('');
			this.subjectApplied(false);
			this.error('');
			this.model('');
			this.busy(false);
			const sel = AI.selectedText(composeVm);
			this.hasSelection(!!sel);
			this.sourceText = sel || AI.ownText(composeVm);
			if (opts.autostart || 'proofread' === this.mode()) {
				setTimeout(() => this.generate(), 50);
			} else {
				setTimeout(() => this.viewModelDom.querySelector('textarea.ai-instruction')?.focus(), 100);
			}
		}

		onHide() {
			this.stop();
		}

		setTone(tone) {
			this.tone(tone.id);
		}

		params() {
			const vm = this.composeVm, mode = this.mode(), p = {
				mode: mode,
				tone: 'custom' === this.tone() ? this.customTone().trim() : this.tone(),
				instruction: this.instruction().trim()
			};
			if ('rewrite' === mode || 'proofread' === mode) {
				p.current = this.sourceText;
			} else {
				p.current = AI.ownText(vm);
				p.wantSubject = !vm.subject().trim();
				const info = vm.aDraftInfo;
				if (info && info.length === 3 && ('reply' === info[0] || 'forward' === info[0])) {
					const uid = parseInt(info[1], 10), folder = info[2];
					const listMsg = rl.app.messageList().find(m => m.folder === folder && m.uid == uid);
					const uids = listMsg?.threads?.().length ? listMsg.threads().slice() : [];
					uids.includes(uid) || uids.push(uid);
					p.folder = folder;
					p.uids = uids;
					p.sent = AI.systemFolder(2);
					if ('forward' === info[0] && 'reply' === mode) p.mode = 'new';
				}
			}
			return p;
		}

		generate() {
			if (this.busy()) return;
			const p = this.params();
			if ('new' === p.mode && !p.instruction && !p.current && !p.folder) {
				this.error(t('DRAFT_NEED_INSTRUCTION', 'Bitte kurz beschreiben, was die Mail enthalten soll.'));
				return;
			}
			if (('rewrite' === p.mode || 'proofread' === p.mode) && !p.current) {
				this.error(t('DRAFT_NO_TEXT', 'Kein Text vorhanden. Erst etwas schreiben oder Text markieren.'));
				return;
			}
			AI.consent('default').then(() => {
				this.busy(true);
				this.error('');
				this.output('');
				this.subject('');
				this.subjectApplied(false);
				this.controller = new AbortController();
				let text = '';
				streamDraft(p, {
					start: d => this.model(d.model || ''),
					delta: d => {
						text += d.text || '';
						this.output(text.replace(/^\s*(Betreff|Subject)\s*:[^\n]*\n+/i, ''));
					},
					done: d => {
						this.output(d.body || this.output());
						this.subject(d.subject || '');
						d.model && this.model(d.model);
					},
					error: d => this.error(d.error || t('ERROR_REQUEST', 'Anfrage fehlgeschlagen'))
				}, this.controller.signal)
				.catch(err => {
					if ('AbortError' === err?.name) return;
					// Rueckfall ohne Streaming
					if (!text) {
						return AI.request('AiDraft', p).then(r => {
							this.output(r.body || '');
							this.subject(r.subject || '');
							this.model(r.model || '');
						}).catch(e2 => this.error(e2.message));
					}
					this.error(err.message);
				})
				.finally(() => {
					this.busy(false);
					this.controller = null;
				});
			}).catch(() => 0);
		}

		stop() {
			this.controller?.abort();
			this.controller = null;
			this.busy(false);
		}

		applySubject() {
			const s = this.subject().trim();
			if (s && this.composeVm) {
				this.composeVm.subject(s);
				this.subjectApplied(true);
			}
		}

		apply(how) {
			const text = this.output().trim();
			if (!text || !this.composeVm) return;
			const mode = this.mode();
			if (!how) {
				how = ('rewrite' === mode || 'proofread' === mode)
					? (this.hasSelection() ? 'replaceSelection' : 'replaceOwn')
					: (AI.ownText(this.composeVm) ? 'replaceOwn' : 'prepend');
			}
			AI.insertText(this.composeVm, text, how);
			if (this.subject().trim() && !this.composeVm.subject().trim()) {
				this.composeVm.subject(this.subject().trim());
			}
			this.close();
		}

		applyReplace() { this.apply(); }
		applyCursor() { this.apply('cursor'); }
	}

	AI.openDraft = (composeVm, opts) => AiDraftPopupView.showModal([composeVm, opts || {}]);

	addEventListener('rl-view-model.create', e => {
		const vm = e.detail;
		if ('PopupsCompose' !== vm.viewModelTemplateID) return;

		const template = document.getElementById('PopupsCompose'),
			row = template.content.querySelector('.b-header div[style*="display:flex"] > .btn-group');
		if (row) {
			row.append(Element.fromHTML(`<div class="ai-compose-bar" data-bind="visible: aiDraftOn">
	<button type="button" class="btn ai-btn" data-bind="click: aiDraft" title="${AI.esc(t('DRAFT_HINT', 'Entwurf mit KI (Taste c dreimal)'))}">${I.wand}<span class="hide-mobile">${AI.esc(t('DRAFT', 'KI-Entwurf'))}</span></button>
	<button type="button" class="btn ai-btn" data-bind="click: aiRewrite" title="${AI.esc(t('REWRITE_HINT', 'Markierten oder eigenen Text umschreiben'))}">${I.edit}<span class="hide-mobile">${AI.esc(t('REWRITE', 'Umschreiben'))}</span></button>
	<button type="button" class="btn ai-btn" data-bind="click: aiProofread" title="${AI.esc(t('PROOFREAD_HINT', 'Rechtschreibung und Grammatik korrigieren'))}">${I.spell}<span class="hide-mobile">${AI.esc(t('PROOFREAD', 'Korrektur'))}</span></button>
</div>`));
		}

		Object.assign(vm, {
			aiDraftOn: ko.computed(() => AI.on('draft')),
			aiDraft: () => AI.openDraft(vm, {}),
			aiRewrite: () => AI.openDraft(vm, {mode: 'rewrite'}),
			aiProofread: () => AI.openDraft(vm, {mode: 'proofread'})
		});

		// Tastenkuerzel: dreimal "c" ausserhalb von Eingabefeldern
		let presses = [];
		addEventListener('keydown', ev => {
			if (!vm.modalVisible?.() || !AI.on('draft') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
			const el = ev.target;
			if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
				presses = [];
				return;
			}
			if ('c' === ev.key || 'C' === ev.key) {
				const now = Date.now();
				presses = presses.filter(ts => now - ts < 800);
				presses.push(now);
				if (presses.length >= 3) {
					presses = [];
					ev.preventDefault();
					AI.openDraft(vm, {});
				}
			} else {
				presses = [];
			}
		});
	});

	// Zauberstab auch in der Editor-Toolbar
	addEventListener('squire-toolbar', e => {
		if (!AI.on('draft')) return;
		e.detail.actions.ai = {
			aiwand: {
				html: I.wand,
				cmd: () => AI.composeVm && AI.openDraft(AI.composeVm, {})
			}
		};
	});

})(window.rl);
