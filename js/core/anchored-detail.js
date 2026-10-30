/**
 * AnchoredDetail: turns the existing module detail panels into one shared
 * dictionary-style interaction. Content renderers keep owning their DOM;
 * this coordinator only owns transient visibility, positioning, dismissal,
 * and focus restoration.
 */
(function () {
  'use strict';

  window.JPLearn = window.JPLearn || {};

  var modules = {
    vocab: { panelId: 'detailPanel', label: '词汇详情' },
    grammar: { panelId: 'grammarDetailPanel', label: '语法详情' },
    lesson: { panelId: 'textbookDetailPanel', label: '课文词汇详情' },
  };
  var expanded = false;
  var activeModule = '';
  var activePanel = null;
  var anchorElement = null;
  var virtualAnchor = null;
  var restoreTarget = null;
  var positionFrame = 0;
  var initialized = false;
  var resizeObserver = null;
  var SHEET_BREAKPOINT = 760;

  function getScale() {
    return window.AppDisplayScale && window.AppDisplayScale.getScale
      ? window.AppDisplayScale.getScale() || 1
      : 1;
  }

  function getViewport() {
    var scale = getScale();
    return {
      width:
        window.AppDisplayScale && window.AppDisplayScale.getLayoutWidth
          ? window.AppDisplayScale.getLayoutWidth()
          : window.innerWidth / scale,
      height:
        window.AppDisplayScale && window.AppDisplayScale.getLayoutHeight
          ? window.AppDisplayScale.getLayoutHeight()
          : window.innerHeight / scale,
    };
  }

  function normalizeRect(rect) {
    if (!rect) return null;
    var scale = getScale();
    var left = Number(rect.left);
    var top = Number(rect.top);
    var right = Number(rect.right);
    var bottom = Number(rect.bottom);
    var width = Number(rect.width);
    var height = Number(rect.height);
    if (!isFinite(left) || !isFinite(top)) return null;
    if (!isFinite(width)) width = isFinite(right) ? right - left : 0;
    if (!isFinite(height)) height = isFinite(bottom) ? bottom - top : 0;
    if (!isFinite(right)) right = left + width;
    if (!isFinite(bottom)) bottom = top + height;
    return {
      left: left / scale,
      top: top / scale,
      right: right / scale,
      bottom: bottom / scale,
      width: width / scale,
      height: height / scale,
    };
  }

  function getAnchorRect() {
    if (anchorElement) {
      if (!anchorElement.isConnected) return null;
      return normalizeRect(anchorElement.getBoundingClientRect());
    }
    return normalizeRect(virtualAnchor);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getHorizontalBounds(viewport, margin) {
    var navWidth = parseFloat(
      window.getComputedStyle(document.documentElement).getPropertyValue('--app-nav-width'),
    );
    if (!isFinite(navWidth) || navWidth < 0) navWidth = 0;
    return {
      left: Math.min(viewport.width - margin, navWidth + margin),
      right: viewport.width - margin,
    };
  }

  function setArrow(panel, placement, anchorRect, left, top, width, height) {
    panel.setAttribute('data-anchor-placement', placement);
    if (placement === 'left' || placement === 'right') {
      panel.style.setProperty(
        '--detail-arrow-offset',
        clamp(anchorRect.top + anchorRect.height / 2 - top, 24, Math.max(24, height - 24)) + 'px',
      );
    } else {
      panel.style.setProperty(
        '--detail-arrow-offset',
        clamp(anchorRect.left + anchorRect.width / 2 - left, 24, Math.max(24, width - 24)) + 'px',
      );
    }
  }

  function positionNow() {
    positionFrame = 0;
    if (!activePanel || !activeModule) return;
    var anchorRect = getAnchorRect();
    if (!anchorRect) {
      close(activeModule, false);
      return;
    }

    var viewport = getViewport();
    var margin = viewport.width <= 600 ? 8 : 12;
    var focusInset =
      parseFloat(
        window.getComputedStyle(document.documentElement).getPropertyValue('--reading-focus-inset'),
      ) || 0;
    var minTop = margin + focusInset;
    var horizontalBounds = getHorizontalBounds(viewport, margin);
    var safeLeft = horizontalBounds.left;
    var safeRight = horizontalBounds.right;
    var gap = 12;
    if (
      !expanded &&
      anchorElement &&
      (anchorRect.bottom < focusInset ||
        anchorRect.top > viewport.height ||
        anchorRect.right < 0 ||
        anchorRect.left > viewport.width)
    ) {
      close(activeModule, false);
      return;
    }

    var availableWidth = Math.max(180, safeRight - safeLeft);
    activePanel.style.setProperty(
      '--detail-popup-width',
      Math.min(expanded ? 760 : 438, availableWidth) + 'px',
    );
    var panelRect = normalizeRect(activePanel.getBoundingClientRect());
    var width = Math.min(panelRect && panelRect.width ? panelRect.width : 438, availableWidth);
    var height = Math.min(
      panelRect && panelRect.height ? panelRect.height : 640,
      viewport.height - minTop - margin,
    );
    var left;
    var top;
    var placement;

    if (expanded) {
      placement = 'reading';
      left = safeLeft + (availableWidth - width) / 2;
      top = minTop;
    } else if (viewport.width <= SHEET_BREAKPOINT) {
      placement = 'sheet';
      left = safeLeft;
      top = viewport.height - height - margin;
    } else if (anchorRect.right + gap + width <= safeRight) {
      placement = 'right';
      left = anchorRect.right + gap;
      top = clamp(anchorRect.top, minTop, viewport.height - height - margin);
    } else if (anchorRect.left - gap - width >= safeLeft) {
      placement = 'left';
      left = anchorRect.left - gap - width;
      top = clamp(anchorRect.top, minTop, viewport.height - height - margin);
    } else if (anchorRect.bottom + gap + height <= viewport.height - margin) {
      placement = 'bottom';
      left = clamp(anchorRect.left + anchorRect.width / 2 - width / 2, safeLeft, safeRight - width);
      top = anchorRect.bottom + gap;
    } else if (anchorRect.top - gap - height >= minTop) {
      placement = 'top';
      left = clamp(anchorRect.left + anchorRect.width / 2 - width / 2, safeLeft, safeRight - width);
      top = anchorRect.top - gap - height;
    } else {
      placement = anchorRect.top > viewport.height / 2 ? 'top' : 'bottom';
      left = clamp(anchorRect.left + anchorRect.width / 2 - width / 2, safeLeft, safeRight - width);
      top =
        placement === 'top'
          ? clamp(anchorRect.top - gap - height, minTop, viewport.height - height - margin)
          : clamp(anchorRect.bottom + gap, minTop, viewport.height - height - margin);
    }

    activePanel.style.left = Math.round(left) + 'px';
    activePanel.style.top = Math.round(top) + 'px';
    setArrow(activePanel, placement, anchorRect, left, top, width, height);
  }

  function schedulePosition() {
    if (!activePanel || positionFrame) return;
    positionFrame = window.requestAnimationFrame(positionNow);
  }

  function open(module, anchor, options) {
    init();
    var config = modules[module];
    var panel = config && document.getElementById(config.panelId);
    if (!panel) return;
    // The expanded navigation drawer makes the content area inert. A detail
    // opened there (e.g. from global search) could be neither focused nor
    // clicked, so the drawer yields to the detail it was asked to show.
    if (
      panel.closest('[inert]') &&
      window.PanelLayout &&
      window.PanelLayout.isNarrowGlobalOpen &&
      window.PanelLayout.isNarrowGlobalOpen()
    ) {
      window.PanelLayout.setNarrowGlobalOpen(false, false);
    }
    options = options || {};
    var preserveAnchor = options.preserveAnchor === true && activeModule === module;
    setExpanded(false);

    if (activeModule && activeModule !== module) close(activeModule, false);
    activeModule = module;
    activePanel = panel;
    if (!preserveAnchor) {
      if (anchorElement) anchorElement.removeAttribute('data-detail-anchor-active');
      anchorElement = anchor && anchor.nodeType === 1 ? anchor : null;
      virtualAnchor = anchorElement ? null : anchor || null;
      var focused = document.activeElement;
      // A whole vocabulary row can anchor the popup while its button owns focus.
      // Keep that trigger rather than trying to focus the non-interactive row.
      restoreTarget = anchorElement
        ? focused && anchorElement.contains(focused)
          ? focused
          : anchorElement
        : focused && focused !== document.body
          ? focused
          : null;
    }

    if (!anchorElement && !virtualAnchor) {
      var fallback = document.activeElement;
      if (fallback && fallback.nodeType === 1 && fallback !== document.body) anchorElement = fallback;
      else {
        var viewport = getViewport();
        virtualAnchor = {
          left: viewport.width / 2,
          right: viewport.width / 2,
          top: viewport.height / 3,
          bottom: viewport.height / 3,
          width: 0,
          height: 0,
        };
      }
    }

    if (anchorElement) anchorElement.setAttribute('data-detail-anchor-active', 'true');
    panel.hidden = false;
    panel.style.display = '';
    panel.classList.remove('detail-panel-collapsed');
    panel.classList.add('anchored-detail-open');
    panel.setAttribute('aria-hidden', 'false');
    var content = panel.querySelector('.detail-content');
    if (content && options.preserveScroll !== true) content.scrollTop = 0;

    if (window.JPLearn.topLayer) window.JPLearn.topLayer.requestOpen('anchored-detail');
    if (resizeObserver) resizeObserver.observe(panel);
    schedulePosition();

    if (options.focus) {
      window.setTimeout(function () {
        var closeButton = panel.querySelector('.detail-collapse-btn');
        if (closeButton && panel.classList.contains('anchored-detail-open')) closeButton.focus();
      }, 140);
    }
  }

  function close(module, restoreFocus) {
    if (!activePanel || (module && module !== activeModule)) return;
    var closingModule = activeModule;
    var panel = activePanel;
    var focusTarget = restoreTarget;
    if (positionFrame) {
      window.cancelAnimationFrame(positionFrame);
      positionFrame = 0;
    }
    if (resizeObserver) resizeObserver.unobserve(panel);
    setExpanded(false);
    panel.classList.remove('anchored-detail-open');
    panel.classList.add('detail-panel-collapsed');
    panel.setAttribute('aria-hidden', 'true');
    // Do not leave the opaque panel shrinking on screen. Besides looking like
    // a white square, that exit frame is especially noticeable when another
    // word opens the same panel immediately after this pointer event.
    panel.hidden = true;
    panel.removeAttribute('data-anchor-placement');
    panel.style.removeProperty('left');
    panel.style.removeProperty('top');
    panel.style.removeProperty('--detail-arrow-offset');
    panel.style.removeProperty('--detail-popup-width');
    activeModule = '';
    activePanel = null;
    if (anchorElement) anchorElement.removeAttribute('data-detail-anchor-active');
    anchorElement = null;
    virtualAnchor = null;
    restoreTarget = null;
    if (window.PanelLayout && window.PanelLayout.setCollapsed) {
      window.PanelLayout.setCollapsed(closingModule, 'detail', true, false);
    }
    if (window.JPLearn.topLayer) window.JPLearn.topLayer.release('anchored-detail');
    if (restoreFocus && focusTarget && focusTarget.isConnected && focusTarget.focus) {
      window.setTimeout(function () {
        focusTarget.focus({ preventScroll: true });
      }, 0);
    }
  }

  function setExpanded(value) {
    expanded = !!value && activeModule === 'grammar';
    if (!activePanel) return;
    activePanel.classList.toggle('detail-reading-expanded', expanded);
    var toggle = activePanel.querySelector('[data-detail-reading-toggle]');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(expanded));
      toggle.textContent = expanded ? '收回浮窗' : '展开阅读';
    }
    schedulePosition();
  }

  function onPointerDown(event) {
    if (!activePanel || activePanel.contains(event.target)) return;
    if (anchorElement && anchorElement.contains && anchorElement.contains(event.target)) return;
    close(activeModule, false);
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !activePanel) return;
    event.preventDefault();
    event.stopPropagation();
    close(activeModule, true);
  }

  function onFocusIn(event) {
    if (!activePanel || activePanel.contains(event.target)) return;
    if (anchorElement && anchorElement.contains && anchorElement.contains(event.target)) return;
    close(activeModule, false);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(schedulePosition);
    }
    document.addEventListener('click', function (event) {
      var toggle = event.target.closest('[data-detail-reading-toggle]');
      if (toggle && activePanel && activePanel.contains(toggle)) setExpanded(!expanded);
    });
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', schedulePosition, true);
    window.addEventListener('app:layout-viewport-change', schedulePosition);
    if (window.JPLearn.topLayer) {
      window.JPLearn.topLayer.register('anchored-detail', {
        close: function (restoreFocus) {
          close(activeModule, restoreFocus);
        },
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.JPLearn.anchoredDetail = {
    init: init,
    open: open,
    close: close,
    reposition: schedulePosition,
    getActiveModule: function () {
      return activeModule;
    },
    isOpen: function (module) {
      return !!activePanel && (!module || module === activeModule);
    },
  };
})();
