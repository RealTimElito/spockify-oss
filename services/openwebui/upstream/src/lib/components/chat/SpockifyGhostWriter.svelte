<script lang="ts">
	import { onDestroy, onMount, getContext, tick } from 'svelte';
	import {
		ghostSuggest,
		ghostWorkspaceList,
		ghostWorkspaceRead,
		ghostWorkspaceWrite,
		ghostWorkspaceMkdir,
		ghostWorkspaceRename,
		ghostWorkspaceDelete,
		ghostWorkspaceDownloadFile,
		ghostWorkspaceDownloadZip,
		triggerBrowserDownload
	} from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	export let open = true;

	type Tab = {
		id: string;
		path: string | null;
		name: string;
		content: string;
		savedContent: string;
		language: string;
		dirty: boolean;
	};

	type TreeNode = {
		path: string;
		name: string;
		type: 'file' | 'dir';
		language?: string;
	};

	let editorEl: HTMLDivElement;
	let monaco: any = null;
	let editor: any = null;
	let inlineDisposable: any = null;
	let modelChangeDisposable: any = null;
	let loadingMonaco = false;

	let tabs: Tab[] = [];
	let activeTabId: string | null = null;
	let tree: TreeNode[] = [];
	let writable = true;
	let status = '';
	let localOnly = false;
	let latencyChip = '';
	let aiBusy = false;

	// AI panel (Cursor-like chat)
	type ChatRole = 'user' | 'assistant';
	type ApplyStrategy = 'selection' | 'search_replace' | 'ambiguous' | 'insert';
	type ProposedEdit = {
		newCode: string;
		oldCode?: string;
		strategy: ApplyStrategy;
		note?: string;
	};
	type ChatMsg = {
		id: string;
		role: ChatRole;
		content: string;
		streaming?: boolean;
		proposed?: ProposedEdit | null;
		applyNote?: string;
	};
	type SelSnap = {
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
		text: string;
	};

	let chatInput = '';
	let chatMessages: ChatMsg[] = [];
	let panelOpen = true;
	let lastChatSel: SelSnap | null = null;
	let pendingAmbiguous: { msgId: string; edit: ProposedEdit } | null = null;
	let chatScrollEl: HTMLDivElement | null = null;
	let streamTimer: ReturnType<typeof setInterval> | null = null;
	let contextLabel = 'no file';

	// Cmd+K inline edit
	let inlineEditOpen = false;
	let inlineEditPrompt = '';
	let inlineEditBusy = false;

	// File switcher (Ctrl+P)
	let paletteOpen = false;
	let paletteQuery = '';
	let paletteIndex = 0;

	// Tree context menu (right-click download / rename / delete)
	let ctxMenu: { x: number; y: number; node: TreeNode } | null = null;

	// Layout
	let treeWidth = 200;
	let aiWidth = 340;
	let resizing: 'tree' | 'ai' | null = null;

	let completeTimer: ReturnType<typeof setTimeout> | null = null;
	let completeSeq = 0;
	let lastCompleteText = '';

	const LANG_BY_EXT: Record<string, string> = {
		py: 'python',
		ts: 'typescript',
		tsx: 'typescript',
		js: 'javascript',
		jsx: 'javascript',
		json: 'json',
		md: 'markdown',
		html: 'html',
		css: 'css',
		svelte: 'html',
		rs: 'rust',
		go: 'go',
		sh: 'shell',
		yml: 'yaml',
		yaml: 'yaml',
		toml: 'ini',
		sql: 'sql',
		txt: 'plaintext'
	};

	const langFromPath = (path: string) => {
		const ext = (path.split('.').pop() || '').toLowerCase();
		return LANG_BY_EXT[ext] || 'plaintext';
	};

	const nameFromPath = (path: string) => path.split('/').pop() || path;

	const token = () => localStorage.token || '';

	const activeTab = (): Tab | null => tabs.find((t) => t.id === activeTabId) || null;

	const markDirtyFromEditor = () => {
		const tab = activeTab();
		if (!tab || !editor) return;
		const val = editor.getValue();
		tab.content = val;
		tab.dirty = val !== tab.savedContent;
		tabs = tabs;
	};

	const syncEditorToTab = async (tab: Tab | null) => {
		if (!editor || !monaco) return;
		if (!tab) {
			editor.setValue('');
			return;
		}
		const model = editor.getModel();
		if (model) {
			monaco.editor.setModelLanguage(model, tab.language || 'plaintext');
		}
		const cur = editor.getValue();
		if (cur !== tab.content) {
			editor.setValue(tab.content);
		}
		editor.updateOptions({ readOnly: !writable && !!tab.path });
		contextLabel = contextChip();
	};

	const openTab = async (path: string | null, opts?: { content?: string; name?: string }) => {
		if (path) {
			const existing = tabs.find((t) => t.path === path);
			if (existing) {
				activeTabId = existing.id;
				await tick();
				await syncEditorToTab(existing);
				return;
			}
			try {
				status = 'Opening…';
				const res = await ghostWorkspaceRead(token(), path);
				const tab: Tab = {
					id: `f-${path}-${Date.now()}`,
					path,
					name: nameFromPath(path),
					content: res.content || '',
					savedContent: res.content || '',
					language: res.language || langFromPath(path),
					dirty: false
				};
				tabs = [...tabs, tab];
				activeTabId = tab.id;
				await tick();
				await syncEditorToTab(tab);
				status = path;
			} catch (e) {
				status = `${e}`;
			}
			return;
		}
		const name = opts?.name || 'untitled';
		const content = opts?.content ?? '';
		const tab: Tab = {
			id: `u-${Date.now()}`,
			path: null,
			name,
			content,
			savedContent: content,
			language: langFromPath(name),
			dirty: !!content
		};
		tabs = [...tabs, tab];
		activeTabId = tab.id;
		await tick();
		await syncEditorToTab(tab);
		status = 'Untitled buffer';
	};

	const closeTab = (id: string) => {
		const idx = tabs.findIndex((t) => t.id === id);
		if (idx < 0) return;
		const wasActive = activeTabId === id;
		tabs = tabs.filter((t) => t.id !== id);
		if (wasActive) {
			const next = tabs[Math.min(idx, tabs.length - 1)] || null;
			activeTabId = next?.id || null;
			syncEditorToTab(next);
		}
	};

	const refreshTree = async () => {
		try {
			const res = await ghostWorkspaceList(token());
			tree = res?.nodes || [];
			writable = res?.writable !== false;
			if (res?.note) status = res.note;
		} catch (e) {
			status = `${e}`;
		}
	};

	const saveActive = async () => {
		const tab = activeTab();
		if (!tab || !editor) return;
		if (!writable) {
			status = 'Workspace is read-only for your role';
			return;
		}
		markDirtyFromEditor();
		let path = tab.path;
		if (!path) {
			const suggested = tab.name.includes('.') ? tab.name : `${tab.name}.py`;
			const entered = window.prompt('Save as (workspace path)', suggested);
			if (!entered) return;
			path = entered.replace(/^\/+/, '');
			tab.path = path;
			tab.name = nameFromPath(path);
			tab.language = langFromPath(path);
		}
		try {
			status = 'Saving…';
			await ghostWorkspaceWrite(token(), { path, content: tab.content });
			tab.savedContent = tab.content;
			tab.dirty = false;
			tabs = tabs;
			await refreshTree();
			status = `Saved ${path}`;
			await syncEditorToTab(tab);
		} catch (e) {
			status = `${e}`;
		}
	};

	const createFile = async () => {
		if (!writable) {
			status = 'Read-only workspace';
			return;
		}
		const path = window.prompt('New file path', 'src/main.py');
		if (!path) return;
		try {
			await ghostWorkspaceWrite(token(), { path: path.replace(/^\/+/, ''), content: '' });
			await refreshTree();
			await openTab(path.replace(/^\/+/, ''));
		} catch (e) {
			status = `${e}`;
		}
	};

	const createFolder = async () => {
		if (!writable) return;
		const path = window.prompt('New folder path', 'src');
		if (!path) return;
		try {
			await ghostWorkspaceMkdir(token(), { path: path.replace(/^\/+/, '') });
			await refreshTree();
		} catch (e) {
			status = `${e}`;
		}
	};

	const renameNode = async (node: TreeNode) => {
		if (!writable) return;
		const next = window.prompt('Rename to', node.path);
		if (!next || next === node.path) return;
		try {
			await ghostWorkspaceRename(token(), {
				from_path: node.path,
				to_path: next.replace(/^\/+/, '')
			});
			const tab = tabs.find((t) => t.path === node.path);
			if (tab) {
				tab.path = next.replace(/^\/+/, '');
				tab.name = nameFromPath(tab.path);
				tab.language = langFromPath(tab.path);
				tabs = tabs;
			}
			await refreshTree();
		} catch (e) {
			status = `${e}`;
		}
	};

	const deleteNode = async (node: TreeNode) => {
		if (!writable) return;
		if (!window.confirm(`Delete ${node.path}?`)) return;
		try {
			await ghostWorkspaceDelete(token(), node.path);
			tabs.filter((t) => t.path === node.path).forEach((t) => closeTab(t.id));
			await refreshTree();
		} catch (e) {
			status = `${e}`;
		}
	};

	const closeCtxMenu = () => {
		ctxMenu = null;
	};

	const openCtxMenu = (e: MouseEvent, node: TreeNode) => {
		e.preventDefault();
		e.stopPropagation();
		ctxMenu = { x: e.clientX, y: e.clientY, node };
	};

	/** Download open editor buffer (includes unsaved edits) with the tab filename. */
	const downloadActiveTab = () => {
		const tab = activeTab();
		if (!tab) {
			status = 'No open file to download';
			return;
		}
		markDirtyFromEditor();
		const name = tab.name.includes('.') ? tab.name : `${tab.name}.txt`;
		const blob = new Blob([tab.content ?? ''], { type: 'text/plain;charset=utf-8' });
		triggerBrowserDownload(blob, name);
		status = `Downloaded ${name}`;
		closeCtxMenu();
	};

	/** Download a saved workspace file (guests allowed). */
	const downloadTreeFile = async (path: string) => {
		try {
			status = 'Downloading…';
			const { blob, filename } = await ghostWorkspaceDownloadFile(token(), path);
			triggerBrowserDownload(blob, filename);
			status = `Downloaded ${filename}`;
		} catch (e) {
			status = `${e}`;
		}
		closeCtxMenu();
	};

	const downloadWorkspaceZip = async () => {
		try {
			status = 'Zipping workspace…';
			const { blob, filename } = await ghostWorkspaceDownloadZip(token());
			triggerBrowserDownload(blob, filename);
			status = `Downloaded ${filename}`;
		} catch (e) {
			status = `${e}`;
		}
		closeCtxMenu();
	};

	const requestComplete = async (prefix: string, suffix: string, language: string, filename: string) => {
		const seq = ++completeSeq;
		try {
			// Match IDE/router FIM budgets; keep a short FILE_HEAD when cursor is deep.
			const PREFIX_BUDGET = 4000;
			const SUFFIX_BUDGET = 1200;
			const pfx = prefix.slice(-PREFIX_BUDGET);
			const sfx = suffix.slice(0, SUFFIX_BUDGET);
			let context = '';
			if (prefix.length > PREFIX_BUDGET) {
				const head = prefix
					.slice(0, 900)
					.split('\n')
					.filter((l) =>
						/^\s*(import|from|package|export |#include|use |using )/i.test(l)
					)
					.slice(0, 40)
					.join('\n');
				if (head.trim()) context = `FILE_HEAD:\n${head}`;
			}
			const res = await ghostSuggest(token(), {
				mode: 'complete',
				prefix: pfx,
				suffix: sfx,
				context,
				code: pfx,
				language,
				filename,
				local_only: localOnly,
				instruction: 'inline completion'
			});
			if (seq !== completeSeq) return null;
			const text = res?.insert_text || res?.suggestion || '';
			if (res?.latency_ms != null) latencyChip = `${res.latency_ms}ms · ${res.mode || ''}`;
			lastCompleteText = text;
			return text;
		} catch {
			return null;
		}
	};

	const registerInlineCompletions = () => {
		if (!monaco || inlineDisposable) return;
		inlineDisposable = monaco.languages.registerInlineCompletionsProvider(
			{ pattern: '**' },
			{
				provideInlineCompletions: async (model: any, position: any) => {
					const tab = activeTab();
					if (!tab) return { items: [] };
					const offset = model.getOffsetAt(position);
					const full = model.getValue();
					const prefix = full.slice(0, offset);
					const suffix = full.slice(offset);
					// Debounce via short wait; cancel via completeSeq.
					// Match Spockify IDE (~80ms); server also runs instant local heuristics.
					const waitMs = localOnly ? 60 : 100;
					await new Promise((r) => setTimeout(r, waitMs));
					const text = await requestComplete(
						prefix,
						suffix,
						tab.language,
						tab.path || tab.name
					);
					if (!text) return { items: [] };
					return {
						items: [
							{
								insertText: text,
								range: {
									startLineNumber: position.lineNumber,
									startColumn: position.column,
									endLineNumber: position.lineNumber,
									endColumn: position.column
								}
							}
						]
					};
				},
				freeInlineCompletions: () => {}
			}
		);
	};

	const stripFences = (text: string): string => {
		let t = (text || '').trim();
		if (!t.startsWith('```')) return t;
		const lines = t.split('\n');
		if (lines[0]?.startsWith('```')) lines.shift();
		if (lines.length && lines[lines.length - 1]?.trim() === '```') lines.pop();
		return lines.join('\n').trim();
	};

	const extractFencedBlocks = (
		text: string
	): { lang: string; body: string; label?: string }[] => {
		const out: { lang: string; body: string; label?: string }[] = [];
		const re = /```([\w+-]*)\n([\s\S]*?)```/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) {
			out.push({ lang: (m[1] || '').toLowerCase(), body: m[2].replace(/\n$/, '') });
		}
		return out;
	};

	/** Infer BEFORE/AFTER or single replacement from model reply. */
	const parseProposedEdit = (
		reply: string,
		fileContent: string,
		selection: string
	): ProposedEdit | null => {
		const fences = extractFencedBlocks(reply);
		const lower = reply.toLowerCase();
		const beforeMatch = reply.match(
			/(?:^|\n)\s*(?:BEFORE|OLD|ORIGINAL)\s*:?\s*\n+```[\w+-]*\n([\s\S]*?)```/i
		);
		const afterMatch = reply.match(
			/(?:^|\n)\s*(?:AFTER|NEW|REPLACEMENT|UPDATED)\s*:?\s*\n+```[\w+-]*\n([\s\S]*?)```/i
		);
		if (beforeMatch && afterMatch) {
			const oldCode = beforeMatch[1].replace(/\n$/, '');
			const newCode = afterMatch[1].replace(/\n$/, '');
			const found = fileContent.includes(oldCode);
			const hasSel = !!(selection && selection.trim());
			return {
				oldCode,
				newCode,
				strategy: found ? 'search_replace' : hasSel ? 'selection' : 'ambiguous',
				note: found
					? 'Search & replace BEFORE→AFTER'
					: hasSel
						? 'BEFORE not in file — replace selection'
						: 'BEFORE block not found in file'
			};
		}

		// Unlabeled dual fences: treat as old→new when first occurs in file.
		if (fences.length >= 2) {
			const a = fences[0].body;
			const b = fences[1].body;
			if (a !== b && fileContent.includes(a)) {
				return {
					oldCode: a,
					newCode: b,
					strategy: 'search_replace',
					note: 'Search & replace first→second fence'
				};
			}
			if (selection && a === selection) {
				return { newCode: b, oldCode: a, strategy: 'selection', note: 'Replace selection' };
			}
			if (lower.includes('before') && lower.includes('after')) {
				return {
					oldCode: a,
					newCode: b,
					strategy: fileContent.includes(a) ? 'search_replace' : 'ambiguous',
					note: 'Paired fences'
				};
			}
		}

		const single = fences.length === 1 ? fences[0].body : null;
		const codeish =
			single ||
			(reply.trim().startsWith('```') ? stripFences(reply) : null);

		if (!codeish) return null;

		if (selection && selection.trim()) {
			return {
				newCode: codeish,
				oldCode: selection,
				strategy: 'selection',
				note: 'Replace selection'
			};
		}

		// Unique occurrence of a likely "old" snippet mentioned in prose is rare;
		// if the fenced block already exists elsewhere, treat as ambiguous.
		const occ = fileContent.split(codeish).length - 1;
		if (occ === 0) {
			// New code — try to find a smaller unique old region? Fall back to insert vs ambiguous.
			return {
				newCode: codeish,
				strategy: 'ambiguous',
				note: 'No selection — choose how to apply'
			};
		}
		if (occ === 1) {
			// Model returned existing code unchanged — not useful as replace target alone.
			return {
				newCode: codeish,
				oldCode: codeish,
				strategy: 'ambiguous',
				note: 'Block already in file — confirm apply'
			};
		}
		return {
			newCode: codeish,
			strategy: 'ambiguous',
			note: 'Ambiguous apply target'
		};
	};

	const scrollChatToBottom = async () => {
		await tick();
		if (chatScrollEl) chatScrollEl.scrollTop = chatScrollEl.scrollHeight;
	};

	const streamReveal = async (msgId: string, full: string) => {
		if (streamTimer) {
			clearInterval(streamTimer);
			streamTimer = null;
		}
		const step = Math.max(12, Math.floor(full.length / 40));
		let i = 0;
		return new Promise<void>((resolve) => {
			streamTimer = setInterval(() => {
				i = Math.min(full.length, i + step);
				chatMessages = chatMessages.map((m) =>
					m.id === msgId ? { ...m, content: full.slice(0, i), streaming: i < full.length } : m
				);
				scrollChatToBottom();
				if (i >= full.length) {
					if (streamTimer) clearInterval(streamTimer);
					streamTimer = null;
					resolve();
				}
			}, 16);
		});
	};

	const snapSelection = (): SelSnap | null => {
		if (!editor) return null;
		const sel = editor.getSelection();
		if (!sel || sel.isEmpty()) return null;
		const text = editor.getModel()?.getValueInRange(sel) || '';
		if (!text) return null;
		return {
			startLineNumber: sel.startLineNumber,
			startColumn: sel.startColumn,
			endLineNumber: sel.endLineNumber,
			endColumn: sel.endColumn,
			text
		};
	};

	const runChat = async () => {
		const tab = activeTab();
		const prompt = chatInput.trim();
		if (!editor || !prompt || aiBusy) return;

		const selSnap = snapSelection();
		lastChatSel = selSnap;
		const selText = selSnap?.text || '';
		const fileContent = editor.getValue();

		const userMsg: ChatMsg = {
			id: `u-${Date.now()}`,
			role: 'user',
			content: prompt
		};
		const asstId = `a-${Date.now()}`;
		const asstMsg: ChatMsg = {
			id: asstId,
			role: 'assistant',
			content: '',
			streaming: true
		};
		chatMessages = [...chatMessages, userMsg, asstMsg];
		chatInput = '';
		pendingAmbiguous = null;
		aiBusy = true;
		status = 'Ghost thinking…';
		await scrollChatToBottom();

		try {
			const res = await ghostSuggest(token(), {
				mode: 'chat',
				code: fileContent,
				selection: selText,
				language: tab?.language || 'plaintext',
				filename: tab?.path || tab?.name || 'untitled',
				instruction: prompt,
				local_only: localOnly
			});
			const full = res?.suggestion || '(no reply)';
			const proposed = parseProposedEdit(full, fileContent, selText);
			await streamReveal(asstId, full);
			chatMessages = chatMessages.map((m) =>
				m.id === asstId
					? { ...m, content: full, streaming: false, proposed }
					: m
			);
			if (proposed?.strategy === 'ambiguous') {
				pendingAmbiguous = { msgId: asstId, edit: proposed };
			}
			if (res?.latency_ms != null) latencyChip = `${res.latency_ms}ms · ${res.mode || ''}`;
			status = res?.note || 'ok';
		} catch (e) {
			chatMessages = chatMessages.map((m) =>
				m.id === asstId
					? { ...m, content: `${e}`, streaming: false, proposed: null }
					: m
			);
			status = `${e}`;
		} finally {
			aiBusy = false;
			await scrollChatToBottom();
		}
	};

	const executeReplaceRange = (range: any, text: string) => {
		if (!editor) return;
		editor.executeEdits('ghost-ai', [{ range, text }]);
		markDirtyFromEditor();
	};

	const applyProposed = (edit: ProposedEdit, force?: ApplyStrategy) => {
		if (!editor || !edit?.newCode) return;
		const strategy = force || edit.strategy;
		const model = editor.getModel();
		if (!model) return;

		if (strategy === 'selection') {
			const snap = lastChatSel;
			if (snap && snap.text) {
				const range = {
					startLineNumber: snap.startLineNumber,
					startColumn: snap.startColumn,
					endLineNumber: snap.endLineNumber,
					endColumn: snap.endColumn
				};
				// Prefer live selection if it still matches the snap text.
				const live = editor.getSelection();
				if (live && !live.isEmpty()) {
					const liveText = model.getValueInRange(live);
					if (liveText === snap.text) {
						executeReplaceRange(live, edit.newCode);
						status = 'Applied · replaced selection';
						pendingAmbiguous = null;
						return;
					}
				}
				executeReplaceRange(range, edit.newCode);
				status = 'Applied · replaced selection (at ask time)';
				pendingAmbiguous = null;
				return;
			}
			const live = editor.getSelection();
			if (live && !live.isEmpty()) {
				executeReplaceRange(live, edit.newCode);
				status = 'Applied · replaced current selection';
				pendingAmbiguous = null;
				return;
			}
			status = 'No selection to replace — use Find & replace or Insert';
			return;
		}

		if (strategy === 'search_replace') {
			const oldCode = edit.oldCode;
			if (!oldCode) {
				status = 'No BEFORE block to search for';
				return;
			}
			const full = model.getValue();
			const idx = full.indexOf(oldCode);
			if (idx < 0) {
				status = 'BEFORE block not found in file';
				pendingAmbiguous = pendingAmbiguous; // keep UI
				return;
			}
			const start = model.getPositionAt(idx);
			const end = model.getPositionAt(idx + oldCode.length);
			executeReplaceRange(
				{
					startLineNumber: start.lineNumber,
					startColumn: start.column,
					endLineNumber: end.lineNumber,
					endColumn: end.column
				},
				edit.newCode
			);
			status = 'Applied · search & replace';
			pendingAmbiguous = null;
			return;
		}

		if (strategy === 'insert') {
			const pos = editor.getPosition();
			executeReplaceRange(
				{
					startLineNumber: pos.lineNumber,
					startColumn: pos.column,
					endLineNumber: pos.lineNumber,
					endColumn: pos.column
				},
				edit.newCode
			);
			status = 'Inserted at cursor';
			pendingAmbiguous = null;
			return;
		}

		// ambiguous — surface choices; do not append blindly
		pendingAmbiguous = pendingAmbiguous || {
			msgId: '',
			edit: { ...edit, strategy: 'ambiguous' }
		};
		status = edit.note || 'Choose how to apply';
	};

	const applyFromMessage = (msg: ChatMsg, force?: ApplyStrategy) => {
		if (!msg.proposed) return;
		applyProposed(msg.proposed, force);
		if (force || msg.proposed.strategy !== 'ambiguous') {
			chatMessages = chatMessages.map((m) =>
				m.id === msg.id ? { ...m, applyNote: status } : m
			);
		}
	};

	const runInlineEdit = async () => {
		if (!editor || !inlineEditPrompt.trim()) return;
		const sel = editor.getSelection();
		if (!sel || sel.isEmpty()) {
			status = 'Select code first for Ctrl/Cmd+K';
			return;
		}
		const selRange = {
			startLineNumber: sel.startLineNumber,
			startColumn: sel.startColumn,
			endLineNumber: sel.endLineNumber,
			endColumn: sel.endColumn
		};
		inlineEditBusy = true;
		try {
			const tab = activeTab();
			const selected = editor.getModel().getValueInRange(sel);
			const res = await ghostSuggest(token(), {
				mode: 'edit',
				selection: selected,
				code: editor.getValue(),
				language: tab?.language || 'plaintext',
				filename: tab?.path || tab?.name || 'untitled',
				instruction: inlineEditPrompt.trim(),
				local_only: localOnly
			});
			const text = stripFences(res?.suggestion || '');
			if (text) {
				editor.executeEdits('ghost-k', [{ range: selRange, text }]);
				markDirtyFromEditor();
				status = res?.note || 'Edited selection';
				if (res?.latency_ms != null) latencyChip = `${res.latency_ms}ms · ${res.mode || ''}`;
			}
			inlineEditOpen = false;
			inlineEditPrompt = '';
		} catch (e) {
			status = `${e}`;
		} finally {
			inlineEditBusy = false;
		}
	};

	/** Render assistant markdown lightly: split fences into code blocks. */
	const renderParts = (
		content: string
	): { type: 'text' | 'code'; text: string }[] => {
		const parts: { type: 'text' | 'code'; text: string }[] = [];
		const re = /```[\w+-]*\n([\s\S]*?)```/g;
		let last = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(content))) {
			if (m.index > last) {
				parts.push({ type: 'text', text: content.slice(last, m.index) });
			}
			parts.push({ type: 'code', text: m[1].replace(/\n$/, '') });
			last = m.index + m[0].length;
		}
		if (last < content.length) parts.push({ type: 'text', text: content.slice(last) });
		if (!parts.length) parts.push({ type: 'text', text: content });
		return parts;
	};

	const contextChip = (): string => {
		const tab = activeTab();
		const name = tab?.path || tab?.name || 'no file';
		const sel = snapSelection();
		if (sel) {
			const lines = sel.text.split('\n').length;
			return `${name} · ${lines} line${lines === 1 ? '' : 's'} selected`;
		}
		return name;
	};

	const paletteFiles = (): TreeNode[] => {
		const q = paletteQuery.trim().toLowerCase();
		const files = tree.filter((n) => n.type === 'file');
		if (!q) return files.slice(0, 40);
		return files.filter((n) => n.path.toLowerCase().includes(q)).slice(0, 40);
	};

	const onKeyDown = (e: KeyboardEvent) => {
		const meta = e.metaKey || e.ctrlKey;
		if (meta && e.key.toLowerCase() === 's') {
			e.preventDefault();
			saveActive();
			return;
		}
		if (meta && e.key.toLowerCase() === 'p') {
			e.preventDefault();
			paletteOpen = true;
			paletteQuery = '';
			paletteIndex = 0;
			return;
		}
		if (meta && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			inlineEditOpen = true;
			inlineEditPrompt = '';
			return;
		}
		if (e.key === 'Escape') {
			paletteOpen = false;
			inlineEditOpen = false;
			ctxMenu = null;
		}
		if (paletteOpen) {
			const items = paletteFiles();
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				paletteIndex = Math.min(paletteIndex + 1, Math.max(0, items.length - 1));
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				paletteIndex = Math.max(0, paletteIndex - 1);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				const hit = items[paletteIndex];
				if (hit) {
					paletteOpen = false;
					openTab(hit.path);
				}
			}
		}
	};

	const onResizeMove = (e: MouseEvent) => {
		if (!resizing) return;
		const root = document.getElementById('ghost-ide-root');
		if (!root) return;
		const rect = root.getBoundingClientRect();
		if (resizing === 'tree') {
			treeWidth = Math.min(360, Math.max(140, e.clientX - rect.left));
		} else if (resizing === 'ai') {
			aiWidth = Math.min(480, Math.max(200, rect.right - e.clientX));
		}
	};

	const onResizeUp = () => {
		resizing = null;
	};

	const loadMonaco = async () => {
		if (monaco || loadingMonaco) return;
		loadingMonaco = true;
		status = 'Loading Monaco…';
		await new Promise<void>((resolve, reject) => {
			const existing = document.querySelector('script[data-spockify-monaco]');
			if ((window as any).monaco) {
				monaco = (window as any).monaco;
				resolve();
				return;
			}
			if (!existing) {
				const link = document.createElement('link');
				link.rel = 'stylesheet';
				link.href =
					'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/editor/editor.main.css';
				document.head.appendChild(link);
				const loader = document.createElement('script');
				loader.dataset.spockifyMonaco = '1';
				loader.src =
					'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js';
				loader.onload = () => resolve();
				loader.onerror = () => reject(new Error('Monaco loader failed'));
				document.head.appendChild(loader);
			} else {
				resolve();
			}
		});
		const req = (window as any).require;
		if (req) {
			req.config({
				paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' }
			});
			await new Promise<void>((resolve) => {
				req(['vs/editor/editor.main'], () => {
					monaco = (window as any).monaco;
					resolve();
				});
			});
		} else {
			monaco = (window as any).monaco;
		}
		if (editorEl && monaco && !editor) {
			editor = monaco.editor.create(editorEl, {
				value: '',
				language: 'python',
				theme: document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs',
				minimap: { enabled: true, maxColumn: 80 },
				automaticLayout: true,
				fontSize: 13,
				fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
				quickSuggestions: true,
				suggestOnTriggerCharacters: true,
				wordBasedSuggestions: 'currentDocument',
				inlineSuggest: { enabled: true },
				scrollbar: { verticalScrollbarSize: 8 },
				renderLineHighlight: 'line',
				padding: { top: 8 }
			});
			modelChangeDisposable = editor.onDidChangeModelContent(() => {
				markDirtyFromEditor();
			});
			editor.onDidChangeCursorSelection(() => {
				contextLabel = contextChip();
			});
			registerInlineCompletions();
			contextLabel = contextChip();
		}
		loadingMonaco = false;
	};

	const ingestChatSeed = async () => {
		try {
			const fromSel = sessionStorage.getItem('spockifyGhostSeed');
			if (fromSel && fromSel.trim()) {
				sessionStorage.removeItem('spockifyGhostSeed');
				await openTab(null, {
					name: 'from-chat.py',
					content: fromSel
				});
				status = 'Opened from chat selection';
				return true;
			}
		} catch {
			/* ignore */
		}
		return false;
	};

	onMount(async () => {
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('mousemove', onResizeMove);
		window.addEventListener('mouseup', onResizeUp);
		window.addEventListener('click', closeCtxMenu);
		if (open) {
			await loadMonaco();
			await refreshTree();
			const seeded = await ingestChatSeed();
			if (!seeded && tree.some((n) => n.type === 'file')) {
				const first = tree.find((n) => n.type === 'file');
				if (first) await openTab(first.path);
			}
		}
	});

	onDestroy(() => {
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('mousemove', onResizeMove);
		window.removeEventListener('mouseup', onResizeUp);
		window.removeEventListener('click', closeCtxMenu);
		if (completeTimer) clearTimeout(completeTimer);
		if (streamTimer) clearInterval(streamTimer);
		inlineDisposable?.dispose?.();
		modelChangeDisposable?.dispose?.();
		editor?.dispose?.();
	});

	$: if (open && !editor) {
		loadMonaco();
	}

	$: dirs = tree.filter((n) => n.type === 'dir');
	$: files = tree.filter((n) => n.type === 'file');
</script>

{#if open}
	<div
		id="ghost-ide-root"
		class="flex flex-col border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-950 min-h-[520px] h-[min(78vh,820px)]"
	>
		<!-- Title bar -->
		<div
			class="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 text-xs bg-gray-50 dark:bg-gray-900/80"
		>
			<div class="flex items-center gap-2 min-w-0">
				<span class="font-semibold tracking-tight">{$i18n.t('Ghost')} · AI IDE</span>
				<span class="text-gray-400 truncate hidden sm:inline">
					{activeTab()?.path || activeTab()?.name || 'My Ghost workspace'}
				</span>
			</div>
			<div class="flex items-center gap-2 shrink-0">
				{#if latencyChip}
					<span class="text-[10px] text-gray-400 tabular-nums">{latencyChip}</span>
				{/if}
				<button
					type="button"
					class="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-40"
					disabled={!activeTab()}
					on:click={downloadActiveTab}
					title="Download open file"
				>
					Download
				</button>
				<label class="flex items-center gap-1 text-gray-500" title="Skip remote LLM">
					<input type="checkbox" bind:checked={localOnly} />
					local-only
				</label>
				<button
					type="button"
					class="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
					on:click={() => (panelOpen = !panelOpen)}
					title="Toggle AI panel"
				>
					{panelOpen ? 'Hide AI' : 'Show AI'}
				</button>
			</div>
		</div>

		<div class="flex flex-1 min-h-0">
			<!-- File tree -->
			<aside
				class="flex flex-col border-r border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/40 text-xs shrink-0"
				style="width:{treeWidth}px"
			>
				<div class="flex items-center justify-between px-2 py-1.5 border-b border-gray-200 dark:border-gray-800">
					<span class="font-medium text-gray-600 dark:text-gray-300">Files</span>
					<div class="flex gap-1">
						<button
							type="button"
							class="px-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800"
							title="Download workspace as zip"
							on:click={downloadWorkspaceZip}>↓zip</button
						>
						<button
							type="button"
							class="px-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800"
							title="New file"
							on:click={createFile}
							disabled={!writable}>+</button
						>
						<button
							type="button"
							class="px-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800"
							title="New folder"
							on:click={createFolder}
							disabled={!writable}>/</button
						>
					</div>
				</div>
				<div class="flex-1 overflow-auto py-1">
					{#if !files.length && !dirs.length}
						<div class="px-3 py-6 text-center text-gray-500">
							<p class="mb-2">Empty workspace</p>
							<button
								type="button"
								class="underline text-gray-700 dark:text-gray-200"
								on:click={createFile}
								disabled={!writable}
							>
								Create a file
							</button>
						</div>
					{:else}
						{#each dirs as node (node.path)}
							<div
								class="group flex items-center gap-1 px-2 py-0.5 text-gray-500 hover:bg-gray-200/60 dark:hover:bg-gray-800/60"
							>
								<span class="truncate flex-1">{node.name}/</span>
								{#if writable}
									<button
										type="button"
										class="opacity-0 group-hover:opacity-100 text-[10px]"
										on:click={() => renameNode(node)}>ren</button
									>
									<button
										type="button"
										class="opacity-0 group-hover:opacity-100 text-[10px]"
										on:click={() => deleteNode(node)}>×</button
									>
								{/if}
							</div>
						{/each}
						{#each files as node (node.path)}
							<div
								class="group flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-gray-200/60 dark:hover:bg-gray-800/60 {activeTab()?.path ===
								node.path
									? 'bg-gray-200/80 dark:bg-gray-800'
									: ''}"
								on:contextmenu={(e) => openCtxMenu(e, node)}
							>
								<button
									type="button"
									class="truncate flex-1 text-left"
									on:click={() => openTab(node.path)}
								>
									{node.name}
								</button>
								<button
									type="button"
									class="opacity-0 group-hover:opacity-100 text-[10px]"
									title="Download file"
									on:click|stopPropagation={() => downloadTreeFile(node.path)}>↓</button
								>
								{#if writable}
									<button
										type="button"
										class="opacity-0 group-hover:opacity-100 text-[10px]"
										on:click|stopPropagation={() => renameNode(node)}>ren</button
									>
									<button
										type="button"
										class="opacity-0 group-hover:opacity-100 text-[10px]"
										on:click|stopPropagation={() => deleteNode(node)}>×</button
									>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
				<div class="px-2 py-1 border-t border-gray-200 dark:border-gray-800 text-[10px] text-gray-400">
					{writable ? 'Private to your account' : 'Read-only (guest)'}
				</div>
			</aside>

			<!-- Resize tree -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				role="separator"
				class="w-1 cursor-col-resize hover:bg-sky-500/40 bg-transparent"
				on:mousedown={() => (resizing = 'tree')}
			></div>

			<!-- Editor column -->
			<div class="flex flex-col flex-1 min-w-0 min-h-0">
				<!-- Tabs -->
				<div
					class="flex items-stretch gap-0 overflow-x-auto border-b border-gray-200 dark:border-gray-800 bg-gray-100/80 dark:bg-gray-900/60 text-xs"
				>
					{#each tabs as tab (tab.id)}
						<div
							class="flex items-center gap-1 px-2.5 py-1.5 border-r border-gray-200 dark:border-gray-800 cursor-pointer shrink-0 {tab.id ===
							activeTabId
								? 'bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100'
								: 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-900'}"
						>
							<button
								type="button"
								class="max-w-[140px] truncate"
								on:click={() => {
									activeTabId = tab.id;
									syncEditorToTab(tab);
								}}
							>
								{tab.dirty ? '● ' : ''}{tab.name}
							</button>
							<button
								type="button"
								class="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
								on:click|stopPropagation={() => closeTab(tab.id)}
								aria-label="Close tab">×</button
							>
						</div>
					{/each}
					{#if !tabs.length}
						<div class="px-3 py-1.5 text-gray-400">No open files</div>
					{/if}
				</div>

				<!-- Breadcrumb / path -->
				{#if activeTab()}
					<div
						class="px-3 py-0.5 text-[10px] text-gray-400 border-b border-gray-100 dark:border-gray-900 truncate font-mono flex items-center gap-2"
					>
						<span class="truncate flex-1 min-w-0"
							>{activeTab()?.path || activeTab()?.name}
							<span class="ml-2 opacity-70">{activeTab()?.language}</span></span
						>
						<button
							type="button"
							class="shrink-0 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
							title="Download open file"
							on:click={downloadActiveTab}>↓ download</button
						>
					</div>
				{/if}

				<div class="relative flex-1 min-h-0">
					{#if !tabs.length}
						<div
							class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-gray-500 z-10 bg-white/80 dark:bg-gray-950/80"
						>
							<p>Open a file from the tree, or create one to start.</p>
							<button
								type="button"
								class="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-900"
								on:click={createFile}
							>
								Create a file
							</button>
							<p class="text-[11px] text-gray-400">
								Ctrl/Cmd+P file · Ctrl/Cmd+S save · Ctrl/Cmd+K edit · Tab accept ghost text
							</p>
						</div>
					{/if}
					<div bind:this={editorEl} class="absolute inset-0 w-full h-full"></div>

					{#if inlineEditOpen}
						<div
							class="absolute left-4 right-4 top-4 z-20 rounded-md border border-sky-500/50 bg-white dark:bg-gray-900 shadow-lg p-3 text-xs"
						>
							<div class="font-medium mb-1">Inline edit (Ctrl/Cmd+K)</div>
							<input
								class="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-transparent mb-2"
								placeholder="e.g. Add error handling"
								bind:value={inlineEditPrompt}
								on:keydown={(e) => e.key === 'Enter' && runInlineEdit()}
							/>
							<div class="flex gap-2">
								<button
									type="button"
									class="px-2 py-1 rounded bg-sky-600 text-white disabled:opacity-50"
									disabled={inlineEditBusy}
									on:click={runInlineEdit}
								>
									{inlineEditBusy ? '…' : 'Apply'}
								</button>
								<button
									type="button"
									class="px-2 py-1 rounded border border-gray-300 dark:border-gray-600"
									on:click={() => (inlineEditOpen = false)}>Cancel</button
								>
							</div>
						</div>
					{/if}
				</div>

				<div
					class="px-2 py-1 border-t border-gray-200 dark:border-gray-800 text-[10px] text-gray-400 flex justify-between gap-2"
				>
					<span class="truncate">{status}</span>
					<span class="shrink-0">Tab · accept completion</span>
				</div>
			</div>

			{#if panelOpen}
				<!-- Resize AI -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					role="separator"
					class="w-1 cursor-col-resize hover:bg-sky-500/40"
					on:mousedown={() => (resizing = 'ai')}
				></div>

				<!-- AI chat sidebar (Cursor-like) -->
				<aside
					class="flex flex-col border-l border-gray-200 dark:border-gray-800 bg-[#f7f7f7] dark:bg-[#1e1e1e] text-xs shrink-0"
					style="width:{aiWidth}px"
				>
					<div
						class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200/80 dark:border-gray-800"
					>
						<span class="font-medium text-[12px] tracking-tight text-gray-800 dark:text-gray-100"
							>Chat</span
						>
						<button
							type="button"
							class="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
							on:click={() => {
								chatMessages = [];
								pendingAmbiguous = null;
							}}
							title="Clear chat"
						>
							Clear
						</button>
					</div>

					<div
						bind:this={chatScrollEl}
						class="flex-1 overflow-y-auto min-h-0 px-2 py-2 space-y-3"
					>
						{#if !chatMessages.length}
							<div class="px-2 py-8 text-center text-gray-400 text-[11px] leading-relaxed">
								Ask about the open file or selection.<br />
								<span class="text-gray-500">Ghost keeps file context like Cursor.</span>
							</div>
						{/if}
						{#each chatMessages as msg (msg.id)}
							<div class="flex flex-col gap-1 {msg.role === 'user' ? 'items-end' : 'items-stretch'}">
								{#if msg.role === 'user'}
									<div
										class="max-w-[95%] rounded-2xl rounded-br-md bg-sky-600 text-white px-3 py-2 text-[12px] leading-snug whitespace-pre-wrap break-words"
									>
										{msg.content}
									</div>
								{:else}
									<div
										class="rounded-lg border border-gray-200/70 dark:border-gray-800 bg-white dark:bg-[#252526] px-2.5 py-2 text-[12px] leading-relaxed text-gray-800 dark:text-gray-200"
									>
										{#each renderParts(msg.content) as part, pi (pi)}
											{#if part.type === 'code'}
												<pre
													class="my-1.5 max-h-48 overflow-auto rounded-md bg-gray-100 dark:bg-[#1a1a1a] border border-gray-200/60 dark:border-gray-800 px-2 py-1.5 font-mono text-[10px] leading-snug whitespace-pre"
												>{part.text}</pre>
											{:else if part.text.trim()}
												<p class="whitespace-pre-wrap break-words text-[12px]">{part.text}</p>
											{/if}
										{/each}
										{#if msg.streaming}
											<span class="inline-block w-1.5 h-3 ml-0.5 bg-sky-500/80 animate-pulse align-middle"
											></span>
										{/if}
									</div>
									{#if msg.proposed && !msg.streaming}
										<div
											class="flex flex-col gap-1.5 px-0.5 pt-0.5 text-[10px] text-gray-500"
										>
											<span class="truncate">{msg.proposed.note || 'Proposed edit'}</span>
											{#if msg.proposed.strategy === 'ambiguous' || (pendingAmbiguous && pendingAmbiguous.msgId === msg.id)}
												{#if msg.proposed.oldCode}
													<pre
														class="max-h-16 overflow-auto rounded bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 px-1.5 py-1 font-mono text-[9px] line-through opacity-80"
													>{msg.proposed.oldCode.slice(0, 400)}</pre>
												{/if}
												<pre
													class="max-h-20 overflow-auto rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 px-1.5 py-1 font-mono text-[9px]"
												>{msg.proposed.newCode.slice(0, 500)}</pre>
												<div class="flex flex-wrap gap-1.5">
													<button
														type="button"
														class="px-2 py-0.5 rounded bg-sky-600 text-white hover:bg-sky-500"
														on:click={() => applyFromMessage(msg, 'selection')}
														>Replace selection</button
													>
													{#if msg.proposed.oldCode}
														<button
															type="button"
															class="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
															on:click={() => applyFromMessage(msg, 'search_replace')}
															>Find &amp; replace</button
														>
													{/if}
													<button
														type="button"
														class="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
														on:click={() => applyFromMessage(msg, 'insert')}>Insert</button
													>
												</div>
											{:else}
												<button
													type="button"
													class="self-start px-2.5 py-1 rounded bg-sky-600 text-white hover:bg-sky-500 font-medium"
													on:click={() => applyFromMessage(msg)}
												>
													Apply
												</button>
											{/if}
											{#if msg.applyNote}
												<span class="text-emerald-600 dark:text-emerald-400">{msg.applyNote}</span>
											{/if}
										</div>
									{/if}
								{/if}
							</div>
						{/each}
					</div>

					<!-- Composer -->
					<div class="border-t border-gray-200/80 dark:border-gray-800 p-2 space-y-1.5 bg-[#f0f0f0] dark:bg-[#181818]">
						<div
							class="flex items-center gap-1.5 px-1 text-[10px] text-gray-500 truncate"
							title={contextLabel}
						>
							<span class="shrink-0 text-gray-400">@</span>
							<span class="truncate font-mono">{contextLabel}</span>
						</div>
						<div
							class="flex items-end gap-1.5 rounded-xl border border-gray-300/80 dark:border-gray-700 bg-white dark:bg-[#252526] px-2 py-1.5 shadow-sm"
						>
							<textarea
								class="flex-1 min-h-[40px] max-h-28 resize-none bg-transparent outline-none text-[12px] leading-snug py-1"
								placeholder="Edit or ask…"
								rows="2"
								bind:value={chatInput}
								on:keydown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										runChat();
									}
								}}
							></textarea>
							<button
								type="button"
								class="shrink-0 mb-0.5 w-7 h-7 rounded-lg bg-sky-600 text-white flex items-center justify-center disabled:opacity-40 hover:bg-sky-500"
								disabled={aiBusy || !chatInput.trim()}
								on:click={runChat}
								title="Send"
								aria-label="Send"
							>
								{#if aiBusy}
									<span class="text-[10px]">…</span>
								{:else}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
										><path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.5.5 0 00-.66.66l2.2 7.54L3 12l1.94.2-2.2 7.54a.5.5 0 00.66.66z"
										/></svg
									>
								{/if}
							</button>
						</div>
						<p class="px-1 text-[9px] text-gray-400">Enter send · Shift+Enter newline</p>
					</div>
				</aside>
			{/if}
		</div>

		{#if paletteOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40"
				on:click={() => (paletteOpen = false)}
			>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="w-full max-w-md rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 shadow-xl overflow-hidden"
					on:click|stopPropagation
				>
					<input
						class="w-full px-3 py-2.5 text-sm border-b border-gray-200 dark:border-gray-800 bg-transparent outline-none"
						placeholder="Go to file…"
						bind:value={paletteQuery}
						autofocus
					/>
					<ul class="max-h-64 overflow-auto text-sm">
						{#each paletteFiles() as f, i (f.path)}
							<li>
								<button
									type="button"
									class="w-full text-left px-3 py-1.5 truncate {i === paletteIndex
										? 'bg-sky-100 dark:bg-sky-900/40'
										: 'hover:bg-gray-100 dark:hover:bg-gray-900'}"
									on:click={() => {
										paletteOpen = false;
										openTab(f.path);
									}}
									on:mouseenter={() => (paletteIndex = i)}
								>
									{f.path}
								</button>
							</li>
						{:else}
							<li class="px-3 py-3 text-gray-400 text-xs">No files</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}

		{#if ctxMenu}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed z-[60] min-w-[140px] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 shadow-lg text-xs py-1"
				style="left:{ctxMenu.x}px; top:{ctxMenu.y}px"
				on:click|stopPropagation
			>
				{#if ctxMenu.node.type === 'file'}
					<button
						type="button"
						class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-900"
						on:click={() => {
							const p = ctxMenu?.node.path;
							if (p) downloadTreeFile(p);
						}}
					>
						Download
					</button>
					<button
						type="button"
						class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-900"
						on:click={() => {
							const p = ctxMenu?.node.path;
							closeCtxMenu();
							if (p) openTab(p);
						}}
					>
						Open
					</button>
				{/if}
				{#if writable}
					<button
						type="button"
						class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-900"
						on:click={() => {
							const n = ctxMenu?.node;
							closeCtxMenu();
							if (n) renameNode(n);
						}}
					>
						Rename
					</button>
					<button
						type="button"
						class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-900 text-red-600"
						on:click={() => {
							const n = ctxMenu?.node;
							closeCtxMenu();
							if (n) deleteNode(n);
						}}
					>
						Delete
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}
