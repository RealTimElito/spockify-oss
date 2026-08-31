/* Spockify Composer webview — multi-file agent input + pending review */
(function () {
  const vscode = acquireVsCodeApi();

  const el = {
    log: document.getElementById('log'),
    input: document.getElementById('input'),
    send: document.getElementById('send'),
    stop: document.getElementById('stop'),
    status: document.getElementById('status'),
    agentStrip: document.getElementById('agentStrip'),
    pending: document.getElementById('pending'),
    pendingList: document.getElementById('pendingList'),
    pendingCount: document.getElementById('pendingCount'),
    acceptAll: document.getElementById('acceptAll'),
    discardAll: document.getElementById('discardAll'),
    diffReview: document.getElementById('diffReview'),
    newSession: document.getElementById('newSession'),
    model: document.getElementById('model'),
    agentMode: document.getElementById('agentMode'),
    thinkBtn: document.getElementById('thinkBtn'),
    ctxChips: document.querySelectorAll('.ctx-chip'),
  };

  let busy = false;
  let thinkingMode = 'high';
  const THINKING_CYCLE = ['off', 'low', 'medium', 'high', 'heavy'];
  const THINKING_META = {
    off: { label: 'Off', hint: 'Never send think=' },
    low: { label: 'Low', hint: 'Low effort' },
    medium: { label: 'Medium', hint: 'Balanced' },
    high: { label: 'High', hint: 'High effort (Agent default)' },
    heavy: { label: 'Heavy', hint: 'High + 4-agent ensemble' },
  };

  function normalizeThinking(value) {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (raw === 'light') return 'low';
    if (THINKING_CYCLE.indexOf(raw) >= 0) return raw;
    return 'high';
  }

  function syncThinkChip() {
    const mode = normalizeThinking(thinkingMode);
    thinkingMode = mode;
    const meta = THINKING_META[mode] || THINKING_META.high;
    if (!el.thinkBtn) return;
    el.thinkBtn.textContent = meta.label;
    el.thinkBtn.className = 'think-chip think-' + mode;
    el.thinkBtn.title = 'Thinking ' + meta.label + ' — ' + meta.hint + ' (click to cycle)';
  }
  let assistantNode = null;
  let assistantRaw = '';
  let pendingDelta = '';
  let rafPending = 0;
  const toolLines = [];
  const toolCards = new Map();

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
    return '';
  }

  function toolLabel(name) {
    if (name === 'terminal_run') return 'terminal';
    if (name === 'apply_patch') return 'apply';
    if (name === 'codebase_search') return 'search';
    if (name === 'grep') return 'grep';
    if (name === 'glob_file_search') return 'glob';
    if (name === 'read_file') return 'read';
    if (name === 'write_file') return 'write';
    if (name === 'list_dir') return 'list';
    return name || 'tool';
  }

  function renderAgentStrip() {
    if (!el.agentStrip) return;
    if (!toolLines.length) {
      el.agentStrip.hidden = true;
      el.agentStrip.innerHTML = '';
      return;
    }
    el.agentStrip.hidden = false;
    el.agentStrip.innerHTML = '';
    toolLines.forEach(function (t) {
      const card = toolCards.get(t.id);
      if (card) {
        el.agentStrip.appendChild(card);
      }
    });
  }

  function upsertToolCard(id, name, phase, detail, args) {
    let card = toolCards.get(id);
    if (!card) {
      card = document.createElement('div');
      card.className = 'tool-card pending chip';
      card.dataset.toolId = id;
      const title = document.createElement('div');
      title.className = 'tool-card-title';
      card.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'tool-card-meta';
      meta.hidden = true;
      card.appendChild(meta);
      const body = document.createElement('pre');
      body.className = 'tool-card-body';
      card.appendChild(body);
      toolCards.set(id, card);
    }
    const title = card.querySelector('.tool-card-title');
    const meta = card.querySelector('.tool-card-meta');
    const body = card.querySelector('.tool-card-body');
    const isTerm = name === 'terminal_run';
    const summary =
      toolMetaSummary(name, args) || card.dataset.summary || '';
    if (summary) card.dataset.summary = summary;
    const label = toolLabel(name);

    if (phase === 'start') {
      card.className =
        'tool-card pending chip collapsed' + (isTerm ? ' terminal' : '');
      if (isTerm) {
        title.textContent =
          'Will run: ' + (truncateOneLine(summary, 72) || '(no command)');
      } else {
        title.textContent = summary
          ? label + ': ' + truncateOneLine(summary, 64)
          : label;
      }
      if (meta) {
        meta.textContent = '';
        meta.hidden = true;
      }
      body.textContent = '';
      body.hidden = true;
      title.onclick = null;
      title.style.cursor = '';
      title.removeAttribute('title');
    } else {
      const ok = phase === 'done';
      card.className =
        'tool-card chip ' +
        (ok ? 'ok' : 'fail') +
        (isTerm ? ' terminal' : '');
      if (isTerm) {
        const blob = String(detail || '');
        const rejected = /rejected by user/i.test(blob);
        const exitM = /exit[=:\s]+(-?\d+)/i.exec(blob);
        const bits = [
          'Ran: ' + (truncateOneLine(summary, 56) || '(no command)'),
        ];
        if (rejected) bits.push('rejected');
        else if (exitM) bits.push('exit ' + exitM[1]);
        else bits.push(ok ? 'ok' : 'failed');
        title.textContent = bits.join(' · ');
      } else {
        title.textContent = [
          (ok ? '✓ ' : '✗ ') + label,
          summary ? truncateOneLine(summary, 48) : '',
        ]
          .filter(Boolean)
          .join(' · ');
      }
      if (meta) {
        meta.textContent = '';
        meta.hidden = true;
      }
      body.textContent = (detail || '').slice(0, 1200);
      body.hidden = !body.textContent;
      card.classList.remove('expandable');
      if (body.textContent) {
        card.classList.add('collapsed', 'expandable');
        title.title = 'Click to expand';
        title.style.cursor = 'pointer';
        title.onclick = function () {
          card.classList.toggle('collapsed');
          body.hidden = card.classList.contains('collapsed');
        };
      } else {
        card.classList.add('collapsed');
        title.onclick = null;
        title.style.cursor = '';
        title.removeAttribute('title');
      }
    }
    const idx = toolLines.findIndex(function (t) {
      return t.id === id;
    });
    const row = { id: id, name: name, phase: phase, detail: detail };
    if (idx >= 0) {
      toolLines[idx] = row;
    } else {
      toolLines.push(row);
    }
    renderAgentStrip();
  }

  function pushToolActivity(id, name, phase, detail, args) {
    upsertToolCard(id || name + ':' + phase, name, phase, detail, args);
  }

  function clearAgentStrip() {
    toolLines.length = 0;
    toolCards.clear();
    renderAgentStrip();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function stripToolLeaks(text) {
    if (!text) return '';
    return String(text)
      .replace(/```tool(?:\s+[\w.-]+)?\s*\n[\s\S]*?```/gi, '')
      .replace(/```apply\s*\n[\s\S]*?```/gi, '')
      .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, '')
      .replace(
        /(?:^|\n)\s*\{\s*"name"\s*:\s*"[A-Za-z_][\w]*"\s*,\s*"arguments"\s*:\s*[\s\S]*?\}(?=\s*(?:\n|$))/gi,
        '\n',
      )
      .replace(/\n{3,}/g, '\n\n');
  }

  function renderMarkdownInline(text) {
    let html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return html;
  }

  function renderAssistantHtml(text) {
    const cleaned = stripToolLeaks(text);
    const parts = cleaned.split(/```/);
    if (parts.length === 1) {
      return (
        '<div class="md">' +
        renderMarkdownInline(cleaned).replace(/\n/g, '<br/>') +
        '</div>'
      );
    }
    let out = '<div class="md">';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        out += renderMarkdownInline(parts[i]).replace(/\n/g, '<br/>');
      } else {
        const lines = parts[i].split('\n');
        const lang = (lines[0] || '').trim();
        const body = lines.slice(1).join('\n');
        out +=
          '<pre class="code"><span class="lang">' +
          escapeHtml(lang || 'code') +
          '</span>' +
          escapeHtml(body) +
          '</pre>';
      }
    }
    out += '</div>';
    return out;
  }

  function ensureAssistant(attribution) {
    removeEmpty();
    if (!assistantNode) {
      assistantNode = document.createElement('div');
      assistantNode.className = 'msg assistant streaming';
      assistantRaw = '';
      el.log.appendChild(assistantNode);
    }
    if (attribution) {
      assistantNode.setAttribute('data-attribution', attribution);
      let chip = assistantNode.querySelector(':scope > .model-attr');
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'model-attr';
        assistantNode.insertBefore(chip, assistantNode.firstChild);
      }
      chip.textContent = attribution;
      chip.title = attribution;
    }
    return assistantNode;
  }

  function flushDeltaPaint() {
    rafPending = 0;
    if (!pendingDelta) return;
    const chunk = pendingDelta;
    pendingDelta = '';
    ensureAssistant();
    assistantRaw += chunk;
    const attr = assistantNode.getAttribute('data-attribution') || '';
    const bodyHtml = renderAssistantHtml(assistantRaw);
    assistantNode.innerHTML = '';
    if (attr) {
      const chip = document.createElement('div');
      chip.className = 'model-attr';
      chip.textContent = attr;
      chip.title = attr;
      assistantNode.appendChild(chip);
      assistantNode.setAttribute('data-attribution', attr);
    }
    const body = document.createElement('div');
    body.className = 'assistant-body';
    body.innerHTML = bodyHtml;
    assistantNode.appendChild(body);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function enqueueDelta(content) {
    if (!content) return;
    pendingDelta += content;
    if (!rafPending) {
      rafPending = requestAnimationFrame(flushDeltaPaint);
    }
  }

  function finalizeAssistant() {
    if (rafPending) {
      cancelAnimationFrame(rafPending);
      rafPending = 0;
    }
    if (pendingDelta) {
      assistantRaw += pendingDelta;
      pendingDelta = '';
    }
    if (assistantNode) {
      const attr = assistantNode.getAttribute('data-attribution') || '';
      const bodyHtml = renderAssistantHtml(assistantRaw);
      assistantNode.innerHTML = '';
      if (attr) {
        const chip = document.createElement('div');
        chip.className = 'model-attr';
        chip.textContent = attr;
        chip.title = attr;
        assistantNode.appendChild(chip);
      }
      const body = document.createElement('div');
      body.className = 'assistant-body';
      body.innerHTML = bodyHtml;
      assistantNode.appendChild(body);
      assistantNode.classList.remove('streaming');
      assistantNode = null;
      assistantRaw = '';
    }
  }

  function setBusy(v) {
    busy = v;
    el.send.disabled = v;
    el.stop.hidden = !v;
    el.input.disabled = v;
  }

  function setStatus(text) {
    if (el.status) el.status.textContent = text || '';
  }

  function clearLog() {
    el.log.innerHTML = '';
    showEmpty();
  }

  function showEmpty() {
    if (el.log.children.length) return;
    const d = document.createElement('div');
    d.className = 'empty';
    d.id = 'empty';
    d.innerHTML =
      'Describe a multi-file change.<br/>@file · @selection · @codebase<br/>Ctrl+Enter to run';
    el.log.appendChild(d);
  }

  function removeEmpty() {
    const e = document.getElementById('empty');
    if (e) e.remove();
  }

  function appendMsg(role, text) {
    removeEmpty();
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    d.textContent = text;
    el.log.appendChild(d);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function activeTags() {
    const tags = [];
    el.ctxChips.forEach(function (chip) {
      if (chip.classList.contains('active')) {
        tags.push(chip.getAttribute('data-tag'));
      }
    });
    return tags;
  }

  function send() {
    if (busy) return;
    const text = (el.input.value || '').trim();
    if (!text) return;
    appendMsg('user', text);
    el.input.value = '';
    clearAgentStrip();
    setBusy(true);
    setStatus('Generating…');
    vscode.postMessage({
      type: 'send',
      text: text,
      contextTags: activeTags(),
      model: el.model ? el.model.value : undefined,
      agentMode: el.agentMode ? el.agentMode.value : undefined,
    });
  }

  function renderPending(files) {
    const list = files || [];
    el.pending.hidden = list.length === 0;
    el.pendingCount.textContent = String(list.length);
    el.pendingList.innerHTML = '';
    list.forEach(function (f) {
      const row = document.createElement('div');
      row.className = 'file-row';
      const path = document.createElement('span');
      path.className = 'file-path';
      path.textContent = f.path;
      path.title = f.path + (f.lines ? ' · ' + f.lines + ' lines' : '');
      row.appendChild(path);

      function btn(label, cmd) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn';
        b.textContent = label;
        b.addEventListener('click', function () {
          vscode.postMessage({ type: cmd, path: f.path });
        });
        return b;
      }
      row.appendChild(btn('Diff', 'diffFile'));
      row.appendChild(btn('Accept', 'acceptFile'));
      row.appendChild(btn('Discard', 'discardFile'));
      el.pendingList.appendChild(row);
    });
  }

  el.send.addEventListener('click', send);
  el.stop.addEventListener('click', function () {
    vscode.postMessage({ type: 'stop' });
    setStatus('Stopping…');
  });
  el.newSession.addEventListener('click', function () {
    vscode.postMessage({ type: 'newSession' });
  });
  if (el.thinkBtn) {
    el.thinkBtn.addEventListener('click', function () {
      const idx = THINKING_CYCLE.indexOf(normalizeThinking(thinkingMode));
      thinkingMode = THINKING_CYCLE[(idx + 1) % THINKING_CYCLE.length];
      syncThinkChip();
      vscode.postMessage({ type: 'setThinkingMode', mode: thinkingMode });
    });
  }
  el.acceptAll.addEventListener('click', function () {
    vscode.postMessage({ type: 'acceptAll' });
  });
  el.discardAll.addEventListener('click', function () {
    vscode.postMessage({ type: 'discardAll' });
  });
  el.diffReview.addEventListener('click', function () {
    vscode.postMessage({ type: 'diffReview' });
  });

  el.ctxChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chip.classList.toggle('active');
    });
  });

  el.input.addEventListener('keydown', function (e) {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && (mod || !e.shiftKey)) {
      e.preventDefault();
      send();
    }
    if (e.key === 'Escape' && busy) {
      e.preventDefault();
      el.stop.click();
    }
  });

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'ready':
        setBusy(false);
        setStatus(msg.status || 'Ready · Ctrl+I focuses Composer');
        if (msg.pending) renderPending(msg.pending);
        if (msg.models && el.model) {
          el.model.innerHTML = '';
          (msg.models || []).forEach(function (m) {
            const o = document.createElement('option');
            o.value = m.id;
            o.textContent = m.label || m.id;
            el.model.appendChild(o);
          });
          if (msg.selectedModel) el.model.value = msg.selectedModel;
        }
        if (msg.agentMode && el.agentMode) {
          el.agentMode.value = msg.agentMode;
        }
        if (msg.thinking) {
          thinkingMode = normalizeThinking(msg.thinking);
          syncThinkChip();
        }
        if (!el.log.children.length) showEmpty();
        break;
      case 'thinking':
        thinkingMode = normalizeThinking(msg.mode);
        syncThinkChip();
        break;
      case 'status':
        setStatus(msg.text || '');
        break;
      case 'assistant':
        finalizeAssistant();
        if (msg.text) {
          appendMsg('assistant', msg.text);
        }
        break;
      case 'streamStart':
        assistantNode = null;
        assistantRaw = '';
        clearAgentStrip();
        ensureAssistant(
          msg.model ? String(msg.model) + ' · routed via spockify' : undefined,
        );
        break;
      case 'streamModel':
        ensureAssistant(msg.attribution || undefined);
        break;
      case 'streamDelta':
        enqueueDelta(msg.content || '');
        break;
      case 'streamDone':
        if (msg.attribution) ensureAssistant(msg.attribution);
        finalizeAssistant();
        if (msg.routingHud) setStatus(msg.routingHud);
        break;
      case 'system':
        appendMsg('system', msg.text || '');
        break;
      case 'toolActivity':
        pushToolActivity(
          msg.id,
          msg.name || 'tool',
          msg.phase || 'start',
          msg.detail,
          msg.arguments,
        );
        break;
      case 'clear':
        clearAgentStrip();
        clearLog();
        break;
      case 'busy':
        setBusy(!!msg.value);
        break;
      case 'pending':
        renderPending(msg.files || []);
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
      case 'done':
        setBusy(false);
        setStatus(msg.text || 'Done');
        break;
      case 'error':
        setBusy(false);
        appendMsg('system', msg.message || 'Error');
        setStatus('Error');
        break;
      default:
        break;
    }
  });

  showEmpty();
  vscode.postMessage({ type: 'ready' });
})();
