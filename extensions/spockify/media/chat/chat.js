/* Spockify Chat webview — Cursor-like dense composer + sticky scroll */
(function () {
  const vscode = acquireVsCodeApi();

  const el = {
    messages: document.getElementById('messages'),
    input: document.getElementById('input'),
    sendStop: document.getElementById('sendStop'),
    send: document.getElementById('sendStop'),
    stop: document.getElementById('sendStop'),
    filePick: document.getElementById('filePick'),
    model: document.getElementById('model'),
    agentMode: document.getElementById('agentMode'),
    modeBtn: document.getElementById('modeBtn'),
    modeBtnIcon: document.getElementById('modeBtnIcon'),
    modeBtnLabel: document.getElementById('modeBtnLabel'),
    modeMenu: document.getElementById('modeMenu'),
    composerBox: document.getElementById('composerBox'),
    modelBtn: document.getElementById('modelBtn'),
    modelBtnLabel: document.getElementById('modelBtnLabel'),
    modelMenu: document.getElementById('modelMenu'),
    modelSearch: document.getElementById('modelSearch'),
    modelList: document.getElementById('modelList'),
    autoToggle: document.getElementById('autoToggle'),
    maxToggle: document.getElementById('maxToggle'),
    thinkBtn: document.getElementById('thinkBtn'),
    thinkBtnLabel: document.getElementById('thinkBtnLabel'),
    permBtn: document.getElementById('permBtn'),
    permBtnLabel: document.getElementById('permBtnLabel'),
    permMenu: document.getElementById('permMenu'),
    addModelsBtn: document.getElementById('addModelsBtn'),
    attachBtn: document.getElementById('attachBtn'),
    filesChangedBar: document.getElementById('filesChangedBar'),
    filesChangedCount: document.getElementById('filesChangedCount'),
    filesChangedToggle: document.getElementById('filesChangedToggle'),
    undoAllFiles: document.getElementById('undoAllFiles'),
    keepAllFiles: document.getElementById('keepAllFiles'),
    reviewFiles: document.getElementById('reviewFiles'),
    streamPhaseBar: document.getElementById('streamPhaseBar'),
    streamPhaseLabel: document.getElementById('streamPhaseLabel'),
    agentsActivityBar: document.getElementById('agentsActivityBar'),
    agentsActivityTitle: document.getElementById('agentsActivityTitle'),
    agentsActivityProgress: document.getElementById('agentsActivityProgress'),
    agentsActivityFill: document.getElementById('agentsActivityFill'),
    agentsActivityWorkers: document.getElementById('agentsActivityWorkers'),
    agentsActivityOpen: document.getElementById('agentsActivityOpen'),
    agentsActivityCancel: document.getElementById('agentsActivityCancel'),
    composerHint: document.getElementById('composerHint'),
    newChat: document.getElementById('newChat'),
    historyBtn: document.getElementById('historyBtn'),
    helpBtn: document.getElementById('helpBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    historyPanel: document.getElementById('historyPanel'),
    historyList: document.getElementById('historyList'),
    historyClose: document.getElementById('historyClose'),
    historyEmpty: document.getElementById('historyEmpty'),
    chatTabs: document.getElementById('chatTabs'),
    openFull: document.getElementById('openFull'),
    authChip: document.getElementById('authChip'),
    signInBtn: document.getElementById('signInBtn'),
    latency: document.getElementById('latency'),
    ctxBtn: document.getElementById('ctxBtn'),
    ctxBtnSummary: document.getElementById('ctxBtnSummary'),
    ctxMenu: document.getElementById('ctxMenu'),
    ctxChips: document.querySelectorAll('.ctx-chip'),
    selChips: document.getElementById('selChips'),
    queuedSends: document.getElementById('queuedSends'),
    toolConsentBar: document.getElementById('toolConsentBar'),
    toolConsentTitle: document.getElementById('toolConsentTitle'),
    toolConsentBadge: document.getElementById('toolConsentBadge'),
    toolConsentCommand: document.getElementById('toolConsentCommand'),
    toolConsentAccept: document.getElementById('toolConsentAccept'),
    toolConsentAllowSession: document.getElementById('toolConsentAllowSession'),
    toolConsentRunTerminal: document.getElementById('toolConsentRunTerminal'),
    toolConsentReject: document.getElementById('toolConsentReject'),
  };

  /** Order matches the mode dropdown; Shift+Tab cycles this list. */
  const MODE_ICONS = {
    agent:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.8 8c0-1.7 1.4-3.1 3.1-3.1 1.2 0 2 .6 3.1 2 1.1-1.4 1.9-2 3.1-2 1.7 0 3.1 1.4 3.1 3.1S13.8 11.1 12.1 11.1c-1.2 0-2-.6-3.1-2-1.1 1.4-1.9 2-3.1 2C4.2 11.1 2.8 9.7 2.8 8z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>',
    plan:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    debug:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5.5 6.2c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5v4.1c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5V6.2z" stroke="currentColor" stroke-width="1.2"/><path d="M3.2 7.2 5 8.2M12.8 7.2 11 8.2M3.2 11 5 10.2M12.8 11 11 10.2M8 3.7V2.4M5.2 4.2 4.2 3.2M10.8 4.2l1-1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    multitask:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="5.5" cy="8" r="2.2" stroke="currentColor" stroke-width="1.2"/><circle cx="10.5" cy="8" r="2.2" stroke="currentColor" stroke-width="1.2"/></svg>',
    ask:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 4.5h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H7.2L4.5 13.2V11.5h-1a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  };
  const MODE_META = [
    {
      id: 'agent',
      label: 'Agent',
      icon: MODE_ICONS.agent,
      colorClass: 'mode-agent',
      hint: 'Full tools — edit, search, and act',
    },
    {
      id: 'plan',
      label: 'Plan',
      icon: MODE_ICONS.plan,
      colorClass: 'mode-plan',
      hint: 'Draft a clear plan first, then act',
    },
    {
      id: 'debug',
      label: 'Debug',
      icon: MODE_ICONS.debug,
      colorClass: 'mode-debug',
      hint: 'Investigate root cause systematically',
    },
    {
      id: 'multitask',
      label: 'Multitask',
      icon: MODE_ICONS.multitask,
      colorClass: 'mode-multitask',
      hint: 'Parallel workers when you ask for them',
    },
    {
      id: 'ask',
      label: 'Ask',
      icon: MODE_ICONS.ask,
      colorClass: 'mode-ask',
      hint: 'Read-only Q&A — no mutating tools',
    },
  ];
  const MODE_COLOR_CLASSES = MODE_META.map(function (m) {
    return m.colorClass;
  });
  /** Grow chrome until this many lines, then scroll inside the textarea. */
  const INPUT_GROW_LINES = 5;
  /** @type {Array<{id:string,fileName:string,filePath:string,startLine:number,endLine:number,text:string}>} */
  let selectionChips = [];
  /** @type {Array<{id:string,name:string,mimeType:string,kind:string,dataUrl?:string,textContent?:string,size:number}>} */
  let fileAttachments = [];
  let fileAttachSeq = 0;
  const MAX_FILE_ATTACHMENTS = 8;
  const MAX_ATTACH_BYTES = 4 * 1024 * 1024;
  const SEL_FILE_ICON =
    '<svg class="sel-chip-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 2.5h6l3 3V13.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 2.5V5.5H12.5" stroke="currentColor" stroke-width="1.2"/></svg>';
  const FILE_CARD_ICON =
    '<svg class="file-card-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 2.5h6l3 3V13.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 2.5V5.5H12.5" stroke="currentColor" stroke-width="1.2"/></svg>';
  const QUEUE_ICON =
    '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.2" stroke="currentColor" stroke-width="1.2"/><path d="M8 5v3.2l2 1.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  let fileExcerptSeq = 0;

  const PERM_META = [
    {
      id: 'allowAll',
      shortLabel: 'Allow all',
      label: 'Allow all (unsandboxed)',
      desc: 'Auto-approve shell and file edits',
    },
    {
      id: 'askEveryTime',
      shortLabel: 'Ask',
      label: 'Ask every time',
      desc: 'Confirm shell and review file edits',
    },
    {
      id: 'autoRunReviewFiles',
      shortLabel: 'Review files',
      label: 'Auto-run tools, review file edits',
      desc: 'Shell auto-runs; Accept / Reject in editor',
    },
  ];

  let streaming = false;
  /**
   * True only between streamStart and a terminal event (done/stop/error).
   * Prevents stale streamingTabIds after done from re-arming Thinking.
   */
  let acceptStreamEvents = false;
  /** @type {'idle'|'thinking'|'tools'|'applying'|'review'|'done'} */
  let streamPhase = 'idle';
  /** @type {null | {runId:string,status:string,workers?:Array,prompt?:string}} */
  let agentsHudRun = null;
  let agentsCancelBusy = false;
  let assistantNode = null;
  let assistantRaw = '';
  let stickToBottom = true;
  let agentMode = 'agent';
  let autoModel = true;
  let maxMode = false;
  let thinkingMode = 'high';
  let agentPermissionMode = 'askEveryTime';
  /** @type {null | {id:string}} */
  let toolConsent = null;
  /** @type {Array<{id:string,label?:string}>} */
  let modelCatalog = [];
  let selectedModelId = 'spockify-auto';
  let pendingDelta = '';
  let rafPending = 0;
  /** Stashed until the first assistant bubble is created after thinking. */
  let pendingStreamAttribution = null;
  const SCROLL_PIN_THRESHOLD = 48;
  let openTabIds = [];
  let streamingTabIds = [];
  let currentSessionId = '';
  let sessionSummaries = [];
  /** @type {Record<string, { draft?: string }>} */
  let sessionUiHints = {};

  function formatRelativeTime(updatedAtMs) {
    const now = Date.now();
    const delta = Math.max(0, now - updatedAtMs);
    const sec = Math.floor(delta / 1000);
    if (sec < 45) return 'Just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return min === 1 ? '1 min ago' : min + ' min ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr === 1 ? '1 hour ago' : hr + ' hours ago';
    const day = Math.floor(hr / 24);
    if (day < 7) return day === 1 ? 'Yesterday' : day + ' days ago';
    const d = new Date(updatedAtMs);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  function tabTitleForId(id) {
    const summary = sessionSummaries.find(function (s) {
      return s.id === id;
    });
    const hint = sessionUiHints[id];
    const title = summary && summary.title ? summary.title : '';
    if (title && title !== 'Chat' && title !== 'New chat') {
      return title.length > 28 ? title.slice(0, 26) + '…' : title;
    }
    const draft =
      (hint && hint.draft) || (el.input && el.input.value && id === currentSessionId
        ? el.input.value
        : '');
    const line = String(draft || '')
      .split('\n')[0]
      .trim();
    if (line) {
      return line.length > 28 ? line.slice(0, 26) + '…' : line;
    }
    return 'New chat';
  }

  function captureCurrentUi() {
    const chips = {};
    el.ctxChips.forEach(function (chip) {
      const t = chip.getAttribute('data-tag');
      if (t) chips[t] = chip.classList.contains('active');
    });
    return {
      draft: el.input ? el.input.value : '',
      agentMode: agentMode,
      contextChips: chips,
      selectionChips: selectionChips.slice(),
    };
  }

  function applySessionUi(ui) {
    if (!ui || typeof ui !== 'object') return;
    if (ui.agentMode) setAgentMode(ui.agentMode);
    if (ui.contextChips) applyContextChips(ui.contextChips);
    if (Array.isArray(ui.selectionChips)) {
      selectionChips = ui.selectionChips.slice();
      renderSelectionChips();
    }
    if (el.input && ui.draft !== undefined) {
      el.input.value = ui.draft;
      resizeComposerInput();
    }
  }

  /** Host tags stream/tool events with persisted session id (chat tab). */
  function routesToActiveTab(msg) {
    const tabId = msg && msg.chatTabId;
    return !tabId || tabId === currentSessionId;
  }

  function tabIsStreaming(id) {
    return streamingTabIds.indexOf(id) >= 0;
  }

  /**
   * Start (or resume) the assistant stream for the current turn.
   * Reuses an assistant only when it is still `.streaming` after the latest
   * user card. After a tool card seals a bubble, the next delta creates a
   * *new* assistant node so tools stay chronological mid-transcript.
   */
  function beginAssistantTurn() {
    removeEmpty();
    if (rafPending) {
      cancelAnimationFrame(rafPending);
      rafPending = 0;
    }
    pendingDelta = '';
    if (assistantNode && !assistantNode.classList.contains('streaming')) {
      assistantNode = null;
      assistantRaw = '';
    } else if (assistantNode) {
      /* keep streaming node */
    } else {
      assistantRaw = '';
    }

    let lastUser = null;
    const kids = el.messages.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i].classList.contains('msg') && kids[i].classList.contains('user')) {
        lastUser = kids[i];
        break;
      }
    }

    let existing = null;
    if (lastUser && !assistantNode) {
      let n = lastUser.nextElementSibling;
      while (n) {
        if (
          n.classList.contains('msg') &&
          n.classList.contains('assistant') &&
          n.classList.contains('streaming')
        ) {
          existing = n;
          break;
        }
        if (n.classList.contains('msg') && n.classList.contains('user')) {
          break;
        }
        n = n.nextElementSibling;
      }
    }

    if (existing) {
      assistantNode = existing;
      assistantRaw = existing.getAttribute('data-raw') || '';
      assistantNode.classList.add('streaming');
      return assistantNode;
    }

    if (assistantNode && assistantNode.isConnected) {
      assistantNode.classList.add('streaming');
      return assistantNode;
    }

    assistantNode = document.createElement('div');
    assistantNode.className = 'msg assistant streaming';
    assistantNode.setAttribute('data-raw', '');
    // Place after the last element of this turn (user / prior assistant / tools).
    if (lastUser && lastUser.parentNode === el.messages) {
      let insertAfter = lastUser;
      let n = lastUser.nextElementSibling;
      while (
        n &&
        !(n.classList.contains('msg') && n.classList.contains('user'))
      ) {
        insertAfter = n;
        n = n.nextElementSibling;
      }
      if (insertAfter.nextSibling) {
        el.messages.insertBefore(assistantNode, insertAfter.nextSibling);
      } else {
        el.messages.appendChild(assistantNode);
      }
    } else {
      el.messages.appendChild(assistantNode);
    }
    if (pendingStreamAttribution) {
      setAssistantAttribution(
        assistantNode,
        pendingStreamAttribution.attribution,
        pendingStreamAttribution.model,
      );
    }
    scrollToBottomIfPinned();
    return assistantNode;
  }

  function renderChatTabs() {
    if (!el.chatTabs) return;
    el.chatTabs.innerHTML = '';
    const ids =
      openTabIds && openTabIds.length
        ? openTabIds
        : currentSessionId
          ? [currentSessionId]
          : [];
    ids.forEach(function (id) {
      const tab = document.createElement('button');
      tab.type = 'button';
      let cls = 'chat-tab';
      if (id === currentSessionId) cls += ' active';
      if (tabIsStreaming(id)) cls += ' running';
      tab.className = cls;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', id === currentSessionId ? 'true' : 'false');
      tab.dataset.sessionId = id;
      const label = document.createElement('span');
      label.className = 'chat-tab-label';
      label.textContent = tabTitleForId(id);
      tab.appendChild(label);
      if (ids.length > 1) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'chat-tab-close';
        close.title = 'Close tab';
        close.setAttribute('aria-label', 'Close tab');
        close.textContent = '×';
        close.addEventListener('click', function (ev) {
          ev.stopPropagation();
          cancelStreamingUi();
          vscode.postMessage({
            type: 'closeSessionTab',
            id: id,
            ui: captureCurrentUi(),
          });
        });
        tab.appendChild(close);
      }
      tab.addEventListener('click', function () {
        if (id === currentSessionId) return;
        cancelStreamingUi();
        vscode.postMessage({
          type: 'switchSession',
          id: id,
          ui: captureCurrentUi(),
        });
      });
      el.chatTabs.appendChild(tab);
    });
  }

  function setHistoryPanelOpen(open) {
    if (!el.historyPanel) return;
    el.historyPanel.hidden = !open;
  }

  function renderHistoryList() {
    if (!el.historyList) return;
    el.historyList.innerHTML = '';
    const rows = sessionSummaries || [];
    if (el.historyEmpty) {
      el.historyEmpty.hidden = rows.length > 0;
    }
    rows.forEach(function (s) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'history-item' + (s.id === currentSessionId ? ' active' : '');
      const clock = document.createElement('span');
      clock.className = 'history-clock';
      clock.textContent = '◷';
      clock.setAttribute('aria-hidden', 'true');
      const body = document.createElement('div');
      body.className = 'history-body';
      const title = document.createElement('div');
      title.className = 'history-item-title';
      title.textContent = s.title || 'Chat';
      const time = document.createElement('div');
      time.className = 'history-item-time';
      time.textContent = formatRelativeTime(s.lastMessageAt || s.updatedAt);
      body.appendChild(title);
      body.appendChild(time);
      btn.appendChild(clock);
      btn.appendChild(body);
      btn.addEventListener('click', function () {
        setHistoryPanelOpen(false);
        cancelStreamingUi();
        vscode.postMessage({
          type: 'switchSession',
          id: s.id,
          ui: captureCurrentUi(),
        });
      });
      el.historyList.appendChild(btn);
    });
  }

  function applySessionsPayload(msg) {
    if (msg.sessions) sessionSummaries = msg.sessions;
    if (msg.currentSessionId) currentSessionId = msg.currentSessionId;
    if (msg.openTabIds) openTabIds = msg.openTabIds;
    if (msg.streamingTabIds) streamingTabIds = msg.streamingTabIds;
    if (msg.sessionUi && msg.sessionUi.draft !== undefined) {
      sessionUiHints[currentSessionId] = {
        draft: msg.sessionUi.draft,
      };
    }
    renderChatTabs();
    renderHistoryList();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function displayUserText(content) {
    if (Array.isArray(content)) {
      const texts = content
        .filter(function (p) {
          return p && p.type === 'text';
        })
        .map(function (p) {
          return p.text || '';
        });
      content = texts.join('\n');
    }
    const idx = (content || '').indexOf('\n\n---\n');
    return idx >= 0 ? content.slice(0, idx) : content || '';
  }

  function userAttachmentPreviews(content) {
    if (!Array.isArray(content)) return [];
    return content
      .filter(function (p) {
        return p && p.type === 'image_url' && p.image_url && p.image_url.url;
      })
      .map(function (p, i) {
        return { id: 'img' + i, dataUrl: p.image_url.url, kind: 'image' };
      });
  }

  function appendUser(content, attachments) {
    removeEmpty();
    const div = document.createElement('div');
    div.className = 'msg user';
    const text = displayUserText(content);
    const atts =
      attachments ||
      (Array.isArray(content) ? userAttachmentPreviews(content) : []);
    if (atts && atts.length) {
      const row = document.createElement('div');
      row.className = 'user-attach-row';
      atts.forEach(function (a) {
        if (a.kind === 'image' && (a.dataUrl || (a.image_url && a.image_url.url))) {
          const img = document.createElement('img');
          img.className = 'user-attach-thumb';
          img.src = a.dataUrl || a.image_url.url;
          img.alt = a.name || '';
          row.appendChild(img);
        } else {
          const chip = document.createElement('span');
          chip.className = 'user-attach-file';
          chip.textContent = a.name || 'file';
          row.appendChild(chip);
        }
      });
      div.appendChild(row);
    }
    if (text) {
      const body = document.createElement('div');
      body.className = 'user-text';
      body.textContent = text;
      div.appendChild(body);
    } else if (!(atts && atts.length)) {
      div.textContent = '';
    }
    el.messages.appendChild(div);
    scrollToBottomIfPinned();
  }

  /** Keep in sync with runtime/displayStreamFilter + parseToolCalls stripToolFences. */
  function stripToolLeaksForDisplay(text) {
    if (!text) return '';
    let s = String(text)
      .replace(/```tool(?:\s+[\w.-]+)?\s*\n[\s\S]*?```/gi, '')
      .replace(/```apply\s*\n[\s\S]*?```/gi, '')
      .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, '')
      .replace(
        /```(?:bash|sh|shell|zsh|console|terminal)?\s*\n\s*(?:terminal_run|run_terminal_cmd)\b[\s\S]*?```/gi,
        '',
      )
      .replace(
        /(?:^|\n)\s*(?:terminal_run|run_terminal_cmd)\s+(?:bash|sh|zsh|shell)?\s*["'`][^"'`]*["'`]\s*;?\s*(?=\n|$)/gi,
        '\n',
      )
      .replace(
        /(?:^|\n)\s*(?:terminal_run|run_terminal_cmd)\s*\(\s*["'`][^"'`]*["'`]\s*\)\s*;?\s*(?=\n|$)/gi,
        '\n',
      )
      .replace(
        /(?:^|\n)\s*(?:terminal_run|run_terminal_cmd)\s+(?:bash|sh|zsh|shell)\s+[^\n]+/gi,
        '\n',
      )
      .replace(
        /(?:^|\n)\s*(?:call|invoke)\s+[a-zA-Z0-9_]+\s+with\s+\{[\s\S]*?\}(?=\s*(?:\n|$))/gi,
        '\n',
      )
      .replace(
        /(?:^|\n)\s*tool\s+[A-Za-z_][\w]*\s*\{[\s\S]*?\}(?=\s*(?:\n|$))/gi,
        '\n',
      )
      .replace(
        /(?:^|\n)\s*\{\s*"name"\s*:\s*"[A-Za-z_][\w]*"\s*,\s*"arguments"\s*:\s*[\s\S]*?\}(?=\s*(?:\n|$))/gi,
        '\n',
      );
    const open = s.lastIndexOf('```');
    if (open >= 0) {
      const tail = s.slice(open);
      if (tail.indexOf('```', 3) < 0) {
        const firstLine = (tail.slice(3).split('\n')[0] || '').trim();
        const toolish =
          !firstLine ||
          /^tool\b/i.test(firstLine) ||
          /^tool\s+apply\b/i.test(firstLine) ||
          firstLine.toLowerCase() === 'apply';
        if (toolish) s = s.slice(0, open);
      }
    }
    const tc = s.lastIndexOf('<tool_call');
    if (tc >= 0 && !/<\/tool_call>/i.test(s.slice(tc))) {
      s = s.slice(0, tc);
    }
    // If the model is mid-way through emitting a tool JSON object, remove it
    // so partial `"name"` / `"arguments"` never leak into the UI.
    const incompleteNameArgsJson =
      /(?:^|\n)\s*\{\s*"name"\s*:\s*"[A-Za-z_][\w-]*"\s*,\s*"arguments"\s*:\s*[\s\S]*$/i.exec(
        s,
      );
    if (incompleteNameArgsJson?.index != null) {
      s = s.slice(0, incompleteNameArgsJson.index);
    }
    const incompleteFunctionNameJson =
      /(?:^|\n)\s*\{\s*"function"\s*:\s*\{\s*"name"\s*:\s*"[A-Za-z_][\w-]*"[\s\S]*$/i.exec(
        s,
      );
    if (incompleteFunctionNameJson?.index != null) {
      s = s.slice(0, incompleteFunctionNameJson.index);
    }
    const incompleteInvokeJson =
      /(?:^|\n)\s*(?:call|invoke)\s+[a-zA-Z0-9_]+\s+with\s+\{\s*[\s\S]*$/i.exec(
        s,
      );
    if (incompleteInvokeJson?.index != null) {
      s = s.slice(0, incompleteInvokeJson.index);
    }
    return s.replace(/\n{3,}/g, '\n\n');
  }

  function isToolFenceHint(hint) {
    const h = (hint || '').trim().toLowerCase();
    return (
      !h ||
      h === 'tool' ||
      h === 'apply' ||
      /^tool\b/.test(h) ||
      /^tool\s+apply/.test(h) ||
      /^json$/.test(h)
    );
  }

  /** Common source extensions for path-like citations. */
  const FILE_EXT_RE =
    /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|md|json|ya?ml|toml|css|scss|html|vue|svelte|sh|bash|zsh|c|cc|cpp|h|hpp|cs|rb|php|sql|proto|graphql|xml|txt|env|dockerfile)$/i;

  /** Path token: optional dirs + basename with extension (or slash path). */
  const FILE_PATH_TOKEN =
    '(?:\\.?\\/)?(?:[\\w.@-]+\\/)*[\\w.@-]+\\.\\w+';

  /** `path/to/file.ts` or `path:12` / `:12:3` / `:12-40` line citations. */
  function parseFileRef(raw) {
    const t = String(raw || '').trim();
    if (!t || /\s/.test(t) || t.length > 260) return null;
    // Avoid URLs / pure numbers / commands.
    if (/^(https?:|file:|mailto:)/i.test(t)) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null;
    // Cursor-style startLine:endLine:path (path may contain colons rarely).
    const cursorRange = /^(\d+):(\d+):(.+)$/.exec(t);
    if (cursorRange) {
      const pathPart = cursorRange[3];
      const line = Number(cursorRange[1]);
      const endLine = Number(cursorRange[2]);
      if (/[\\/]/.test(pathPart) || FILE_EXT_RE.test(pathPart)) {
        return {
          path: pathPart,
          line: Math.min(line, endLine),
          endLine: Math.max(line, endLine),
          col: undefined,
        };
      }
    }
    // path:start-end  OR  path:line:col  OR  path:line
    let pathPart = t;
    let line;
    let endLine;
    let col;
    const range = /^(.+?):(\d+)-(\d+)$/.exec(t);
    const withCol = /^(.+?):(\d+):(\d+)$/.exec(t);
    const withLine = /^(.+?):(\d+)$/.exec(t);
    if (range) {
      pathPart = range[1];
      line = Number(range[2]);
      endLine = Number(range[3]);
    } else if (withCol) {
      pathPart = withCol[1];
      line = Number(withCol[2]);
      col = Number(withCol[3]);
    } else if (withLine) {
      pathPart = withLine[1];
      line = Number(withLine[2]);
    }
    // Path-like: has slash or common source extension.
    if (!/[\\/]/.test(pathPart) && !FILE_EXT_RE.test(pathPart)) {
      return null;
    }
    if (pathPart.startsWith('-') || pathPart === '.' || pathPart === '..') {
      return null;
    }
    if (endLine != null && line != null && endLine < line) {
      const tmp = line;
      line = endLine;
      endLine = tmp;
    }
    return { path: pathPart, line: line, endLine: endLine, col: col };
  }

  /** Parse markdown link target that may be a workspace file (+ optional #L10-L20). */
  function parseFileMarkdownHref(href) {
    const raw = String(href || '').trim();
    if (!raw || /^(https?:|mailto:|file:)/i.test(raw)) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;
    const m = /^([^#?#]+)(?:#L?(\d+)(?:-L?(\d+))?)?$/i.exec(raw);
    if (!m) return null;
    const pathPart = m[1].replace(/^\.\//, '');
    const ref = parseFileRef(pathPart);
    if (!ref) return null;
    if (m[2]) {
      ref.line = Number(m[2]);
      ref.endLine = m[3] ? Number(m[3]) : ref.line;
    }
    return ref;
  }

  /** Pull line/range from nearby prose ("lines 10-20", "line 42", "L10-L20"). */
  function extractNearbyLineRange(text) {
    const s = String(text || '');
    const m =
      /\blines?\s+(\d+)\s*[-–—]\s*(\d+)\b|\bline\s+(\d+)\b|\bL(\d+)(?:\s*[-–—]\s*L?(\d+))?\b/i.exec(
        s,
      );
    if (!m) return null;
    if (m[1]) {
      return {
        startLine: Math.min(Number(m[1]), Number(m[2])),
        endLine: Math.max(Number(m[1]), Number(m[2])),
      };
    }
    if (m[3]) {
      return { startLine: Number(m[3]), endLine: Number(m[3]) };
    }
    const a = Number(m[4]);
    const b = m[5] ? Number(m[5]) : a;
    return { startLine: Math.min(a, b), endLine: Math.max(a, b) };
  }

  function fileLinkHtml(path, line, col, label, endLine) {
    const attrs =
      ' class="file-link" href="#" data-path="' +
      encodeURIComponent(path) +
      '"' +
      (line != null ? ' data-line="' + line + '"' : '') +
      (endLine != null && endLine !== line
        ? ' data-end-line="' + endLine + '"'
        : '') +
      (col != null ? ' data-col="' + col + '"' : '') +
      ' title="Open ' +
      escapeHtml(path) +
      (line != null
        ? ':' +
          line +
          (endLine != null && endLine !== line ? '-' + endLine : '')
        : '') +
      '"';
    return '<a' + attrs + '>' + escapeHtml(label || path) + '</a>';
  }

  /** Cursor-style block file card: path + range + code excerpt (own row). */
  function fileCardHtml(path, startLine, endLine, code) {
    const start = startLine != null ? startLine : undefined;
    const end =
      endLine != null && endLine !== startLine ? endLine : start;
    const rangeLabel =
      start != null
        ? end != null && end !== start
          ? start + '-' + end
          : String(start)
        : '';
    const base = String(path).split(/[/\\]/).pop() || path;
    const hasCode = code != null && code !== '';
    const needs =
      !hasCode && start != null
        ? ' data-needs-excerpt="1" data-excerpt-id="fe' +
          ++fileExcerptSeq +
          '"'
        : '';
    const codeBody = hasCode ? escapeHtml(code) : start != null ? '…' : '';
    const applyBtn =
      hasCode
        ? '<button type="button" class="apply-btn file-card-apply" data-code="' +
          encodeURIComponent(code) +
          '" data-path="' +
          encodeURIComponent(path) +
          '" data-shell="0"' +
          (start != null ? ' data-start-line="' + start + '"' : '') +
          (end != null ? ' data-end-line="' + end + '"' : '') +
          '>Apply</button>'
        : '';
    return (
      '<div class="file-card" role="button" tabindex="0" data-path="' +
      encodeURIComponent(path) +
      '"' +
      (start != null ? ' data-line="' + start + '"' : '') +
      (end != null && end !== start ? ' data-end-line="' + end + '"' : '') +
      needs +
      ' title="Open ' +
      escapeHtml(path) +
      (rangeLabel ? ':' + rangeLabel : '') +
      '">' +
      '<span class="file-card-header">' +
      FILE_CARD_ICON +
      '<span class="file-card-path">' +
      escapeHtml(base) +
      '</span>' +
      (rangeLabel
        ? '<span class="file-card-range">' + escapeHtml(rangeLabel) + '</span>'
        : '') +
      '<span class="file-card-fullpath" title="' +
      escapeHtml(path) +
      '">' +
      escapeHtml(path) +
      '</span>' +
      applyBtn +
      '</span>' +
      (codeBody !== ''
        ? '<pre class="file-card-code' +
          (hasCode ? '' : ' file-card-loading') +
          '">' +
          codeBody +
          '</pre>'
        : '') +
      '</div>'
    );
  }

  /**
   * Promote path:line cites to block cards only when alone on a line or
   * after a finished sentence — never mid-prose (those stay cyan links).
   */
  function extractBlockFileCite(line) {
    const t = String(line || '').trim();
    if (!t) return null;

    const cursorOwn =
      /^`?(\d+:\d+:(?:\.\/)?(?:[\w.@-]+\/)*[\w.@-]+\.\w+)`?\s*[.:]?\s*$/.exec(
        t,
      );
    if (cursorOwn) {
      const ref = parseFileRef(cursorOwn[1]);
      if (ref && ref.line != null) {
        return {
          prose: '',
          path: ref.path,
          startLine: ref.line,
          endLine: ref.endLine != null ? ref.endLine : ref.line,
        };
      }
    }

    const ownRe = new RegExp(
      '^`?(' + FILE_PATH_TOKEN + '(?::\\d+(?:-\\d+)?)?)`?\\s*[.:]?\\s*$',
    );
    const own = ownRe.exec(t);
    if (own) {
      const ref = parseFileRef(own[1]);
      if (ref) {
        return {
          prose: '',
          path: ref.path,
          startLine: ref.line,
          endLine: ref.endLine != null ? ref.endLine : ref.line,
        };
      }
    }

    const afterRe = new RegExp(
      '^([\\s\\S]*[.!?])\\s+`?(' +
        FILE_PATH_TOKEN +
        '(?::\\d+(?:-\\d+)?)?)`?\\s*$',
    );
    const after = afterRe.exec(t);
    if (after) {
      const ref = parseFileRef(after[2]);
      if (ref && ref.line != null) {
        return {
          prose: after[1],
          path: ref.path,
          startLine: ref.line,
          endLine: ref.endLine != null ? ref.endLine : ref.line,
        };
      }
    }
    return null;
  }

  /** Strip model-copied HTML residue: path">path → path */
  function demangleFileCitations(text) {
    return String(text || '').replace(
      /([\w./@+-]+(?:\.\w+)?)">\1((?::\d+(?:-\d+)?(?::\d+)?)?)/g,
      '$1$2',
    );
  }

  /** Protect existing anchors/file-cards so bare-path pass cannot re-link inside. */
  function withProtectedAnchors(html, fn) {
    const slots = [];
    const marked = String(html)
      .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, function (m) {
        const id = slots.length;
        slots.push(m);
        return '\uE010' + id + '\uE011';
      })
      .replace(
        /<(div|span)\b([^>]*\bfile-card\b[^>]*)>[\s\S]*?<\/\1>/gi,
        function (m) {
          const id = slots.length;
          slots.push(m);
          return '\uE010' + id + '\uE011';
        },
      );
    let out = fn(marked);
    out = out.replace(/\uE010(\d+)\uE011/g, function (_m, idStr) {
      return slots[Number(idStr)] || '';
    });
    return out;
  }

  /** Private-use placeholders so math survives escape/inline passes. */
  const MATH_PH_START = '\uE000';
  const MATH_PH_END = '\uE001';

  /**
   * Pull `$$…$$`, `\[…\]`, `\(…\)` before HTML escape (LaTeX may contain <>).
   * Incomplete delimiters (streaming) are left as plain text until closed.
   */
  function extractMath(text) {
    const src = String(text || '');
    const slots = [];
    let out = '';
    let i = 0;
    while (i < src.length) {
      if (src.startsWith('$$', i)) {
        const end = src.indexOf('$$', i + 2);
        if (end !== -1) {
          const id = slots.length;
          slots.push({ tex: src.slice(i + 2, end), display: true });
          out += MATH_PH_START + id + MATH_PH_END;
          i = end + 2;
          continue;
        }
      }
      if (src.startsWith('\\[', i)) {
        const end = src.indexOf('\\]', i + 2);
        if (end !== -1) {
          const id = slots.length;
          slots.push({ tex: src.slice(i + 2, end), display: true });
          out += MATH_PH_START + id + MATH_PH_END;
          i = end + 2;
          continue;
        }
      }
      if (src.startsWith('\\(', i)) {
        const end = src.indexOf('\\)', i + 2);
        if (end !== -1) {
          const id = slots.length;
          slots.push({ tex: src.slice(i + 2, end), display: false });
          out += MATH_PH_START + id + MATH_PH_END;
          i = end + 2;
          continue;
        }
      }
      out += src.charAt(i);
      i++;
    }
    return { text: out, slots: slots };
  }

  function renderKatex(tex, display) {
    const raw = String(tex || '').trim();
    if (!raw) return '';
    try {
      if (typeof katex === 'undefined' || !katex.renderToString) {
        const body = escapeHtml(raw);
        return display
          ? '<div class="md-math md-math-fallback">' + body + '</div>'
          : '<code class="md-math-fallback">' + body + '</code>';
      }
      return katex.renderToString(raw, {
        displayMode: !!display,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
      });
    } catch (_err) {
      const body = escapeHtml(raw);
      return display
        ? '<div class="md-math md-math-fallback">' + body + '</div>'
        : '<code class="md-math-fallback">' + body + '</code>';
    }
  }

  function restoreMath(html, slots) {
    if (!slots || !slots.length) return html;
    return String(html).replace(
      new RegExp(MATH_PH_START + '(\\d+)' + MATH_PH_END, 'g'),
      function (_m, idStr) {
        const slot = slots[Number(idStr)];
        if (!slot) return '';
        const rendered = renderKatex(slot.tex, slot.display);
        if (slot.display) {
          return '<div class="md-math">' + rendered + '</div>';
        }
        return '<span class="md-math md-math-inline">' + rendered + '</span>';
      },
    );
  }

  function splitTableRow(line) {
    let s = String(line || '').trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(function (c) {
      return c.trim();
    });
  }

  function isTableSeparator(line) {
    const cells = splitTableRow(line);
    if (!cells.length) return false;
    return cells.every(function (c) {
      return /^:?-{3,}:?$/.test(c);
    });
  }

  function looksLikeTableRow(line) {
    const t = String(line || '').trim();
    if (!t.includes('|')) return false;
    if (/^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) return false;
    return splitTableRow(t).length >= 2;
  }

  function alignFromSep(cell) {
    const c = String(cell || '');
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  }

  function renderMarkdownTable(headerLine, sepLine, bodyLines, slots) {
    const headers = splitTableRow(headerLine);
    const aligns = splitTableRow(sepLine).map(alignFromSep);
    const rows = bodyLines.map(splitTableRow);
    const colCount = headers.length;
    let html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
    for (let c = 0; c < colCount; c++) {
      const a = aligns[c] || '';
      html +=
        '<th' +
        (a ? ' style="text-align:' + a + '"' : '') +
        '>' +
        renderMarkdownInlineOnly(headers[c] || '', slots) +
        '</th>';
    }
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows.length; r++) {
      html += '<tr>';
      for (let c = 0; c < colCount; c++) {
        const a = aligns[c] || '';
        html +=
          '<td' +
          (a ? ' style="text-align:' + a + '"' : '') +
          '>' +
          renderMarkdownInlineOnly(rows[r][c] || '', slots) +
          '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  /** Inline markdown only (no block constructs). Mid-prose cites → cyan links. */
  function renderMarkdownInlineOnly(text, slots) {
    let html = escapeHtml(demangleFileCitations(text));
    // Backtick paths → clickable file links (never fat cards mid-sentence).
    html = html.replace(/`([^`\n]+)`/g, function (_m, inner) {
      const ref = parseFileRef(inner);
      if (ref) {
        return fileLinkHtml(
          ref.path,
          ref.line,
          ref.col,
          inner,
          ref.endLine,
        );
      }
      return '<code>' + escapeHtml(inner) + '</code>';
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(
      /(^|[^*\w])\*([^*\n]+)\*(?!\*)/g,
      '$1<em>$2</em>',
    );
    // Markdown links [label](url) — http(s) or workspace file paths.
    html = html.replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      function (_m, label, href) {
        if (/^https?:/i.test(href)) {
          return (
            '<a href="' +
            href +
            '" rel="noreferrer">' +
            escapeHtml(label) +
            '</a>'
          );
        }
        const ref = parseFileMarkdownHref(href);
        if (!ref) {
          return '[' + escapeHtml(label) + '](' + escapeHtml(href) + ')';
        }
        return fileLinkHtml(ref.path, ref.line, ref.col, label, ref.endLine);
      },
    );
    // Bare path tokens (workspace-relative) after other markup.
    // Basename+ext (file.js:10) and dir paths both accepted.
    // Protect existing <a>/file-cards so title="Open path">label is not re-matched.
    html = withProtectedAnchors(html, function (safe) {
      return safe.replace(
        new RegExp(
          '(^|[\\s(]|[^\\w./-])(' +
            FILE_PATH_TOKEN +
            ')(:\\d+(?:-\\d+)?(?::\\d+)?)?(?=[\\s)<,;.!?]|$)',
          'g',
        ),
        function (full, lead, pathPart, loc) {
          const ref = parseFileRef(pathPart + (loc || ''));
          if (!ref) return full;
          const label = pathPart + (loc || '');
          return (
            lead +
            fileLinkHtml(ref.path, ref.line, ref.col, label, ref.endLine)
          );
        },
      );
    });
    return restoreMath(html, slots);
  }

  /** Block-aware markdown: ATX headers, GFM tables, lists, then inline. */
  function renderMarkdownInline(text) {
    const pulled = extractMath(text);
    const slots = pulled.slots;
    const lines = pulled.text.split(/\r?\n/);
    const parts = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (heading) {
        const level = Math.min(heading[1].length, 6);
        parts.push(
          '<h' +
            level +
            ' class="md-h md-h' +
            level +
            '">' +
            renderMarkdownInlineOnly(heading[2], slots) +
            '</h' +
            level +
            '>',
        );
        i++;
        continue;
      }
      // GFM pipe table: header + separator + body rows
      if (
        looksLikeTableRow(line) &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1])
      ) {
        const headerLine = line;
        const sepLine = lines[i + 1];
        i += 2;
        const body = [];
        while (i < lines.length && looksLikeTableRow(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        parts.push(renderMarkdownTable(headerLine, sepLine, body, slots));
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          items.push(
            '<li>' +
              renderMarkdownInlineOnly(lines[i].replace(/^[-*]\s+/, ''), slots) +
              '</li>',
          );
          i++;
        }
        parts.push('<ul>' + items.join('') + '</ul>');
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          items.push(
            '<li>' +
              renderMarkdownInlineOnly(lines[i].replace(/^\d+\.\s+/, ''), slots) +
              '</li>',
          );
          i++;
        }
        parts.push('<ol>' + items.join('') + '</ol>');
        continue;
      }
      if (!line.trim()) {
        parts.push('<br/>');
        i++;
        continue;
      }
      // Paragraph / plain lines — promote own-line / after-sentence cites to cards.
      const proseBuf = [];
      function flushProseBuf() {
        if (!proseBuf.length) return;
        const mathOnly =
          proseBuf.length === 1 &&
          new RegExp(
            '^\\s*' + MATH_PH_START + '\\d+' + MATH_PH_END + '\\s*$',
          ).test(proseBuf[0]);
        if (mathOnly) {
          parts.push(renderMarkdownInlineOnly(proseBuf[0], slots));
        } else {
          parts.push(
            '<p class="md-p">' +
              proseBuf
                .map(function (ln) {
                  return renderMarkdownInlineOnly(ln, slots);
                })
                .join('<br/>') +
              '</p>',
          );
        }
        proseBuf.length = 0;
      }
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,6})\s+/.test(lines[i]) &&
        !/^[-*]\s+/.test(lines[i]) &&
        !/^\d+\.\s+/.test(lines[i]) &&
        !(
          looksLikeTableRow(lines[i]) &&
          i + 1 < lines.length &&
          isTableSeparator(lines[i + 1])
        )
      ) {
        const block = extractBlockFileCite(lines[i]);
        if (block) {
          flushProseBuf();
          if (block.prose && block.prose.trim()) {
            parts.push(
              '<p class="md-p">' +
                renderMarkdownInlineOnly(block.prose, slots) +
                '</p>',
            );
          }
          parts.push(
            fileCardHtml(
              block.path,
              block.startLine,
              block.endLine,
              '',
            ),
          );
          i++;
          continue;
        }
        proseBuf.push(lines[i]);
        i++;
      }
      flushProseBuf();
    }
    return parts.join('');
  }

  /**
   * Pull path + line range from prose just before a fence, e.g.
   * "see safer/train.py lines 365-424:" or "`safer/train.py:365-424`".
   * Also accepts basename-only paths, path without lines (card uses fence body),
   * and "in `path`" with nearby "lines X-Y" / "line N".
   * Trailing blank lines before the fence are ignored (common model habit).
   */
  function extractCiteBeforeFence(before) {
    const chunk = String(before || '');
    const trimmed = chunk.replace(/\s+$/, '');
    if (!trimmed) return null;
    const tail = trimmed.slice(Math.max(0, trimmed.length - 500));
    const baseOffset = trimmed.length - tail.length;

    function citeResult(path, startLine, endLine, matchIndex) {
      const ref = parseFileRef(path);
      if (!ref) return null;
      let start = startLine != null ? startLine : ref.line;
      let end =
        endLine != null
          ? endLine
          : ref.endLine != null
            ? ref.endLine
            : start;
      if (start == null) {
        const nearby = extractNearbyLineRange(tail.slice(Math.max(0, matchIndex)));
        if (nearby) {
          start = nearby.startLine;
          end = nearby.endLine;
        }
      }
      // Path-only is OK — card shows fence body without a line range.
      return {
        path: ref.path,
        startLine: start,
        endLine: end != null ? end : start,
        matchStart: baseOffset + matchIndex,
      };
    }

    // Cursor start:end:path (backtick or bare) at end of prose.
    const cursorAtEnd =
      /`?(\d+:\d+:(?:\.\/)?(?:[\w.@-]+\/)*[\w.@-]+\.\w+)`?\s*[:.]?\s*$/.exec(
        tail,
      );
    if (cursorAtEnd) {
      const ref = parseFileRef(cursorAtEnd[1]);
      if (ref && ref.line != null) {
        return {
          path: ref.path,
          startLine: ref.line,
          endLine: ref.endLine != null ? ref.endLine : ref.line,
          matchStart: baseOffset + cursorAtEnd.index,
        };
      }
    }

    // `path` / `path:line` / `path:start-end` (+ optional nearby lines on same tail).
    const btRe = new RegExp(
      '`(' +
        FILE_PATH_TOKEN +
        '(?::\\d+(?:-\\d+)?)?)`(?:[^`\\n]*(?:\\blines?\\s+(\\d+)\\s*[-–—]\\s*(\\d+)|\\bline\\s+(\\d+)))?[^\\n]*$',
      'i',
    );
    const bt = btRe.exec(tail);
    if (bt) {
      const start = bt[2]
        ? Number(bt[2])
        : bt[4]
          ? Number(bt[4])
          : undefined;
      const end = bt[3] ? Number(bt[3]) : start;
      const hit = citeResult(bt[1], start, end, bt.index);
      if (hit) return hit;
    }

    // Bare path:line / path + "lines X-Y" / path alone at end of prose (basename OK).
    const bareRe = new RegExp(
      '(' +
        FILE_PATH_TOKEN +
        ')(?::(\\d+)(?:-(\\d+))?)?(?:[^\\S\\n]*lines?\\s+(\\d+)\\s*[-–—]\\s*(\\d+))?\\s*[:.]?\\s*$',
      'i',
    );
    const bare = bareRe.exec(tail);
    if (bare) {
      const start = bare[2]
        ? Number(bare[2])
        : bare[4]
          ? Number(bare[4])
          : undefined;
      const end = bare[3]
        ? Number(bare[3])
        : bare[5]
          ? Number(bare[5])
          : start;
      const hit = citeResult(bare[1], start, end, bare.index);
      if (hit) return hit;
    }

    // Last resort: path earlier in the last ~2 lines + nearby line numbers.
    const lastLines = tail.split(/\n/).slice(-3).join('\n');
    const pathInTail = new RegExp(
      '`?(' + FILE_PATH_TOKEN + '(?::\\d+(?:-\\d+)?)?)`?',
      'g',
    );
    let pm;
    let lastPath = null;
    while ((pm = pathInTail.exec(lastLines)) !== null) {
      const ref = parseFileRef(pm[1]);
      if (ref) {
        lastPath = {
          ref: ref,
          indexInLast: pm.index,
          raw: pm[1],
        };
      }
    }
    if (lastPath) {
      const nearby =
        lastPath.ref.line != null
          ? {
              startLine: lastPath.ref.line,
              endLine:
                lastPath.ref.endLine != null
                  ? lastPath.ref.endLine
                  : lastPath.ref.line,
            }
          : extractNearbyLineRange(lastLines);
      const idxInTail = tail.lastIndexOf(lastLines);
      const matchStart =
        baseOffset +
        (idxInTail >= 0 ? idxInTail : 0) +
        lastPath.indexInLast;
      return {
        path: lastPath.ref.path,
        startLine: nearby ? nearby.startLine : undefined,
        endLine: nearby ? nearby.endLine : undefined,
        matchStart: matchStart,
      };
    }
    return null;
  }

  /**
   * Models sometimes emit nested language fences:
   *   ```python
   *   ```python
   *   code
   *   ```
   * Collapse those so the fence regex yields one clean code body.
   */
  function unwrapNestedLanguageFences(text) {
    let s = String(text || '');
    // ```lang\n```lang\n → ```lang\n  (repeat for triple nesting)
    for (let i = 0; i < 4; i++) {
      const next = s
        .replace(/```([a-zA-Z0-9_+-]*)\s*\n```\1\s*\n/g, '```$1\n')
        .replace(/```\s*\n```([a-zA-Z0-9_+-]+)\s*\n/g, '```$1\n');
      if (next === s) break;
      s = next;
    }
    return s;
  }

  /** If a fence body itself starts with ```lang … ```, unwrap once. */
  function stripInnerFenceFromCode(code) {
    const raw = String(code || '');
    const trimmed = raw.trim();
    const full = /^```([^\n]*)\n([\s\S]*?)```\s*$/.exec(trimmed);
    if (full) return full[2].replace(/\n$/, '');
    const open = /^```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*)$/.exec(raw);
    if (open) return open[2].replace(/\n$/, '');
    return raw.replace(/\n$/, '');
  }

  /** Render markdown-ish with fenced code + Apply buttons + file cards. */
  function renderAssistantHtml(text) {
    const cleaned = unwrapNestedLanguageFences(stripToolLeaksForDisplay(text));
    const parts = [];
    const re = /```([^\n]*)\n([\s\S]*?)```/g;
    let last = 0;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
      const hint = (m[1] || '').trim();
      if (isToolFenceHint(hint)) {
        last = m.index + m[0].length;
        continue;
      }
      const code = stripInnerFenceFromCode(m[2]);
      // Skip empty shells left by nested-fence collapse failures.
      if (!code.trim()) {
        last = m.index + m[0].length;
        continue;
      }
      const toks = hint.split(/\s+/).filter(Boolean);
      const pathTok = toks.length ? toks[toks.length - 1] : '';
      const langTok = (toks[0] || '').toLowerCase();
      const pathLike =
        hint.includes('/') ||
        /^(\d+:)+\S+\.\w+/.test(pathTok) ||
        /\.[a-z0-9]+$/i.test(pathTok);
      const label = hint || 'code';
      const lang = langTok;
      const isShell =
        /^(bash|sh|shell|zsh|fish|powershell|pwsh|console|terminal|cmd|bat)$/.test(
          lang,
        );
      // Prefer path token; also accept Cursor start:end:path as sole hint,
      // or any path-like token in the info string (```javascript path/to/file.js).
      let fencePath = '';
      if (!isShell) {
        if (pathLike && parseFileRef(pathTok)) {
          fencePath = pathTok;
        } else if (parseFileRef(hint)) {
          fencePath = hint;
        } else {
          for (let ti = toks.length - 1; ti >= 0; ti--) {
            if (parseFileRef(toks[ti])) {
              fencePath = toks[ti];
              break;
            }
          }
        }
      }
      const fenceRef = fencePath ? parseFileRef(fencePath) : null;

      const before = cleaned.slice(last, m.index);
      const cite = !isShell ? extractCiteBeforeFence(before) : null;

      if (cite) {
        const prose = before.slice(0, cite.matchStart).replace(/\s+$/, '');
        if (prose.trim()) {
          parts.push(
            '<div class="md">' + renderMarkdownInline(prose) + '</div>',
          );
        }
        parts.push(
          fileCardHtml(cite.path, cite.startLine, cite.endLine, code),
        );
        last = m.index + m[0].length;
        continue;
      }

      if (m.index > last) {
        parts.push(
          '<div class="md">' +
            renderMarkdownInline(cleaned.slice(last, m.index)) +
            '</div>',
        );
      }

      if (fenceRef && fenceRef.line != null && !isShell) {
        parts.push(
          fileCardHtml(
            fenceRef.path,
            fenceRef.line,
            fenceRef.endLine != null ? fenceRef.endLine : fenceRef.line,
            code,
          ),
        );
      } else if (fencePath && parseFileRef(fencePath) && !isShell) {
        // Path-only fence → card with provided code (no line range).
        parts.push(fileCardHtml(fencePath, undefined, undefined, code));
      } else {
        const barLabel =
          fencePath && parseFileRef(fencePath)
            ? fileLinkHtml(fencePath, undefined, undefined, label)
            : escapeHtml(label);
        const btnLabel = isShell ? 'Run' : 'Apply';
        parts.push(
          '<div class="code-wrap">' +
            '<div class="code-bar"><span>' +
            barLabel +
            '</span><button type="button" class="apply-btn" data-code="' +
            encodeURIComponent(code) +
            '" data-path="' +
            encodeURIComponent(fencePath) +
            '" data-shell="' +
            (isShell ? '1' : '0') +
            '">' +
            btnLabel +
            '</button></div>' +
            '<pre class="code-block' +
            (lang && !pathLike ? ' language-' + escapeHtml(lang) : '') +
            '"><code>' +
            escapeHtml(code) +
            '</code></pre></div>',
        );
      }
      last = m.index + m[0].length;
    }
    if (last < cleaned.length) {
      parts.push(
        '<div class="md">' + renderMarkdownInline(cleaned.slice(last)) + '</div>',
      );
    }
    return parts.join('') || '<div class="md"></div>';
  }

  function isNearBottom() {
    const delta =
      el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight;
    return delta <= SCROLL_PIN_THRESHOLD;
  }

  function scrollToBottomIfPinned() {
    if (stickToBottom) {
      el.messages.scrollTop = el.messages.scrollHeight;
    }
    syncJumpBtn();
  }

  function syncJumpBtn() {
    const btn = document.getElementById('jumpLatest');
    if (!btn) return;
    btn.hidden = stickToBottom || !el.messages.children.length;
  }

  el.messages.addEventListener(
    'scroll',
    function () {
      stickToBottom = isNearBottom();
      syncJumpBtn();
    },
    { passive: true },
  );

  function clearMessages() {
    el.messages.innerHTML = '';
    assistantNode = null;
    assistantRaw = '';
    stickToBottom = true;
    showEmpty();
  }

  function showEmpty() {
    if (el.messages.children.length) return;
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.id = 'empty';
    const signedIn = !el.signInBtn || el.signInBtn.hidden;
    empty.innerHTML = signedIn
      ? '<div class="empty-brand">Spockify</div><div class="empty-lead">Ask anything about your code</div><span class="empty-hint">@ for context · Ctrl+L selection · Enter to send</span>'
      : '<div class="empty-brand">Spockify</div><div class="empty-lead"><b>Sign in</b> to chat</div><span class="empty-hint">Status bar → Spockify · email/password or API key</span>';
    el.messages.appendChild(empty);
  }

  function removeEmpty() {
    const empty = document.getElementById('empty');
    if (empty) empty.remove();
  }

  function refreshEmptyForAuth() {
    const empty = document.getElementById('empty');
    if (empty) {
      empty.remove();
      showEmpty();
    } else if (!el.messages.children.length) {
      showEmpty();
    }
  }

  function ensureAssistant() {
    if (assistantNode && assistantNode.isConnected) {
      return assistantNode;
    }
    return beginAssistantTurn();
  }

  function setAssistantAttribution(node, attribution, modelId) {
    if (!node) return;
    if (modelId) node.setAttribute('data-model', modelId);
    if (attribution) node.setAttribute('data-attribution', attribution);
    let chip = node.querySelector(':scope > .model-attr');
    const label = attribution || '';
    if (!label) {
      if (chip) chip.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'model-attr';
      node.insertBefore(chip, node.firstChild);
    }
    chip.textContent = label;
    chip.title = label;
  }

  function paintAssistant() {
    if (!assistantNode) return;
    assistantNode.setAttribute('data-raw', assistantRaw);
    const attribution = assistantNode.getAttribute('data-attribution') || '';
    const modelId = assistantNode.getAttribute('data-model') || '';
    const bodyHtml = renderAssistantHtml(assistantRaw);
    assistantNode.innerHTML = '';
    if (attribution) {
      const chip = document.createElement('div');
      chip.className = 'model-attr';
      chip.textContent = attribution;
      chip.title = attribution;
      assistantNode.appendChild(chip);
    }
    const body = document.createElement('div');
    body.className = 'assistant-body';
    body.innerHTML = bodyHtml;
    assistantNode.appendChild(body);
    if (modelId) assistantNode.setAttribute('data-model', modelId);
    if (attribution) assistantNode.setAttribute('data-attribution', attribution);
    bindApplyButtons(body);
  }

  /** Paint coalesced tokens once per animation frame (progressive markdown). */
  function flushDeltaPaint() {
    rafPending = 0;
    if (!pendingDelta) return;
    const chunk = pendingDelta;
    pendingDelta = '';
    ensureAssistant();
    assistantRaw += chunk;
    paintAssistant();
    scrollToBottomIfPinned();
  }

  function enqueueDelta(content) {
    if (!content) return;
    if (!streaming) return;
    finalizeLiveThought(400);
    pendingDelta += content;
    if (!rafPending) {
      rafPending = requestAnimationFrame(flushDeltaPaint);
    }
  }

  function finalizeAssistantPaint() {
    if (rafPending) {
      cancelAnimationFrame(rafPending);
      rafPending = 0;
    }
    if (pendingDelta) {
      assistantRaw += pendingDelta;
      pendingDelta = '';
    }
    paintAssistant();
  }

  function bindApplyButtons(root) {
    root.querySelectorAll('.apply-btn').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const code = decodeURIComponent(btn.getAttribute('data-code') || '');
        const pathHint = decodeURIComponent(btn.getAttribute('data-path') || '');
        const shell = btn.getAttribute('data-shell') === '1';
        const startRaw = btn.getAttribute('data-start-line');
        const endRaw = btn.getAttribute('data-end-line');
        const startLine = startRaw ? Number(startRaw) : undefined;
        const endLine = endRaw ? Number(endRaw) : undefined;
        vscode.postMessage({
          type: 'applyBlock',
          code: code,
          pathHint: pathHint || undefined,
          shell: shell || undefined,
          startLine:
            startLine != null && Number.isFinite(startLine)
              ? startLine
              : undefined,
          endLine:
            endLine != null && Number.isFinite(endLine) ? endLine : undefined,
        });
      });
    });
    bindFileLinks(root);
  }

  function bindFileLinks(root) {
    if (!root) return;
    root.querySelectorAll('a.file-link').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const path = decodeURIComponent(a.getAttribute('data-path') || '');
        if (!path) return;
        const lineRaw = a.getAttribute('data-line');
        const endRaw = a.getAttribute('data-end-line');
        const colRaw = a.getAttribute('data-col');
        vscode.postMessage({
          type: 'openFile',
          path: path,
          line: lineRaw ? Number(lineRaw) : undefined,
          endLine: endRaw ? Number(endRaw) : undefined,
          column: colRaw ? Number(colRaw) : undefined,
        });
      });
    });
    root.querySelectorAll('.file-card').forEach(function (card) {
      function openCard() {
        const path = decodeURIComponent(card.getAttribute('data-path') || '');
        if (!path) return;
        const lineRaw = card.getAttribute('data-line');
        const endRaw = card.getAttribute('data-end-line');
        vscode.postMessage({
          type: 'openFile',
          path: path,
          line: lineRaw ? Number(lineRaw) : undefined,
          endLine: endRaw ? Number(endRaw) : undefined,
        });
      }
      card.addEventListener('click', function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('a.file-link')) {
          return;
        }
        ev.preventDefault();
        openCard();
      });
      card.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openCard();
        }
      });
    });
    hydrateFileCardExcerpts(root);
  }

  function hydrateFileCardExcerpts(root) {
    if (!root) return;
    root.querySelectorAll('.file-card[data-needs-excerpt="1"]').forEach(function (card) {
      const path = decodeURIComponent(card.getAttribute('data-path') || '');
      const start = Number(card.getAttribute('data-line') || '0');
      const endRaw = card.getAttribute('data-end-line');
      const end = endRaw ? Number(endRaw) : start;
      const requestId =
        card.getAttribute('data-excerpt-id') || 'fe' + ++fileExcerptSeq;
      card.setAttribute('data-excerpt-id', requestId);
      card.removeAttribute('data-needs-excerpt');
      if (!path || !start) return;
      vscode.postMessage({
        type: 'requestFileExcerpt',
        requestId: requestId,
        path: path,
        startLine: start,
        endLine: end,
      });
    });
  }

  function applyFileExcerpt(msg) {
    if (!msg || !msg.requestId) return;
    const card = document.querySelector(
      '.file-card[data-excerpt-id="' + msg.requestId + '"]',
    );
    if (!card) return;
    const pre = card.querySelector('.file-card-code');
    if (msg.path) {
      card.setAttribute('data-path', encodeURIComponent(msg.path));
      const full = card.querySelector('.file-card-fullpath');
      if (full) {
        full.textContent = msg.path;
        full.setAttribute('title', msg.path);
      }
      const base = String(msg.path).split(/[/\\]/).pop() || msg.path;
      const pathEl = card.querySelector('.file-card-path');
      if (pathEl) pathEl.textContent = base;
      const range =
        (card.getAttribute('data-line') || '') +
        (card.getAttribute('data-end-line')
          ? '-' + card.getAttribute('data-end-line')
          : '');
      card.setAttribute(
        'title',
        'Open ' + msg.path + (range ? ':' + range : ''),
      );
    }
    if (!pre) return;
    pre.classList.remove('file-card-loading');
    if (msg.text != null && msg.text !== '') {
      pre.textContent = msg.text + (msg.truncated ? '\n…' : '');
    } else {
      // Missing file: keep clickable header, drop broken excerpt body.
      pre.remove();
    }
  }

  const THINKING_CYCLE = ['off', 'low', 'medium', 'high', 'heavy'];
  const THINKING_META = {
    off: { label: 'Off', hint: 'Never send think= — any model is OK' },
    low: { label: 'Low', hint: 'Low effort, fast/cheap single worker' },
    medium: { label: 'Medium', hint: 'Balanced auto route (single worker)' },
    high: { label: 'High', hint: 'High effort, best single thinking model' },
    heavy: {
      label: 'Heavy',
      hint: 'High effort + 4-agent ensemble (Explorer/Analyst/Builder → Skeptic)',
    },
  };

  function normalizeThinking(value) {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (raw === 'light') return 'low';
    if (raw === 'think-off' || raw === 'disabled' || raw === 'none') return 'off';
    if (THINKING_CYCLE.indexOf(raw) >= 0) return raw;
    return 'high';
  }

  function nextThinking(mode) {
    const cur = normalizeThinking(mode);
    const idx = THINKING_CYCLE.indexOf(cur);
    return THINKING_CYCLE[(idx + 1) % THINKING_CYCLE.length];
  }

  function syncThinkChip() {
    const mode = normalizeThinking(thinkingMode);
    thinkingMode = mode;
    const meta = THINKING_META[mode] || THINKING_META.high;
    if (el.thinkBtnLabel) el.thinkBtnLabel.textContent = meta.label;
    if (el.thinkBtn) {
      el.thinkBtn.className = 'think-chip think-' + mode;
      el.thinkBtn.title = 'Thinking ' + meta.label + ' — ' + meta.hint + ' (click to cycle)';
      el.thinkBtn.setAttribute(
        'aria-label',
        'Thinking ' + meta.label + '. Click to cycle.',
      );
    }
  }

  function modelTagsFor(id, label, family) {
    const fam = String(family || '').toLowerCase();
    if (fam === 'qwen') return ['Qwen'];
    if (fam === 'gemma') return ['Gemma'];
    if (fam === 'gpt-oss') return ['gpt-oss'];
    if (fam === 'mistral') return ['Mistral'];
    if (fam === 'llama') return ['Llama'];
    if (fam === 'nemotron') return ['Nemotron'];
    if (fam === 'codestral') return ['FIM'];
    if (fam === 'auto') return ['Auto'];
    const s = ((label || '') + ' ' + (id || '')).toLowerCase();
    if (/qwen/.test(s)) return ['Qwen'];
    if (/gemma/.test(s)) return ['Gemma'];
    if (/gpt-oss/.test(s)) return ['gpt-oss'];
    if (id === 'spockify-auto' || /auto/.test(s)) return ['Auto'];
    return [];
  }

  function closePopovers() {
    if (el.modeMenu) el.modeMenu.hidden = true;
    if (el.modelMenu) el.modelMenu.hidden = true;
    if (el.permMenu) el.permMenu.hidden = true;
    if (el.ctxMenu) el.ctxMenu.hidden = true;
    if (el.modeBtn) el.modeBtn.setAttribute('aria-expanded', 'false');
    if (el.modelBtn) el.modelBtn.setAttribute('aria-expanded', 'false');
    if (el.permBtn) el.permBtn.setAttribute('aria-expanded', 'false');
    if (el.ctxBtn) el.ctxBtn.setAttribute('aria-expanded', 'false');
  }

  /**
   * Place a popover above its trigger with position:fixed so ancestor
   * overflow / contain cannot clip it behind the message list.
   */
  function placePopover(menu, anchor) {
    if (!menu || !anchor) return;
    menu.hidden = false;
    // Force layout so offsetWidth/Height are accurate after unhiding.
    const mw = menu.offsetWidth || 200;
    const mh = menu.offsetHeight || 120;
    const rect = anchor.getBoundingClientRect();
    const gap = 6;
    const pad = 8;
    const vw = window.innerWidth || document.documentElement.clientWidth || 320;
    const vh = window.innerHeight || document.documentElement.clientHeight || 480;

    let left = rect.left;
    // Prefer left-align to trigger; clamp into viewport.
    if (left + mw > vw - pad) left = Math.max(pad, vw - mw - pad);
    if (left < pad) left = pad;

    // Prefer opening upward (Cursor composer drop-up).
    let top = rect.top - mh - gap;
    if (top < pad) {
      // Not enough room above — open below the trigger instead.
      top = Math.min(rect.bottom + gap, vh - mh - pad);
      if (top < pad) top = pad;
    }

    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function renderModeMenu() {
    if (!el.modeMenu) return;
    el.modeMenu.innerHTML = '';
    MODE_META.forEach(function (m) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'mode-item' +
        (m.id === agentMode ? ' selected' : '') +
        ' ' +
        m.colorClass;
      btn.setAttribute('role', 'menuitem');
      btn.dataset.mode = m.id;
      btn.innerHTML =
        '<span class="mode-item-icon">' +
        m.icon +
        '</span><span class="mode-item-copy"><span class="mode-item-label">' +
        m.label +
        '</span><span class="mode-item-hint">' +
        (m.hint || '') +
        '</span></span><span class="mode-item-check">' +
        (m.id === agentMode ? '✓' : '') +
        '</span>';
      btn.addEventListener('click', function () {
        setAgentMode(m.id);
        vscode.postMessage({ type: 'selectAgentMode', mode: agentMode });
        closePopovers();
      });
      el.modeMenu.appendChild(btn);
    });
  }

  function syncModePill() {
    const meta =
      MODE_META.find(function (m) {
        return m.id === agentMode;
      }) || MODE_META[0];
    if (el.modeBtnIcon) el.modeBtnIcon.innerHTML = meta.icon;
    if (el.modeBtnLabel) el.modeBtnLabel.textContent = meta.label;
    if (el.modeBtn) {
      el.modeBtn.title = meta.label + ' (Shift+Tab)';
      el.modeBtn.dataset.mode = meta.id;
      MODE_COLOR_CLASSES.forEach(function (c) {
        el.modeBtn.classList.remove(c);
      });
      el.modeBtn.classList.add(meta.colorClass);
    }
    // Cursor send-with-mode: circular send inherits composer mode tint.
    const sendBtn = el.sendStop || el.send;
    if (sendBtn) {
      MODE_COLOR_CLASSES.forEach(function (c) {
        sendBtn.classList.remove(c);
      });
      sendBtn.classList.add(meta.colorClass);
    }
    if (el.agentMode) el.agentMode.value = agentMode;
    syncPermChip();
  }

  function cycleAgentMode(delta) {
    const idx = MODE_META.findIndex(function (m) {
      return m.id === agentMode;
    });
    const base = idx >= 0 ? idx : 0;
    const next =
      MODE_META[(base + delta + MODE_META.length) % MODE_META.length];
    if (!next) return;
    setAgentMode(next.id);
    vscode.postMessage({ type: 'selectAgentMode', mode: agentMode });
  }

  /** Expand textarea with content; scroll only after ~INPUT_GROW_LINES. */
  function resizeComposerInput() {
    if (!el.input) return;
    const cs = window.getComputedStyle(el.input);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const padY =
      (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const minH = Math.ceil(lineHeight * 2 + padY);
    const maxH = Math.ceil(lineHeight * INPUT_GROW_LINES + padY);
    el.input.style.height = '0px';
    const contentH = el.input.scrollHeight;
    const next = Math.max(minH, Math.min(contentH, maxH));
    el.input.style.height = next + 'px';
    el.input.style.overflowY = contentH > maxH + 1 ? 'auto' : 'hidden';
  }

  function syncPermChip() {
    const ask = agentMode === 'ask';
    const meta =
      PERM_META.find(function (m) {
        return m.id === agentPermissionMode;
      }) || PERM_META[1];
    if (el.permBtnLabel) el.permBtnLabel.textContent = meta.shortLabel;
    if (el.permBtn) {
      el.permBtn.disabled = ask;
      el.permBtn.classList.toggle('is-ask-disabled', ask);
      el.permBtn.classList.toggle('is-allow-all', !ask && meta.id === 'allowAll');
      el.permBtn.title = ask
        ? 'Permissions — disabled in Ask (read-only)'
        : meta.label + ' — ' + meta.desc;
    }
  }

  function renderPermMenu() {
    if (!el.permMenu) return;
    el.permMenu.innerHTML = '';
    PERM_META.forEach(function (m) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'perm-item' + (m.id === agentPermissionMode ? ' selected' : '');
      btn.setAttribute('role', 'menuitem');
      btn.dataset.mode = m.id;
      btn.innerHTML =
        '<span class="perm-item-copy"><span class="perm-item-label">' +
        m.label +
        '</span><span class="perm-item-desc">' +
        m.desc +
        '</span></span><span class="perm-item-check">' +
        (m.id === agentPermissionMode ? '✓' : '') +
        '</span>';
      btn.addEventListener('click', function () {
        if (agentMode === 'ask') return;
        agentPermissionMode = m.id;
        syncPermChip();
        vscode.postMessage({ type: 'setAgentPermissionMode', mode: m.id });
        closePopovers();
      });
      el.permMenu.appendChild(btn);
    });
  }

  function syncModelChip() {
    if (el.modelBtnLabel) {
      el.modelBtnLabel.textContent = autoModel
        ? 'Auto'
        : shortModelLabel(selectedModelId);
    }
    if (el.autoToggle) {
      el.autoToggle.setAttribute('aria-checked', autoModel ? 'true' : 'false');
    }
    if (el.maxToggle) {
      el.maxToggle.setAttribute('aria-checked', maxMode ? 'true' : 'false');
    }
    syncThinkChip();
    syncPermChip();
    if (el.model) el.model.value = selectedModelId;
  }

  function shortModelLabel(id) {
    const found = modelCatalog.find(function (m) {
      return m.id === id;
    });
    const label = (found && (found.label || found.id)) || id || 'Model';
    return label.length > 22 ? label.slice(0, 20) + '…' : label;
  }

  function renderModelList(filter) {
    if (!el.modelList) return;
    el.modelList.innerHTML = '';
    const q = (filter || '').trim().toLowerCase();
    const rows = (modelCatalog || []).filter(function (m) {
      if (!q) return true;
      const hay = ((m.label || '') + ' ' + m.id).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    rows.forEach(function (m, idx) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'model-row';
      btn.setAttribute('role', 'option');
      const tags = modelTagsFor(m.id, m.label, m.family);
      const isNew = idx === 0 && /new|latest|4\.5|5\./i.test(m.label || m.id);
      const selected = !autoModel && m.id === selectedModelId;
      const qwenMark =
        (m.family || '').toLowerCase() === 'qwen'
          ? '<span class="model-family-mark model-family-qwen" aria-hidden="true">Q</span>'
          : '';
      btn.innerHTML =
        '<span class="model-row-name">' +
        qwenMark +
        (m.label || m.id) +
        '</span>' +
        (tags.length
          ? '<span class="model-row-tags">' +
            tags
              .map(function (t) {
                return '<span>' + t + '</span>';
              })
              .join('') +
            '</span>'
          : '') +
        (isNew ? '<span class="model-badge-new">NEW</span>' : '') +
        '<span class="model-row-check">' +
        (selected ? '✓' : '') +
        '</span>';
      btn.addEventListener('click', function () {
        autoModel = false;
        selectedModelId = m.id;
        if (el.model) el.model.value = m.id;
        syncModelChip();
        vscode.postMessage({ type: 'selectModel', model: m.id });
        closePopovers();
      });
      el.modelList.appendChild(btn);
    });
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'model-toggle-desc';
      empty.style.padding = '8px';
      empty.textContent = 'No models match';
      el.modelList.appendChild(empty);
    }
  }

  function setModels(models, selected) {
    const incoming = Array.isArray(models) ? models : [];
    modelCatalog = incoming.filter(function (m) {
      return m && m.id;
    });
    if (el.model) {
      el.model.innerHTML = '';
      modelCatalog.forEach(function (m) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label || m.id;
        if (m.id === selected) opt.selected = true;
        el.model.appendChild(opt);
      });
      if (!el.model.options.length) {
        const opt = document.createElement('option');
        opt.value = 'spockify-auto';
        opt.textContent = 'spockify-auto';
        el.model.appendChild(opt);
        modelCatalog = [{ id: 'spockify-auto', label: 'spockify-auto' }];
      }
    } else if (!modelCatalog.length) {
      modelCatalog = [{ id: 'spockify-auto', label: 'spockify-auto' }];
    }
    if (selected) selectedModelId = selected;
    if (autoModel) {
      selectedModelId = 'spockify-auto';
      if (el.model) el.model.value = 'spockify-auto';
    } else if (selected && el.model) {
      el.model.value = selected;
    }
    syncModelChip();
    renderModelList(el.modelSearch ? el.modelSearch.value : '');
  }

  function setFilesChanged(count) {
    const n = Number(count) || 0;
    if (el.filesChangedCount) el.filesChangedCount.textContent = String(n);
    if (el.filesChangedBar) el.filesChangedBar.hidden = n <= 0;
    if (n > 0 && !streaming) {
      setStreamPhase('review');
    } else if (n <= 0 && streamPhase === 'review') {
      setStreamPhase(streaming ? 'thinking' : 'idle');
    }
  }

  function setStreamPhase(phase) {
    streamPhase = phase || 'idle';
    if (!el.streamPhaseBar || !el.streamPhaseLabel) return;
    const labels = {
      idle: '',
      thinking: 'Thinking',
      tools: 'Running tools',
      applying: 'Applying edits',
      review: 'Review changes',
      done: 'Done',
    };
    const label = labels[streamPhase] || '';
    if (!label || streamPhase === 'idle' || streamPhase === 'done') {
      el.streamPhaseBar.hidden = streamPhase !== 'done';
      if (streamPhase === 'done') {
        el.streamPhaseLabel.textContent = label;
        el.streamPhaseBar.dataset.phase = 'done';
        el.streamPhaseBar.classList.add('done');
        setTimeout(function () {
          if (streamPhase === 'done' && el.streamPhaseBar) {
            el.streamPhaseBar.hidden = true;
            streamPhase = 'idle';
          }
        }, 1600);
      } else {
        el.streamPhaseBar.hidden = true;
        el.streamPhaseBar.classList.remove('done');
      }
      return;
    }
    el.streamPhaseBar.hidden = false;
    el.streamPhaseBar.classList.remove('done');
    el.streamPhaseBar.dataset.phase = streamPhase;
    el.streamPhaseLabel.textContent = label;
  }

  function phaseFromToolName(name) {
    if (name === 'write_file' || name === 'apply_patch') return 'applying';
    return 'tools';
  }

  function renderAgentsActivityBar(payload) {
    if (!el.agentsActivityBar) return;
    if (!payload || !payload.runId) {
      agentsHudRun = null;
      el.agentsActivityBar.hidden = true;
      return;
    }
    agentsHudRun = payload;
    const workers = Array.isArray(payload.workers) ? payload.workers : [];
    const status = payload.status || 'pending';
    const active = /^(pending|running|synthesizing)$/.test(status);
    const doneN = workers.filter(function (w) {
      const st = workerStateOf(w);
      return st === 'done' || st === 'failed' || st === 'cancelled';
    }).length;
    const pct = workers.length
      ? Math.round((doneN / workers.length) * 100)
      : 0;

    el.agentsActivityBar.hidden = workers.length === 0 && !active;
    if (el.agentsActivityBar.hidden) return;

    if (el.agentsActivityTitle) {
      el.agentsActivityTitle.textContent = active
        ? 'Agents · ' + doneN + '/' + (workers.length || '?')
        : 'Agents · ' + status;
    }
    if (el.agentsActivityProgress) {
      el.agentsActivityProgress.hidden = !active || !workers.length;
    }
    if (el.agentsActivityFill) {
      el.agentsActivityFill.style.width = pct + '%';
    }
    if (el.agentsActivityWorkers) {
      el.agentsActivityWorkers.innerHTML = workers
        .slice(0, 6)
        .map(function (w) {
          const st = workerStateOf(w);
          const cls =
            st === 'done'
              ? 'done'
              : st === 'failed' || st === 'cancelled'
                ? 'failed'
                : 'busy';
          return (
            '<span class="agents-worker-chip ' +
            cls +
            '" title="' +
            escapeHtml((w.name || w.id || 'worker') + ': ' + st) +
            '"><span class="agents-worker-dot"></span>' +
            escapeHtml(truncateOneLine(w.name || w.id || 'worker', 18)) +
            '</span>'
          );
        })
        .join('');
    }
    if (el.agentsActivityOpen) {
      el.agentsActivityOpen.hidden = false;
      el.agentsActivityOpen.dataset.runId = payload.runId;
    }
    if (el.agentsActivityCancel) {
      el.agentsActivityCancel.hidden = !active;
      el.agentsActivityCancel.disabled = !!agentsCancelBusy;
      el.agentsActivityCancel.textContent = agentsCancelBusy
        ? 'Cancelling…'
        : 'Cancel';
      el.agentsActivityCancel.dataset.runId = payload.runId;
    }
  }

  function setModelPrefs(prefs) {
    if (!prefs) return;
    if (typeof prefs.auto === 'boolean') autoModel = prefs.auto;
    if (typeof prefs.maxMode === 'boolean') maxMode = prefs.maxMode;
    if (typeof prefs.thinking === 'string') {
      thinkingMode = normalizeThinking(prefs.thinking);
    }
    if (typeof prefs.agentPermissionMode === 'string') {
      agentPermissionMode = prefs.agentPermissionMode;
    } else if (typeof prefs.runAllUnsandboxed === 'boolean') {
      agentPermissionMode = prefs.runAllUnsandboxed
        ? 'allowAll'
        : 'askEveryTime';
    }
    if (prefs.selectedModel) selectedModelId = prefs.selectedModel;
    syncModelChip();
    syncPermChip();
    renderModelList(el.modelSearch ? el.modelSearch.value : '');
  }

  function setAuth(signedIn, label) {
    el.authChip.textContent = signedIn
      ? label || 'signed in'
      : 'not signed in';
    el.signInBtn.hidden = !!signedIn;
    refreshEmptyForAuth();
  }

  function toolArgsFromHistory(messages, index, toolCallId, name) {
    for (let i = index - 1; i >= 0; i--) {
      const prev = messages[i];
      if (!prev || prev.role !== 'assistant' || !prev.toolCalls) continue;
      const hit = prev.toolCalls.find(function (c) {
        return (
          (toolCallId && c.id === toolCallId) ||
          (!toolCallId && c.name === name)
        );
      });
      if (hit) return hit.arguments || {};
    }
    return {};
  }

  function renderHistory(messages) {
    el.messages.innerHTML = '';
    assistantNode = null;
    assistantRaw = '';
    pendingDelta = '';
    resetToolTimelineState();
    if (rafPending) {
      cancelAnimationFrame(rafPending);
      rafPending = 0;
    }
    if (!messages || !messages.length) {
      showEmpty();
      return;
    }
    messages.forEach(function (m, idx) {
      if (m.role === 'user') appendUser(m.content || '');
      else if (m.role === 'assistant') {
        const raw = m.content || '';
        // Skip empty assistant placeholders that only carried tool_calls.
        if (!String(raw).trim() && m.toolCalls && m.toolCalls.length) {
          return;
        }
        if (!String(raw).trim()) return;
        const node = document.createElement('div');
        node.className = 'msg assistant';
        node.setAttribute('data-raw', raw);
        const attribution = m.model
          ? (m.model === 'spockify-auto' || String(m.model).endsWith('-auto')
              ? 'Auto'
              : String(m.model).split('/').pop()) + ' · routed via spockify'
          : '';
        if (m.model) node.setAttribute('data-model', m.model);
        if (attribution) node.setAttribute('data-attribution', attribution);
        assistantNode = node;
        assistantRaw = raw;
        paintAssistant();
        assistantNode = null;
        assistantRaw = '';
        el.messages.appendChild(node);
      } else if (m.role === 'tool') {
        const id = m.toolCallId || 'hist-tool-' + idx;
        const args = toolArgsFromHistory(messages, idx, m.toolCallId, m.name);
        const err =
          typeof m.content === 'string' && /^Error:/i.test(m.content)
            ? m.content
            : undefined;
        upsertToolCard(
          {
            id: id,
            name: m.name || 'tool',
            arguments: args,
            ok: !err,
            content: m.content || '',
            error: err,
          },
          'result',
        );
      }
    });
    assistantRaw = '';
    syncReplyActions();
    scrollToBottomIfPinned();
  }

  /** Bottom-of-turn Retry (Cursor-style), not in the composer chrome. */
  function findRetryAnchor() {
    if (!el.messages) return null;
    const kids = el.messages.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      if (k.classList.contains('reply-actions')) continue;
      if (k.classList.contains('msg') && k.classList.contains('user')) break;
      if (
        (k.classList.contains('msg') &&
          (k.classList.contains('assistant') || k.classList.contains('error'))) ||
        k.classList.contains('tool-card') ||
        k.classList.contains('tool-summary') ||
        k.classList.contains('thought-line') ||
        k.classList.contains('agent-run-card')
      ) {
        return k;
      }
    }
    return null;
  }

  function ensureReplyActions() {
    let bar = el.messages
      ? el.messages.querySelector(':scope > .reply-actions')
      : null;
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'reply-actions';
    bar.hidden = true;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost-btn reply-retry';
    btn.title = 'Retry last';
    btn.textContent = 'Retry';
    btn.addEventListener('click', function () {
      if (streaming) return;
      stickToBottom = true;
      setStreaming(true);
      vscode.postMessage({ type: 'retry' });
    });
    bar.appendChild(btn);
    return bar;
  }

  function syncReplyActions() {
    if (!el.messages) return;
    const bar = ensureReplyActions();
    const btn = bar.querySelector('.reply-retry');
    if (btn) btn.disabled = !!streaming;
    const anchor = findRetryAnchor();
    const hasUser = !!el.messages.querySelector('.msg.user');
    if (
      streaming ||
      !hasUser ||
      !anchor ||
      (anchor.classList.contains('assistant') &&
        anchor.classList.contains('streaming'))
    ) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    if (anchor.nextSibling !== bar) {
      if (anchor.nextSibling) {
        el.messages.insertBefore(bar, anchor.nextSibling);
      } else {
        el.messages.appendChild(bar);
      }
    } else if (!bar.isConnected) {
      el.messages.appendChild(bar);
    }
  }

  function shouldResumeStreamingAfterHistory(input) {
    if (input.resumeStreaming) return true;
    if (!input.acceptStreamEvents) return false;
    return input.wasLocallyStreaming || input.tabListedAsStreaming;
  }

  function setStreaming(on) {
    streaming = on;
    // One button morphs: send arrow ↔ stop square (never both).
    const btn = el.sendStop || el.send;
    if (btn) {
      btn.dataset.mode = on ? 'stop' : 'send';
      btn.classList.toggle('send-round', !on);
      btn.classList.toggle('stop-round', !!on);
      btn.title = on
        ? 'Stop this turn (Esc) — parallel agents keep running'
        : 'Send (Enter)';
      btn.setAttribute('aria-label', on ? 'Stop this turn' : 'Send');
      const sendGlyph = btn.querySelector('.send-glyph');
      const stopGlyph = btn.querySelector('.stop-glyph');
      if (sendGlyph) sendGlyph.hidden = !!on;
      if (stopGlyph) stopGlyph.hidden = !on;
    }
    if (el.composerBox) el.composerBox.classList.toggle('working', !!on);
    if (el.composerHint) {
      el.composerHint.textContent = on
        ? 'Stop ends this turn · agents keep running'
        : 'Plan, search, build — Shift+Tab cycles mode';
    }
    if (on) {
      setStreamPhase('thinking');
    } else if (streamPhase !== 'review') {
      setStreamPhase(
        el.filesChangedBar && !el.filesChangedBar.hidden ? 'review' : 'done',
      );
    }
    if (!on && assistantNode) {
      finalizeAssistantPaint();
      assistantNode.classList.remove('streaming');
      assistantNode = null;
      assistantRaw = '';
    }
    syncReplyActions();
  }

  function cancelStreamingUi() {
    streaming = false;
    acceptStreamEvents = false;
    setStreamPhase('idle');
    if (el.composerBox) el.composerBox.classList.remove('working');
    const btn = el.sendStop || el.send;
    if (btn) {
      btn.disabled = false;
      btn.dataset.mode = 'send';
      btn.classList.add('send-round');
      btn.classList.remove('stop-round');
      btn.title = 'Send (Enter)';
      btn.setAttribute('aria-label', 'Send');
      const sendGlyph = btn.querySelector('.send-glyph');
      const stopGlyph = btn.querySelector('.stop-glyph');
      if (sendGlyph) sendGlyph.hidden = false;
      if (stopGlyph) stopGlyph.hidden = true;
    }
    pendingDelta = '';
    resetToolTimelineState();
    hideToolConsent();
    if (rafPending) {
      cancelAnimationFrame(rafPending);
      rafPending = 0;
    }
    // Drop any in-flight rendering state and tool cards. History reload
    // (switching tabs/sessions) should be the source of truth.
    if (assistantNode) {
      assistantNode.classList.remove('streaming');
      assistantNode = null;
    }
    assistantRaw = '';
    syncReplyActions();
  }

  function hideToolConsent() {
    toolConsent = null;
    if (el.toolConsentBar) el.toolConsentBar.hidden = true;
    const cards = el.messages.querySelectorAll('.tool-consent-card.pending');
    cards.forEach(function (c) {
      c.remove();
    });
  }

  function visualizeWs(text) {
    return String(text || '')
      .replace(/ /g, '\u00b7')
      .replace(/\t/g, '\u2192');
  }

  /** Line-by-line colored unified diff with Cursor-style collapsed +/- runs. */
  function renderUnifiedDiffHtml(unified) {
    const lines = String(unified || '').split('\n');
    const rows = collapseUnifiedDiffLines(lines);
    const max = Math.min(rows.length, 400);
    const parts = [];
    for (let i = 0; i < max; i++) {
      const row = rows[i];
      if (row.kind === 'collapsed') {
        const cls =
          'diff-ln collapsed ' + (row.sig === '-' ? 'del' : 'add');
        const sig = row.sig === '-' ? '\u2212' : '+';
        parts.push(
          '<div class="' +
            cls +
            '" title="Click card to expand full diff"><span class="diff-sig">' +
            sig +
            '</span><span class="diff-body">' +
            escapeHtml(row.text) +
            '</span></div>',
        );
        continue;
      }
      const line = row.text;
      const prefix = line.charAt(0);
      const body = line.slice(1);
      let cls = 'diff-ln';
      let sig = ' ';
      let content = escapeHtml(visualizeWs(line));
      if (
        line.startsWith('+++') ||
        line.startsWith('---') ||
        line.startsWith('diff ')
      ) {
        cls += ' meta';
        content = escapeHtml(line);
      } else if (line.startsWith('@@')) {
        cls += ' hunk';
        content = escapeHtml(line);
      } else if (prefix === '+' && !line.startsWith('+++')) {
        cls += ' add';
        sig = '+';
        content = escapeHtml(visualizeWs(body));
      } else if (prefix === '-' && !line.startsWith('---')) {
        cls += ' del';
        sig = '\u2212';
        content = escapeHtml(visualizeWs(body));
      } else if (prefix === ' ') {
        sig = ' ';
        content = escapeHtml(visualizeWs(body));
      }
      parts.push(
        '<div class="' +
          cls +
          '"><span class="diff-sig">' +
          sig +
          '</span><span class="diff-body">' +
          content +
          '</span></div>',
      );
    }
    if (rows.length > max) {
      parts.push('<div class="diff-ln meta">\u2026</div>');
    }
    return parts.join('');
  }

  /**
   * Collapse long consecutive +/- runs into Cursor-style summary rows:
   * `+203 … subject=email_subject | +28 … notification_id`
   */
  function collapseUnifiedDiffLines(lines) {
    const COLLAPSE_MIN_LINES = 4;
    const COLLAPSE_MIN_CHARS = 120;
    const COLLAPSE_MAX_SNIPPETS = 3;
    const out = [];
    let runSig = null;
    let run = [];

    function peekOf(body) {
      const t = String(body || '').replace(/^\s+|\s+$/g, '');
      if (!t) return '\u00b7';
      const str = t.match(/['"`][^'"`]{3,}['"`]/);
      if (str) {
        let s = str[0].replace(/^['"`]|['"`]$/g, '');
        if (s.length > 36) s = s.slice(0, 34) + '\u2026';
        return s;
      }
      const id = t.match(/[A-Za-z_][A-Za-z0-9_]{2,}/);
      let peek = id ? id[0] : t;
      if (peek.length > 40) peek = peek.slice(0, 38) + '\u2026';
      return peek;
    }

    function flush() {
      if (!runSig || !run.length) {
        runSig = null;
        run = [];
        return;
      }
      const bodies = run.map(function (l) {
        return l.slice(1);
      });
      const chars = bodies.reduce(function (a, b) {
        return a + b.length + 1;
      }, 0);
      const collapse =
        bodies.length >= COLLAPSE_MIN_LINES ||
        (chars >= COLLAPSE_MIN_CHARS && bodies.length >= 2);
      if (!collapse) {
        for (let i = 0; i < run.length; i++) {
          out.push({ kind: 'raw', text: run[i] });
        }
      } else {
        const n = Math.min(
          COLLAPSE_MAX_SNIPPETS,
          Math.max(2, Math.ceil(bodies.length / 8)),
        );
        const size = Math.ceil(bodies.length / n);
        const parts = [];
        for (
          let i = 0;
          i < bodies.length && parts.length < COLLAPSE_MAX_SNIPPETS;
          i += size
        ) {
          const slice = bodies.slice(i, i + size);
          const c = slice.reduce(function (a, b) {
            return a + b.length + 1;
          }, 0);
          parts.push(runSig + c + ' \u2026 ' + peekOf(slice[0]));
        }
        out.push({
          kind: 'collapsed',
          text: parts.join(' | '),
          sig: runSig,
        });
      }
      runSig = null;
      run = [];
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isHeader =
        line.startsWith('+++') ||
        line.startsWith('---') ||
        line.startsWith('diff ') ||
        line.startsWith('@@');
      const prefix = line.charAt(0);
      if (
        !isHeader &&
        (prefix === '+' || prefix === '-') &&
        !line.startsWith('+++') &&
        !line.startsWith('---')
      ) {
        if (runSig && runSig !== prefix) flush();
        runSig = prefix;
        run.push(line);
        continue;
      }
      flush();
      out.push({ kind: 'raw', text: line });
    }
    flush();
    return out;
  }

  function showToolConsent(req) {
    hideToolConsent();
    toolConsent = { id: req.id };

    // Cursor ShellToolCallView: pending approval as a block in the transcript.
    removeEmpty();
    maybeInsertThought(400);
    const card = document.createElement('div');
    card.className = 'tool-consent-card pending';
    card.dataset.consentId = String(req.id || '');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Tool consent');

    const head = document.createElement('div');
    head.className = 'tool-consent-card-head';
    const title = document.createElement('div');
    title.className = 'tool-consent-card-title';
    title.textContent = req.title || 'Tool wants to run';
    head.appendChild(title);
    if (req.badge) {
      const badge = document.createElement('span');
      badge.className = 'tool-consent-badge';
      badge.textContent = String(req.badge);
      head.appendChild(badge);
    }
    card.appendChild(head);

    if (req.hint) {
      const hint = document.createElement('div');
      hint.className = 'tool-consent-card-hint';
      hint.textContent = String(req.hint);
      card.appendChild(hint);
    }

    const cmd = document.createElement('pre');
    cmd.className = 'tool-consent-card-cmd';
    cmd.textContent = String(req.commandPreview || '');
    card.appendChild(cmd);

    const actions = document.createElement('div');
    actions.className = 'tool-consent-card-actions';

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'ghost-btn';
    skipBtn.textContent = 'Skip';
    skipBtn.title = 'Reject (Esc)';
    skipBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      respondToolConsent('reject');
    });
    actions.appendChild(skipBtn);

    if (req.allowSessionEnabled) {
      const alwaysBtn = document.createElement('button');
      alwaysBtn.type = 'button';
      alwaysBtn.className = 'ghost-btn';
      alwaysBtn.textContent = 'Always allow';
      alwaysBtn.title = 'Allow for this session';
      alwaysBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        respondToolConsent('allowSession');
      });
      actions.appendChild(alwaysBtn);
    }

    if (req.terminalRunEnabled) {
      const termBtn = document.createElement('button');
      termBtn.type = 'button';
      termBtn.className = 'ghost-btn';
      termBtn.textContent = 'Run in Terminal';
      termBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        respondToolConsent('terminalRun');
      });
      actions.appendChild(termBtn);
    }

    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = 'ghost-btn tool-consent-accept';
    runBtn.textContent = 'Run';
    runBtn.title = 'Run (Enter)';
    runBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      respondToolConsent('run');
    });
    actions.appendChild(runBtn);

    card.appendChild(actions);
    insertTimelineNode(card);
    scrollToBottomIfPinned();
    try {
      runBtn.focus();
    } catch (_) {}
  }

  function respondToolConsent(decision) {
    if (!toolConsent || !toolConsent.id) return;
    const id = toolConsent.id;
    vscode.postMessage({
      type: 'toolConsentResponse',
      id: id,
      decision: decision,
    });
    const card = el.messages.querySelector(
      '.tool-consent-card.pending[data-consent-id="' + id + '"]',
    );
    if (card) {
      card.classList.remove('pending');
      card.classList.add(decision === 'reject' ? 'rejected' : 'resolved');
      const actions = card.querySelector('.tool-consent-card-actions');
      if (actions) {
        actions.querySelectorAll('button').forEach(function (b) {
          b.disabled = true;
        });
        const status = document.createElement('span');
        status.className = 'tool-consent-card-status';
        status.textContent =
          decision === 'run'
            ? 'Running…'
            : decision === 'allowSession'
              ? 'Allowed for session'
              : decision === 'terminalRun'
                ? 'Running in terminal…'
                : 'Skipped';
        actions.appendChild(status);
      }
    }
    toolConsent = null;
    if (el.toolConsentBar) el.toolConsentBar.hidden = true;
  }

  function activeContextTags() {
    const tags = [];
    el.ctxChips.forEach(function (chip) {
      if (chip.classList.contains('active')) {
        const t = chip.getAttribute('data-tag');
        if (t === 'file' || t === 'codebase' || t === 'terminal' || t === 'web') {
          tags.push(t);
        }
      }
    });
    return tags;
  }

  function syncCtxMenuChecks() {
    el.ctxChips.forEach(function (chip) {
      const on = chip.classList.contains('active');
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
      const check = chip.querySelector('.ctx-item-check');
      if (check) check.textContent = on ? '✓' : '';
    });
    if (el.ctxBtnSummary) {
      const n =
        activeContextTags().length +
        selectionChips.length +
        fileAttachments.length;
      el.ctxBtnSummary.textContent = n ? String(n) : '';
    }
  }

  function applyContextChips(chips) {
    if (!chips || typeof chips !== 'object') return;
    el.ctxChips.forEach(function (chip) {
      const t = chip.getAttribute('data-tag');
      if (!t) return;
      if (Object.prototype.hasOwnProperty.call(chips, t)) {
        chip.classList.toggle('active', !!chips[t]);
      }
    });
    syncCtxMenuChecks();
  }

  function renderSelectionChips() {
    if (!el.selChips) return;
    el.selChips.innerHTML = '';
    const hasSel = selectionChips.length > 0;
    const hasAtt = fileAttachments.length > 0;
    if (!hasSel && !hasAtt) {
      el.selChips.hidden = true;
      syncCtxMenuChecks();
      return;
    }
    el.selChips.hidden = false;
    selectionChips.forEach(function (chip) {
      const node = document.createElement('div');
      node.className = 'sel-chip';
      node.setAttribute('data-id', chip.id);
      node.title =
        (chip.filePath || chip.fileName) +
        ' · lines ' +
        chip.startLine +
        '-' +
        chip.endLine;
      node.innerHTML = SEL_FILE_ICON;
      const label = document.createElement('span');
      label.className = 'sel-chip-label';
      label.textContent =
        chip.fileName + ' (' + chip.startLine + '-' + chip.endLine + ')';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sel-chip-remove';
      remove.title = 'Remove selection';
      remove.setAttribute('aria-label', 'Remove ' + label.textContent);
      remove.textContent = '×';
      remove.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        removeSelectionChip(chip.id);
      });
      node.appendChild(label);
      node.appendChild(remove);
      el.selChips.appendChild(node);
    });
    fileAttachments.forEach(function (att) {
      const node = document.createElement('div');
      node.className =
        'sel-chip attach-chip' +
        (att.kind === 'image' ? ' attach-chip-image' : '');
      node.setAttribute('data-attach-id', att.id);
      node.title = att.name + (att.mimeType ? ' · ' + att.mimeType : '');
      if (att.kind === 'image' && att.dataUrl) {
        const img = document.createElement('img');
        img.className = 'sel-chip-thumb';
        img.src = att.dataUrl;
        img.alt = '';
        node.appendChild(img);
      } else {
        node.innerHTML = SEL_FILE_ICON;
      }
      const label = document.createElement('span');
      label.className = 'sel-chip-label';
      label.textContent = att.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sel-chip-remove';
      remove.title = 'Remove attachment';
      remove.setAttribute('aria-label', 'Remove ' + att.name);
      remove.textContent = '×';
      remove.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        removeFileAttachment(att.id);
      });
      node.appendChild(label);
      node.appendChild(remove);
      el.selChips.appendChild(node);
    });
    syncCtxMenuChecks();
  }

  function addSelectionChip(chip) {
    if (!chip || !chip.id || !chip.text) return;
    selectionChips = selectionChips.filter(function (c) {
      return c.id !== chip.id;
    });
    selectionChips.push({
      id: chip.id,
      fileName: chip.fileName || 'file',
      filePath: chip.filePath || '',
      startLine: chip.startLine || 1,
      endLine: chip.endLine || chip.startLine || 1,
      text: chip.text,
    });
    renderSelectionChips();
  }

  function removeSelectionChip(id) {
    selectionChips = selectionChips.filter(function (c) {
      return c.id !== id;
    });
    renderSelectionChips();
  }

  function clearSelectionChips() {
    if (!selectionChips.length) return;
    selectionChips = [];
    renderSelectionChips();
  }

  function removeFileAttachment(id) {
    fileAttachments = fileAttachments.filter(function (a) {
      return a.id !== id;
    });
    renderSelectionChips();
  }

  function clearFileAttachments() {
    if (!fileAttachments.length) return;
    fileAttachments = [];
    renderSelectionChips();
  }

  function looksLikeTextFile(mime, name) {
    if (mime && /^text\//i.test(mime)) return true;
    if (
      mime &&
      /^(application\/(json|xml|javascript|typescript|x-yaml|yaml|toml|sql|csv|x-sh)|image\/svg\+xml)/i.test(
        mime,
      )
    ) {
      return true;
    }
    return /\.(txt|md|markdown|json|js|ts|tsx|jsx|css|html|htm|xml|yml|yaml|toml|py|rs|go|java|c|h|cpp|hpp|cs|rb|php|sh|bash|zsh|sql|csv|svg|env)$/i.test(
      name || '',
    );
  }

  function addFileAttachment(att) {
    if (!att || !att.name) return;
    if (fileAttachments.length >= MAX_FILE_ATTACHMENTS) return;
    fileAttachments.push(att);
    renderSelectionChips();
  }

  function readFileAsAttachment(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('no file'));
        return;
      }
      if (file.size > MAX_ATTACH_BYTES) {
        reject(new Error('File too large (max 4MB)'));
        return;
      }
      const isImage = /^image\//i.test(file.type || '');
      const reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('read failed'));
      };
      if (isImage) {
        reader.onload = function () {
          resolve({
            id: 'att' + ++fileAttachSeq,
            name: file.name || 'image',
            mimeType: file.type || 'image/png',
            kind: 'image',
            dataUrl: String(reader.result || ''),
            size: file.size,
          });
        };
        reader.readAsDataURL(file);
        return;
      }
      if (looksLikeTextFile(file.type, file.name)) {
        reader.onload = function () {
          resolve({
            id: 'att' + ++fileAttachSeq,
            name: file.name || 'file',
            mimeType: file.type || 'text/plain',
            kind: 'file',
            textContent: String(reader.result || ''),
            size: file.size,
          });
        };
        reader.readAsText(file);
        return;
      }
      reader.onload = function () {
        resolve({
          id: 'att' + ++fileAttachSeq,
          name: file.name || 'file',
          mimeType: file.type || 'application/octet-stream',
          kind: 'file',
          dataUrl: String(reader.result || ''),
          size: file.size,
        });
      };
      reader.readAsDataURL(file);
    });
  }

  function ingestFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    files.forEach(function (file) {
      readFileAsAttachment(file)
        .then(function (att) {
          addFileAttachment(att);
        })
        .catch(function () {
          /* ignore oversize / read errors */
        });
    });
  }

  function toggleCtxMenu(forceOpen) {
    if (!el.ctxMenu || !el.ctxBtn) return;
    const open =
      typeof forceOpen === 'boolean' ? forceOpen : el.ctxMenu.hidden;
    closePopovers();
    if (open) {
      syncCtxMenuChecks();
      placePopover(el.ctxMenu, el.ctxBtn);
      el.ctxBtn.setAttribute('aria-expanded', 'true');
    }
  }

  function send(opts) {
    const text = (el.input.value || '').trim();
    const atts = fileAttachments.slice();
    if (!text && !atts.length) return;
    // If a turn is already streaming, this submission queues host-side
    // (see 'queuedSends') rather than starting/replacing it — don't touch
    // the in-flight assistant node or optimistically append a user bubble;
    // 'history' will render it for real once the host actually starts it.
    if (!streaming) {
      stickToBottom = true;
      // Detach prior turn — streamStart creates a fresh assistant under this card.
      if (assistantNode) {
        assistantNode.classList.remove('streaming');
      }
      assistantNode = null;
      assistantRaw = '';
      pendingDelta = '';
      if (rafPending) {
        cancelAnimationFrame(rafPending);
        rafPending = 0;
      }
      appendUser(text, atts);
      setStreaming(true);
      if (el.latency) el.latency.textContent = '';
    }
    const tags = activeContextTags();
    const chips = selectionChips.slice();
    vscode.postMessage({
      type: 'send',
      text: text,
      model: autoModel ? 'spockify-auto' : el.model.value || selectedModelId,
      withContext: tags.length > 0 || chips.length > 0 || atts.length > 0,
      contextTags: tags,
      selectionChips: chips,
      attachments: atts,
      agentMode: agentMode,
      modifierFlip: !!(opts && opts.modifierFlip),
    });
    el.input.value = '';
    clearSelectionChips();
    clearFileAttachments();
    resizeComposerInput();
  }

  function renderQueuedSends(items) {
    if (!el.queuedSends) return;
    const list = Array.isArray(items) ? items : [];
    el.queuedSends.innerHTML = '';
    if (!list.length) {
      el.queuedSends.hidden = true;
      return;
    }
    el.queuedSends.hidden = false;
    list.forEach(function (item) {
      const row = document.createElement('div');
      row.className = 'queued-send';
      const icon = document.createElement('span');
      icon.className = 'queued-send-icon';
      icon.innerHTML = QUEUE_ICON;
      icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'queued-send-text';
      text.textContent = item.preview || '(empty)';
      text.title = item.preview || '';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'queued-send-remove';
      remove.title = 'Remove from queue';
      remove.setAttribute('aria-label', 'Remove queued message');
      remove.textContent = '✕';
      remove.addEventListener('click', function () {
        vscode.postMessage({ type: 'clearQueuedSend', id: item.id });
      });
      row.appendChild(icon);
      row.appendChild(text);
      row.appendChild(remove);
      el.queuedSends.appendChild(row);
    });
  }

  function truncateOneLine(s, max) {
    const t = String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    return t.length > max ? t.slice(0, Math.max(1, max - 1)) + '…' : t;
  }

  function toolMetaSummary(name, args) {
    if (!args || typeof args !== 'object') return '';
    if (name === 'terminal_run') {
      return String(args.command || args.cmd || '').slice(0, 200);
    }
    if (name === 'apply_patch') {
      const files = Array.isArray(args.files) ? args.files : [];
      const paths = files
        .map(function (f) {
          return f && f.path ? String(f.path) : '';
        })
        .filter(Boolean);
      if (args.path) paths.push(String(args.path));
      return paths.length
        ? paths.slice(0, 6).join(', ') + (paths.length > 6 ? '…' : '')
        : 'patch';
    }
    if (name === 'codebase_search') {
      return String(args.query || '').slice(0, 160);
    }
    if (name === 'web_search') {
      return String(args.query || '').slice(0, 160);
    }
    if (name === 'fetch_url') {
      return String(args.url || '').slice(0, 200);
    }
    if (name === 'grep') {
      return String(args.pattern || args.query || '').slice(0, 160);
    }
    if (name === 'glob_file_search') {
      return String(args.glob || args.pattern || '').slice(0, 160);
    }
    if (name === 'read_file' || name === 'write_file') {
      return String(args.path || '').slice(0, 200);
    }
    if (name === 'list_dir') {
      return String(args.path || args.directory || '.').slice(0, 200);
    }
    if (name && name.indexOf('mcp__') === 0) {
      try {
        return JSON.stringify(args).slice(0, 160);
      } catch (e) {
        return '';
      }
    }
    return '';
  }

  function toolLabel(name) {
    if (name === 'terminal_run') return 'terminal';
    if (name === 'apply_patch') return 'apply';
    if (name === 'codebase_search') return 'search';
    if (name === 'web_search') return 'web';
    if (name === 'fetch_url') return 'fetch';
    if (name === 'grep') return 'grep';
    if (name === 'glob_file_search') return 'glob';
    if (name === 'read_file') return 'read';
    if (name === 'write_file') return 'write';
    if (name === 'list_dir') return 'list';
    return name || 'tool';
  }

  /** One compact "current action" line for the status pill — "Running:
   * <cmd>", "Reading <file>", etc. — instead of the generic "Tool: name".
   * Reuses the same arg-summary logic as the tool cards (toolMetaSummary)
   * so the two stay consistent. */
  function toolStatusLine(name, args) {
    const summary = truncateOneLine(toolMetaSummary(name, args), 40);
    if (name === 'terminal_run') return summary ? 'Running: ' + summary : 'Running…';
    if (name === 'read_file') return summary ? 'Reading ' + summary : 'Reading…';
    if (name === 'write_file') return summary ? 'Writing ' + summary : 'Writing…';
    if (name === 'apply_patch') return summary ? 'Editing ' + summary : 'Editing…';
    if (name === 'codebase_search') return summary ? 'Searching ' + summary : 'Searching…';
    if (name === 'web_search') return summary ? 'Web search: ' + summary : 'Web search…';
    if (name === 'fetch_url') return summary ? 'Fetching ' + summary : 'Fetching…';
    if (name === 'grep') return summary ? 'Grepping ' + summary : 'Grepping…';
    if (name === 'glob_file_search') return summary ? 'Finding ' + summary : 'Finding…';
    if (name === 'list_dir') return summary ? 'Listing ' + summary : 'Listing…';
    return summary ? toolLabel(name) + ': ' + summary : 'Tool: ' + toolLabel(name);
  }

  function rememberToolSummary(card, name, args) {
    const summary = toolMetaSummary(name, args);
    if (summary) card.dataset.summary = summary;
    return card.dataset.summary || summary || '';
  }

  /** Explore-style tools collapse to grey one-liners (Cursor density). */
  const EXPLORE_TOOLS = {
    read_file: true,
    list_dir: true,
    codebase_search: true,
    grep: true,
    glob_file_search: true,
    web_search: true,
    fetch_url: true,
  };

  /** Agent-run create: card comes from maybeShowAgentCardFromTool / live bridge. */
  const AGENT_RUN_TOOLS = {
    spockify_create_agent_run: true,
    create_agent_run: true,
  };

  /** Tools that keep a bordered expandable result card. */
  function isResultCardTool(name) {
    return name === 'terminal_run' || name === 'apply_patch' || name === 'write_file';
  }

  let exploreBatch = null;
  let thoughtAnchorAt = 0;
  let lastTimelineAt = 0;
  /** Live “Thinking… Ns” node while the model is idle before the next content. */
  let liveThought = null;
  let liveThoughtTimer = 0;
  let thoughtRestartTimer = 0;

  function resetToolTimelineState() {
    exploreBatch = null;
    thoughtAnchorAt = 0;
    lastTimelineAt = 0;
    cancelScheduledThought();
    stopLiveThought(false);
  }

  function cancelScheduledThought() {
    if (thoughtRestartTimer) {
      clearTimeout(thoughtRestartTimer);
      thoughtRestartTimer = 0;
    }
  }

  function scheduleLiveThought() {
    cancelScheduledThought();
    thoughtRestartTimer = setTimeout(function () {
      thoughtRestartTimer = 0;
      if (streaming) startLiveThought();
    }, 280);
  }

  function stopLiveThought(keepNode) {
    if (liveThoughtTimer) {
      clearInterval(liveThoughtTimer);
      liveThoughtTimer = 0;
    }
    if (!keepNode && liveThought && liveThought.node && liveThought.node.isConnected) {
      liveThought.node.remove();
    }
    if (!keepNode) liveThought = null;
  }

  function paintLiveThought() {
    if (!liveThought || !liveThought.node) return;
    const secs = Math.max(0, Math.floor((Date.now() - liveThought.startedAt) / 1000));
    liveThought.node.textContent = 'Thinking… ' + secs + 's';
    liveThought.node.classList.add('thinking');
  }

  function startLiveThought() {
    if (liveThought && liveThought.node && liveThought.node.isConnected) {
      return;
    }
    stopLiveThought(false);
    const line = document.createElement('div');
    line.className = 'thought-line thinking';
    line.textContent = 'Thinking… 0s';
    insertTimelineNode(line);
    liveThought = { node: line, startedAt: Date.now() };
    thoughtAnchorAt = liveThought.startedAt;
    liveThoughtTimer = setInterval(paintLiveThought, 1000);
  }

  function finalizeLiveThought(minMs) {
    cancelScheduledThought();
    const floor = typeof minMs === 'number' ? minMs : 400;
    if (liveThought && liveThought.node && liveThought.node.isConnected) {
      const ms = Date.now() - liveThought.startedAt;
      stopLiveThought(true);
      if (ms < floor) {
        liveThought.node.remove();
        liveThought = null;
        thoughtAnchorAt = Date.now();
        return;
      }
      const secs = Math.max(1, Math.round(ms / 1000));
      liveThought.node.classList.remove('thinking');
      liveThought.node.textContent = 'Thought for ' + secs + 's';
      liveThought = null;
      thoughtAnchorAt = Date.now();
      return;
    }
    // No live node — do not invent a retrospective "Thought for Ns" at the
    // bottom of the reply (that was the old streamDone placement bug).
    thoughtAnchorAt = Date.now();
  }

  function sealAssistantBeforeTimeline() {
    if (assistantNode && assistantNode.isConnected) {
      if (rafPending) {
        cancelAnimationFrame(rafPending);
        rafPending = 0;
      }
      if (pendingDelta) {
        assistantRaw += pendingDelta;
        pendingDelta = '';
      }
      paintAssistant();
      assistantNode.classList.remove('streaming');
    }
    assistantNode = null;
    assistantRaw = '';
  }

  function insertTimelineNode(node) {
    removeEmpty();
    sealAssistantBeforeTimeline();
    let insertAfter = null;
    const kids = el.messages.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      if (k.classList.contains('msg') && k.classList.contains('user')) break;
      if (
        k.classList.contains('msg') ||
        k.classList.contains('tool-card') ||
        k.classList.contains('tool-summary') ||
        k.classList.contains('thought-line') ||
        k.classList.contains('agent-run-card')
      ) {
        insertAfter = k;
        break;
      }
    }
    if (!insertAfter) {
      insertAfter = el.messages.lastElementChild;
    }
    if (insertAfter && insertAfter.parentNode === el.messages) {
      if (insertAfter.nextSibling) {
        el.messages.insertBefore(node, insertAfter.nextSibling);
      } else {
        el.messages.appendChild(node);
      }
    } else {
      el.messages.appendChild(node);
    }
    lastTimelineAt = Date.now();
    scrollToBottomIfPinned();
  }

  function maybeInsertThoughtStatic(minMs) {
    const floor = typeof minMs === 'number' ? minMs : 800;
    const from = thoughtAnchorAt || lastTimelineAt;
    if (!from) {
      thoughtAnchorAt = Date.now();
      return;
    }
    const ms = Date.now() - from;
    if (ms < floor) {
      thoughtAnchorAt = Date.now();
      return;
    }
    const secs = Math.max(1, Math.round(ms / 1000));
    const line = document.createElement('div');
    line.className = 'thought-line';
    line.textContent = 'Thought for ' + secs + 's';
    insertTimelineNode(line);
    thoughtAnchorAt = Date.now();
  }

  /** @deprecated kept as alias for call sites that finalize before tools */
  function maybeInsertThought(minMs) {
    finalizeLiveThought(minMs);
  }

  function formatExploreSummary(batch) {
    const parts = [];
    const files = batch.files || 0;
    const searches = batch.searches || 0;
    const lists = batch.lists || 0;
    const lastPath = batch.lastPath || '';
    if (files === 1 && !searches && !lists && lastPath) {
      parts.push('Explored ' + truncateOneLine(lastPath, 48));
    } else if (files || searches || lists) {
      const bits = [];
      if (files) bits.push(files + (files === 1 ? ' file' : ' files'));
      if (searches) bits.push(searches + (searches === 1 ? ' search' : ' searches'));
      if (lists) bits.push(lists + (lists === 1 ? ' listing' : ' listings'));
      parts.push('Explored ' + bits.join(', '));
    } else {
      parts.push('Explored');
    }
    return parts.join('');
  }

  function upsertExploreSummary(msg, phase) {
    if (phase === 'start') {
      maybeInsertThought(1200);
      if (!exploreBatch || !exploreBatch.node || !exploreBatch.node.isConnected) {
        const line = document.createElement('div');
        line.className = 'tool-summary';
        line.textContent = 'Exploring…';
        insertTimelineNode(line);
        exploreBatch = {
          node: line,
          files: 0,
          searches: 0,
          lists: 0,
          lastPath: '',
          pending: {},
        };
      }
      exploreBatch.pending[msg.id] = msg.name;
      if (msg.name === 'read_file') {
        exploreBatch.lastPath = toolMetaSummary(msg.name, msg.arguments) || exploreBatch.lastPath;
      }
      exploreBatch.node.textContent = formatExploreSummary(exploreBatch) + '…';
      return;
    }

    if (!exploreBatch || !exploreBatch.node) {
      // History / late result without start — synthesize one line.
      const line = document.createElement('div');
      line.className = 'tool-summary';
      exploreBatch = {
        node: line,
        files: 0,
        searches: 0,
        lists: 0,
        lastPath: toolMetaSummary(msg.name, msg.arguments) || '',
        pending: {},
      };
      insertTimelineNode(line);
    }
    delete exploreBatch.pending[msg.id];
    if (msg.name === 'read_file') {
      exploreBatch.files += 1;
      exploreBatch.lastPath =
        toolMetaSummary(msg.name, msg.arguments) || exploreBatch.lastPath;
    } else if (msg.name === 'codebase_search') {
      exploreBatch.searches += 1;
    } else if (msg.name === 'list_dir') {
      exploreBatch.lists += 1;
    }
    exploreBatch.node.textContent = formatExploreSummary(exploreBatch);
    thoughtAnchorAt = Date.now();
  }

  function parseTerminalStatus(msg) {
    let exitCode = null;
    if (msg.content) {
      try {
        const parsed = JSON.parse(msg.content);
        if (typeof parsed.exitCode === 'number') exitCode = parsed.exitCode;
      } catch (e) {
        /* plain text */
      }
    }
    if (exitCode === null) {
      const m = /exit[=:\s]+(-?\d+)/i.exec(
        String(msg.error || '') + '\n' + String(msg.content || ''),
      );
      if (m) exitCode = Number(m[1]);
    }
    const blob = String(msg.error || '') + '\n' + String(msg.content || '');
    return {
      exitCode: exitCode,
      rejected: /rejected by user/i.test(blob),
      denied: /\bdenied\b/i.test(blob),
    };
  }

  function terminalOutputText(msg) {
    if (msg.content) {
      try {
        const parsed = JSON.parse(msg.content);
        const chunks = [];
        if (parsed.stdout) chunks.push(String(parsed.stdout));
        if (parsed.stderr) chunks.push(String(parsed.stderr));
        if (parsed.sandboxNote) chunks.push('[' + parsed.sandboxNote + ']');
        const joined = chunks.join('\n').trim();
        if (joined) return joined.slice(0, 1600);
      } catch (e) {
        /* plain text */
      }
    }
    return String(msg.error || msg.content || '').slice(0, 1600);
  }

  /** Build HTML for apply_patch unified diffs (line-by-line + visible whitespace). */
  function applyPatchDiffHtml(msg) {
    if (!msg.content) return '';
    try {
      const parsed = JSON.parse(msg.content);
      const diffs = Array.isArray(parsed.diffs) ? parsed.diffs : [];
      if (!diffs.length) {
        if (Array.isArray(parsed.staged) && parsed.staged.length) {
          return (
            '<div class="diff-file-label">Staged for review</div>' +
            '<div class="diff-ln meta">' +
            escapeHtml(parsed.staged.join(', ')) +
            '</div>'
          );
        }
        return '';
      }
      return diffs
        .map(function (d) {
          const path = d && d.path ? String(d.path) : 'file';
          const unified = d && d.unifiedDiff ? String(d.unifiedDiff) : '';
          return (
            '<div class="diff-file-label">' +
            escapeHtml(path) +
            '</div>' +
            renderUnifiedDiffHtml(unified)
          );
        })
        .join('');
    } catch (e) {
      return '';
    }
  }

  function bindToolExpand(card, title, body) {
    card.classList.remove('expandable');
    if (!body || !body.textContent) {
      card.classList.add('collapsed');
      title.onclick = null;
      title.style.cursor = '';
      title.removeAttribute('title');
      return;
    }
    card.classList.add('collapsed', 'expandable');
    title.title = 'Click to expand output';
    title.style.cursor = 'pointer';
    title.onclick = function () {
      // Expand in-place without scrolling the transcript away from context.
      const wasCollapsed = card.classList.contains('collapsed');
      card.classList.toggle('collapsed');
      if (wasCollapsed && !stickToBottom) {
        /* keep scroll position — body grows downward only */
      }
    };
  }

  /** Cursor ui-tool-call-line: action (secondary) + details (tertiary). */
  function cardHeaderBits(msg, summary) {
    const isTerm = msg.name === 'terminal_run';
    const isApply = msg.name === 'apply_patch';
    if (isTerm) {
      return {
        title: 'Ran',
        meta: truncateOneLine(summary || '(command)', 56),
      };
    }
    if (isApply) {
      return {
        title: 'Edited',
        meta: truncateOneLine(summary || 'files', 56),
      };
    }
    const actions = {
      codebase_search: 'Searched',
      web_search: 'Searched',
      fetch_url: 'Fetched',
      grep: 'Grepped',
      glob_file_search: 'Found',
      read_file: 'Read',
      write_file: 'Wrote',
      list_dir: 'Listed',
    };
    const label = actions[msg.name] || toolLabel(msg.name);
    const detail = truncateOneLine(summary || '', 56);
    return {
      title: label,
      meta: detail,
    };
  }

  function upsertResultCard(msg, phase) {
    removeEmpty();
    let card;
    if (phase === 'start') {
      maybeInsertThought(1200);
      exploreBatch = null;
      card = document.createElement('div');
      card.className = 'tool-card pending collapsed';
      card.dataset.toolId = msg.id;
      card.dataset.startedAt = String(Date.now());
      const head = document.createElement('div');
      head.className = 'tool-card-head';
      const title = document.createElement('div');
      title.className = 'tool-card-title';
      head.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'tool-card-meta';
      head.appendChild(meta);
      card.appendChild(head);
      const body = document.createElement('pre');
      body.className = 'tool-card-body';
      card.appendChild(body);
      insertTimelineNode(card);
    } else {
      const cards = el.messages.querySelectorAll(
        '.tool-card[data-tool-id="' + msg.id + '"]',
      );
      card = cards.length ? cards[cards.length - 1] : null;
    }

    if (!card) {
      card = document.createElement('div');
      card.dataset.toolId = msg.id;
      card.dataset.startedAt = String(Date.now());
      const head = document.createElement('div');
      head.className = 'tool-card-head';
      const title = document.createElement('div');
      title.className = 'tool-card-title';
      head.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'tool-card-meta';
      head.appendChild(meta);
      card.appendChild(head);
      const body = document.createElement('pre');
      body.className = 'tool-card-body';
      card.appendChild(body);
      insertTimelineNode(card);
    }

    const title = card.querySelector('.tool-card-title');
    const meta = card.querySelector('.tool-card-meta');
    const body = card.querySelector('.tool-card-body');
    const isTerm = msg.name === 'terminal_run';
    const isApply = msg.name === 'apply_patch';
    const kindClass =
      (isTerm ? ' terminal' : '') + (isApply ? ' apply' : '');
    const summary = rememberToolSummary(card, msg.name, msg.arguments);
    const bits = cardHeaderBits(msg, summary);

    if (phase === 'start') {
      card.className = 'tool-card pending collapsed' + kindClass;
      title.textContent = bits.title;
      if (meta) {
        meta.textContent = bits.meta;
        meta.hidden = !bits.meta;
      }
      body.textContent = '';
      title.onclick = null;
      title.style.cursor = '';
      title.removeAttribute('title');
    } else {
      const started = Number(card.dataset.startedAt || 0);
      const ms = started ? Date.now() - started : 0;
      const dur = ms >= 1000 ? Math.round(ms / 1000) + 's' : ms ? ms + 'ms' : '';
      card.className =
        'tool-card collapsed ' + (msg.ok ? 'ok' : 'err') + kindClass;

      if (isTerm) {
        const st = parseTerminalStatus(msg);
        const right = [];
        if (bits.meta) right.push(bits.meta);
        if (st.rejected) right.push('rejected');
        else if (st.denied) right.push('denied');
        else if (st.exitCode !== null) right.push('exit ' + st.exitCode);
        else right.push(msg.ok ? 'ok' : 'failed');
        if (dur) right.push(dur);
        title.textContent = bits.title;
        if (meta) {
          meta.textContent = right.join(' · ');
          meta.hidden = false;
        }
        body.textContent = terminalOutputText(msg);
        body.classList.remove('diff-body-html');
      } else if (isApply) {
        title.textContent = bits.title;
        if (meta) {
          meta.textContent = [bits.meta, dur].filter(Boolean).join(' · ');
          meta.hidden = false;
        }
        const diffHtml = applyPatchDiffHtml(msg);
        if (diffHtml) {
          body.innerHTML = diffHtml;
          body.classList.add('diff-body-html');
        } else {
          body.textContent = (msg.error || msg.content || '').slice(0, 1600);
          body.classList.remove('diff-body-html');
        }
      } else {
        title.textContent = bits.title;
        if (meta) {
          meta.textContent = [bits.meta, dur].filter(Boolean).join(' · ');
          meta.hidden = false;
        }
        body.textContent = (msg.error || msg.content || '').slice(0, 1600);
        body.classList.remove('diff-body-html');
      }

      bindToolExpand(card, title, body);

      let actions = card.querySelector('.tool-card-actions');
      if (actions) actions.remove();
      if (msg.ok && isApply) {
        actions = document.createElement('div');
        actions.className = 'tool-card-actions';
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'ghost-btn';
        undoBtn.textContent = 'Undo';
        undoBtn.title = 'Undo last apply (Ctrl+Alt+Z)';
        undoBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          vscode.postMessage({ type: 'undoApply' });
        });
        actions.appendChild(undoBtn);
        if (msg.checkpointId) {
          const restoreBtn = document.createElement('button');
          restoreBtn.type = 'button';
          restoreBtn.className = 'ghost-btn';
          restoreBtn.textContent = 'Restore';
          restoreBtn.title = 'Restore this checkpoint';
          restoreBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            vscode.postMessage({
              type: 'restoreCheckpoint',
              id: msg.checkpointId,
            });
          });
          actions.appendChild(restoreBtn);
        }
        const listBtn = document.createElement('button');
        listBtn.type = 'button';
        listBtn.className = 'ghost-btn';
        listBtn.textContent = 'List';
        listBtn.title = 'List all checkpoints';
        listBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          vscode.postMessage({ type: 'listCheckpoints' });
        });
        actions.appendChild(listBtn);
        card.appendChild(actions);
      }
      thoughtAnchorAt = Date.now();
    }
    scrollToBottomIfPinned();
  }

  function upsertToolCard(msg, phase) {
    if (AGENT_RUN_TOOLS[msg.name]) {
      // Live agent-run card carries the UX; avoid dumping raw JSON tool bodies.
      if (phase === 'start') {
        maybeInsertThought(800);
      }
      return;
    }
    if (EXPLORE_TOOLS[msg.name] && !isResultCardTool(msg.name)) {
      upsertExploreSummary(msg, phase);
      return;
    }
    upsertResultCard(msg, phase);
  }

  function workerStateLabel(state) {
    if (state === 'running') return 'running';
    if (state === 'done') return 'done';
    if (state === 'failed') return 'failed';
    if (state === 'cancelled') return 'cancelled';
    if (state === 'pending') return 'pending';
    return state || 'pending';
  }

  function workerStateOf(w) {
    return (w && (w.state || w.status)) || 'pending';
  }


  function upsertAgentRunCard(payload) {
    if (!payload || !payload.runId) return;
    removeEmpty();
    let card = el.messages.querySelector(
      '.agent-run-card[data-run-id="' + payload.runId + '"]',
    );
    if (!card) {
      finalizeLiveThought(400);
      card = document.createElement('div');
      card.className = 'agent-run-card';
      card.dataset.runId = payload.runId;
      insertTimelineNode(card);
    }
    const status = payload.status || 'pending';
    card.dataset.status = status;
    card.classList.toggle('busy', /^(pending|running|synthesizing)$/.test(status));
    card.classList.toggle('done', status === 'done');
    card.classList.toggle('failed', status === 'failed' || status === 'cancelled');

    const title =
      payload.prompt ||
      (payload.model ? 'Agent run · ' + payload.model : 'Agent run');
    const desc =
      payload.description ||
      (payload.workers && payload.workers.length
        ? payload.workers.length + ' workers · ' + status
        : status);

    let workersHtml = '';
    if (payload.workers && payload.workers.length) {
      workersHtml =
        '<ul class="agent-run-workers">' +
        payload.workers
          .map(function (w) {
            const label = w.name || w.id;
            const st = workerStateOf(w);
            const bit = w.prompt
              ? truncateOneLine(w.prompt, 72)
              : workerStateLabel(st);
            return (
              '<li><span class="agent-worker-state ' +
              workerStateLabel(st) +
              '">' +
              workerStateLabel(st) +
              '</span> <strong>' +
              escapeHtml(label) +
              '</strong> — ' +
              escapeHtml(bit) +
              '</li>'
            );
          })
          .join('') +
        '</ul>';
    }

    card.innerHTML =
      '<div class="agent-run-head">' +
      '<span class="agent-run-dot" aria-hidden="true"></span>' +
      '<div class="agent-run-text">' +
      '<div class="agent-run-title">' +
      escapeHtml(truncateOneLine(title, 96)) +
      '</div>' +
      '<div class="agent-run-meta">' +
      escapeHtml(desc) +
      (payload.model ? ' · ' + escapeHtml(payload.model) : '') +
      ' · <code>' +
      escapeHtml(payload.runId.slice(0, 12)) +
      '</code></div>' +
      '</div>' +
      '<button type="button" class="agent-run-open ghost-btn" data-run-id="' +
      escapeHtml(payload.runId) +
      '">Open</button>' +
      '</div>' +
      workersHtml;


    if (!card.dataset.openBound) {
      card.dataset.openBound = '1';
      card.addEventListener('click', function (ev) {
        const t = ev.target;
        const runId =
          (t && t.getAttribute && t.getAttribute('data-run-id')) ||
          card.dataset.runId;
        if (runId) {
          vscode.postMessage({ type: 'openAgentRun', runId: runId });
        }
      });
    }
    scrollToBottomIfPinned();
  }

  function maybeShowAgentCardFromTool(msg) {
    if (!msg || !msg.ok || !msg.content) return;
    if (
      msg.name !== 'spockify_create_agent_run' &&
      msg.name !== 'create_agent_run'
    ) {
      return;
    }
    try {
      const run = JSON.parse(msg.content);
      if (!run || !run.id) return;
      const workers = Array.isArray(run.workers)
        ? run.workers.map(function (w) {
            return {
              id: w.id,
              name: w.name,
              state: w.state || w.status,
              prompt: w.prompt,
            };
          })
        : typeof run.workers === 'number'
          ? undefined
          : undefined;
      upsertAgentRunCard({
        runId: run.id,
        status: run.status || 'pending',
        prompt: run.parent_prompt || run.summary,
        model: run.model,
        description: run.summary,
        workers: workers,
      });
      renderAgentsActivityBar({
        runId: run.id,
        status: run.status || 'pending',
        prompt: run.parent_prompt || run.summary,
        workers: workers,
      });
    } catch (e) {
      /* ignore non-JSON tool payloads */
    }
  }

  function setAgentMode(mode) {
    const ok = MODE_META.some(function (m) {
      return m.id === mode;
    });
    agentMode = ok ? mode : mode === 'strict' ? 'agent' : 'ask';
    syncModePill();
    renderModeMenu();
  }

  el.sendStop.addEventListener('click', function () {
    if ((el.sendStop.dataset.mode || 'send') === 'stop' || streaming) {
      if (!streaming) return;
      // Freeze "Thinking… Ns" immediately — streamStopped is ignored once
      // streaming is false, so we must finalize here (Cursor cancel behaviour).
      finalizeLiveThought(400);
      finalizeAssistantPaint();
      setStreaming(false);
      vscode.postMessage({ type: 'stop' });
      return;
    }
    send();
  });

  if (el.toolConsentAccept) {
    el.toolConsentAccept.addEventListener('click', function (ev) {
      ev.stopPropagation();
      respondToolConsent('run');
    });
  }
  if (el.toolConsentAllowSession) {
    el.toolConsentAllowSession.addEventListener('click', function (ev) {
      ev.stopPropagation();
      respondToolConsent('allowSession');
    });
  }
  if (el.toolConsentRunTerminal) {
    el.toolConsentRunTerminal.addEventListener('click', function (ev) {
      ev.stopPropagation();
      respondToolConsent('terminalRun');
    });
  }
  if (el.toolConsentReject) {
    el.toolConsentReject.addEventListener('click', function (ev) {
      ev.stopPropagation();
      respondToolConsent('reject');
    });
  }
  const jumpLatest = document.getElementById('jumpLatest');
  if (jumpLatest) {
    jumpLatest.addEventListener('click', function () {
      stickToBottom = true;
      el.messages.scrollTop = el.messages.scrollHeight;
      syncJumpBtn();
    });
  }
  el.newChat.addEventListener('click', function () {
    vscode.postMessage({ type: 'newChat', ui: captureCurrentUi() });
  });
  if (el.helpBtn) {
    el.helpBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'openHelp' });
    });
  }
  if (el.settingsBtn) {
    el.settingsBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'openSettings' });
    });
  }
  if (el.historyBtn) {
    el.historyBtn.addEventListener('click', function () {
      const open = el.historyPanel && el.historyPanel.hidden;
      setHistoryPanelOpen(!!open);
      if (open) {
        vscode.postMessage({ type: 'requestSessions' });
      }
    });
  }
  if (el.historyClose) {
    el.historyClose.addEventListener('click', function () {
      setHistoryPanelOpen(false);
    });
  }
  el.openFull.addEventListener('click', function () {
    vscode.postMessage({ type: 'openFullSpockify' });
  });
  el.signInBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'signIn' });
  });
  el.model.addEventListener('change', function () {
    selectedModelId = el.model.value;
    autoModel = selectedModelId === 'spockify-auto';
    syncModelChip();
    vscode.postMessage({ type: 'selectModel', model: el.model.value });
  });
  if (el.agentMode) {
    el.agentMode.addEventListener('change', function () {
      setAgentMode(el.agentMode.value);
      vscode.postMessage({ type: 'selectAgentMode', mode: agentMode });
    });
  }
  if (el.modeBtn) {
    el.modeBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const open = el.modeMenu && el.modeMenu.hidden;
      closePopovers();
      if (open && el.modeMenu) {
        renderModeMenu();
        placePopover(el.modeMenu, el.modeBtn);
        el.modeBtn.setAttribute('aria-expanded', 'true');
      }
    });
  }
  if (el.modelBtn) {
    el.modelBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const open = el.modelMenu && el.modelMenu.hidden;
      closePopovers();
      if (open && el.modelMenu) {
        // Catalog never arrived (lost ready) — ask host again before painting.
        if (!modelCatalog.length) {
          vscode.postMessage({ type: 'ready' });
        }
        renderModelList(el.modelSearch ? el.modelSearch.value : '');
        placePopover(el.modelMenu, el.modelBtn);
        el.modelBtn.setAttribute('aria-expanded', 'true');
        if (el.modelSearch) el.modelSearch.focus();
      }
    });
  }
  if (el.permBtn) {
    el.permBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (agentMode === 'ask') return;
      const open = el.permMenu && el.permMenu.hidden;
      closePopovers();
      if (open && el.permMenu) {
        renderPermMenu();
        placePopover(el.permMenu, el.permBtn);
        el.permBtn.setAttribute('aria-expanded', 'true');
      }
    });
  }
  if (el.modelSearch) {
    el.modelSearch.addEventListener('input', function () {
      renderModelList(el.modelSearch.value);
    });
    el.modelSearch.addEventListener('click', function (ev) {
      ev.stopPropagation();
    });
  }
  if (el.autoToggle) {
    el.autoToggle.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const next = el.autoToggle.getAttribute('aria-checked') !== 'true';
      autoModel = next;
      if (next) {
        selectedModelId = 'spockify-auto';
        if (el.model) el.model.value = 'spockify-auto';
      }
      syncModelChip();
      renderModelList(el.modelSearch ? el.modelSearch.value : '');
      vscode.postMessage({ type: 'setAutoModel', enabled: next });
    });
  }
  if (el.maxToggle) {
    el.maxToggle.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const next = el.maxToggle.getAttribute('aria-checked') !== 'true';
      maxMode = next;
      syncModelChip();
      vscode.postMessage({ type: 'setMaxMode', enabled: next });
    });
  }
  if (el.thinkBtn) {
    el.thinkBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      thinkingMode = nextThinking(thinkingMode);
      syncThinkChip();
      vscode.postMessage({ type: 'setThinkingMode', mode: thinkingMode });
    });
  }
  if (el.addModelsBtn) {
    el.addModelsBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      closePopovers();
      vscode.postMessage({ type: 'addModels' });
    });
  }
  if (el.ctxBtn) {
    el.ctxBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleCtxMenu();
    });
  }
  if (el.attachBtn) {
    el.attachBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (el.filePick) {
        el.filePick.value = '';
        el.filePick.click();
      }
    });
  }
  if (el.filePick) {
    el.filePick.addEventListener('change', function () {
      if (el.filePick.files && el.filePick.files.length) {
        ingestFiles(el.filePick.files);
      }
    });
  }
  if (el.undoAllFiles) {
    el.undoAllFiles.addEventListener('click', function () {
      vscode.postMessage({ type: 'composerDiscardAll' });
    });
  }
  if (el.keepAllFiles) {
    el.keepAllFiles.addEventListener('click', function () {
      vscode.postMessage({ type: 'composerAcceptAll' });
    });
  }
  if (el.reviewFiles) {
    el.reviewFiles.addEventListener('click', function () {
      vscode.postMessage({ type: 'composerReview' });
    });
  }
  if (el.filesChangedToggle) {
    el.filesChangedToggle.addEventListener('click', function () {
      vscode.postMessage({ type: 'composerReview' });
    });
  }
  if (el.agentsActivityOpen) {
    el.agentsActivityOpen.addEventListener('click', function () {
      const runId =
        el.agentsActivityOpen.dataset.runId ||
        (agentsHudRun && agentsHudRun.runId);
      if (runId) {
        vscode.postMessage({ type: 'openAgentRun', runId: runId });
      }
    });
  }
  if (el.agentsActivityCancel) {
    el.agentsActivityCancel.addEventListener('click', function () {
      const runId =
        el.agentsActivityCancel.dataset.runId ||
        (agentsHudRun && agentsHudRun.runId);
      if (!runId || agentsCancelBusy) return;
      agentsCancelBusy = true;
      renderAgentsActivityBar(agentsHudRun);
      vscode.postMessage({ type: 'cancelAgentRun', runId: runId });
      setTimeout(function () {
        agentsCancelBusy = false;
        if (agentsHudRun) renderAgentsActivityBar(agentsHudRun);
      }, 2500);
    });
  }
  document.addEventListener('click', function () {
    closePopovers();
  });
  if (el.modeMenu) {
    el.modeMenu.addEventListener('click', function (ev) {
      ev.stopPropagation();
    });
  }
  if (el.modelMenu) {
    el.modelMenu.addEventListener('click', function (ev) {
      ev.stopPropagation();
    });
  }
  if (el.permMenu) {
    el.permMenu.addEventListener('click', function (ev) {
      ev.stopPropagation();
    });
  }
  if (el.ctxMenu) {
    el.ctxMenu.addEventListener('click', function (ev) {
      ev.stopPropagation();
    });
  }

  el.ctxChips.forEach(function (chip) {
    chip.addEventListener('click', function (ev) {
      ev.stopPropagation();
      chip.classList.toggle('active');
      syncCtxMenuChecks();
    });
  });
  syncCtxMenuChecks();

  el.input.addEventListener('input', resizeComposerInput);
  el.input.addEventListener('keydown', function (e) {
    const mod = e.ctrlKey || e.metaKey;
    if (toolConsent && toolConsent.id) {
      if (e.key === 'Escape') {
        e.preventDefault();
        respondToolConsent('reject');
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        respondToolConsent('run');
        return;
      }
    }
    if (e.key === 'Tab' && e.shiftKey && !mod && !e.altKey) {
      e.preventDefault();
      cycleAgentMode(1);
      return;
    }
    if (e.key === 'Escape' && streaming) {
      e.preventDefault();
      if (el.sendStop) el.sendStop.click();
      return;
    }
    if (
      (e.key === 'Backspace' || e.key === 'Delete') &&
      !mod &&
      (selectionChips.length || fileAttachments.length) &&
      !(el.input.value || '') &&
      el.input.selectionStart === 0 &&
      el.input.selectionEnd === 0
    ) {
      e.preventDefault();
      if (fileAttachments.length) {
        const lastAtt = fileAttachments[fileAttachments.length - 1];
        if (lastAtt) removeFileAttachment(lastAtt.id);
        return;
      }
      const last = selectionChips[selectionChips.length - 1];
      if (last) removeSelectionChip(last.id);
      return;
    }
    if (e.key === 'Enter' && mod) {
      e.preventDefault();
      // Cursor: modifier flips queue ↔ stop-and-send while streaming.
      send({ modifierFlip: !!streaming });
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // When the inline consent bar is visible, Enter=Accept and Esc=Reject
  // regardless of the currently focused control.
  document.addEventListener('keydown', function (e) {
    if (!el.toolConsentBar || el.toolConsentBar.hidden || !toolConsent) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      respondToolConsent('reject');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      respondToolConsent('run');
      return;
    }
  });
  resizeComposerInput();

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'ready':
        setModels(msg.models, msg.selectedModel);
        setAuth(msg.signedIn, msg.accountLabel);
        if (msg.agentMode) setAgentMode(msg.agentMode);
        else syncModePill();
        if (msg.currentSessionId) currentSessionId = msg.currentSessionId;
        if (msg.openTabIds) openTabIds = msg.openTabIds;
        if (msg.sessions) sessionSummaries = msg.sessions;
        renderHistory(msg.messages);
        applySessionUi(msg.sessionUi);
        applySessionsPayload(msg);
        break;
      case 'auth':
        setAuth(msg.signedIn, msg.accountLabel);
        break;
      case 'models':
        setModels(msg.models, msg.selectedModel);
        break;
      case 'modelPrefs':
        setModelPrefs(msg);
        break;
      case 'toolConsentRequest':
        showToolConsent(msg);
        break;
      case 'filesChanged':
        setFilesChanged(msg.count);
        break;
      case 'agentMode':
        setAgentMode(msg.mode);
        break;
      case 'history':
        // Session/tab switch or turn bootstrap: rebuild DOM. Only re-arm
        // Thinking when the host says the turn is still live — never from
        // stale streamingTabIds after streamDone (0.9.12/0.9.13 race).
        var resumeStream = shouldResumeStreamingAfterHistory({
          resumeStreaming: !!msg.resumeStreaming,
          wasLocallyStreaming: streaming,
          tabListedAsStreaming: tabIsStreaming(currentSessionId),
          acceptStreamEvents: acceptStreamEvents,
        });
        cancelStreamingUi();
        renderHistory(msg.messages);
        if (resumeStream) {
          acceptStreamEvents = true;
          setStreaming(true);
          startLiveThought();
        }
        break;
      case 'sessions':
        applySessionsPayload(msg);
        if (msg.sessionUi) applySessionUi(msg.sessionUi);
        break;
      case 'composerDraft':
        if (el.input && msg.text !== undefined) {
          el.input.value = msg.text;
          resizeComposerInput();
        }
        break;
      case 'historyPanel':
        setHistoryPanelOpen(!!msg.open);
        if (msg.open) renderHistoryList();
        break;
      case 'streamStart':
        if (!routesToActiveTab(msg)) break;
        acceptStreamEvents = true;
        setStreaming(true);
        resetToolTimelineState();
        // Live thinking at the chronological spot — assistant bubble only
        // appears once tokens (or tools) arrive.
        startLiveThought();
        if (msg.model) {
          // Stash attribution for the first assistant bubble.
          pendingStreamAttribution = {
            model: msg.model,
            attribution: String(msg.model) + ' · routed via spockify',
          };
        } else {
          pendingStreamAttribution = null;
        }
        break;
      case 'streamModel':
        if (!routesToActiveTab(msg)) break;
        // Host already routed this event to the active tab — re-arm even if
        // local streaming / streamingTabIds are stale (0.9.1 race).
        if (!streaming) setStreaming(true);
        pendingStreamAttribution = {
          model: msg.model,
          attribution:
            msg.attribution ||
            (msg.model ? String(msg.model) + ' · routed via spockify' : ''),
        };
        if (assistantNode) {
          setAssistantAttribution(
            assistantNode,
            pendingStreamAttribution.attribution,
            pendingStreamAttribution.model,
          );
          paintAssistant();
        }
        break;
      case 'streamDelta':
        if (!routesToActiveTab(msg)) break;
        // Always re-arm for active-tab deltas. Gating on tabIsStreaming was
        // the incomplete 0.9.1 path — sessions.streamingTabIds updates after
        // streamStart, so post-history deltas were dropped until next send.
        if (!streaming) setStreaming(true);
        enqueueDelta(msg.content || '');
        break;
      case 'toolStart':
        if (!routesToActiveTab(msg)) return;
        if (!streaming) setStreaming(true);
        finalizeLiveThought(400);
        flushDeltaPaint();
        setStreamPhase(phaseFromToolName(msg.name));
        upsertToolCard(msg, 'start');
        break;
      case 'toolResult':
        if (!routesToActiveTab(msg)) return;
        if (!streaming) setStreaming(true);
        hideToolConsent();
        flushDeltaPaint();
        upsertToolCard(msg, 'result');
        maybeShowAgentCardFromTool(msg);
        if (streaming) setStreamPhase('thinking');
        // Model will think again before the next tokens (debounced so bursts
        // of tool results don't flash a Thinking line between each).
        scheduleLiveThought();
        break;
      case 'streamDone':
        if (!routesToActiveTab(msg)) break;
        acceptStreamEvents = false;
        // If the local flag was already cleared, still finalize any pending
        // paint — host also posts history as a terminal safety net.
        if (streaming) {
          finalizeLiveThought(800);
          exploreBatch = null;
          if (msg.attribution && assistantNode) {
            setAssistantAttribution(
              assistantNode,
              msg.attribution,
              msg.model,
            );
            paintAssistant();
          }
          finalizeAssistantPaint();
          setStreaming(false);
        } else {
          finalizeLiveThought(400);
          finalizeAssistantPaint();
        }
        hideToolConsent();
        if (el.latency && msg.latencyMs != null) {
          el.latency.textContent =
            msg.routingHud || msg.latencyMs + ' ms total';
        }
        break;
      case 'streamStopped':
        if (!routesToActiveTab(msg)) break;
        acceptStreamEvents = false;
        // Always freeze the thinking timer (Stop click may already have set
        // streaming=false and finalized; this is idempotent / defensive).
        finalizeLiveThought(400);
        if (!streaming) {
          hideToolConsent();
          break;
        }
        finalizeAssistantPaint();
        setStreaming(false);
        hideToolConsent();
        break;
      case 'streamError':
        if (!routesToActiveTab(msg)) break;
        acceptStreamEvents = false;
        finalizeLiveThought(400);
        removeEmpty();
        var err = document.createElement('div');
        err.className = 'msg error';
        err.textContent = msg.message || 'Error';
        el.messages.appendChild(err);
        setStreaming(false);
        hideToolConsent();
        syncReplyActions();
        scrollToBottomIfPinned();
        break;
      case 'latency':
        if (!routesToActiveTab(msg)) break;
        if (el.latency) {
          el.latency.textContent = msg.ms ? msg.ms + ' ms total' : '';
        }
        break;
      case 'firstToken':
        if (!routesToActiveTab(msg)) break;
        if (el.latency && msg.ms != null) {
          el.latency.textContent = msg.ms + ' ms TTFT';
        }
        break;
      case 'status':
        // Inline timeline only; composer chrome does not show status.
        break;
      case 'queuedSends':
        if (!routesToActiveTab(msg)) break;
        renderQueuedSends(msg.items);
        break;
      case 'fileExcerpt':
        applyFileExcerpt(msg);
        break;
      case 'agentRunCard':
        if (msg.chatTabId && !routesToActiveTab(msg)) break;
        upsertAgentRunCard(msg);
        renderAgentsActivityBar(msg);
        if (!streaming) syncReplyActions();
        break;
      case 'sessionPaused':
        // Pause removed — ignore legacy host messages.
        break;
      case 'focusInput':
        if (el.input) {
          el.input.focus();
          try {
            var len = el.input.value.length;
            el.input.setSelectionRange(len, len);
          } catch (_) {}
        }
        break;
      case 'attachContext':
        applyContextChips(msg.chips);
        if (msg.selectionChip) {
          addSelectionChip(msg.selectionChip);
        }
        break;
      case 'newChatTab':
        vscode.postMessage({ type: 'newChat', ui: captureCurrentUi() });
        break;
      case 'switchSessionTab':
        if (msg.id && msg.id !== currentSessionId) {
          vscode.postMessage({
            type: 'switchSession',
            id: msg.id,
            ui: captureCurrentUi(),
          });
        }
        break;
      default:
        break;
    }
  });

  el.input.addEventListener('paste', function (e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [];
    if (cd.files && cd.files.length) {
      Array.prototype.push.apply(files, cd.files);
    } else if (cd.items) {
      for (let i = 0; i < cd.items.length; i++) {
        const it = cd.items[i];
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    const imageFiles = files.filter(function (f) {
      return f && /^image\//i.test(f.type || '');
    });
    if (!imageFiles.length) return;
    e.preventDefault();
    ingestFiles(imageFiles);
  });

  showEmpty();
  syncModePill();
  // Host registers its listener before html, but retry once in case a
  // transient race still drops the first ready (models/auth stay empty).
  vscode.postMessage({ type: 'ready' });
  setTimeout(function () {
    if (!modelCatalog.length) {
      vscode.postMessage({ type: 'ready' });
    }
  }, 400);
})();
