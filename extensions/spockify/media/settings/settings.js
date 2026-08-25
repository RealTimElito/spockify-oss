/* Spockify Settings webview */
(function () {
  const vscode = acquireVsCodeApi();

  const SECTIONS = [
    { id: 'general', label: 'General', ico: '◈' },
    { id: 'usage', label: 'Usage', ico: '▣' },
    { id: 'models', label: 'Models', ico: '◇' },
    { id: 'rules', label: 'Rules & Knowledge', ico: '☰' },
    { id: 'indexing', label: 'Codebase indexing', ico: '▦' },
    { id: 'agent', label: 'Agent & Chat', ico: '∞' },
    { id: 'updates', label: 'Updates', ico: '↻' },
  ];

  const navList = document.getElementById('navList');
  const content = document.getElementById('content');
  const openStock = document.getElementById('openStock');

  let state = null;
  let section = 'general';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  function renderNav() {
    navList.innerHTML = '';
    SECTIONS.forEach(function (s) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-item' + (s.id === section ? ' active' : '');
      btn.setAttribute('data-section', s.id);
      btn.innerHTML =
        '<span class="nav-ico" aria-hidden="true">' +
        s.ico +
        '</span><span>' +
        esc(s.label) +
        '</span>';
      btn.addEventListener('click', function () {
        section = s.id;
        renderNav();
        render();
        if (s.id === 'usage') {
          post({ type: 'fetchUsage' });
        }
      });
      navList.appendChild(btn);
    });
  }

  function row(title, desc, actionsHtml) {
    return (
      '<div class="row">' +
      '<div class="row-copy">' +
      '<div class="row-title">' +
      esc(title) +
      '</div>' +
      (desc ? '<div class="row-desc">' + desc + '</div>' : '') +
      '</div>' +
      '<div class="row-actions">' +
      actionsHtml +
      '</div></div>'
    );
  }

  function toggle(key, on) {
    return (
      '<button type="button" class="toggle" role="switch" aria-checked="' +
      (on ? 'true' : 'false') +
      '" data-config="' +
      esc(key) +
      '" title="Toggle"></button>'
    );
  }

  function select(key, value, options) {
    const opts = options
      .map(function (o) {
        const v = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        return (
          '<option value="' +
          esc(v) +
          '"' +
          (v === value ? ' selected' : '') +
          '>' +
          esc(label) +
          '</option>'
        );
      })
      .join('');
    return (
      '<select class="select" data-config="' +
      esc(key) +
      '">' +
      opts +
      '</select>'
    );
  }

  function btn(label, attrs) {
    return (
      '<button type="button" class="btn' +
      (attrs.primary ? ' primary' : '') +
      (attrs.danger ? ' danger' : '') +
      '" ' +
      (attrs.cmd ? 'data-cmd="' + esc(attrs.cmd) + '"' : '') +
      (attrs.action ? 'data-action="' + esc(attrs.action) + '"' : '') +
      (attrs.url ? 'data-url="' + esc(attrs.url) + '"' : '') +
      (attrs.path ? 'data-path="' + esc(attrs.path) + '"' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }

  function card(title, hint, body) {
    return (
      '<section class="card"><h2>' +
      esc(title) +
      '</h2>' +
      (hint ? '<p class="hint">' + hint + '</p>' : '') +
      body +
      '</section>'
    );
  }

  function renderGeneral() {
    const a = state.account;
    const badge = a.signedIn
      ? '<span class="badge ok">Signed in</span>'
      : '<span class="badge warn">Not signed in</span>';
    return (
      head(
        'General',
        'Account and product connection. Credentials stay in SecretStorage — never shown in full.',
      ) +
      card(
        'Account',
        'Same account as spockify.eu. API keys and session tokens are stored securely.',
        row('Status', esc(a.label || (a.signedIn ? 'Signed in' : 'Sign in to use AI')), badge) +
          row(
            'Credential',
            a.kind === 'session'
              ? 'OWUI session'
              : a.kind === 'apiKey'
                ? 'API key'
                : '—',
            '<span class="mono">' + esc(a.keyHint) + '</span>',
          ) +
          row(
            'Actions',
            '',
            (a.signedIn
              ? btn('Sign out', { action: 'signOut', danger: true })
              : btn('Sign in', { action: 'signIn', primary: true })) +
              btn('Account menu', { cmd: 'spockify.accountMenu' }),
          ),
      ) +
      card(
        'Connection',
        'Product root for chat, models, and sync (not /v1).',
        row(
          'Base URL',
          'Default https://spockify.eu',
          '<input class="input" data-config="baseUrl" value="' +
            esc(state.baseUrl) +
            '" />',
        ) +
          row(
            'Sync prefs',
            'Rules / memories via spockify.eu when signed in',
            toggle('sync.enabled', !!state.syncEnabled),
          ) +
          row(
            'Open site',
            '',
            btn('spockify.eu', { url: state.siteUrl }) +
              btn('IDE page', { url: state.siteUrl.replace(/\/?$/, '') + '/ide' }),
          ),
      ) +
      card(
        'Version',
        '',
        row('Spockify IDE', 'Extension / AppImage version axis', '<span class="mono">' + esc(state.version) + '</span>'),
      )
    );
  }

  function renderUsage() {
    const u = state.usage || {};
    let body;
    if (u.available) {
      body =
        '<div class="stats">' +
        '<div class="stat"><div class="stat-label">Spend</div><div class="stat-value">$' +
        esc(Number(u.spend || 0).toFixed(2)) +
        '</div></div>' +
        '<div class="stat"><div class="stat-label">Requests</div><div class="stat-value">' +
        esc(String(u.requests || 0)) +
        '</div></div>' +
        '<div class="stat"><div class="stat-label">Tokens</div><div class="stat-value">' +
        esc(String(u.totalTokens || 0)) +
        '</div></div></div>';
      if (u.byModel && u.byModel.length) {
        body +=
          '<ul class="list">' +
          u.byModel
            .slice(0, 8)
            .map(function (m) {
              return (
                '<li><span class="mono">' +
                esc(m.model) +
                '</span><span>$' +
                esc(Number(m.spend || 0).toFixed(2)) +
                ' · ' +
                esc(String(m.requests || 0)) +
                ' req</span></li>'
              );
            })
            .join('') +
          '</ul>';
      }
    } else {
      body =
        '<p class="placeholder">' +
        esc(u.message || 'Usage placeholder') +
        '</p>' +
        row(
          'Refresh',
          'Tries GET /api/v1/spockify/usage when signed in',
          btn('Refresh usage', { action: 'fetchUsage', primary: true }) +
            btn('Open web Usage', {
              url: state.siteUrl.replace(/\/?$/, '') + '/spockify',
            }),
        );
    }
    return (
      head(
        'Usage',
        'Quota and spend for your Spockify account. Wired to the usage API when permitted.',
      ) + card('Account usage', '', body)
    );
  }

  function renderModels() {
    const modelOpts = [{ value: 'spockify-auto', label: 'Auto (spockify-auto)' }].concat(
      (state.models || []).map(function (m) {
        return { value: m.id, label: m.label || m.id };
      }),
    );
    // Ensure current default is in the list
    if (
      state.defaultModel &&
      !modelOpts.some(function (o) {
        return o.value === state.defaultModel;
      })
    ) {
      modelOpts.unshift({
        value: state.defaultModel,
        label: state.defaultModel,
      });
    }
    const list =
      state.models && state.models.length
        ? '<ul class="list">' +
          state.models
            .slice(0, 24)
            .map(function (m) {
              return (
                '<li><span class="mono">' +
                esc(m.id) +
                '</span>' +
                (m.id === state.defaultModel
                  ? '<span class="badge ok">default</span>'
                  : '') +
                '</li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="placeholder">Sign in and refresh to list models from spockify.eu.</p>';

    return (
      head(
        'Models',
        'Default model and catalog filters. Closed models are stripped when OSS-only is on.',
      ) +
      card(
        'Defaults',
        '',
        row(
          'Provider',
          'Local models are coming soon',
          select('provider', state.provider, [
            { value: 'remote', label: 'Remote (spockify.eu)' },
            { value: 'local', label: 'Local (soon)' },
          ]),
        ) +
          row(
            'Default model',
            'Chat, Composer, Terminal Agent',
            select('defaultModel', state.defaultModel, modelOpts),
          ) +
          row(
            'OSS only',
            'Strip closed models from catalog and completions',
            toggle('models.ossOnly', !!state.ossOnly),
          ) +
          row(
            'Refresh catalog',
            '',
            btn('List models', { cmd: 'spockify.listModels' }) +
              btn('API health', { cmd: 'spockify.health' }),
          ),
      ) +
      card('Available models', 'From the signed-in transport', list)
    );
  }

  function renderRules() {
    const r = state.rules || {};
    const layers =
      r.layers && r.layers.length
        ? '<ul class="list">' +
          r.layers
            .map(function (l) {
              return (
                '<li><span>' +
                esc(l.layer) +
                ' · <span class="mono">' +
                esc(l.source) +
                '</span></span><span>' +
                esc(String(l.chars)) +
                ' chars</span></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="placeholder">No rules found yet. Add project rules under .spockify/rules.</p>';

    return (
      head(
        'Rules & Knowledge',
        'Project rules, user rules, and memories. Skills slash-commands are not shipped yet.',
      ) +
      card(
        'Rules layers',
        'Merge order: global → user → project',
        layers +
          row(
            'Open files',
            '',
            btn('Project rules', { path: 'projectRules', primary: true }) +
              btn('User rules', { path: 'userRules' }) +
              btn('Global rules', { path: 'globalRules' }),
          ) +
          row(
            'Preview',
            '',
            btn('Show effective rules', { cmd: 'spockify.rules.show' }),
          ),
      ) +
      card(
        'Knowledge (memories)',
        'Short facts injected into future chats.',
        row(
          'Saved memories',
          '',
          '<span class="mono">' + esc(String(r.memoriesCount || 0)) + '</span>',
        ) +
          row(
            'Manage',
            '',
            btn('List', { cmd: 'spockify.memories.list' }) +
              btn('Add memory', { cmd: 'spockify.memories.add' }),
          ),
      ) +
      card(
        'Skills',
        esc(r.skillsNote || ''),
        row(
          'Project skills folder',
          '.spockify/skills (placeholder)',
          btn('Open folder', { path: 'skillsDir' }),
        ),
      )
    );
  }

  function renderIndexing() {
    const ix = state.indexing || {};
    return (
      head(
        'Codebase indexing',
        'Local BM25 (+ optional hybrid embeddings). Chunk text stays on disk; cloud sync is metadata only.',
      ) +
      card(
        'Status',
        '',
        row(
          'Index',
          ix.error ? esc(ix.error) : '',
          '<span class="badge ' +
            (ix.status === 'ready' ? 'ok' : ix.status === 'error' ? 'warn' : '') +
            '">' +
            esc(ix.status || 'idle') +
            '</span>',
        ) +
          row(
            'Chunks / files',
            ix.embedModel ? 'Embed: ' + esc(ix.embedModel) : '',
            '<span class="mono">' +
              esc(String(ix.chunks != null ? ix.chunks : '—')) +
              ' / ' +
              esc(String(ix.files != null ? ix.files : '—')) +
              '</span>',
          ) +
          row(
            'Actions',
            '',
            btn('Reindex', { cmd: 'spockify.codebase.reindex', primary: true }) +
              btn('Status', { cmd: 'spockify.codebase.status' }) +
              btn('Search', { cmd: 'spockify.codebase.search' }) +
              btn('Preset…', { cmd: 'spockify.codebase.configure' }),
          ),
      ) +
      card(
        'Options',
        '',
        row(
          'Index on startup',
          'Build or load when the extension starts',
          toggle('codebase.indexOnStartup', !!ix.indexOnStartup),
        ) +
          row(
            'Auto-attach @codebase',
            'Inject search hits into Chat/Composer (not chip-only)',
            toggle('codebase.autoAttach', ix.autoAttach !== false),
          ) +
          row(
            'Auto-attach in Ask',
            'Also retrieve in Ask mode when auto-attach is on',
            toggle('codebase.autoAttachAsk', ix.autoAttachAsk !== false),
          ) +
          row(
            'Reindex on save',
            'Debounced full reindex after edits',
            toggle('codebase.reindexOnSave', !!ix.reindexOnSave),
          ) +
          row(
            'Hybrid search',
            'BM25 + embeddings when available',
            toggle('codebase.hybrid', !!ix.hybrid),
          ) +
          row(
            'Remote index meta',
            'Push fingerprint / counts only to spockify.eu',
            toggle('codebase.remoteIndexMeta', !!ix.remoteIndexMeta),
          ),
      )
    );
  }

  function renderAgent() {
    return (
      head(
        'Agent & Chat',
        'Runtime tool policy, chat context, completions, and Terminal Agent safety.',
      ) +
      card(
        'Agent mode',
        'ask = read-only · agent = full tools · strict = allowlist only',
        row(
          'Mode',
          'Also changeable from the status bar',
          select('agent.mode', state.agentMode, [
            { value: 'ask', label: 'Ask (read-only)' },
            { value: 'agent', label: 'Agent' },
            { value: 'strict', label: 'Strict' },
          ]),
        ) +
        row(
          'Permissions',
          'Cursor-like tool/file policy (Ask mode stays read-only)',
          select('agentPermissionMode', state.agentPermissionMode || 'askEveryTime', [
            {
              value: 'allowAll',
              label: 'Allow all (unsandboxed)',
            },
            { value: 'askEveryTime', label: 'Ask every time' },
            {
              value: 'autoRunReviewFiles',
              label: 'Auto-run tools, review file edits',
            },
          ]),
        ) +
          row(
            'MAX Mode preference',
            'Stored for the model picker',
            toggle('chat.maxMode', !!state.chatMaxMode),
          ),
      ) +
      card(
        'Chat & completions',
        '',
        row(
          'Attach terminal to chat',
          '@terminal chip on Send / Ctrl+L',
          toggle('chat.attachTerminal', !!state.chatAttachTerminal),
        ) +
          row(
            'Tab completions',
            'Ghost text via Ghost complete API',
            toggle('completions.enabled', !!state.completionsEnabled),
          ),
      ) +
      card(
        'Terminal Agent',
        'Command execution policy for captured shell tools.',
        row(
          'Policy',
          '',
          select('terminalAgent.policy', state.terminalPolicy, [
            { value: 'ask', label: 'Ask' },
            { value: 'allowlist', label: 'Allowlist' },
            { value: 'deny', label: 'Deny (strict)' },
          ]),
        ) +
          row(
            'Allowlist tier',
            '',
            select('terminalAgent.allowlistTier', state.terminalAllowlistTier, [
              { value: 'read', label: 'Read' },
              { value: 'dev', label: 'Dev' },
              { value: 'build', label: 'Build' },
              { value: 'custom', label: 'Custom only' },
            ]),
          ) +
          row(
            'Plan approval',
            'Approve / edit plan before tools run',
            toggle('terminalAgent.planApproval', !!state.terminalPlanApproval),
          ) +
          row(
            'More',
            '',
            btn('Policy status', { cmd: 'spockify.terminalAgent.policyStatus' }) +
              btn('MCP servers', { cmd: 'spockify.mcp.configure' }),
          ),
      )
    );
  }

  function renderUpdates() {
    return (
      head(
        'Updates',
        'AppImage / .deb releases are published on spockify.eu. Update checks use the extension version axis.',
      ) +
      card(
        'Current',
        '',
        row('Installed', '', '<span class="mono">' + esc(state.version) + '</span>') +
          row(
            'Check on startup',
            'Banner when a newer AppImage is available',
            toggle('update.checkOnStartup', !!state.updateCheckOnStartup),
          ) +
          row(
            'Actions',
            '',
            btn('Check now', { cmd: 'spockify.update.check', primary: true }) +
              btn('Releases archive', { url: state.releasesUrl }),
          ),
      )
    );
  }

  function head(title, sub) {
    return (
      '<header class="section-head"><h1>' +
      esc(title) +
      '</h1><p>' +
      esc(sub) +
      '</p></header>'
    );
  }

  function render() {
    if (!state) {
      content.innerHTML = '<p class="placeholder">Loading…</p>';
      return;
    }
    var html = '';
    switch (section) {
      case 'usage':
        html = renderUsage();
        break;
      case 'models':
        html = renderModels();
        break;
      case 'rules':
        html = renderRules();
        break;
      case 'indexing':
        html = renderIndexing();
        break;
      case 'agent':
        html = renderAgent();
        break;
      case 'updates':
        html = renderUpdates();
        break;
      default:
        html = renderGeneral();
    }
    content.innerHTML = html;
    wireControls();
  }

  function wireControls() {
    content.querySelectorAll('[data-config].toggle').forEach(function (el) {
      el.addEventListener('click', function () {
        var key = el.getAttribute('data-config');
        var next = el.getAttribute('aria-checked') !== 'true';
        el.setAttribute('aria-checked', next ? 'true' : 'false');
        post({ type: 'setConfig', key: key, value: next });
      });
    });
    content.querySelectorAll('select[data-config]').forEach(function (el) {
      el.addEventListener('change', function () {
        post({
          type: 'setConfig',
          key: el.getAttribute('data-config'),
          value: el.value,
        });
      });
    });
    content.querySelectorAll('input.input[data-config]').forEach(function (el) {
      el.addEventListener('change', function () {
        post({
          type: 'setConfig',
          key: el.getAttribute('data-config'),
          value: el.value.trim(),
        });
      });
    });
    content.querySelectorAll('[data-cmd]').forEach(function (el) {
      el.addEventListener('click', function () {
        post({ type: 'runCommand', command: el.getAttribute('data-cmd') });
      });
    });
    content.querySelectorAll('[data-url]').forEach(function (el) {
      el.addEventListener('click', function () {
        post({ type: 'openExternal', url: el.getAttribute('data-url') });
      });
    });
    content.querySelectorAll('[data-path]').forEach(function (el) {
      el.addEventListener('click', function () {
        post({ type: 'openPath', kind: el.getAttribute('data-path') });
      });
    });
    content.querySelectorAll('[data-action]').forEach(function (el) {
      el.addEventListener('click', function () {
        var action = el.getAttribute('data-action');
        if (action === 'signIn') post({ type: 'signIn' });
        else if (action === 'signOut') post({ type: 'signOut' });
        else if (action === 'fetchUsage') post({ type: 'fetchUsage' });
      });
    });
  }

  openStock.addEventListener('click', function () {
    post({ type: 'openStockSettings', query: 'spockify' });
  });

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'snapshot') {
      state = msg.data;
      if (state.section && SECTIONS.some(function (s) { return s.id === state.section; })) {
        section = state.section;
      }
      renderNav();
      render();
    } else if (msg.type === 'usage' && state) {
      state.usage = msg.data;
      if (section === 'usage') render();
    }
  });

  renderNav();
  post({ type: 'ready' });
})();
