/**
 * PanelLayout: persistent sidebar widths with transient drawers and details.
 * Legacy collapse/detail fields remain readable for storage compatibility;
 * refreshing always starts with the compact navigation rail.
 */
var PanelLayout = (function () {
  var STORAGE_KEY = 'jp_learning_panel_layout_v1';
  var COLLAPSE_KEY = 'jp_learning_status_bar_hidden';
  var MAIN_MIN_WIDTH = 520;
  var HANDLE_TOTAL_WIDTH = 10;
  var DEFAULTS = {
    sidebarWidth: 288,
    detailWidth: 320,
    sidebarCollapsed: true,
    detailCollapsed: true,
  };
  var modules = {
    vocab: {
      label: '词汇',
      sidebarId: 'sidebar',
      sidebarButtonId: 'sidebarCollapseBtn',
      sidebarHandleId: 'resizeSidebarVocab',
      detailId: 'detailPanel',
      detailButtonId: 'detailPanelCollapseBtn',
      detailHandleId: 'resizeHandleVocab',
    },
    grammar: {
      label: '语法',
      sidebarId: 'grammarSidebar',
      sidebarButtonId: 'grammarSidebarCollapseBtn',
      sidebarHandleId: 'resizeSidebarGrammar',
      detailId: 'grammarDetailPanel',
      detailButtonId: 'grammarDetailCollapseBtn',
      detailHandleId: 'resizeHandleGrammar',
    },
    lesson: {
      label: '课文',
      sidebarId: 'textbookSidebar',
      sidebarButtonId: 'textbookSidebarCollapseBtn',
      sidebarHandleId: 'resizeSidebarTextbook',
      detailId: 'textbookDetailPanel',
      detailButtonId: 'textbookDetailCollapseBtn',
      detailHandleId: 'resizeHandleTextbook',
    },
    // Local copies only (CLASSICS-01); the classics have no detail panel.
    classics: {
      label: '古典',
      sidebarId: 'classicsSidebar',
      sidebarButtonId: 'classicsSidebarCollapseBtn',
      sidebarHandleId: 'resizeSidebarClassics',
    },
  };
  var state = {};
  var unifiedCollapsed = true;
  var narrowGlobalOpen = false;
  var narrowBackdrop = null;
  var drawerReturnFocus = null;
  var readingFocus = null;
  var initialized = false;

  function isNarrowLayout() {
    if (window.AppDisplayScale && window.AppDisplayScale.getLayoutWidth) {
      return window.AppDisplayScale.getLayoutWidth() <= 1024;
    }
    return document.documentElement.getAttribute('data-layout-viewport') !== 'desktop';
  }

  function getActiveModule() {
    var button = document.querySelector('.mod-btn[aria-current="page"]');
    var name = button ? button.getAttribute('data-module') : '';
    return modules[name] ? name : '';
  }

  function updateCollapseControl(collapsed) {
    var button = document.getElementById('statusBarShowBtn');
    if (!button) return;
    var expanded = !collapsed;
    var label = expanded ? '关闭左侧栏' : '展开左侧栏';
    // Closing a detail on pointerdown may refresh layout before this click.
    // Keep the trigger's children intact unless its actual state changed.
    if (button.getAttribute('aria-expanded') !== String(expanded)) {
      button.innerHTML = uiIcon(expanded ? 'chevron-left' : 'chevron-right') + '<span>' + label + '</span>';
    }
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.setAttribute('aria-controls', 'unifiedSidebar');
  }

  function syncNarrowGlobal() {
    document.body.classList.toggle('narrow-global-sidebar-open', narrowGlobalOpen);
    var content = document.querySelector('.app-container');
    if (content) content.inert = narrowGlobalOpen;
    var shell = document.getElementById('unifiedSidebar');
    if (shell) {
      if (narrowGlobalOpen) {
        shell.setAttribute('role', 'dialog');
        shell.setAttribute('aria-modal', 'true');
      } else {
        shell.removeAttribute('role');
        shell.removeAttribute('aria-modal');
      }
    }
    if (narrowBackdrop) {
      narrowBackdrop.hidden = !narrowGlobalOpen;
      narrowBackdrop.setAttribute('aria-hidden', narrowGlobalOpen ? 'false' : 'true');
    }
  }

  function syncUnifiedShell() {
    var active = getActiveModule();
    if (readingFocus && readingFocus.module !== active) setReadingFocus(false, false);
    var focusEntry = document.getElementById('readingFocusEnter');
    if (focusEntry) focusEntry.hidden = !active;
    var record = active && state[active];
    var width = DEFAULTS.sidebarWidth;
    if (record) {
      width = record.sidebarWidth;
    }
    document.body.style.setProperty('--unified-sidebar-width', Math.round(width) + 'px');
    document.body.classList.toggle('status-bar-collapsed', unifiedCollapsed);
    syncNarrowGlobal();
    document.body.setAttribute('data-unified-sidebar-module', active || 'dashboard');
    updateCollapseControl(unifiedCollapsed);
    var host = document.getElementById('unifiedModuleSidebarHost');
    if (host) host.setAttribute('aria-hidden', active ? 'false' : 'true');
  }

  function setReadingFocus(enabled, restoreFocus) {
    var active = getActiveModule();
    if (!!readingFocus === !!enabled || (enabled && !active)) return false;
    var previous = readingFocus;
    if (enabled) {
      var sidebar = document.getElementById(modules[active].sidebarId);
      readingFocus = {
        module: active,
        narrowOpen: narrowGlobalOpen,
        tabletOpen: !!(sidebar && sidebar.classList.contains('tablet-drawer-open')),
      };
      if (window.JPLearn.topLayer) window.JPLearn.topLayer.close(null, false);
      setNarrowGlobalOpen(false, false);
      if (window.TabletLayout) window.TabletLayout.close(active, false);
    } else {
      readingFocus = null;
    }
    document.documentElement.classList.toggle('reading-focus', !!enabled);
    var bar = document.getElementById('readingFocusBar');
    if (bar) bar.hidden = !enabled;
    if (enabled) {
      var location = document.getElementById('readingFocusLocation');
      if (location) location.textContent = modules[active].label + ' · 专注阅读';
      var exit = document.getElementById('readingFocusExit');
      if (exit) exit.focus({ preventScroll: true });
    } else if (restoreFocus !== false && previous.module === active) {
      if (previous.tabletOpen && isNarrowLayout() && window.TabletLayout) {
        window.TabletLayout.open(active);
      } else {
        if (previous.narrowOpen) setNarrowGlobalOpen(true, false);
        var settings = document.getElementById('appSettingsToggle');
        if (settings) settings.focus({ preventScroll: true });
      }
    }
    if (window.JPLearn.anchoredDetail) window.JPLearn.anchoredDetail.reposition();
    return true;
  }

  function setNarrowGlobalOpen(open, restoreFocus) {
    if (open && readingFocus) return false;
    // The navigation drawer stays open underneath settings and other popovers.
    // Explicitly opening/closing the drawer dismisses its temporary child layer.
    if (narrowGlobalOpen !== !!open && window.JPLearn.topLayer) {
      window.JPLearn.topLayer.close(null, false);
    }
    var returnTarget = drawerReturnFocus;
    drawerReturnFocus = null;
    narrowGlobalOpen = !!open;
    unifiedCollapsed = !narrowGlobalOpen;
    Object.keys(modules).forEach(function (name) {
      if (state[name]) state[name].sidebarCollapsed = unifiedCollapsed;
    });
    applyAll();
    syncUnifiedShell();
    if (narrowGlobalOpen) {
      document.getElementById('statusBarShowBtn').focus({ preventScroll: true });
    }
    if (!narrowGlobalOpen && restoreFocus) {
      var button =
        returnTarget &&
        returnTarget.isConnected &&
        returnTarget.getClientRects().length &&
        !returnTarget.disabled
          ? returnTarget
          : document.getElementById('statusBarShowBtn');
      if (button)
        window.setTimeout(function () {
          button.focus();
        }, 0);
    }
    return true;
  }

  function toggleNarrowGlobal() {
    return setNarrowGlobalOpen(!narrowGlobalOpen, false);
  }

  // In-page context controls open the same drawer; it remains the only home of
  // module tools. The caller picks the first tool to focus and the control that
  // receives focus again when the drawer is dismissed.
  function openTools(options) {
    options = options || {};
    if (readingFocus || !getActiveModule()) return false;
    if (!narrowGlobalOpen && !setNarrowGlobalOpen(true, false)) return false;
    drawerReturnFocus =
      options.returnFocus && options.returnFocus.nodeType === 1 ? options.returnFocus : null;
    var target =
      typeof options.focus === 'function'
        ? options.focus()
        : options.focus
          ? document.querySelector(options.focus)
          : null;
    if (target && target.getClientRects().length) target.focus();
    return true;
  }

  function mountUnifiedSidebars() {
    var host = document.getElementById('unifiedModuleSidebarHost');
    if (!host) return;
    Object.keys(modules).forEach(function (name) {
      var sidebar = document.getElementById(modules[name].sidebarId);
      if (sidebar && sidebar.parentElement !== host) host.appendChild(sidebar);
      var handle = document.getElementById(modules[name].sidebarHandleId);
      var footer = document.getElementById('statusBarRevealControls');
      if (handle && footer) footer.parentElement.insertBefore(handle, footer);
    });
  }

  function copyDefaults() {
    return {
      sidebarWidth: DEFAULTS.sidebarWidth,
      detailWidth: DEFAULTS.detailWidth,
      sidebarCollapsed: DEFAULTS.sidebarCollapsed,
      detailCollapsed: DEFAULTS.detailCollapsed,
    };
  }

  function normalizeRecord(record) {
    var next = copyDefaults();
    if (!record || typeof record !== 'object') return next;
    if (isFinite(record.sidebarWidth)) next.sidebarWidth = clamp(Number(record.sidebarWidth), 220, 380);
    if (isFinite(record.detailWidth)) next.detailWidth = clamp(Number(record.detailWidth), 260, 520);
    if (typeof record.sidebarCollapsed === 'boolean') next.sidebarCollapsed = record.sidebarCollapsed;
    next.detailCollapsed = true;
    return next;
  }

  function load() {
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (err) {
      saved = null;
    }
    Object.keys(modules).forEach(function (name) {
      state[name] = normalizeRecord(saved && saved[name]);
    });
    // A drawer is transient: even an old expanded preference starts as the rail.
    unifiedCollapsed = true;
    Object.keys(modules).forEach(function (name) {
      state[name].sidebarCollapsed = unifiedCollapsed;
    });
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(COLLAPSE_KEY, '1');
    } catch (err) {}
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getElements(name) {
    var config = modules[name];
    if (!config) return null;
    return {
      config: config,
      sidebar: document.getElementById(config.sidebarId),
      sidebarButton: document.getElementById(config.sidebarButtonId),
      sidebarHandle: document.getElementById(config.sidebarHandleId),
      detail: document.getElementById(config.detailId),
      detailButton: document.getElementById(config.detailButtonId),
      detailHandle: document.getElementById(config.detailHandleId),
    };
  }

  function getWidthBounds(name, side) {
    var record = state[name];
    var otherWidth;
    var appContainer = document.querySelector('.app-container');
    var availableWidth =
      appContainer && appContainer.clientWidth ? appContainer.clientWidth : window.innerWidth;
    if (side === 'sidebar') {
      otherWidth = 0;
      return {
        min: 220,
        max: Math.max(220, Math.min(380, availableWidth - otherWidth - MAIN_MIN_WIDTH - HANDLE_TOTAL_WIDTH)),
      };
    }
    otherWidth = unifiedCollapsed ? 44 : Math.min(record.sidebarWidth, 380);
    return {
      min: 260,
      max: Math.max(260, Math.min(520, availableWidth - otherWidth - MAIN_MIN_WIDTH - HANDLE_TOTAL_WIDTH)),
    };
  }

  function setButtonState(button, expanded, label, side) {
    if (!button) return;
    var isSidebar = side === 'sidebar';
    var action = isSidebar ? (expanded ? '折叠' : '展开') : expanded ? '关闭' : '打开';
    var target = isSidebar ? label + '侧栏' : label + '详情';
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.title = action + target;
    button.setAttribute('aria-label', action + target);
    button.innerHTML = uiIcon(
      isSidebar ? (expanded ? 'chevron-left' : 'chevron-right') : expanded ? 'x' : 'info',
    );
  }

  function setHandleState(handle, collapsed, value, bounds) {
    if (!handle) return;
    handle.classList.toggle('is-disabled', collapsed);
    handle.setAttribute('aria-disabled', collapsed ? 'true' : 'false');
    handle.setAttribute('aria-valuemin', String(bounds.min));
    handle.setAttribute('aria-valuemax', String(bounds.max));
    handle.setAttribute('aria-valuenow', String(Math.round(value)));
    handle.tabIndex = collapsed ? -1 : 0;
  }

  function apply(name) {
    var record = state[name];
    var elements = getElements(name);
    if (!record || !elements || !elements.sidebar) return;
    var sidebarBounds = getWidthBounds(name, 'sidebar');
    var detailBounds = getWidthBounds(name, 'detail');
    var sidebarWidth = clamp(record.sidebarWidth, sidebarBounds.min, sidebarBounds.max);
    var detailWidth = clamp(record.detailWidth, detailBounds.min, detailBounds.max);

    elements.sidebar.style.width = '100%';
    elements.sidebar.classList.toggle('sidebar-collapsed', unifiedCollapsed);
    if (elements.detail) {
      elements.detail.style.width = detailWidth + 'px';
      elements.detail.classList.toggle('detail-panel-collapsed', record.detailCollapsed);
      elements.detail.setAttribute('aria-hidden', record.detailCollapsed ? 'true' : 'false');
    }
    setButtonState(elements.sidebarButton, !unifiedCollapsed, elements.config.label, 'sidebar');
    setButtonState(elements.detailButton, !record.detailCollapsed, elements.config.label, 'detail');
    setHandleState(elements.sidebarHandle, unifiedCollapsed, sidebarWidth, sidebarBounds);
    setHandleState(elements.detailHandle, record.detailCollapsed, detailWidth, detailBounds);
    if (getActiveModule() === name) syncUnifiedShell();
  }

  function applyAll() {
    Object.keys(modules).forEach(apply);
  }

  function setCollapsed(name, side, collapsed, persist) {
    if (!state[name]) return;
    if (side === 'sidebar') {
      setUnifiedCollapsed(collapsed, persist);
      return;
    }
    var key = side === 'sidebar' ? 'sidebarCollapsed' : 'detailCollapsed';
    state[name][key] = !!collapsed;
    apply(name);
    if (side === 'detail') persist = false;
    if (persist !== false) save();
  }

  function toggle(name, side) {
    if (!state[name]) return;
    if (side === 'sidebar') {
      setUnifiedCollapsed(!unifiedCollapsed);
      return;
    }
    var key = side === 'sidebar' ? 'sidebarCollapsed' : 'detailCollapsed';
    setCollapsed(name, side, !state[name][key]);
  }

  function reset(name) {
    if (!modules[name]) return;
    if (window.JPLearn.anchoredDetail && window.JPLearn.anchoredDetail.isOpen(name)) {
      window.JPLearn.anchoredDetail.close(name, false);
    }
    state[name] = copyDefaults();
    state[name].sidebarCollapsed = unifiedCollapsed;
    apply(name);
    save();
  }

  function updateWidth(name, side, width, persist) {
    if (!state[name]) return;
    var key = side === 'sidebar' ? 'sidebarWidth' : 'detailWidth';
    var bounds = getWidthBounds(name, side);
    state[name][key] = clamp(Math.round(width), bounds.min, bounds.max);
    apply(name);
    if (persist !== false) save();
  }

  function setUnifiedCollapsed(collapsed, persist) {
    setNarrowGlobalOpen(!collapsed, !!collapsed);
    if (persist !== false) save();
  }

  function setupResize(name, side, handle) {
    if (!handle) return;
    var panel = document.getElementById(
      side === 'sidebar' ? modules[name].sidebarId : modules[name].detailId,
    );
    if (!panel) return;

    handle.addEventListener('mousedown', function (event) {
      var collapsedKey = side === 'sidebar' ? 'sidebarCollapsed' : 'detailCollapsed';
      if (state[name][collapsedKey]) return;
      event.preventDefault();
      var startX = event.clientX;
      var scale =
        window.AppDisplayScale && window.AppDisplayScale.getScale
          ? window.AppDisplayScale.getScale() || 1
          : 1;
      // Pointer coordinates are scaled; stored widths use layout pixels. Measure
      // the outer shell so its border is not lost on every sidebar drag.
      var resizePanel = side === 'sidebar' ? document.getElementById('unifiedSidebar') : panel;
      var startWidth = (resizePanel || panel).getBoundingClientRect().width / scale;
      handle.classList.add('dragging');
      panel.classList.add('resizing');
      document.body.classList.add('panel-resize-active');

      function onMove(moveEvent) {
        var delta = side === 'sidebar' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
        updateWidth(name, side, startWidth + delta / scale, false);
      }

      function onUp() {
        handle.classList.remove('dragging');
        panel.classList.remove('resizing');
        document.body.classList.remove('panel-resize-active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        save();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    handle.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      var collapsedKey = side === 'sidebar' ? 'sidebarCollapsed' : 'detailCollapsed';
      if (state[name][collapsedKey]) return;
      event.preventDefault();
      var key = side === 'sidebar' ? 'sidebarWidth' : 'detailWidth';
      var direction = event.key === 'ArrowRight' ? 1 : -1;
      if (side === 'detail') direction *= -1;
      updateWidth(name, side, state[name][key] + direction * (event.shiftKey ? 24 : 8));
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    narrowBackdrop = document.getElementById('narrowGlobalSidebarBackdrop');
    if (narrowBackdrop) {
      narrowBackdrop.addEventListener('click', function () {
        setNarrowGlobalOpen(false, true);
      });
    }
    document.addEventListener(
      'keydown',
      function (event) {
        if (!narrowGlobalOpen || event.defaultPrevented) return;
        // A child surface owns Escape/Tab until it closes; the next Escape
        // dismisses the drawer and restores the original trigger's focus.
        if (window.JPLearn.topLayer && window.JPLearn.topLayer.getCurrent()) return;
        if (document.querySelector('dialog[open]')) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setNarrowGlobalOpen(false, true);
        } else if (event.key === 'Tab') {
          var controls = Array.from(
            document
              .getElementById('unifiedSidebar')
              .querySelectorAll(
                'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]',
              ),
          ).filter(function (el) {
            return el.getClientRects().length && !el.closest('[hidden]');
          });
          var first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      },
      true,
    );
    mountUnifiedSidebars();
    load();
    var focusEntry = document.getElementById('readingFocusEnter');
    var focusExit = document.getElementById('readingFocusExit');
    if (focusEntry)
      focusEntry.addEventListener('click', function () {
        setReadingFocus(true);
      });
    if (focusExit)
      focusExit.addEventListener('click', function () {
        setReadingFocus(false);
      });
    document.addEventListener(
      'keydown',
      function (event) {
        if (!readingFocus || event.key !== 'Escape' || event.defaultPrevented) return;
        if (window.JPLearn.topLayer && window.JPLearn.topLayer.getCurrent()) return;
        if (document.querySelector('dialog[open]')) return;
        event.preventDefault();
        event.stopPropagation();
        setReadingFocus(false);
      },
      true,
    );
    Object.keys(modules).forEach(function (name) {
      var elements = getElements(name);
      if (!elements) return;
      if (elements.sidebarButton) {
        elements.sidebarButton.addEventListener('click', function () {
          if (elements.sidebar.classList.contains('tablet-drawer-open') && window.TabletLayout) {
            window.TabletLayout.close(name, true);
          } else {
            toggle(name, 'sidebar');
          }
        });
      }
      if (elements.detailButton) {
        elements.detailButton.addEventListener('click', function () {
          if (window.JPLearn.anchoredDetail && window.JPLearn.anchoredDetail.isOpen(name)) {
            window.JPLearn.anchoredDetail.close(name, true);
          } else {
            setCollapsed(name, 'detail', true, false);
          }
        });
      }
      setupResize(name, 'sidebar', elements.sidebarHandle);
    });
    var resetButtons = document.querySelectorAll('[data-panel-reset]');
    for (var i = 0; i < resetButtons.length; i++) {
      resetButtons[i].addEventListener('click', function () {
        reset(this.getAttribute('data-panel-reset'));
      });
    }
    window.addEventListener('resize', function () {
      applyAll();
      syncUnifiedShell();
    });
    window.addEventListener('app:layout-viewport-change', function () {
      applyAll();
      syncUnifiedShell();
    });
    applyAll();
    var moduleSwitcher = document.getElementById('moduleSwitcher');
    if (moduleSwitcher && window.MutationObserver) {
      var observer = new MutationObserver(function () {
        syncUnifiedShell();
      });
      observer.observe(moduleSwitcher, {
        attributes: true,
        subtree: true,
        attributeFilter: ['aria-current'],
      });
    }
    syncUnifiedShell();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    init: init,
    reset: reset,
    refresh: applyAll,
    syncUnified: syncUnifiedShell,
    setCollapsed: setCollapsed,
    setUnifiedCollapsed: setUnifiedCollapsed,
    setReadingFocus: setReadingFocus,
    isReadingFocus: function () {
      return !!readingFocus;
    },
    toggleNarrowGlobal: toggleNarrowGlobal,
    setNarrowGlobalOpen: setNarrowGlobalOpen,
    openTools: openTools,
    isNarrowGlobalOpen: function () {
      return narrowGlobalOpen;
    },
    isUnifiedCollapsed: function () {
      return unifiedCollapsed;
    },
    expandDetail: function (name, anchor, options) {
      setCollapsed(name, 'detail', false, false);
      if (window.JPLearn.anchoredDetail) window.JPLearn.anchoredDetail.open(name, anchor, options);
    },
    collapseDetail: function (name, restoreFocus) {
      if (window.JPLearn.anchoredDetail && window.JPLearn.anchoredDetail.isOpen(name)) {
        window.JPLearn.anchoredDetail.close(name, restoreFocus !== false);
      } else {
        setCollapsed(name, 'detail', true, false);
      }
    },
    getState: function (name) {
      return state[name]
        ? {
            sidebarWidth: state[name].sidebarWidth,
            detailWidth: state[name].detailWidth,
            sidebarCollapsed: unifiedCollapsed,
            detailCollapsed: state[name].detailCollapsed,
          }
        : null;
    },
  };
})();
