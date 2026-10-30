const { PNG } = require('pngjs');

// Measures rendered background pixels, including both masked wave gradients,
// transparent descendants and color(srgb)/color-mix. Text is hidden only for the
// screenshot paint pass; Playwright removes the transient style automatically.
async function heroTextContrast(page) {
  const hero = page.locator('.dashboard-start-card');
  await hero.evaluate((card) =>
    Promise.all(card.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))),
  );
  const samples = await hero.evaluate((card) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (value) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const p = Array.from(ctx.getImageData(0, 0, 1, 1).data);
      return [p[0], p[1], p[2], p[3] / 255];
    };
    const bounds = card.getBoundingClientRect();
    const rows = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!node.textContent.trim() || el.closest('svg, .sr-only, [aria-hidden="true"]')) continue;
      const style = getComputedStyle(el);
      if (style.visibility !== 'visible') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()]
        .filter((r) => r.width && r.height)
        .map((r) => ({ x: r.x - bounds.x, y: r.y - bounds.y, width: r.width, height: r.height }));
      if (!rects.length) continue;
      let opacity = 1;
      for (let parent = el; parent; parent = parent.parentElement)
        opacity *= Number(getComputedStyle(parent).opacity);
      const foreground = rgba(style.color);
      foreground[3] *= opacity;
      const fontSize = parseFloat(style.fontSize);
      const weight = parseInt(style.fontWeight, 10);
      rows.push({
        text: node.textContent.trim(),
        foreground,
        opacity,
        rects,
        threshold: fontSize >= 24 || (fontSize >= 18.66 && weight >= 700) ? 3 : 4.5,
      });
    }
    return rows;
  });
  const png = PNG.sync.read(
    await hero.screenshot({
      animations: 'disabled',
      style:
        '.dashboard-start-card, .dashboard-start-card * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } .dashboard-start-card::after { color: transparent !important; -webkit-text-fill-color: transparent !important; }',
    }),
  );
  const luminance = (rgb) =>
    rgb.reduce((sum, c, i) => {
      const s = c / 255;
      return sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
    }, 0);
  return samples.map(({ text, foreground, opacity, rects, threshold }) => {
    let ratio = Infinity;
    for (const r of rects) {
      const left = Math.max(0, Math.ceil(r.x + 1));
      const right = Math.min(png.width - 1, Math.floor(r.x + r.width - 1));
      const top = Math.max(0, Math.ceil(r.y + 1));
      const bottom = Math.min(png.height - 1, Math.floor(r.y + r.height - 1));
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++) {
          const p = (y * png.width + x) * 4;
          const bg = Array.from(png.data.subarray(p, p + 3));
          const fg = foreground.slice(0, 3).map((c, i) => c * foreground[3] + bg[i] * (1 - foreground[3]));
          const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
          ratio = Math.min(ratio, (hi + 0.05) / (lo + 0.05));
        }
    }
    return { text, ratio, threshold, opacity };
  });
}

module.exports = { heroTextContrast };
