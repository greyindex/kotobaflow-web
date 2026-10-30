(function () {
  'use strict';

  var STORAGE_KEY = 'jp_learning_display_density';
  var DEFAULT_MODE = 'comfortable';
  var allowedModes = { comfortable: true, compact: true };
  var root = document.documentElement;

  function readMode() {
    var mode = DEFAULT_MODE;
    try {
      mode = localStorage.getItem(STORAGE_KEY) || DEFAULT_MODE;
    } catch (err) {}
    return allowedModes[mode] ? mode : DEFAULT_MODE;
  }

  function updateControl(mode) {
    var select = document.getElementById('appDensitySelect');
    if (!select) return;
    select.value = mode;
    select.title = mode === 'compact' ? '当前布局密度：紧凑' : '当前布局密度：舒适';
    select.setAttribute('aria-label', '布局密度，当前 ' + (mode === 'compact' ? '紧凑' : '舒适'));
  }

  function apply(mode) {
    mode = allowedModes[mode] ? mode : DEFAULT_MODE;
    root.setAttribute('data-density', mode);
    updateControl(mode);
    return mode;
  }

  function saveAndApply(mode) {
    mode = allowedModes[mode] ? mode : DEFAULT_MODE;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (err) {}
    return apply(mode);
  }

  function bindControl() {
    var select = document.getElementById('appDensitySelect');
    if (!select || select.getAttribute('data-density-bound') === '1') return;
    select.setAttribute('data-density-bound', '1');
    select.addEventListener('change', function () {
      saveAndApply(this.value);
    });
    updateControl(readMode());
  }

  apply(readMode());

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControl);
  else bindControl();

  window.AppDisplayDensity = {
    getMode: readMode,
    setMode: saveAndApply,
    refresh: function () {
      return apply(readMode());
    },
  };
})();
