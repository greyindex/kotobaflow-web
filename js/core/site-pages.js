/* Shared public entry points. Node also reads this table when generating HTML. */
(function () {
  'use strict';
  var origin = 'https://kotobaflow.lol';
  var pages = {
    dashboard: {
      path: '/',
      title: '词基流动',
      description:
        '日语词汇、JLPT 语法与 KotobaFlow 课文查阅工具，支持例句朗读、词汇复习、阅读位置恢复和本地存档，无需注册。',
    },
    vocab: {
      path: '/vocabulary/',
      title: '日语词汇查阅与复习 · 词基流动',
      description:
        '按 JLPT 等级、词性和中文释义查阅日语词汇，查看读音、日中例句与关联词，支持朗读、收藏和间隔复习。',
    },
    grammar: {
      path: '/grammar/',
      title: 'JLPT 日语语法查阅 · 词基流动',
      description: '按 JLPT 等级浏览日语语法，查阅接续、用法说明与日中例句，支持语法收藏和辅助课文阅读。',
    },
    lesson: {
      path: '/textbook/',
      title: 'KotobaFlow 日语课文阅读 · 词基流动',
      description:
        '阅读 KotobaFlow 日语四册 77 课，查阅课内词汇与语法，播放课文朗读和会话音频，保存本地阅读位置。',
    },
  };
  var about = {
    path: '/privacy',
    title: '关于词基流动',
    description: '词基流动的内容说明、本地学习记录与备份方式、隐私说明、相关资源和联系方式。',
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = { origin: origin, pages: pages, about: about };
    return;
  }

  // Local copies only (CLASSICS-01): the classics have no public entry page,
  // so the shell's own address carries them as /#classics.
  var CLASSICS_HASH = '#classics';
  var starting = true;
  var fromHistory = false;
  function moduleAtLocation() {
    return window.location.hash === CLASSICS_HASH ? 'classics' : moduleAtPath(window.location.pathname);
  }
  function moduleAtPath(pathname) {
    for (var key in pages) {
      var path = pages[key].path;
      if (
        pathname === path ||
        (path !== '/' && (pathname === path + 'index.html' || pathname === path.slice(0, -1)))
      )
        return key;
    }
    return 'dashboard';
  }
  function metadata(key) {
    if (key === 'classics') {
      metadata('dashboard');
      document.title = '日本古典 · 词基流动';
      return;
    }
    var page = pages[key];
    if (!page) return;
    document.title = page.title;
    [
      ['meta[name="description"]', page.description],
      ['meta[property="og:title"]', page.title],
      ['meta[property="og:description"]', page.description],
      ['meta[property="og:url"]', origin + page.path],
      ['meta[name="twitter:title"]', page.title],
      ['meta[name="twitter:description"]', page.description],
    ].forEach(function (entry) {
      var element = document.querySelector(entry[0]);
      if (element) element.setAttribute('content', entry[1]);
    });
    var canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.href = origin + page.path;
    var schema = document.getElementById('sitePageSchema');
    if (schema) {
      var data = JSON.parse(schema.textContent);
      data.name = page.title;
      data.description = page.description;
      data.url = origin + page.path;
      schema.textContent = JSON.stringify(data);
    }
  }
  function activate(key) {
    if (starting || (key !== 'classics' && !pages[key])) return;
    metadata(key);
    var hash = window.location.hash === CLASSICS_HASH ? '' : window.location.hash;
    var target =
      key === 'classics'
        ? pages.dashboard.path + window.location.search + CLASSICS_HASH
        : pages[key].path + window.location.search + hash;
    if (!fromHistory && window.location.pathname + window.location.search + window.location.hash !== target)
      window.history.pushState(null, '', target);
  }
  var initial = moduleAtLocation();
  window.JPLearn.sitePages = { activate: activate };
  window.JPLearn.events.on('app:ready', function () {
    if (!starting) return;
    starting = false;
    if (initial === 'dashboard') {
      metadata(initial);
      return;
    }
    if (initial === 'classics') {
      window.ModuleSwitcher.openClassics().then(function (opened) {
        if (opened) return;
        metadata('dashboard');
        window.history.replaceState(null, '', pages.dashboard.path + window.location.search);
      });
      return;
    }
    var saved = window.ProgressStore.getNavigation();
    saved.lastModule = initial;
    window.ModuleSwitcher.resume(saved);
  });
  window.addEventListener('popstate', function () {
    if (starting) return;
    fromHistory = true;
    var target = moduleAtLocation();
    // Opening the classics names the page itself; a copy without them stays put.
    if (target !== 'classics') metadata(target);
    var switching =
      target === 'classics' ? window.ModuleSwitcher.openClassics() : window.ModuleSwitcher.switchTo(target);
    Promise.resolve(switching).finally(function () {
      fromHistory = false;
    });
  });
})();
