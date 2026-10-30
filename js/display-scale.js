(function () {
  'use strict';

  var STORAGE_KEY = 'jp_learning_display_scale';
  var AUTO = 'auto';
  var allowedModes = { auto: true, 1: true, 1.25: true, 1.5: true };
  var root = document.documentElement;
  var currentScale = 1;
  var resizeTimer = null;
  var responsiveWidths = [1400, 1300, 1200, 1024, 900, 760, 700, 640, 600];
  var COMPACT_HEIGHT = 600;
  // FIX-25: a chosen zoom never leaves the layout narrower than 320 CSS px, the
  // width WCAG reflow is measured at; on a 390px phone 150% applies as 121%.
  var MIN_LAYOUT_WIDTH = 320;

  function readMode() {
    var mode = AUTO;
    try {
      mode = localStorage.getItem(STORAGE_KEY) || AUTO;
    } catch (err) {}
    return allowedModes[mode] ? mode : AUTO;
  }

  function isFourKAtWindows150DefaultZoom() {
    var dpr = window.devicePixelRatio || 1;
    var screenWidth = Number(window.screen && window.screen.width) || 0;
    var screenHeight = Number(window.screen && window.screen.height) || 0;
    var physicalLongSide = Math.max(screenWidth, screenHeight) * dpr;
    var physicalShortSide = Math.min(screenWidth, screenHeight) * dpr;
    var isFourK = physicalLongSide >= 3200 && physicalShortSide >= 1800;
    var isWindows150Range = dpr >= 1.35 && dpr <= 1.75;
    return isFourK && isWindows150Range;
  }

  function resolveScale(mode) {
    var parsed = mode === AUTO ? (isFourKAtWindows150DefaultZoom() ? 1.5 : 1) : parseFloat(mode);
    var chosen = isFinite(parsed) && parsed > 0 ? parsed : 1;
    return Math.max(1, Math.min(chosen, Math.floor((window.innerWidth / MIN_LAYOUT_WIDTH) * 100) / 100));
  }

  function updateControl(mode, scale) {
    var select = document.getElementById('appScaleSelect');
    if (!select) return;
    select.value = mode;
    var percent = Math.round(scale * 100) + '%';
    select.title = '当前页面缩放：' + percent;
    select.setAttribute('aria-label', '页面缩放，当前 ' + percent);
    var control = select.closest('.app-scale-control');
    if (control) control.setAttribute('data-applied-scale', percent);
    // Say so in the choice itself when a narrow window holds the zoom back.
    for (var i = 0; i < select.options.length; i++) {
      var option = select.options[i];
      if (!option.hasAttribute('data-label')) option.setAttribute('data-label', option.textContent);
      var label = option.getAttribute('data-label');
      var held = option.value === mode && mode !== AUTO && Math.abs(parseFloat(mode) - scale) > 0.001;
      option.textContent = held ? label + ' → ' + percent : label;
      if (held) select.title += '（窄屏保持至少 ' + MIN_LAYOUT_WIDTH + 'px 版面）';
    }
  }

  function getLayoutWidth(scale) {
    return window.innerWidth / (scale || currentScale || 1);
  }

  function getLayoutHeight(scale) {
    var visualHeight = window.visualViewport && Number(window.visualViewport.height);
    var height = isFinite(visualHeight) && visualHeight > 0 ? visualHeight : window.innerHeight;
    return height / (scale || currentScale || 1);
  }

  function getBrowserChromeBottomGap(scale) {
    var viewport = window.visualViewport;
    if (!viewport) return 0;
    var viewportHeight = Number(viewport.height);
    var viewportTop = Number(viewport.offsetTop);
    if (!isFinite(viewportHeight) || viewportHeight <= 0) return 0;
    if (!isFinite(viewportTop) || viewportTop < 0) viewportTop = 0;
    return Math.max(0, window.innerHeight - viewportTop - viewportHeight) / (scale || currentScale || 1);
  }

  function updateLayoutViewport(scale) {
    var width = getLayoutWidth(scale);
    var height = getLayoutHeight(scale);
    var viewport = width <= 600 ? 'phone' : width <= 1024 ? 'tablet' : 'desktop';
    root.setAttribute('data-layout-viewport', viewport);
    root.setAttribute('data-layout-height', height <= COMPACT_HEIGHT ? 'compact' : 'regular');
    root.style.setProperty('--layout-viewport-width', width + 'px');
    root.style.setProperty('--layout-viewport-height', height + 'px');
    root.style.setProperty('--browser-chrome-bottom-gap', getBrowserChromeBottomGap(scale) + 'px');
    responsiveWidths.forEach(function (breakpoint) {
      root.classList.toggle('layout-max-' + breakpoint, width <= breakpoint);
    });
    root.classList.toggle('layout-height-compact', height <= COMPACT_HEIGHT);
    return { width: width, height: height, viewport: viewport };
  }

  function apply(mode) {
    var scale = resolveScale(mode);
    var layout;
    currentScale = scale;
    root.style.setProperty('--app-scale', String(scale));
    root.style.zoom = String(scale);
    root.setAttribute('data-app-scale', String(scale));
    root.setAttribute('data-app-scale-mode', mode);
    layout = updateLayoutViewport(scale);
    updateControl(mode, scale);
    if (typeof window.CustomEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('app:layout-viewport-change', {
          detail: {
            scale: scale,
            width: layout.width,
            height: layout.height,
            viewport: layout.viewport,
          },
        }),
      );
    }
    return scale;
  }

  function saveAndApply(mode) {
    mode = allowedModes[mode] ? mode : AUTO;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (err) {}
    return apply(mode);
  }

  function bindControl() {
    var select = document.getElementById('appScaleSelect');
    if (!select || select.getAttribute('data-scale-bound') === '1') return;
    select.setAttribute('data-scale-bound', '1');
    select.addEventListener('change', function () {
      saveAndApply(this.value);
    });
    updateControl(readMode(), currentScale);
  }

  apply(readMode());

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControl);
  else bindControl();

  function scheduleViewportRefresh() {
    // Keep the CSS height variable and height breakpoint in lockstep with
    // browser chrome changes. Width-dependent composition and the full
    // control/event refresh remain debounced below so resize gestures do not
    // fan out expensive work or expose an intermediate responsive state.
    var height = getLayoutHeight(currentScale);
    root.style.setProperty('--layout-viewport-height', height + 'px');
    root.style.setProperty(
      '--browser-chrome-bottom-gap',
      getBrowserChromeBottomGap(currentScale) + 'px',
    );
    root.setAttribute('data-layout-height', height <= COMPACT_HEIGHT ? 'compact' : 'regular');
    root.classList.toggle('layout-height-compact', height <= COMPACT_HEIGHT);
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      apply(readMode());
    }, 180);
  }

  window.addEventListener('resize', scheduleViewportRefresh);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleViewportRefresh);

  window.AppDisplayScale = {
    getMode: readMode,
    getScale: function () {
      return currentScale;
    },
    getLayoutWidth: function () {
      return getLayoutWidth(currentScale);
    },
    getLayoutHeight: function () {
      return getLayoutHeight(currentScale);
    },
    setMode: saveAndApply,
    refresh: function () {
      return apply(readMode());
    },
  };
})();
