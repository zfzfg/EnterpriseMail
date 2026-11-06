/* AI Copilot: gemeinsame Hilfen. Keine Emojis, nur SVG-Icons. */
(rl => {
	if (!rl || rl.adminArea()) return;

	const PLUGIN = 'ai-copilot',
		cfg = name => rl.pluginSettingsGet(PLUGIN, name),

		svg = d => '<svg class="ai-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"'
			+ ' fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>',

		ICONS = {
			sparkle: svg('<path d="M12 3.5l1.7 4.6 4.8 1.7-4.8 1.7L12 16.1l-1.7-4.6-4.8-1.7 4.8-1.7z"/><path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
			summary: svg('<path d="M5 6h14M5 10h14M5 14h9M5 18h6"/>'),
			replies: svg('<path d="M9 15l-5-5 5-5"/><path d="M4 10h9a7 7 0 017 7v2"/>'),
			wand: svg('<path d="M4 20L14.5 9.5"/><path d="M12.5 7.5l4 4"/><path d="M17 3v3M15.5 4.5h3M20 8v2M19 9h2"/>'),
			chat: svg('<path d="M20 12a7.5 7.5 0 01-10.9 6.7L4.5 20l1.2-4.2A7.5 7.5 0 1120 12z"/>'),
			bell: svg('<path d="M6.5 9a5.5 5.5 0 1111 0c0 6 2.5 7.5 2.5 7.5H4s2.5-1.5 2.5-7.5"/><path d="M10 20a2 2 0 004 0"/>'),
			search: svg('<circle cx="10.5" cy="10.5" r="5.5"/><path d="M19.5 19.5l-5-5"/><path d="M18 3.5l.6 1.4 1.4.6-1.4.6L18 7.5l-.6-1.4-1.4-.6 1.4-.6z"/>'),
			refresh: svg('<path d="M19.5 11.5a7.5 7.5 0 10-2.2 5.3"/><path d="M19.5 4.5v7h-7"/>'),
			close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
			send: svg('<path d="M4.5 12L20 4.5 14 20l-2.5-6z"/><path d="M11.5 14L20 4.5"/>'),
			check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
			tag: svg('<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.3"/>'),
			mail: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M4 7l8 6 8-6"/>'),
			clock: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'),
			invoice: svg('<path d="M6.5 3.5h11v17l-2.75-1.6-2.75 1.6-2.75-1.6-2.75 1.6z"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>'),
			edit: svg('<path d="M4.5 19.5l1-4L15 6l3 3-9.5 9.5z"/><path d="M13 8l3 3"/>'),
			spell: svg('<path d="M4 17l4-11 4 11M5.5 13h5"/><path d="M14 15l2.5 2.5L21 12"/>'),
			panel: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M14.5 4.5v15"/>')
		},

		esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),

		i18n = (key, def) => {
			const v = rl.i18n('AI_COPILOT/' + key);
			return (v && v !== 'AI_COPILOT/' + key) ? v : (def ?? key);
		},

		// Klartext -> sicheres HTML (Absaetze und einfache Listen)
		renderText = text => {
			const lines = String(text ?? '').replace(/\r/g, '').split('\n');
			let html = '', list = null, para = [];
			const flushPara = () => {
				if (para.length) {
					html += '<p>' + para.map(esc).join('<br>') + '</p>';
					para = [];
				}
			}, flushList = () => {
				if (list) {
					html += '<' + list.tag + '>' + list.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</' + list.tag + '>';
					list = null;
				}
			};
			lines.forEach(line => {
				const t = line.trim(), ul = t.match(/^[-*•]\s+(.*)$/), ol = t.match(/^\d+[.)]\s+(.*)$/);
				if (ul || ol) {
					flushPara();
					const tag = ul ? 'ul' : 'ol';
					if (!list || list.tag !== tag) {
						flushList();
						list = {tag: tag, items: []};
					}
					list.items.push((ul || ol)[1].replace(/\*\*(.+?)\*\*/g, '$1'));
				} else if (!t) {
					flushPara();
					flushList();
				} else {
					flushList();
					para.push(t.replace(/\*\*(.+?)\*\*/g, '$1'));
				}
			});
			flushPara();
			flushList();
			return html;
		},

		errorText = (iError, oData) => {
			switch (iError) {
				case 2: return i18n('ERROR_ABORT', 'Abgebrochen.');
				case 3: return i18n('ERROR_TIMEOUT', 'Zeitüberschreitung. Bitte erneut versuchen.');
				default: return (oData && (oData.messageAdditional || oData.message || oData.ErrorMessage))
					|| i18n('ERROR_REQUEST', 'Anfrage fehlgeschlagen') + ' (' + iError + ')';
			}
		},

		request = (action, params, timeout) => new Promise((resolve, reject) => {
			rl.pluginRemoteRequest((iError, oData) => {
				if (iError) {
					reject(new Error(errorText(iError, oData)));
				} else {
					const r = oData?.Result;
					if (r && r.error) {
						reject(new Error(r.error));
					} else {
						resolve(r || {});
					}
				}
			}, action, params || {}, timeout || 120000);
		}),

		walkFolders = (list, fn) => (list || []).forEach(f => {
			fn(f);
			const sub = f.subFolders?.();
			sub && sub.length && walkFolders(sub, fn);
		}),

		folders = () => {
			const result = [];
			walkFolders(rl.app.folderList?.() || [], f => f.selectable?.() !== false && f.fullName && result.push(f.fullName));
			return result;
		},

		findFolder = name => {
			let found = null;
			walkFolders(rl.app.folderList?.() || [], f => { if (!found && f.fullName === name) found = f; });
			return found;
		},

		// FolderType: 1 Inbox, 2 Sent, 3 Drafts, 4 Junk, 5 Trash, 6 Archive
		FOLDER_NAMES = {
			2: ['Sent', 'Gesendet', 'Gesendete Objekte', 'Gesendete Elemente', 'Sent Items', 'Sent Messages', 'INBOX.Sent'],
			5: ['Trash', 'Papierkorb', 'Gelöschte Objekte', 'Gelöschte Elemente', 'Deleted Items', 'INBOX.Trash'],
			6: ['Archive', 'Archiv', 'Archives', 'INBOX.Archive']
		},

		systemFolder = type => {
			let found = '';
			walkFolders(rl.app.folderList?.() || [], f => { if (!found && type === f.type?.()) found = f.fullName; });
			if (!found && FOLDER_NAMES[type]) {
				// Rueckfall ueber uebliche Ordnernamen (z. B. IONOS ohne SPECIAL-USE)
				const names = FOLDER_NAMES[type].map(n => n.toLowerCase());
				walkFolders(rl.app.folderList?.() || [], f => {
					if (!found && f.fullName && names.includes(f.fullName.toLowerCase())) found = f.fullName;
				});
			}
			return found || (1 === type ? 'INBOX' : '');
		},

		currentFolder = () => {
			let found = '';
			walkFolders(rl.app.folderList?.() || [], f => { if (!found && f.selected?.()) found = f.fullName; });
			return found || rl.app.messageList?.()?.[0]?.folder || 'INBOX';
		},

		userSettings = ko.observable(null),

		loadSettings = () => request('AiGetSettings', {}, 30000)
			.then(r => userSettings(r.settings || {}))
			.catch(e => {
				console.warn('AI Copilot: Einstellungen nicht geladen', e);
				userSettings({enabled: true, features: {}});
			}),

		// Funktion freigeschaltet (Admin) und vom Benutzer nicht abgeschaltet
		on = feature => {
			// userSettings zuerst lesen, damit ko.computed davon abhaengt
			// (AppData ist nicht beobachtbar, die Einstellungen werden erst nach dem Login geladen)
			const s = userSettings();
			if (!s) return false;
			const features = cfg('features') || {};
			if (!features[feature]) return false;
			if (false === s.enabled) return false;
			return false !== (s.features || {})[feature];
		},

		provider = (feature = 'default') => {
			const p = (cfg('providers') || {})[feature] || (cfg('providers') || {}).default || {};
			return p;
		},

		providerLabel = feature => {
			const p = provider(feature);
			return p.name ? p.name + (p.model ? ' (' + p.model + ')' : '') : '';
		},

		// Einmaliger Hinweis, bevor Inhalte an einen externen Anbieter gehen
		consent = (feature = 'default') => new Promise((resolve, reject) => {
			const s = userSettings() || {}, p = provider(feature);
			if (s.notice_ack || p.local) {
				resolve();
				return;
			}
			const text = i18n('CONSENT_TEXT', 'Diese KI-Funktion sendet den Inhalt der betroffenen Mails an %PROVIDER%. Es wird nur gesendet, wenn Sie eine KI-Aktion anklicken. Fortfahren?')
				.replace('%PROVIDER%', providerLabel(feature) || 'den KI-Anbieter');
			rl.app.ask.showModal([text, () => {
				request('AiSaveSettings', {settings: {notice_ack: true}}).then(r => r.settings && userSettings(r.settings)).catch(() => 0);
				userSettings(Object.assign({}, s, {notice_ack: true}));
				resolve();
			}, () => reject(new Error('cancel'))]);
		}),

		confirm = text => new Promise(resolve => {
			rl.app.ask.showModal([text, () => resolve(true), () => resolve(false)]);
		}),

		openMessage = (folder, uid) => dispatchEvent(new CustomEvent('mailbox.message.show', {
			detail: {folder: folder, uid: uid},
			cancelable: false
		})),

		setSearch = (search, folder) => {
			const list = rl.app.messageList;
			const cur = currentFolder();
			if (folder && folder !== cur) {
				const f = findFolder(folder);
				const hash = f ? f.fullNameHash : encodeURIComponent(folder);
				hasher.setHash('#/mailbox/' + hash + (search ? '/' + encodeURI(search) : ''));
			} else {
				list.mainSearch(search || '');
			}
		},

		/* ---------- Editor-Hilfen (Compose) ---------- */

		// Eigener Text vs. Zitat (Antwort/Weiterleitung) trennen
		splitHtml = html => {
			const idx = html.search(/<blockquote/i);
			if (idx < 0) return [html, ''];
			const p = html.lastIndexOf('<p', idx);
			const cut = (p >= 0 && idx - p < 600) ? p : idx;
			// vorangestellte <br> dem Zitat zuschlagen
			let head = html.slice(0, cut), tail = html.slice(cut);
			const m = head.match(/(\s*<br\s*\/?>\s*)+$/i);
			if (m) {
				tail = head.slice(head.length - m[0].length) + tail;
				head = head.slice(0, head.length - m[0].length);
			}
			return [head, tail];
		},

		splitPlain = text => {
			const lines = text.split('\n');
			let i = lines.findIndex(l => /^>/.test(l));
			if (i < 0) return [text, ''];
			if (i > 0 && /:\s*$/.test(lines[i - 1])) --i;
			return [lines.slice(0, i).join('\n').replace(/\s+$/, ''), '\n\n' + lines.slice(i).join('\n')];
		},

		ownText = vm => {
			const ed = vm.oEditor;
			if (!ed) return '';
			const data = ed.getData() || '';
			if (ed.isPlain()) return splitPlain(data)[0].trim();
			return rl.Utils.htmlToPlain(splitHtml(data)[0]).trim();
		},

		selectedText = vm => {
			const sq = vm.oEditor?.editor?.squire;
			if (sq && !vm.oEditor.isPlain()) {
				try { return (sq.getSelectedText() || '').trim(); } catch (e) { return ''; }
			}
			const ta = vm.oEditor?.editor?.plain;
			if (ta && vm.oEditor.isPlain() && ta.selectionEnd > ta.selectionStart) {
				return ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
			}
			return '';
		},

		/**
		 * how: 'prepend' | 'cursor' | 'replaceOwn' | 'replaceSelection'
		 */
		insertText = (vm, text, how) => {
			vm.editor(editor => {
				const ui = editor.editor, html = rl.Utils.plainToHtml(text);
				if (editor.isPlain()) {
					const ta = ui?.plain, cur = editor.getData() || '';
					if (('cursor' === how || 'replaceSelection' === how) && ta) {
						ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
						ta.dispatchEvent(new Event('input'));
					} else if ('replaceOwn' === how) {
						editor.setPlain(text + splitPlain(cur)[1]);
					} else {
						editor.setPlain(text + (cur.trim() ? '\n\n' + cur : ''));
					}
					return;
				}
				const sq = ui?.squire;
				if (sq && ('cursor' === how || 'replaceSelection' === how)) {
					sq.focus();
					sq.insertHTML(html);
				} else if (sq && 'prepend' === how) {
					sq.moveCursorToStart();
					sq.insertHTML(html + '<div><br></div>');
				} else {
					const cur = editor.getData() || '', parts = splitHtml(cur);
					editor.setHtml('replaceOwn' === how ? html + parts[1] : html + cur);
				}
			});
		},

		/* ---------- Compose oeffnen ---------- */
		pendingCompose = [],

		/**
		 * opts: {message (MessageModel) | null, to, subject, body, how, draft: {mode, instruction}}
		 */
		compose = opts => {
			pendingCompose.push(opts);
			if (opts.message) {
				rl.app.showMessageComposer([1, opts.message]);
			} else {
				rl.app.showMessageComposer([0]);
			}
		};

	addEventListener('rl-view-model.create', e => {
		const vm = e.detail;
		if ('PopupsCompose' === vm.viewModelTemplateID) {
			AI.composeVm = vm;
		} else if ('MailMessageView' === vm.viewModelTemplateID) {
			AI.messageVm = vm;
		} else if ('MailMessageList' === vm.viewModelTemplateID) {
			AI.listVm = vm;
		}
	});

	addEventListener('rl-vm-visible', e => {
		const vm = e.detail;
		if ('PopupsCompose' === vm.viewModelTemplateID && pendingCompose.length) {
			const opts = pendingCompose.shift();
			pendingCompose.length = 0;
			setTimeout(() => {
				opts.to && vm.to(opts.to);
				opts.subject && !vm.subject() && vm.subject(opts.subject);
				opts.body && insertText(vm, opts.body, opts.how || 'prepend');
				opts.draft && AI.openDraft?.(vm, opts.draft);
			}, 80);
		}
	});

	const AI = window.AiCopilot = {
		PLUGIN, cfg, ICONS, esc, i18n, renderText, request, folders, findFolder, systemFolder, currentFolder,
		userSettings, loadSettings, on, provider, providerLabel, consent, confirm, openMessage, setSearch,
		ownText, selectedText, insertText, compose,
		composeVm: null, messageVm: null, listVm: null,
		currentMessage: () => AI.messageVm?.message?.() || null,
		categoryLabel: cat => cat ? i18n('CAT_' + String(cat).toUpperCase(), cat) : '',
		categories: ['needs_reply', 'personal', 'newsletter', 'notification', 'invoice']
	};

	// Einstellungen laden, sobald angemeldet
	const boot = () => {
		if (rl.settings.get('Auth') && cfg('features')) {
			loadSettings();
		} else {
			setTimeout(boot, 1000);
		}
	};
	boot();

})(window.rl);
