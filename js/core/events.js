(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});
  var listeners = Object.create(null);

  function on(eventName, listener) {
    if (!listeners[eventName]) listeners[eventName] = [];
    listeners[eventName].push(listener);
    return function unsubscribe() {
      var index = listeners[eventName].indexOf(listener);
      if (index >= 0) listeners[eventName].splice(index, 1);
    };
  }

  function emit(eventName, payload) {
    var subscribers = (listeners[eventName] || []).slice();
    for (var i = 0; i < subscribers.length; i++) subscribers[i](payload);
  }

  app.events = Object.freeze({ on: on, emit: emit });
})(window);
