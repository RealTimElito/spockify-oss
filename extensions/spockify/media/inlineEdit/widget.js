(function () {
  const vscode = acquireVsCodeApi();
  const el = {
    loc: document.getElementById('loc'),
    phase: document.getElementById('phase'),
    input: document.getElementById('input'),
    hint: document.getElementById('hint'),
    run: document.getElementById('run'),
    accept: document.getElementById('accept'),
    reject: document.getElementById('reject'),
    follow: document.getElementById('follow'),
    cancel: document.getElementById('cancel'),
  };

  let mode = 'prompt';

  function setMode(next) {
    mode = next;
    const prompting = mode === 'prompt';
    const preview = mode === 'preview';
    const busy = mode === 'streaming';
    el.input.disabled = !prompting;
    el.run.hidden = !prompting;
    el.run.disabled = busy;
    el.accept.hidden = !preview;
    el.reject.hidden = !preview;
    el.follow.hidden = !preview;
    el.cancel.hidden = preview;
    el.hint.hidden = !preview;
    if (prompting) {
      el.phase.textContent = 'Instruction';
      el.input.focus();
    } else if (busy) {
      el.phase.textContent = 'Streaming…';
    } else if (preview) {
      el.phase.textContent = 'Preview';
    }
  }

  el.run.addEventListener('click', function () {
    const text = (el.input.value || '').trim();
    if (!text) return;
    vscode.postMessage({ type: 'submit', instruction: text });
    setMode('streaming');
  });

  el.accept.addEventListener('click', function () {
    vscode.postMessage({ type: 'accept' });
  });
  el.reject.addEventListener('click', function () {
    vscode.postMessage({ type: 'reject' });
  });
  el.follow.addEventListener('click', function () {
    vscode.postMessage({ type: 'followUp' });
    setMode('prompt');
    el.input.value = '';
    el.input.placeholder = 'Refine the previewed change…';
    el.input.focus();
  });
  el.cancel.addEventListener('click', function () {
    vscode.postMessage({ type: 'cancel' });
  });

  el.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      el.run.click();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (mode === 'preview') {
        el.reject.click();
      } else {
        el.cancel.click();
      }
    }
  });

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'init':
        el.loc.textContent = msg.location || 'Inline edit';
        el.input.placeholder = msg.placeholder || 'Describe the edit…';
        if (msg.placement === 'float') {
          document.body.classList.add('float-mode');
        } else {
          document.body.classList.remove('float-mode');
        }
        if (msg.mode === 'terminal') {
          el.hint.textContent =
            'Preview command · Ctrl+Enter Run · Esc Reject';
        } else {
          el.hint.textContent =
            'Diff in editor · Ctrl+Enter Accept · Esc Reject';
        }
        setMode('prompt');
        break;
      case 'streaming':
        setMode('streaming');
        break;
      case 'preview':
        setMode('preview');
        break;
      case 'previewCommand':
        if (typeof msg.command === 'string') {
          el.input.value = msg.command;
        }
        setMode('preview');
        break;
      case 'reset':
        el.input.value = '';
        el.input.placeholder = msg.placeholder || 'Describe the edit…';
        setMode('prompt');
        break;
      case 'focus':
        el.input.focus();
        break;
      default:
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
