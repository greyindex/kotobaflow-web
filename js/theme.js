(function () {
  'use strict';

  var STORAGE_KEY = 'jp_learning_theme';
  // UI-ART-25: without a saved choice the page follows the system's light/dark setting.
  var DEFAULT_MODE = 'auto';
  var allowedModes = { light: true, dark: true, auto: true };
  var labels = { light: '浅色', dark: '深色', auto: '跟随系统' };
  var root = document.documentElement;
  var currentMode = DEFAULT_MODE;
  var currentTheme = 'light';
  var mediaQuery = null;

  function readMode() {
    var mode = DEFAULT_MODE;
    try {
      mode = localStorage.getItem(STORAGE_KEY) || DEFAULT_MODE;
    } catch (err) {}
    return allowedModes[mode] ? mode : DEFAULT_MODE;
  }

  function getMediaQuery() {
    if (mediaQuery || !window.matchMedia) return mediaQuery;
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    return mediaQuery;
  }

  function resolveTheme(mode) {
    if (mode === 'auto') {
      var query = getMediaQuery();
      return query && query.matches ? 'dark' : 'light';
    }
    return mode === 'dark' ? 'dark' : 'light';
  }

  function updateControl(mode, theme) {
    var select = document.getElementById('appThemeSelect');
    if (!select) return;
    select.value = mode;
    select.title = '当前配色：' + labels[theme] + (mode === 'auto' ? '（跟随系统）' : '');
    select.setAttribute('aria-label', '配色主题，当前 ' + labels[theme]);
    var control = select.closest('.app-theme-control');
    if (control) control.setAttribute('data-applied-theme', labels[theme]);
  }

  function apply(mode) {
    mode = allowedModes[mode] ? mode : DEFAULT_MODE;
    currentMode = mode;
    currentTheme = resolveTheme(mode);
    root.setAttribute('data-theme-mode', currentMode);
    root.setAttribute('data-theme', currentTheme);
    root.style.colorScheme = currentTheme;
    updateControl(currentMode, currentTheme);
    window.dispatchEvent(
      new CustomEvent('app:theme-change', { detail: { mode: currentMode, theme: currentTheme } }),
    );
    return currentTheme;
  }

  function saveAndApply(mode) {
    mode = allowedModes[mode] ? mode : DEFAULT_MODE;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (err) {}
    return apply(mode);
  }

  function bindControl() {
    var select = document.getElementById('appThemeSelect');
    if (!select || select.getAttribute('data-theme-bound') === '1') return;
    select.setAttribute('data-theme-bound', '1');
    select.addEventListener('change', function () {
      saveAndApply(this.value);
    });
    updateControl(currentMode, currentTheme);
  }

  function bindMediaQuery() {
    var query = getMediaQuery();
    if (!query) return;
    var handler = function () {
      if (currentMode === 'auto') apply('auto');
    };
    if (query.addEventListener) query.addEventListener('change', handler);
    else if (query.addListener) query.addListener(handler);
  }

  apply(readMode());
  bindMediaQuery();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControl);
  else bindControl();

  window.addEventListener('storage', function (event) {
    if (event.key === STORAGE_KEY) apply(readMode());
  });

  window.AppTheme = {
    getMode: readMode,
    getTheme: function () {
      return currentTheme;
    },
    setMode: saveAndApply,
    refresh: function () {
      return apply(readMode());
    },
  };
})();
