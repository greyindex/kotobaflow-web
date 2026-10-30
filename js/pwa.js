/*
 * Small PWA coordinator for the product header. The service worker owns cache
 * policy; this file only reports availability and handles the install prompt.
 */
(function () {
  'use strict';

  var WORKER_VERSION = '20261031-apk-download-1';
  var WORKER_URL = './sw.js?v=' + WORKER_VERSION;

  var state = {
    supported: !!(navigator.serviceWorker && window.isSecureContext !== false),
    registered: false,
    ready: false,
    online: navigator.onLine !== false,
    canInstall: false,
    installed: false,
    error: false,
    updateAvailable: false,
  };
  var deferredPrompt = null;
  var registration = null;
  var observedRegistrations = new WeakSet();

  function getStatusElements() {
    return {
      root: document.getElementById('appPwaStatus'),
      text: document.getElementById('appPwaStatusText'),
      install: document.getElementById('appPwaInstallBtn'),
    };
  }

  function statusText() {
    var localApi = window.ProgressStore && window.ProgressStore.getStorageMode() === 'local-api';
    if (!state.supported) return '当前环境不支持离线安装，但网页仍可正常使用';
    if (state.online === false) {
      if (!state.ready) return '当前离线：离线缓存尚未就绪，请联网后重试';
      return localApi
        ? '当前离线：已缓存内容仍可用，本机存档服务恢复后重试'
        : '当前离线：已缓存内容仍可用，进度仅保存在此浏览器';
    }
    if (state.updateAvailable) return '更新已就绪：关闭本站全部窗口后重新打开';
    if (state.error) return state.ready ? '更新未完成，继续使用已缓存版本' : '离线缓存未就绪，联网后重试';
    if (!state.ready) return '正在准备离线缓存…';
    if (state.installed) return '已安装到设备，可离线使用';
    if (state.canInstall) return '可安装到设备，离线学习已就绪';
    if (state.ready)
      return localApi
        ? '应用壳已就绪，可离线使用已缓存内容；进度保存到本机'
        : '应用壳已就绪，可离线使用已缓存内容；进度仅保存在此浏览器';
    return '正在准备离线缓存…';
  }

  function stateName() {
    if (!state.supported) return 'unsupported';
    if (state.error) return 'error';
    if (state.online === false) return 'offline';
    if (state.installed) return 'installed';
    if (state.canInstall) return 'installable';
    return state.ready ? 'ready' : 'starting';
  }

  function render() {
    var els = getStatusElements();
    if (!els.root) return;
    els.root.dataset.pwaState = stateName();
    if (els.text) els.text.textContent = statusText();
    if (els.install) {
      els.install.hidden = !state.canInstall;
      els.install.disabled = !state.canInstall;
    }
  }

  function setOnline(online) {
    state.online = online;
    render();
  }

  function requestInstall() {
    if (!deferredPrompt) return Promise.resolve(false);
    var promptEvent = deferredPrompt;
    deferredPrompt = null;
    state.canInstall = false;
    render();
    try {
      var result = promptEvent.prompt();
      return Promise.resolve(result)
        .then(function () {
          return promptEvent.userChoice || null;
        })
        .then(function (choice) {
          if (choice && choice.outcome === 'dismissed') render();
          return !!(choice && choice.outcome === 'accepted');
        })
        .catch(function () {
          render();
          return false;
        });
    } catch (err) {
      render();
      return Promise.resolve(false);
    }
  }

  function bindDom() {
    var els = getStatusElements();
    if (els.install && els.install.getAttribute('data-pwa-bound') !== '1') {
      els.install.setAttribute('data-pwa-bound', '1');
      els.install.addEventListener('click', requestInstall);
    }
    render();
  }

  function observeRegistration(reg) {
    if (observedRegistrations.has(reg)) return;
    observedRegistrations.add(reg);
    function refresh() {
      state.ready = !!(
        reg.active && new URL(reg.active.scriptURL).searchParams.get('v') === WORKER_VERSION
      );
      state.updateAvailable = !!reg.waiting;
      render();
    }
    function watch() {
      var worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', function () {
        if (worker.state === 'redundant') state.error = true;
        if (worker.state === 'activated') state.error = false;
        refresh();
      });
    }
    reg.addEventListener('updatefound', watch);
    watch();
    refresh();
  }

  function registerWorker() {
    if (!state.supported) {
      render();
      return;
    }
    navigator.serviceWorker
      .register(WORKER_URL, { scope: './', updateViaCache: 'none' })
      .then(function (reg) {
        registration = reg;
        state.registered = true;
        observeRegistration(reg);
        render();
        return navigator.serviceWorker.ready;
      })
      .then(function () {
        state.ready = !!(
          registration.active &&
          new URL(registration.active.scriptURL).searchParams.get('v') === WORKER_VERSION
        );
        state.error = false;
        render();
        if (registration && registration.update) {
          registration.update().catch(function () {
            return null;
          });
        }
      })
      .catch(function () {
        state.error = true;
        render();
      });
  }

  window.addEventListener('online', function () {
    setOnline(true);
    registerWorker();
  });
  window.addEventListener('offline', function () {
    setOnline(false);
  });
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    state.canInstall = true;
    render();
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    state.canInstall = false;
    state.installed = true;
    render();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindDom();
      registerWorker();
    });
  } else {
    bindDom();
    registerWorker();
  }

  window.AppPWA = {
    getState: function () {
      return {
        supported: state.supported,
        registered: state.registered,
        ready: state.ready,
        online: state.online,
        canInstall: state.canInstall,
        installed: state.installed,
        error: state.error,
        updateAvailable: state.updateAvailable,
      };
    },
    requestInstall: requestInstall,
  };
})();
