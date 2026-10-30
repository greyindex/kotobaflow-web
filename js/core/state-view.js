(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  var DEFAULTS = {
    loading: { icon: 'library', title: '正在加载', message: '内容很快就会出现。' },
    empty: { icon: 'info', title: '这里还没有内容', message: '换一个条件或从推荐入口开始。' },
    error: { icon: 'info', title: '暂时无法显示', message: '请稍后重试，当前内容不会丢失。' },
    complete: { icon: 'check', title: '完成了', message: '这一步已经保存。' },
  };

  function escapeValue(value) {
    return app.html && app.html.escape ? app.html.escape(value) : String(value == null ? '' : value);
  }

  function renderIcon(name) {
    return typeof root.uiIcon === 'function' ? root.uiIcon(name || 'info') : '';
  }

  function normalizeOptions(options) {
    var input = options || {};
    var kind = DEFAULTS[input.kind] ? input.kind : 'empty';
    var defaults = DEFAULTS[kind];
    var action = input.action && input.action.label ? input.action : null;
    return {
      kind: kind,
      icon: input.icon || defaults.icon,
      title: input.title || defaults.title,
      message: input.message || defaults.message,
      details: input.details || '',
      action: action,
      compact: !!input.compact,
      className: input.className || '',
      labelledBy: input.labelledBy || '',
      skeleton: !!input.skeleton,
    };
  }

  function html(options) {
    var opts = normalizeOptions(options);
    var id = opts.labelledBy ? ' id="' + escapeValue(opts.labelledBy) + '"' : '';
    var role = opts.kind === 'error' ? 'alert' : 'status';
    var live = opts.kind === 'error' ? 'assertive' : 'polite';
    var classes = 'state-view state-view--' + opts.kind + (opts.compact ? ' state-view--compact' : '');
    if (opts.className) classes += ' ' + opts.className;
    if (opts.skeleton && opts.kind === 'loading') classes += ' state-view--paper-loading';
    var markup =
      '<section class="' +
      classes +
      '" data-state-kind="' +
      opts.kind +
      '" role="' +
      role +
      '" aria-live="' +
      live +
      '"' +
      (opts.kind === 'loading' ? ' aria-busy="true"' : '') +
      id +
      '>';
    if (opts.skeleton && opts.kind === 'loading') {
      markup +=
        '<div class="loading-paper" aria-hidden="true">' +
        '<div class="loading-paper-tools"><i></i><i></i><i></i><i></i></div>' +
        '<div class="loading-paper-spread"><div></div><div></div></div></div>';
    } else {
      markup += '<div class="state-view-icon" aria-hidden="true">' + renderIcon(opts.icon) + '</div>';
    }
    markup += '<div class="state-view-copy">';
    markup += '<h3 class="state-view-title">' + escapeValue(opts.title) + '</h3>';
    markup += '<p class="state-view-message">' + escapeValue(opts.message) + '</p>';
    if (opts.details) {
      markup +=
        '<details class="state-view-details"><summary>查看技术详情</summary><code>' +
        escapeValue(opts.details) +
        '</code></details>';
    }
    markup += '</div>';
    if (opts.action) {
      markup +=
        '<div class="state-view-actions"><button type="button" class="state-view-action ' +
        (opts.action.secondary ? 'state-view-action--secondary' : 'state-view-action--primary') +
        '" data-state-action="' +
        escapeValue(opts.action.id || 'primary') +
        '">' +
        (opts.action.icon ? renderIcon(opts.action.icon) : '') +
        escapeValue(opts.action.label) +
        '</button></div>';
    }
    markup += '</section>';
    return markup;
  }

  function mount(container, options) {
    if (!container) return null;
    var opts = normalizeOptions(options);
    container.innerHTML = html(opts);
    var actionButton = container.querySelector('[data-state-action]');
    if (actionButton && opts.action && typeof opts.action.onClick === 'function') {
      actionButton.addEventListener('click', function () {
        if (actionButton.disabled) return;
        actionButton.disabled = true;
        actionButton.setAttribute('aria-busy', 'true');
        actionButton.classList.add('is-busy');
        var result;
        try {
          result = opts.action.onClick();
        } catch (err) {
          result = Promise.reject(err);
        }
        Promise.resolve(result).catch(function (err) {
          if (root.console && console.error) console.error('[StateView] action failed:', err);
          if (!actionButton.isConnected) return;
          actionButton.disabled = false;
          actionButton.removeAttribute('aria-busy');
          actionButton.classList.remove('is-busy');
        });
      });
    }
    return container.querySelector('.state-view');
  }

  function setLoading(container, title, detail) {
    if (!container) return;
    var rootEl = container.querySelector('.state-view--loading');
    if (!rootEl) {
      mount(container, { kind: 'loading', title: title || '正在加载', message: detail || '请稍候…' });
      return;
    }
    var titleEl = rootEl.querySelector('.state-view-title');
    var messageEl = rootEl.querySelector('.state-view-message');
    if (title != null && titleEl) titleEl.textContent = title;
    if (detail != null && messageEl) messageEl.textContent = detail;
  }

  app.StateView = {
    html: html,
    mount: mount,
    setLoading: setLoading,
  };
  root.StateView = app.StateView;
})(window);
