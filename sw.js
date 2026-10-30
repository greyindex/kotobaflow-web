/* Complete versioned shells; updates activate only after old clients close. */
importScripts('./sw-manifest.js');
(function () {
  'use strict';
  var manifest = self.JPLearnShellManifest;
  if (!manifest || manifest.schema !== 1) throw new Error('Unsupported shell manifest');
  var prefix = 'jp-learning-';
  var shellName = prefix + 'shell-' + manifest.version;
  var scope = new URL(self.registration.scope);
  var required = new Map(
    manifest.required.map(function (e) {
      return [new URL(e.url, scope).pathname, e];
    }),
  );
  var dataEntries = new Map(
    manifest.data.map(function (e) {
      return [new URL(e.url, scope).pathname, e];
    }),
  );
  var writes = new Map();
  var policies = {
    data: {
      name: prefix + 'data-' + manifest.version,
      entries: 24,
      single: 48 * 1024 * 1024,
      total: 128 * 1024 * 1024,
    },
    audio: {
      name: prefix + 'audio-' + manifest.version,
      entries: 24,
      single: 4 * 1024 * 1024,
      total: 96 * 1024 * 1024,
    },
    image: {
      name: prefix + 'image-' + manifest.version,
      entries: 12,
      single: 5 * 1024 * 1024,
      total: 60 * 1024 * 1024,
    },
  };
  var names = [shellName, policies.data.name, policies.audio.name, policies.image.name];
  function absolute(file) {
    return new URL(file, scope).href;
  }
  function navigationResponse(response, request) {
    // Pages redirects index.html to /. Navigation requests reject a cached
    // redirected response, even though its verified HTML is valid.
    if (request.mode !== 'navigate' || !response.redirected) return response;
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  async function verify(response, entry) {
    if (!response || response.status !== 200 || response.type === 'opaque')
      throw new Error('Asset unavailable');
    if (!entry || entry.dynamic) return response;
    var text = (await response.clone().text()).replace(/\r\n/g, '\n');
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    var hash = Array.from(new Uint8Array(digest))
      .map(function (b) {
        return b.toString(16).padStart(2, '0');
      })
      .join('');
    if (hash !== entry.sha256) throw new Error('Asset version mismatch: ' + entry.url);
    return response;
  }
  async function installShell() {
    var responses = await Promise.all(
      manifest.required.map(async function (e) {
        return verify(await fetch(absolute(e.url), { cache: 'reload' }), e);
      }),
    );
    var cache = await caches.open(shellName);
    try {
      for (var i = 0; i < responses.length; i++)
        await cache.put(absolute(manifest.required[i].url), responses[i]);
    } catch (error) {
      await caches.delete(shellName);
      throw error;
    }
    await Promise.all(
      manifest.optional.map(async function (e) {
        try {
          await store(
            new Request(absolute(e.url)),
            await verify(await fetch(absolute(e.url), { cache: 'reload' }), e),
            policies.data,
          );
        } catch (_) {
          /* Optional indexes can be fetched when their module opens. */
        }
      }),
    );
  }
  async function store(request, response, policy) {
    if (!response || response.status !== 200 || response.type === 'opaque') return;
    if (Number(response.headers.get('content-length')) > policy.single) return;
    var body = await response.clone().arrayBuffer();
    if (body.byteLength > policy.single) return;
    var headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.set('content-length', String(body.byteLength));
    headers.set('X-JPLearn-Cache-Bytes', String(body.byteLength));
    var next = (writes.get(policy.name) || Promise.resolve())
      .catch(function () {})
      .then(async function () {
        var cache = await caches.open(policy.name);
        await cache.delete(request);
        await cache.put(request, new Response(body, { status: 200, headers: headers }));
        var keys = await cache.keys();
        var sizes = await Promise.all(
          keys.map(async function (key) {
            return Number((await cache.match(key)).headers.get('X-JPLearn-Cache-Bytes')) || 0;
          }),
        );
        var total = sizes.reduce(function (sum, size) {
          return sum + size;
        }, 0);
        for (var i = 0; i < keys.length && (keys.length - i > policy.entries || total > policy.total); i++) {
          await cache.delete(keys[i]);
          total -= sizes[i];
        }
      });
    writes.set(policy.name, next);
    await next;
  }
  async function networkContent(request, policy, entry) {
    // Content-addressed chunks are immutable; repeat visits need no network download.
    if (
      entry &&
      /\/(?:vocab|grammar|book|audio)_chunks\/(?:(?:detail|vocab|text|wiki|grammar)-)?[a-f0-9]{64}\.json$/.test(
        new URL(request.url).pathname,
      )
    ) {
      var existing = await (await caches.open(policy.name)).match(request);
      if (existing) return { response: existing };
    }
    try {
      var response = await fetch(request, { cache: entry ? 'no-cache' : 'default' });
      if (response.status === 206) return { response: response };
      await verify(response, entry);
      return { response: response, write: store(request, response, policy).catch(function () {}) };
    } catch (error) {
      var cached = await (await caches.open(policy.name)).match(request);
      if (cached) return { response: cached };
      throw error;
    }
  }
  self.addEventListener('install', function (event) {
    event.waitUntil(installShell());
  });
  self.addEventListener('activate', function (event) {
    // No skipWaiting/clients.claim: never mix a new shell into an old study page.
    event.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key.startsWith(prefix) && !names.includes(key);
            })
            .map(function (key) {
              return caches.delete(key);
            }),
        );
      }),
    );
  });
  self.addEventListener('fetch', function (event) {
    var request = event.request,
      url = new URL(request.url);
    if (
      request.method !== 'GET' ||
      url.origin !== scope.origin ||
      /\/api\//.test(url.pathname) ||
      /\/data\/user_progress(?:\.|\/)/.test(url.pathname) ||
      // Example audio is online-only: packs are read by byte range and would
      // otherwise crowd the bounded audio and data caches (PUB-04-EXAMPLES).
      /\/data\/example_audio_v\d+\//.test(url.pathname) ||
      // The reading library (CLASSICS-01) has hour-long narrations read
      // by byte range; it stays out of the bounded caches as well.
      /\/data\/classics_v\d+\//.test(url.pathname)
    )
      return;
    var shellEntry = required.get(url.pathname);
    if (request.mode === 'navigate' && !shellEntry) {
      var directory = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
      shellEntry = required.get(directory + 'index.html');
    }
    if (shellEntry) {
      event.respondWith(
        (async function () {
          var key = absolute(shellEntry.url),
            cache = await caches.open(shellName),
            cached = await cache.match(key);
          if (cached) return navigationResponse(cached, request);
          var response = await verify(await fetch(key, { cache: 'reload' }), shellEntry);
          await cache.put(key, response.clone());
          return navigationResponse(response, request);
        })(),
      );
      return;
    }
    var policy = /\/data\/.*\.jsonl?$/i.test(url.pathname)
      ? policies.data
      : /\.(?:ogg|mp3|m4a|wav)$/i.test(url.pathname)
        ? policies.audio
        : /\.(?:png|jpe?g|webp|gif|svg)$/i.test(url.pathname)
          ? policies.image
          : null;
    if (!policy) return;
    var result = networkContent(request, policy, dataEntries.get(url.pathname));
    event.respondWith(
      result.then(function (item) {
        return item.response;
      }),
    );
    event.waitUntil(
      result
        .then(function (item) {
          return item.write;
        })
        .catch(function () {}),
    );
  });
})();
