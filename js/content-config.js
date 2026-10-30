// Which textbooks this copy of the site offers (PUB-05). The repository and
// serve.py offer every book; npm run release:build rewrites the `offered` line
// in the public package so the third-party XinBian books stay on this machine.
(function (window) {
  'use strict';

  var ALL_TEXTBOOKS = [
    'XinBian1',
    'XinBian2',
    'XinBian3',
    'XinBian4',
    'KotobaFlow1',
    'KotobaFlow2',
    'KotobaFlow3',
    'KotobaFlow4',
  ];
  var offered = null; // null: every book
  // Reading library data is built by tools/build_classics_library.cjs.
  // Local copies use the adjacent audio; public releases use the R2 base.
  var classics = true;
  var classicsAudioBase = '';

  var list = Array.isArray(offered)
    ? ALL_TEXTBOOKS.filter(function (id) {
        return offered.indexOf(id) !== -1;
      })
    : ALL_TEXTBOOKS.slice();

  var app = window.JPLearn || (window.JPLearn = {});
  app.textbooks = {
    isOffered: function (bookId) {
      return list.indexOf(bookId) !== -1;
    },
    // Saved plans and navigation may name a book this copy does not offer;
    // callers fall back to this one instead of rewriting the saved value.
    defaultBookId: function () {
      return list[0] || '';
    },
    classicsOffered: function () {
      return classics;
    },
    classicsAudioBase: function () {
      return classicsAudioBase;
    },
  };
})(window);
