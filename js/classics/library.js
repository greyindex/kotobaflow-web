// Japanese classics data (CLASSICS-01). tools/build_classics_library.cjs
// writes data/classics_v1/: catalog.json, then per work an index.json and one
// JSON file per part. Public copies keep the JSON and play immutable R2 audio;
// local copies use the adjacent audio. Copies without a catalog offer no module.
(function (window) {
  'use strict';

  var app = window.JPLearn || (window.JPLearn = {});
  var ROOT = './data/classics_v1/';
  var ID = /^[a-z][a-z0-9_-]{0,31}$/;
  var PART_FILE = /^[0-9]{2,3}\.json$/;
  var AUDIO_FILE = /^[a-z0-9_-]{1,32}\.(?:mp3|ogg|m4a)$/;
  var catalog = null;
  var books = {};
  var parts = {};

  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error(url + ' ' + response.status);
      return response.json();
    });
  }

  function offered() {
    return !!(app.textbooks && app.textbooks.classicsOffered && app.textbooks.classicsOffered());
  }

  // Narration timeline: chunk times with the modern-Japanese code-point spans
  // each chunk reads. Inside a chunk time is spread evenly over its characters,
  // which places a sentence within a few seconds; the data has no finer timing.
  function Timeline(audio) {
    var spans = [];
    (audio.chunks || []).forEach(function (chunk) {
      var total = 0;
      chunk.spans.forEach(function (span) {
        total += Math.max(0, span[2] - span[1]);
      });
      var duration = Math.max(0, chunk.end - chunk.start);
      var before = 0;
      chunk.spans.forEach(function (span) {
        var length = Math.max(0, span[2] - span[1]);
        spans.push({
          id: span[0],
          from: span[1],
          to: span[2],
          start: chunk.start + (total ? (before / total) * duration : 0),
          end: chunk.start + (total ? ((before + length) / total) * duration : 0),
        });
        before += length;
      });
    });
    this.spans = spans;
    this.duration = Number(audio.duration) || (spans.length ? spans[spans.length - 1].end : 0);
  }

  Timeline.prototype = {
    // Seconds at which a unit's character (code point) offset is read.
    timeAt: function (id, offset) {
      offset = Math.max(0, Number(offset) || 0);
      var last = null;
      for (var i = 0; i < this.spans.length; i++) {
        var span = this.spans[i];
        if (span.id !== id) continue;
        if (offset < span.to || span.to === span.from) {
          if (offset < span.from) return span.start;
          var share = span.to > span.from ? (offset - span.from) / (span.to - span.from) : 0;
          return span.start + share * (span.end - span.start);
        }
        last = span;
      }
      return last ? last.end : null;
    },

    // The unit and character offset being read at a time.
    positionAt: function (time) {
      var spans = this.spans;
      if (!spans.length) return null;
      var low = 0;
      var high = spans.length - 1;
      while (low < high) {
        var mid = (low + high + 1) >> 1;
        if (spans[mid].start <= time) low = mid;
        else high = mid - 1;
      }
      var span = spans[low];
      if (time <= span.start) return { id: span.id, offset: span.from };
      var share = span.end > span.start ? Math.min(1, (time - span.start) / (span.end - span.start)) : 1;
      var offset = span.from + Math.floor(share * (span.to - span.from));
      return { id: span.id, offset: Math.min(offset, Math.max(span.from, span.to - 1)) };
    },
  };

  app.classics = {
    offered: offered,

    // Resolves null when this copy has no classics (switched off or not built).
    getCatalog: function () {
      if (!offered()) return Promise.resolve(null);
      if (!catalog)
        catalog = fetchJson(ROOT + 'catalog.json')
          .then(function (data) {
            if (!data || data.schema !== 1 || !Array.isArray(data.books)) return null;
            var list = data.books.filter(function (book) {
              return book && ID.test(book.id) && book.parts > 0;
            });
            return list.length ? { books: list } : null;
          })
          .catch(function () {
            return null;
          });
      return catalog;
    },

    getBook: function (id) {
      if (!ID.test(id)) return Promise.reject(new Error('Unknown classic: ' + id));
      if (!books[id])
        books[id] = fetchJson(ROOT + id + '/index.json').then(
          function (index) {
            if (!index || index.schema !== 1 || !Array.isArray(index.parts) || !index.parts.length)
              throw new Error('Unsupported classic index: ' + id);
            if (index.audio) index.timeline = new Timeline(index.audio);
            return index;
          },
          function (error) {
            delete books[id];
            throw error;
          },
        );
      return books[id];
    },

    getPart: function (book, n) {
      var entry = book.parts[n - 1];
      if (!entry || !PART_FILE.test(entry.file))
        return Promise.reject(new Error('Unknown part ' + n + ' of ' + book.id));
      var key = book.id + '/' + n;
      if (!parts[key])
        parts[key] = fetchJson(ROOT + book.id + '/' + entry.file).then(
          function (part) {
            if (!part || !Array.isArray(part.units)) throw new Error('Unsupported part: ' + key);
            return part;
          },
          function (error) {
            delete parts[key];
            throw error;
          },
        );
      return parts[key];
    },

    audioUrl: function (book) {
      if (!book || !ID.test(book.id) || !book.audio) return '';
      var base = app.textbooks && app.textbooks.classicsAudioBase && app.textbooks.classicsAudioBase();
      if (base) {
        if (
          base !== 'https://audio.kotobaflow.lol/classics/v1/' ||
          !/^[a-f0-9]{64}\.mp3$/.test(book.audio.file)
        )
          return '';
        return base + book.id + '/' + book.audio.file;
      }
      return AUDIO_FILE.test(book.audio.file) ? ROOT + book.id + '/' + book.audio.file : '';
    },

    Timeline: Timeline,
  };
})(window);
