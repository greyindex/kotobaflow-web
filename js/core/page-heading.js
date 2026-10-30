(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  // Shared module heading: "where am I, what is selected, what is next".
  // Modules own the state and handlers; this helper only renders escaped markup
  // and updates an existing heading in place so focused controls survive
  // re-rendering (filters, pagination, lesson switches).

  // js/core/html.js is loaded earlier in index.html. There is deliberately no
  // raw-string fallback: without the shared escaper nothing is rendered.
  function escapeValue(value) {
    return app.html.escape(value);
  }

  function renderIcon(name) {
    return name && typeof root.uiIcon === 'function' ? root.uiIcon(name) : '';
  }

  function normalizeAction(action) {
    var input = action || {};
    return {
      id: String(input.id || ''),
      label: String(input.label || ''),
      icon: input.icon || '',
      iconAfter: !!input.iconAfter,
      variant: input.variant === 'primary' || input.variant === 'quiet' ? input.variant : 'secondary',
      segment: !!input.segment,
      title: input.title || '',
      ariaLabel: input.ariaLabel || '',
      badge: input.badge === undefined || input.badge === null ? '' : String(input.badge),
      pressed: input.pressed === true || input.pressed === false ? input.pressed : null,
      disabled: !!input.disabled,
      compactLabel: input.compactLabel || '',
    };
  }

  function actionClass(action) {
    return (
      'page-heading-action page-heading-action--' +
      action.variant +
      (action.segment ? ' page-heading-action--segment' : '') +
      (action.compactLabel ? ' has-compact-label' : '') +
      (action.iconAfter ? ' has-trailing-icon' : '')
    );
  }

  function actionInner(action) {
    var icon = renderIcon(action.icon);
    return (
      (action.iconAfter ? '' : icon) +
      '<span class="page-heading-action-label">' +
      escapeValue(action.label) +
      '</span>' +
      (action.compactLabel
        ? '<span class="page-heading-action-compact" aria-hidden="true">' +
          escapeValue(action.compactLabel) +
          '</span>'
        : '') +
      (action.iconAfter ? icon : '') +
      (action.badge ? '<span class="page-heading-action-badge">' + escapeValue(action.badge) + '</span>' : '')
    );
  }

  function setAttribute(el, name, value) {
    if (value) {
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    } else if (el.hasAttribute(name)) {
      el.removeAttribute(name);
    }
  }

  function applyAction(button, action) {
    var className = actionClass(action);
    if (button.className !== className) button.className = className;
    var inner = actionInner(action);
    if (button._pageHeadingInner !== inner) {
      button.innerHTML = inner;
      button._pageHeadingInner = inner;
    }
    setAttribute(button, 'title', action.title);
    setAttribute(button, 'aria-label', action.ariaLabel);
    setAttribute(button, 'aria-pressed', action.pressed === null ? '' : action.pressed ? 'true' : 'false');
    if (button.disabled !== action.disabled) button.disabled = action.disabled;
  }

  function syncActions(container, actions) {
    var existing = {};
    var nodes = container.querySelectorAll('[data-heading-action]');
    for (var i = 0; i < nodes.length; i++) existing[nodes[i].getAttribute('data-heading-action')] = nodes[i];
    var previous = null;
    for (var j = 0; j < actions.length; j++) {
      var action = actions[j];
      if (!action.id) continue;
      var button = existing[action.id];
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-heading-action', action.id);
      }
      delete existing[action.id];
      applyAction(button, action);
      var reference = previous ? previous.nextSibling : container.firstChild;
      if (button !== reference) container.insertBefore(button, reference);
      previous = button;
    }
    Object.keys(existing).forEach(function (id) {
      existing[id].remove();
    });
  }

  function titleMarkup(model) {
    var prefix = model.titlePrefix
      ? '<span class="page-heading-title-prefix">' + escapeValue(model.titlePrefix) + '</span>'
      : '';
    var lang = model.titleLang ? ' lang="' + escapeValue(model.titleLang) + '"' : '';
    return (
      prefix + '<span class="page-heading-title-text"' + lang + '>' + escapeValue(model.title) + '</span>'
    );
  }

  function stepsMarkup(model) {
    var steps = Array.isArray(model.steps) ? model.steps : [];
    if (!steps.length) return '';
    var html =
      '<span class="page-heading-steps" role="img" aria-label="' + escapeValue(model.stepsLabel || '') + '">';
    for (var i = 0; i < steps.length; i++) {
      var state = /^(done|skipped|active|current|todo)$/.test(steps[i].state) ? steps[i].state : 'todo';
      html += '<i class="is-' + state + '" title="' + escapeValue(steps[i].label || '') + '"></i>';
    }
    return html + '</span>';
  }

  function metaMarkup(model) {
    var items = Array.isArray(model.meta) ? model.meta : [];
    var html = stepsMarkup(model);
    for (var i = 0; i < items.length; i++) {
      if (items[i] === '' || items[i] === null || items[i] === undefined) continue;
      html += '<span class="page-heading-meta-item">' + escapeValue(items[i]) + '</span>';
    }
    return html;
  }

  function ensureStructure(host) {
    var copy = host.querySelector(':scope > .page-heading-copy');
    var actions = host.querySelector(':scope > .page-heading-actions');
    if (copy && actions) return { copy: copy, actions: actions };
    var titleId = (host.id || 'pageHeading') + 'Title';
    host.innerHTML =
      '<div class="page-heading-copy"><p class="page-heading-eyebrow"></p><h2 class="page-heading-title" id="' +
      escapeValue(titleId) +
      '" tabindex="-1"></h2><p class="page-heading-meta"></p></div><div class="page-heading-actions"></div>';
    host.setAttribute('aria-labelledby', titleId);
    return {
      copy: host.querySelector(':scope > .page-heading-copy'),
      actions: host.querySelector(':scope > .page-heading-actions'),
    };
  }

  function setHtml(el, html) {
    if (el._pageHeadingHtml === html) return;
    el.innerHTML = html;
    el._pageHeadingHtml = html;
  }

  // Catalog headings marked data-scroll-autohide slide out of the main column
  // while the list below scrolls down, and return on any upward scroll, at the
  // top of the list, or when keyboard focus enters them.
  var AUTOHIDE_TRAVEL = 24;
  var AUTOHIDE_SETTLE_MS = 320;

  function setScrollHidden(host, hidden) {
    var state = host._pageHeadingAutoHide;
    if (!state || state.hidden === hidden) return;
    state.hidden = hidden;
    state.travel = 0;
    // Sliding the heading resizes the list and may clamp its scrollTop.
    state.settleUntil = Date.now() + AUTOHIDE_SETTLE_MS;
    if (hidden) host.style.setProperty('--page-heading-offset', host.offsetHeight + 'px');
    host.classList.toggle('is-scroll-hidden', hidden);
    followSlide(state.settleUntil);
  }

  // Anchored details follow scroll events; the slide moves the list without
  // one, so keep an open detail beside its anchor until the slide settles.
  function followSlide(until) {
    var detail = app.anchoredDetail;
    if (!detail || typeof detail.reposition !== 'function') return;
    (function step() {
      detail.reposition();
      if (Date.now() < until) root.requestAnimationFrame(step);
    })();
  }

  function onAutoHideScroll(host, event) {
    var state = host._pageHeadingAutoHide;
    var target = event.target;
    if (!target || target.nodeType !== 1 || host.contains(target)) return;
    var top = target.scrollTop;
    var previous = state.positions.has(target) ? state.positions.get(target) : top;
    state.positions.set(target, top);
    state.target = target;
    if (top <= 2) {
      setScrollHidden(host, false);
      return;
    }
    if (Date.now() < state.settleUntil) return;
    var delta = top - previous;
    if (!delta) return;
    if (delta > 0 !== state.travel > 0) state.travel = 0;
    state.travel += delta;
    if (state.travel <= -AUTOHIDE_TRAVEL) {
      setScrollHidden(host, false);
      return;
    }
    // Hide only when the list stays scrollable once it gains the heading's
    // height; otherwise the clamp would bring the heading straight back.
    var height = host.offsetHeight;
    if (
      state.travel >= AUTOHIDE_TRAVEL &&
      top > height &&
      target.scrollHeight - target.clientHeight > height * 2
    ) {
      setScrollHidden(host, true);
    }
  }

  function bindAutoHide(host) {
    var root = host.parentElement;
    if (host._pageHeadingAutoHide || !root) return;
    host._pageHeadingAutoHide = {
      hidden: false,
      travel: 0,
      settleUntil: 0,
      positions: new WeakMap(),
      target: null,
    };
    root.addEventListener(
      'scroll',
      function (event) {
        onAutoHideScroll(host, event);
      },
      { capture: true, passive: true },
    );
    // An upward wheel at the top of a list scrolls nothing but still asks for
    // the heading back.
    root.addEventListener(
      'wheel',
      function (event) {
        if (event.deltaY < 0) setScrollHidden(host, false);
      },
      { passive: true },
    );
    host.addEventListener('focusin', function () {
      setScrollHidden(host, false);
    });
  }

  function syncAutoHide(host) {
    if (!host.hasAttribute('data-scroll-autohide')) return;
    bindAutoHide(host);
    var state = host._pageHeadingAutoHide;
    if (!state || !state.hidden) return;
    // A re-render after the list was switched, hidden or scrolled back to the
    // top brings the heading back; mid-list re-renders keep it out of the way.
    var target = state.target;
    if (!target || !target.isConnected || !target.offsetParent || target.scrollTop <= 2) {
      setScrollHidden(host, false);
    }
  }

  function render(host, model, handlers) {
    if (!host) return null;
    model = model || {};
    if (model.hidden) {
      if (host._pageHeadingAutoHide) setScrollHidden(host, false);
      host.hidden = true;
      return host;
    }
    var active = document.activeElement;
    var focusedAction =
      active && host.contains(active) && active.getAttribute
        ? active.getAttribute('data-heading-action')
        : null;
    var parts = ensureStructure(host);
    var eyebrow = parts.copy.querySelector('.page-heading-eyebrow');
    var title = parts.copy.querySelector('.page-heading-title');
    var meta = parts.copy.querySelector('.page-heading-meta');
    setHtml(eyebrow, escapeValue(model.eyebrow || ''));
    eyebrow.hidden = !model.eyebrow;
    setHtml(title, titleMarkup(model));
    var metaHtml = metaMarkup(model);
    setHtml(meta, metaHtml);
    meta.hidden = !metaHtml;
    syncActions(parts.actions, (model.actions || []).map(normalizeAction));
    parts.actions.hidden = !parts.actions.children.length;
    host.setAttribute('data-heading-variant', model.variant || 'default');
    host.hidden = false;
    syncAutoHide(host);
    host._pageHeadingHandlers = handlers || {};
    if (!host._pageHeadingBound) {
      host.addEventListener('click', function (event) {
        var button =
          event.target && event.target.closest ? event.target.closest('[data-heading-action]') : null;
        if (!button || button.disabled || !host.contains(button)) return;
        var handler = host._pageHeadingHandlers[button.getAttribute('data-heading-action')];
        if (typeof handler === 'function') handler(button, event);
      });
      host._pageHeadingBound = true;
    }
    if (focusedAction && !host.contains(document.activeElement)) {
      var target = parts.actions.querySelector('[data-heading-action="' + focusedAction + '"]');
      if (target && !target.disabled) target.focus({ preventScroll: true });
      else title.focus({ preventScroll: true });
    }
    return host;
  }

  function hide(host) {
    if (!host) return;
    if (host._pageHeadingAutoHide) setScrollHidden(host, false);
    host.hidden = true;
  }

  function focusAction(host, id) {
    var target = host && host.querySelector('[data-heading-action="' + id + '"]');
    if (target && !target.disabled && !target.hidden) {
      target.focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  app.pageHeading = Object.freeze({ render: render, hide: hide, focusAction: focusAction });
})(window);
