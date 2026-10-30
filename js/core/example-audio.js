/**
 * Example sentence audio (PUB-04-EXAMPLES). Clips are packed into a few large
 * files under data/example_audio_v1, so Pages stays within its file limit. A
 * text key selects an index shard, and the clip is fetched by byte range; a
 * server that ignores ranges returns the whole pack, which is cut locally.
 * tools/build_example_audio_packs.cjs evaluates this file to hash the same way.
 */
(function (root) {
  root.JPLearn = root.JPLearn || {};

  var BASE = 'data/example_audio_v1/';
  var HASH = 'cyrb53-v1';

  // The packer keys clips by their displayed text; the page hashes the raw
  // example string. Both drop the [[ ]] highlight marks and spacing noise.
  function normalize(text) {
    var value = String(text == null ? '' : text);
    if (value.normalize) value = value.normalize('NFC');
    return value
      .replace(/\[\[|\]\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // cyrb53: a 53-bit string hash that needs no secure context (crypto.subtle
  // is unavailable on plain-HTTP LAN addresses). The packer rejects collisions.
  function hashText(text) {
    var h1 = 0xdeadbeef,
      h2 = 0x41c6ce57;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  function textKey(text) {
    var value = normalize(text);
    if (!value) return '';
    return ('00000000000000' + hashText(value).toString(16)).slice(-14);
  }

  function shardOf(key, bits) {
    return Math.floor(parseInt(key, 16) / Math.pow(2, 53 - bits));
  }

  var api = {
    BASE: BASE,
    HASH: HASH,
    normalize: normalize,
    textKey: textKey,
    shardOf: shardOf,
  };
  root.JPLearn.exampleAudio = api;
  if (typeof document === 'undefined') return;

  var CLIP_CACHE_SIZE = 32;
  var PACK_CACHE_SIZE = 2;
  var LABELS = {
    idle: '朗读例句',
    loading: '正在加载例句配音',
    playing: '停止朗读例句',
    missing: '这句暂无配音',
    error: '例句配音加载失败',
  };
  var indexPromise = null;
  var indexMissing = false;
  var shardPromises = {};
  var clipCache = new Map();
  var packCache = new Map();
  var current = null;

  function getJson(url, reload) {
    return fetch(url, reload ? { cache: 'reload' } : undefined).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function loadIndex(reload) {
    // A site without packs answers 404 once; later details do not ask again.
    if (indexMissing && !reload) return Promise.reject(new Error('HTTP 404'));
    if (!indexPromise || reload) {
      var promise = getJson(BASE + 'index.json', reload).then(function (index) {
        if (!index || index.schema !== 1 || index.hash !== HASH || !Array.isArray(index.shards))
          throw new Error('Unsupported example audio index');
        document.documentElement.setAttribute('data-example-audio', 'ready');
        return index;
      });
      promise.catch(function (error) {
        if (indexPromise === promise) indexPromise = null;
        if (error && error.message === 'HTTP 404') indexMissing = true;
      });
      indexPromise = promise;
    }
    return indexPromise;
  }

  function loadShard(name, reload) {
    if (!shardPromises[name] || reload) {
      var promise = getJson(BASE + name, reload);
      promise.catch(function () {
        if (shardPromises[name] === promise) delete shardPromises[name];
      });
      shardPromises[name] = promise;
    }
    return shardPromises[name];
  }

  function locate(text, reload) {
    var key = textKey(text);
    if (!key) return Promise.resolve(null);
    return loadIndex(reload).then(function (index) {
      var name = index.shards[shardOf(key, index.shardBits)];
      if (!name) return null;
      return loadShard(name, reload).then(function (shard) {
        var entry = shard && shard[key];
        if (!entry || !index.packs[entry[0]]) return null;
        return { key: key, pack: index.packs[entry[0]], offset: entry[1], length: entry[2] };
      });
    });
  }

  function remember(map, key, value, limit) {
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) map.delete(map.keys().next().value);
  }

  function isOgg(buffer) {
    var head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    return head.length === 4 && head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53;
  }

  function readClip(clip) {
    var cached = clipCache.get(clip.key);
    if (cached) {
      remember(clipCache, clip.key, cached, CLIP_CACHE_SIZE);
      return Promise.resolve(cached);
    }
    var whole = packCache.get(clip.pack);
    var request = whole
      ? whole
      : fetch(BASE + clip.pack, {
          headers: { Range: 'bytes=' + clip.offset + '-' + (clip.offset + clip.length - 1) },
        }).then(function (response) {
          if (response.status === 206) return response.arrayBuffer();
          if (!response.ok) throw new Error('HTTP ' + response.status);
          // The server ignored the range: keep the pack for its other clips.
          var pack = response.arrayBuffer();
          remember(packCache, clip.pack, pack, PACK_CACHE_SIZE);
          pack.catch(function () {
            if (packCache.get(clip.pack) === pack) packCache.delete(clip.pack);
          });
          return pack;
        });
    return Promise.resolve(request).then(function (buffer) {
      if (buffer.byteLength !== clip.length) buffer = buffer.slice(clip.offset, clip.offset + clip.length);
      if (buffer.byteLength !== clip.length || !isOgg(buffer)) throw new Error('Example clip is damaged');
      remember(clipCache, clip.key, buffer, CLIP_CACHE_SIZE);
      return buffer;
    });
  }

  // A pack missing after a redeploy means the cached index is stale: read the
  // index and shard again once before reporting the sentence as unavailable.
  function fetchClip(text) {
    return locate(text).then(function (clip) {
      if (!clip) return null;
      return readClip(clip).catch(function (error) {
        if (!/^HTTP 404$/.test(error && error.message)) throw error;
        return locate(text, true).then(function (fresh) {
          return fresh ? readClip(fresh) : null;
        });
      });
    });
  }

  function setState(button, state) {
    if (!button) return;
    button.setAttribute('data-state', state);
    button.setAttribute('aria-pressed', state === 'playing' || state === 'loading' ? 'true' : 'false');
    button.setAttribute('aria-label', LABELS[state] || LABELS.idle);
    button.title = LABELS[state] || LABELS.idle;
    var note = button.nextElementSibling;
    var message = state === 'missing' || state === 'error' ? LABELS[state] : '';
    if (note && note.classList.contains('example-audio-note')) {
      if (message) note.textContent = message;
      else note.remove();
    } else if (message) {
      note = document.createElement('span');
      note.className = 'example-audio-note';
      note.setAttribute('lang', 'zh-CN');
      note.setAttribute('role', 'status');
      note.textContent = message;
      button.after(note);
    }
  }

  function stop() {
    var item = current;
    if (!item) return;
    current = null;
    if (item.audio) {
      item.audio.pause();
      item.audio.removeAttribute('src');
    }
    if (item.url) URL.revokeObjectURL(item.url);
    setState(item.button, 'idle');
  }

  function fail(item, state) {
    if (current !== item) return;
    stop();
    setState(item.button, state);
  }

  function play(button) {
    if (current && current.button === button) {
      stop();
      return Promise.resolve();
    }
    stop();
    if (root.VocabTTS && typeof root.VocabTTS.stop === 'function') root.VocabTTS.stop();
    var item = { button: button };
    current = item;
    setState(button, 'loading');
    return fetchClip(button.getAttribute('data-example-audio') || '')
      .then(function (buffer) {
        if (current !== item) return;
        if (!buffer) return fail(item, 'missing');
        item.url = URL.createObjectURL(new Blob([buffer], { type: 'audio/ogg' }));
        item.audio = new Audio(item.url);
        item.audio.addEventListener('ended', function () {
          if (current === item) stop();
        });
        item.audio.addEventListener('error', function () {
          fail(item, 'error');
        });
        setState(button, 'playing');
        return item.audio.play();
      })
      .catch(function () {
        fail(item, 'error');
      });
  }

  // Detail renderers call this beside a Japanese example. Buttons stay hidden
  // until the index loads, so a site without the packs shows no dead control.
  function button(text) {
    if (!normalize(text)) return '';
    loadIndex().catch(function () {});
    var esc = root.JPLearn.html.escape;
    return (
      '<button type="button" class="example-audio-btn" lang="zh-CN" data-example-audio="' +
      esc(String(text)) +
      '" data-state="idle" aria-pressed="false" aria-label="' +
      LABELS.idle +
      '" title="' +
      LABELS.idle +
      '">' +
      (typeof root.uiIcon === 'function' ? root.uiIcon('volume') : '') +
      '</button>'
    );
  }

  document.addEventListener('click', function (event) {
    // Only the buttons: <html> carries data-example-audio="ready" too, and
    // matching it would cancel every other click on the page.
    var target =
      event.target && event.target.closest ? event.target.closest('button[data-example-audio]') : null;
    if (!target) return;
    event.preventDefault();
    play(target);
  });

  api.button = button;
  api.play = play;
  api.stop = stop;
  api.ready = function () {
    return loadIndex().then(
      function () {
        return true;
      },
      function () {
        return false;
      },
    );
  };
})(typeof window !== 'undefined' ? window : this);
