/**
 * TopLayer: coordinates product-level popovers, dialogs and tablet drawers.
 * Components keep ownership of their own animation and focus behavior; this
 * registry only guarantees that opening one surface dismisses the previous one.
 */
(function () {
  window.JPLearn = window.JPLearn || {};

  var registry = {};
  var current = '';

  function register(id, handlers) {
    if (!id) return;
    registry[id] = handlers || {};
  }

  function requestOpen(id) {
    if (!id) return;
    if (current && current !== id) {
      var previous = current;
      current = '';
      if (registry[previous] && typeof registry[previous].close === 'function') {
        registry[previous].close(false, 'switch');
      }
    }
    current = id;
  }

  function release(id) {
    if (current === id) current = '';
  }

  function close(id, restoreFocus) {
    var target = id || current;
    if (!target) return;
    if (current === target) current = '';
    if (registry[target] && typeof registry[target].close === 'function') {
      registry[target].close(restoreFocus !== false, 'request');
    }
  }

  window.JPLearn.topLayer = {
    register: register,
    requestOpen: requestOpen,
    release: release,
    close: close,
    getCurrent: function () {
      return current;
    },
  };
})();
