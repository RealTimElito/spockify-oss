/* Spockify Agents panel webview — live per-run view (Cursor-style). */
(function () {
  const vscode = acquireVsCodeApi();

  const el = {
    root: document.getElementById('root'),
    statusDot: document.getElementById('statusDot'),
    title: document.getElementById('title'),
    meta: document.getElementById('meta'),
    prompt: document.getElementById('prompt'),
    cancelBtn: document.getElementById('cancelBtn'),
    workers: document.getElementById('workers'),
    empty: document.getElementById('empty'),
  };

  /** Current run snapshot (whole-object, as delivered by run_status/worker_status events). */
  let run = null;
  /** workerId -> array of {tool, ok, query, url, preview, error} in arrival order. */
  const toolActivity = {};
  /** workerId -> expanded (bool) */
  const expanded = {};
  let tickTimer = null;
  let cancelRequested = false;

  function fmtElapsed(ms) {
    if (ms == null || ms < 0) return '';
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return m + 'm ' + rem + 's';
  }

  function isBusyStatus(status) {
    return status === 'pending' || status === 'running' || status === 'synthesizing';
  }

  function isBusyWorker(state) {
    return state === 'pending' || state === 'running';
  }

  function startTicking() {
    if (tickTimer) return;
    tickTimer = window.setInterval(renderElapsedOnly, 1000);
  }

  function stopTicking() {
    if (tickTimer) {
      window.clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function truncateOneLine(s, max) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length > max ? t.slice(0, Math.max(1, max - 1)) + '…' : t;
  }

  function workerStateOf(w) {
    return w.state || w.status || 'pending';
  }

  function workerResultOf(w) {
    return w.result || w.output || w.preview || '';
  }

  /** One compact "current action" line per worker — same idea as Chat's
   * streamStatus: "Searching: <query>", "Browsing <url>", "Generating…". */
  function workerStatusLine(worker) {
    const activity = toolActivity[worker.id];
    const state = workerStateOf(worker);
    if (state === 'running' && activity && activity.length) {
      const last = activity[activity.length - 1];
      if (last.phase === 'start') {
        if (last.tool === 'search') return 'Searching: ' + truncateOneLine(last.query, 40);
        if (last.tool === 'browse') return 'Browsing ' + truncateOneLine(last.url, 40);
        return 'Running ' + (last.tool || 'tool') + '…';
      }
      return 'Generating…';
    }
    if (state === 'running') return 'Generating…';
    if (state === 'done') {
      const text = String(workerResultOf(worker) || '').trim();
      if (!text) return 'done';
      const first = text.split(/\r?\n/).find(function (l) { return l.trim(); });
      return truncateOneLine(first || text, 56);
    }
    if (state === 'failed') return truncateOneLine(worker.error || 'failed', 48);
    if (state === 'cancelled') return 'stopped';
    return 'queued';
  }

  function workerIcon(state) {
    if (state === 'running') return '●'; // ●
    if (state === 'done') return '✓'; // check
    if (state === 'failed') return '✗'; // x
    if (state === 'cancelled') return '⦸'; // circle-slash-ish
    return '○'; // ○ pending
  }

  function renderElapsedOnly() {
    if (!run) return;
    (run.workers || []).forEach(function (w) {
      const rowEl = el.workers.querySelector('[data-worker-id="' + cssEscape(w.id) + '"] .worker-elapsed');
      if (rowEl) rowEl.textContent = elapsedFor(w);
    });
    const runElapsedEl = document.getElementById('runElapsed');
    if (runElapsedEl) runElapsedEl.textContent = elapsedFor(run);
  }

  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function elapsedFor(obj) {
    const started = obj.started_at ? Date.parse(obj.started_at) : (obj.created_at ? Date.parse(obj.created_at) : NaN);
    if (Number.isNaN(started)) return '';
    const end = obj.finished_at ? Date.parse(obj.finished_at) : (obj.updated_at && !isBusyStatusLike(obj) ? Date.parse(obj.updated_at) : Date.now());
    return fmtElapsed(end - started);
  }

  function isBusyStatusLike(obj) {
    return isBusyStatus(obj.status) || isBusyWorker(workerStateOf(obj));
  }

  function render() {
    if (!run) {
      el.empty.hidden = false;
      return;
    }
    el.empty.hidden = true;
    el.statusDot.className = 'run-status-dot ' + (run.status || 'pending');
    el.statusDot.textContent = '●';
    el.title.textContent = (run.parent_prompt && run.parent_prompt.trim()) || run.id;
    el.title.title = run.parent_prompt || run.id;
    const bits = [];
    if (run.model) bits.push(run.model);
    bits.push(run.status);
    const workersList = run.workers || [];
    const doneCount = workersList.filter(function (w) { return workerStateOf(w) === 'done'; }).length;
    const liveCount = workersList.filter(function (w) {
      const s = workerStateOf(w);
      return s === 'running' || s === 'pending';
    }).length;
    const total = workersList.length;
    if (total) {
      bits.push(
        liveCount > 0
          ? liveCount + '/' + total + ' live'
          : doneCount + '/' + total + ' done',
      );
    }
    bits.push('<span id="runElapsed">' + elapsedFor(run) + '</span>');
    el.meta.innerHTML = bits.map(function (b) { return '<span>' + b + '</span>'; }).join('');
    el.prompt.textContent = run.parent_prompt || '';

    const busy = isBusyStatus(run.status);
    el.cancelBtn.hidden = !busy || cancelRequested;
    el.cancelBtn.textContent = cancelRequested ? 'Stopping…' : 'Stop';

    if (busy) startTicking(); else stopTicking();

    renderWorkers();
  }

  function renderWorkers() {
    const workers = run.workers || [];
    el.workers.innerHTML = '';
    workers.forEach(function (w) {
      const row = document.createElement('div');
      row.className = 'worker-row' + (expanded[w.id] ? ' expanded' : '');
      row.dataset.workerId = w.id;

      const head = document.createElement('div');
      head.className = 'worker-head';
      head.addEventListener('click', function () {
        expanded[w.id] = !expanded[w.id];
        row.classList.toggle('expanded', expanded[w.id]);
      });

      const state = workerStateOf(w);
      const icon = document.createElement('span');
      icon.className = 'worker-icon ' + state;
      icon.textContent = workerIcon(state);
      head.appendChild(icon);

      const name = document.createElement('span');
      name.className = 'worker-name';
      name.textContent = w.name || w.id;
      head.appendChild(name);

      const status = document.createElement('span');
      status.className = 'worker-status-line';
      status.textContent = workerStatusLine(w);
      head.appendChild(status);

      const elapsed = document.createElement('span');
      elapsed.className = 'worker-elapsed';
      elapsed.textContent = elapsedFor(w);
      head.appendChild(elapsed);

      const chev = document.createElement('span');
      chev.className = 'worker-chevron';
      chev.textContent = expanded[w.id] ? '▾' : '▸';
      head.appendChild(chev);

      row.appendChild(head);

      const body = document.createElement('div');
      body.className = 'worker-body';

      const activity = toolActivity[w.id] || [];
      activity.forEach(function (a) {
        body.appendChild(renderToolChip(a));
      });

      const resultText = String(workerResultOf(w) || '').trim();
      if (resultText) {
        const pre = document.createElement('pre');
        pre.className = 'worker-transcript';
        pre.textContent = resultText;
        body.appendChild(pre);
      }
      if (w.error && w.error.trim()) {
        const err = document.createElement('div');
        err.className = 'worker-error';
        err.textContent = w.error;
        body.appendChild(err);
      }
      row.appendChild(body);
      el.workers.appendChild(row);
    });
  }

  /** Reuses chat.css's .tool-card visual language (linked stylesheet) so
   * this reads as the same design system as Chat's tool cards. */
  function renderToolChip(activity) {
    const card = document.createElement('div');
    const okClass = activity.phase === 'result' ? (activity.ok ? 'ok' : 'err') : 'pending';
    card.className = 'tool-card chip ' + okClass;
    const title = document.createElement('div');
    title.className = 'tool-card-title';
    const label = activity.tool === 'search' ? 'search' : activity.tool === 'browse' ? 'browse' : (activity.tool || 'tool');
    const detail = activity.tool === 'search' ? activity.query : activity.url;
    title.textContent = label + (detail ? ': ' + truncateOneLine(detail, 60) : '') +
      (activity.phase === 'start' ? '…' : activity.ok ? ' ✓' : ' ✗');
    card.appendChild(title);
    if (activity.preview || activity.error) {
      const body = document.createElement('pre');
      body.className = 'tool-card-body';
      body.textContent = activity.preview || activity.error || '';
      card.appendChild(body);
    }
    return card;
  }

  function applyEvent(ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'run_created' || ev.type === 'run_status') {
      if (ev.run) run = ev.run;
      if (ev.status === 'cancelled' || ev.status === 'done' || ev.status === 'failed') {
        cancelRequested = false;
      }
      render();
      return;
    }
    if (ev.type === 'worker_status') {
      if (ev.run) run = ev.run;
      render();
      return;
    }
    if (ev.type === 'tool_start' || ev.type === 'tool_result') {
      const wid = ev.worker_id || ev.child_id;
      if (!wid) return;
      if (!toolActivity[wid]) toolActivity[wid] = [];
      toolActivity[wid].push({
        phase: ev.type === 'tool_start' ? 'start' : 'result',
        tool: ev.tool,
        query: ev.query,
        url: ev.url,
        ok: ev.ok,
        preview: ev.preview,
        error: ev.error,
      });
      render();
      return;
    }
    if (ev.type === 'error') {
      const banner = document.createElement('div');
      banner.className = 'worker-error';
      banner.style.padding = '8px 12px';
      banner.textContent = ev.error || 'Stream error';
      el.root.insertBefore(banner, el.workers);
      return;
    }
    // heartbeat / fork_created: nothing to render.
  }

  el.cancelBtn.addEventListener('click', function () {
    if (cancelRequested) return;
    cancelRequested = true;
    el.cancelBtn.hidden = true;
    vscode.postMessage({ type: 'cancel' });
  });

  window.addEventListener('message', function (e) {
    const msg = e.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'init') {
      run = msg.run;
      render();
      return;
    }
    if (msg.type === 'event') {
      applyEvent(msg.event);
      return;
    }
    if (msg.type === 'streamError') {
      const banner = document.createElement('div');
      banner.className = 'worker-error';
      banner.style.padding = '8px 12px';
      banner.textContent = msg.message || 'Connection lost';
      el.root.insertBefore(banner, el.workers);
      return;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
