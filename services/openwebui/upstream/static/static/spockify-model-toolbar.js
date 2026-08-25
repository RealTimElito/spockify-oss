(function () {
  'use strict';

  const MOVED_ATTR = 'data-spockify-model-toolbar';
  const ACTIVE_CHAT = /^\/c\/[^/]+/;

  function isActiveChat() {
    return ACTIVE_CHAT.test(window.location.pathname);
  }

  function modelRoot() {
    const toolbar = document.querySelector(
      '.spockify-input-model-selector #model-selector-0-button'
    );
    if (toolbar) {
      return toolbar.closest('.flex.flex-col.w-full.items-start') ||
        toolbar.closest('.flex.flex-col.items-start');
    }

    const navbarButton = document.querySelector(
      'nav #model-selector-0-button'
    );
    if (!navbarButton) return null;

    return (
      navbarButton.closest('.flex.flex-col.w-full.items-start') ||
      navbarButton.closest('.flex.flex-col.items-start') ||
      navbarButton.parentElement?.parentElement
    );
  }

  function integrationsBlock(container) {
    if (!container) return null;
    const btn =
      container.querySelector('#integration-menu-button') ||
      container.querySelector('button[aria-label*="Tools"]') ||
      container.querySelector('button[aria-label*="Integrations"]') ||
      container.querySelector('#input-menu-button');
    if (!btn) return null;
    return (
      btn.closest('.ml-1.self-end.flex.items-center') ||
      btn.closest('.ml-1.self-end') ||
      btn
    );
  }

  function relocationSlot() {
    const container = document.getElementById('message-input-container');
    if (!container) return null;

    const block = integrationsBlock(container);
    if (block?.parentElement) {
      return { parent: block.parentElement, before: block };
    }

    const row =
      container.querySelector('div.flex.justify-between') ||
      container.querySelector('div[class*="gap-1.5"]');
    if (!row) return null;
    return { parent: row, before: null };
  }

  function isolateModelClicks(root) {
    if (!root || root.getAttribute('data-spockify-isolated') === '1') return;
    root.setAttribute('data-spockify-isolated', '1');
    for (const type of ['click', 'mousedown', 'pointerdown']) {
      root.addEventListener(type, (event) => event.stopPropagation(), false);
    }
  }

  function relocate() {
    const root = modelRoot();
    const slot = relocationSlot();
    if (!root || !slot) return false;

    root.classList.add('spockify-input-model-selector');
    root.setAttribute(MOVED_ATTR, '1');
    isolateModelClicks(root);

    const { parent, before } = slot;
    if (before) {
      if (root.parentElement !== parent || root.nextElementSibling !== before) {
        parent.insertBefore(root, before);
      }
    } else if (root.parentElement !== parent) {
      parent.prepend(root);
    }
    return true;
  }

  function modelDropdowns() {
    return Array.from(
      document.querySelectorAll('body > div[style*="position: fixed"][style*="z-index: 9999"]')
    ).filter((el) => el.querySelector('#model-search-input'));
  }

  function repositionDropdown() {
    if (!isActiveChat()) return;

    const button = document.querySelector(
      '.spockify-input-model-selector #model-selector-0-button'
    );
    if (!button || button.getAttribute('aria-expanded') !== 'true') return;

    const rect = button.getBoundingClientRect();
    for (const dropdown of modelDropdowns()) {
      const height = dropdown.offsetHeight || dropdown.getBoundingClientRect().height || 320;
      const top = Math.max(8, rect.top - height - 6);
      dropdown.classList.add('spockify-model-dropdown-up');
      dropdown.style.top = `${top}px`;
      dropdown.style.bottom = 'auto';
      dropdown.style.maxHeight = `${Math.max(160, rect.top - 12)}px`;

      const list = dropdown.querySelector('[style*="height"]') ||
        dropdown.querySelector('.overflow-y-auto') ||
        dropdown.querySelector('div.px-2');
      if (list && list.style) {
        list.style.maxHeight = `${Math.max(120, rect.top - 80)}px`;
        list.style.overflowY = 'auto';
      }
    }
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      relocate();
      repositionDropdown();
    });
  }

  function isModelInteraction(target) {
    return (
      target instanceof Element &&
      !!target.closest('.spockify-input-model-selector, #model-selector-0-button')
    );
  }

  function boot() {
    schedule();

    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'style', 'class'],
    });

    window.addEventListener('popstate', schedule);
    window.addEventListener('resize', schedule);

    document.addEventListener(
      'click',
      (event) => {
        if (isModelInteraction(event.target)) {
          schedule();
          window.setTimeout(schedule, 0);
          window.setTimeout(schedule, 50);
        }
      },
      false
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
