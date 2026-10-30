/**
 * TabletLayout: keeps the content surface usable between desktop and mobile.
 * Sidebars become a dismissible drawer while shared anchored details remain
 * transient overlays; desktop PanelLayout persistence remains unchanged.
 */
var TabletLayout = (function () {
  var SIDEBAR_BREAKPOINT = 1024;
  var moduleConfig = {
    vocab: { sidebarId: 'sidebar', buttonId: 'sidebarCollapseBtn', label: '词汇筛选' },
    grammar: { sidebarId: 'grammarSidebar', buttonId: 'grammarSidebarCollapseBtn', label: '语法筛选' },
    lesson: { sidebarId: 'textbookSidebar', buttonId: 'textbookSidebarCollapseBtn', label: '课文筛选' },
    classics: { sidebarId: 'classicsSidebar', buttonId: 'classicsSidebarCollapseBtn', label: '古典目录' },
  };
  var activeModule = '';
  var initialized = false;
  var toggle = null;
  var backdrop = null;

  function isTablet() {
    var width =
      window.AppDisplayScale && window.AppDisplayScale.getLayoutWidth
        ? window.AppDisplayScale.getLayoutWidth()
        : window.innerWidth;
    return width <= SIDEBAR_BREAKPOINT;
  }

  function getActiveModule() {
    var button = document.querySelector('.mod-btn[aria-current="page"]');
    var module = button ? button.getAttribute('data-module') : '';
    return moduleConfig[module] ? module : '';
  }

  function getSidebar(module) {
    var config = moduleConfig[module];
    return config ? document.getElementById(config.sidebarId) : null;
  }

  function setToggleState(module, open) {
    if (!toggle) return;
    var config = moduleConfig[module];
    if (!config || !isTablet()) {
      toggle.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.removeAttribute('aria-controls');
      toggle.setAttribute('aria-label', '打开筛选侧栏');
      toggle.title = '打开筛选侧栏';
      return;
    }
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-controls', config.sidebarId);
    var label = open ? '关闭' + config.label : '打开' + config.label;
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    var text = toggle.querySelector('span');
    if (text) text.textContent = open ? '关闭' : '筛选';
  }

  function setBackdrop(open) {
    if (!backdrop) return;
    backdrop.hidden = !open;
    backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function close(module, restoreFocus) {
    var panel = getSidebar(module || activeModule);
    if (panel) panel.classList.remove('tablet-drawer-open');
    setBackdrop(false);
    setToggleState(activeModule, false);
    if (window.JPLearn.topLayer) window.JPLearn.topLayer.release('tablet-sidebar');
    if (restoreFocus && toggle && !toggle.hidden) {
      window.setTimeout(function () {
        toggle.focus();
      }, 0);
    }
  }

  function open(module) {
    if (!isTablet()) return;
    var name = module || activeModule;
    var panel = getSidebar(name);
    if (!panel) return;
    if (window.JPLearn.topLayer) window.JPLearn.topLayer.requestOpen('tablet-sidebar');
    panel.classList.remove('sidebar-collapsed');
    panel.classList.add('tablet-drawer-open');
    setBackdrop(true);
    setToggleState(name, true);
    var closeButton = document.getElementById(moduleConfig[name].buttonId);
    if (closeButton) {
      window.setTimeout(function () {
        closeButton.focus();
      }, 0);
    }
  }

  function syncActive() {
    var next = getActiveModule();
    if (next !== activeModule) {
      if (activeModule) close(activeModule, false);
      activeModule = next;
    }
    var panel = getSidebar(activeModule);
    var isOpen = !!(panel && panel.classList.contains('tablet-drawer-open'));
    if (!isTablet()) {
      if (panel) panel.classList.remove('tablet-drawer-open');
      setBackdrop(false);
      isOpen = false;
    }
    setToggleState(activeModule, isOpen);
  }

  function bind() {
    toggle = document.getElementById('tabletSidebarToggle');
    backdrop = document.getElementById('tabletSidebarBackdrop');
    if (!toggle || !backdrop) return;

    if (window.JPLearn.topLayer) {
      window.JPLearn.topLayer.register('tablet-sidebar', {
        close: function (restoreFocus) {
          close(activeModule, restoreFocus);
        },
      });
    }

    toggle.addEventListener('click', function () {
      var panel = getSidebar(activeModule);
      if (panel && panel.classList.contains('tablet-drawer-open')) close(activeModule, false);
      else open(activeModule);
    });
    backdrop.addEventListener('click', function () {
      close(activeModule, true);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var panel = getSidebar(activeModule);
      if (!panel || !panel.classList.contains('tablet-drawer-open')) return;
      event.preventDefault();
      close(activeModule, true);
    });

    Object.keys(moduleConfig).forEach(function (module) {
      var button = document.getElementById(moduleConfig[module].buttonId);
      if (!button) return;
      button.addEventListener('click', function () {
        window.setTimeout(function () {
          var panel = getSidebar(module);
          if (isTablet() && panel && panel.classList.contains('sidebar-collapsed')) {
            close(module, true);
          }
        }, 0);
      });
    });

    var moduleSwitcher = document.getElementById('moduleSwitcher');
    if (moduleSwitcher && window.MutationObserver) {
      var observer = new MutationObserver(function () {
        syncActive();
      });
      observer.observe(moduleSwitcher, {
        attributes: true,
        subtree: true,
        attributeFilter: ['aria-current'],
      });
    }
    window.addEventListener('resize', syncActive);
    window.addEventListener('app:layout-viewport-change', syncActive);
    syncActive();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    bind();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    init: init,
    open: open,
    close: close,
    sync: syncActive,
    isTablet: isTablet,
  };
})();
