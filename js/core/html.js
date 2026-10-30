(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  function escape(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  app.html = Object.freeze({ escape: escape });
})(window);
