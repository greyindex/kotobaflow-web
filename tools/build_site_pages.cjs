// Keep the three module entry shells and public search metadata in sync.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { origin, pages, about } = require('../js/core/site-pages.js');
const root = path.resolve(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/core/html.js'), 'utf8'), context);
const escape = context.window.JPLearn.html.escape;

function metadata(page) {
  const url = origin + page.path;
  return [
    '    <!-- Generated site metadata: npm run site:generate -->',
    '    <title>' + escape(page.title) + '</title>',
    '    <meta name="description" content="' + escape(page.description) + '">',
    '    <meta name="robots" content="index, follow">',
    '    <link rel="canonical" href="' + url + '">',
    '    <meta property="og:type" content="website">',
    '    <meta property="og:site_name" content="词基流动">',
    '    <meta property="og:locale" content="zh_CN">',
    '    <meta property="og:title" content="' + escape(page.title) + '">',
    '    <meta property="og:description" content="' + escape(page.description) + '">',
    '    <meta property="og:url" content="' + url + '">',
    '    <meta name="twitter:card" content="summary">',
    '    <meta name="twitter:title" content="' + escape(page.title) + '">',
    '    <meta name="twitter:description" content="' + escape(page.description) + '">',
    '    <script type="application/ld+json" id="sitePageSchema">' +
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: page.title,
        description: page.description,
        url,
        inLanguage: 'zh-CN',
        isPartOf: { '@type': 'WebSite', name: '词基流动', url: origin + '/' },
      }) +
      '</script>',
    '    <!-- End site metadata -->',
  ].join('\n');
}
function withMetadata(html, page) {
  const block = /[ \t]*<!-- Generated site metadata:[\s\S]*?<!-- End site metadata -->/;
  if (block.test(html)) return html.replace(block, metadata(page));
  return html.replace(
    /[ \t]*<title>[^<]*<\/title>(?:\r?\n[ \t]*<meta name="description"[^>]*>)?/,
    metadata(page),
  );
}
function buildPages() {
  const index = withMetadata(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), pages.dashboard);
  const result = new Map([['index.html', index]]);
  for (const [key, page] of Object.entries(pages)) {
    if (key !== 'dashboard') result.set(page.path.slice(1) + 'index.html', withMetadata(index, page));
  }
  result.set('privacy.html', withMetadata(fs.readFileSync(path.join(root, 'privacy.html'), 'utf8'), about));
  result.set('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: ' + origin + '/sitemap.xml\n');
  result.set(
    'sitemap.xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      [...Object.values(pages), about]
        .map((page) => '  <url><loc>' + origin + page.path + '</loc></url>')
        .join('\n') +
      '\n</urlset>\n',
  );
  return result;
}
let stale = false;
for (const [file, body] of buildPages()) {
  const target = path.join(root, file);
  if (process.argv.includes('--check')) {
    if (
      !fs.existsSync(target) ||
      fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== body.replace(/\r\n/g, '\n')
    ) {
      console.error('Site page stale: ' + file + '; run npm run site:generate');
      stale = true;
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
}
if (stale) process.exitCode = 1;
else
  console.log(
    process.argv.includes('--check')
      ? 'Site pages match the shared shell and metadata.'
      : 'Generated site pages, robots.txt and sitemap.xml.',
  );
