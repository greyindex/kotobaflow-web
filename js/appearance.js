/* W-03: validated, device-local palettes. Loaded before CSS to avoid a default-color flash.
 * Palette references / notices: resources/licenses/theme-palettes.md.
 * UI and Japanese font choices are shared; light and dark colors are independent. */
(function () {
  'use strict';

  var KEY = 'jp_learning_appearance_v1';
  var fields = ['accent', 'canvas', 'paper', 'text'];
  // UI-ART-25: new visitors start on 简洁 (white / near-black); saved choices are kept.
  var DEFAULT_PRESET = 'plain';
  // How far --c-ink-2/3/4 move from the text colour towards the paper.
  var INK_STEPS = [0.2, 0.34, 0.46];
  var presets = [
    {
      id: 'plain',
      name: '简洁',
      note: '纯白页面与近黑深色',
      light: ['#2b4c7e', '#ffffff', '#ffffff', '#1f2328'],
      dark: ['#a4bde6', '#0f0f0f', '#1a1a1a', '#e6e6e6'],
      // UI-ART-27: secondary text one step darker on the white page; the
      // default steps leave ink-3 and ink-4 both at the 4.5:1 floor there.
      inkSteps: { light: [0.14, 0.24, 0.3] },
    },
    {
      id: 'paper',
      name: '和纸藏青',
      note: '暖白纸面与藏青墨色',
      light: ['#2b4c7e', '#f3efe7', '#fdfbf7', '#22231f'],
      dark: ['#a4bde6', '#16181c', '#22252b', '#ecebe5'],
    },
    {
      id: 'original',
      name: '原有灰绿',
      note: '熟悉的纸面与青绿',
      light: ['#1f6964', '#f0ede7', '#fffdf9', '#1d211f'],
      dark: ['#82cfc4', '#121918', '#2a3833', '#f2f7f4'],
    },
    {
      id: 'ink',
      name: '中性墨色',
      note: '克制的黑白灰',
      light: ['#454545', '#eaeaea', '#fafafa', '#242424'],
      dark: ['#c6c6c6', '#171717', '#282828', '#eeeeee'],
    },
    {
      id: 'nord',
      name: '北境蓝灰',
      note: 'Nord · 清冷蓝调',
      light: ['#426185', '#e5e9f0', '#eceff4', '#2e3440'],
      dark: ['#99c9d7', '#2e3440', '#3b4252', '#eceff4'],
    },
    {
      id: 'catppuccin',
      name: '柔雾紫',
      note: 'Catppuccin · 轻柔紫调',
      light: ['#7731d3', '#e6e9ef', '#eff1f5', '#4c4f69'],
      dark: ['#cba6f7', '#181825', '#1e1e2e', '#cdd6f4'],
    },
    {
      id: 'gruvbox',
      name: '暖沙棕',
      note: 'Gruvbox · 暖纸琥珀',
      light: ['#80520e', '#ebdbb2', '#fbf1c7', '#3c3836'],
      dark: ['#fabd2f', '#282828', '#3c3836', '#ebdbb2'],
    },
    {
      id: 'ai',
      name: '藍染',
      note: '沉静的深靛蓝',
      light: ['#2b4a7e', '#e9ecf2', '#f8f9fc', '#1b2233'],
      dark: ['#8fb0e6', '#11161f', '#1d2533', '#e6ebf4'],
    },
    {
      id: 'konpeki',
      name: '紺碧',
      note: '明净的海天蓝',
      light: ['#0b5f8a', '#e6eef3', '#f7fbfd', '#13222c'],
      dark: ['#6cc3ea', '#0e1820', '#182833', '#e4f1f8'],
    },
    {
      id: 'matcha',
      name: '抹茶',
      note: '温润的茶绿',
      light: ['#4d6b1f', '#ecefe2', '#fbfcf5', '#23281c'],
      dark: ['#b5d17a', '#151a12', '#232b1e', '#eef2e4'],
    },
    {
      id: 'sakura',
      name: '桜色',
      note: '淡雅的樱粉',
      light: ['#a33a5e', '#f4ebee', '#fffafb', '#2c2226'],
      dark: ['#f2a7bf', '#1c1518', '#2c2226', '#f6eaee'],
    },
    {
      id: 'kaki',
      name: '柿色',
      note: '秋日的暖橙',
      light: ['#a34a14', '#f3ece4', '#fffaf5', '#2b231d'],
      dark: ['#f5a46a', '#1b1612', '#2b231d', '#f5ece4'],
    },
  ];
  var fonts = {
    ui: [
      { id: 'original', name: '原有界面字体', value: '' },
      {
        id: 'system',
        name: '系统界面字体',
        value: 'system-ui, "Segoe UI", "Yu Gothic", "Meiryo", "Microsoft YaHei", "PingFang SC", sans-serif',
      },
      {
        id: 'chinese',
        name: '中文优先',
        value:
          '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Yu Gothic", "Meiryo", system-ui, sans-serif',
      },
    ],
    japanese: [
      { id: 'original', name: '原有搭配（正文宋体／词头黑体）', value: '' },
      {
        id: 'mincho',
        name: '明朝体（宋体）',
        value: '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif JP", "MS PMincho", serif',
      },
      {
        id: 'gothic',
        name: '日文黑体',
        // "JPLearn Gothic" (style.css) draws the regular weight with Yu Gothic Medium.
        value:
          '"JPLearn Gothic", "Yu Gothic", "YuGothic", "Hiragino Kaku Gothic ProN", "Meiryo", "Noto Sans JP", sans-serif',
      },
    ],
  };
  var owned = new WeakMap();
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function preset(id) {
    return (
      presets.find(function (item) {
        return item.id === id;
      }) ||
      presets.find(function (item) {
        return item.id === DEFAULT_PRESET;
      })
    );
  }
  function fromPreset(id, mode) {
    var item = preset(id),
      colors = {};
    fields.forEach(function (field, index) {
      colors[field] = item[mode === 'dark' ? 'dark' : 'light'][index];
    });
    return { preset: item.id, colors: colors };
  }
  function defaults() {
    return {
      version: 1,
      light: fromPreset(DEFAULT_PRESET, 'light'),
      dark: fromPreset(DEFAULT_PRESET, 'dark'),
      fonts: { ui: 'chinese', japanese: 'original' },
    };
  }
  function hex(value) {
    if (typeof value !== 'string') return null;
    value = value.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(value))
      value =
        '#' +
        value
          .slice(1)
          .split('')
          .map(function (c) {
            return c + c;
          })
          .join('');
    return /^#[0-9a-f]{6}$/.test(value) ? value : null;
  }
  function font(group, id) {
    return (
      fonts[group].find(function (item) {
        return item.id === id;
      }) ||
      fonts[group].find(function (item) {
        return item.id === (group === 'ui' ? 'chinese' : 'original');
      })
    );
  }
  function normalize(value) {
    var result = defaults();
    if (!value || value.version !== 1) return result;
    ['light', 'dark'].forEach(function (mode) {
      var entry = value[mode];
      if (
        !entry ||
        !entry.colors ||
        !fields.every(function (field) {
          return hex(entry.colors[field]);
        })
      )
        return;
      result[mode].preset = preset(entry.preset).id;
      fields.forEach(function (field) {
        result[mode].colors[field] = hex(entry.colors[field]);
      });
    });
    if (value.fonts)
      Object.keys(fonts).forEach(function (group) {
        result.fonts[group] = font(group, value.fonts[group]).id;
      });
    return result;
  }
  function read() {
    try {
      var value = normalize(JSON.parse(localStorage.getItem(KEY)));
      ['light', 'dark'].forEach(function (mode) {
        if (
          assess(value[mode]).some(function (item) {
            return item.ratio < 4.5;
          })
        )
          value[mode] = fromPreset(DEFAULT_PRESET, mode);
      });
      return value;
    } catch (error) {
      return defaults();
    }
  }
  function rgb(color) {
    return [1, 3, 5].map(function (start) {
      return parseInt(color.slice(start, start + 2), 16);
    });
  }
  function mix(a, b, amount) {
    var other = rgb(b);
    return (
      '#' +
      rgb(a)
        .map(function (channel, i) {
          return Math.round(channel * (1 - amount) + other[i] * amount)
            .toString(16)
            .padStart(2, '0');
        })
        .join('')
    );
  }
  function luminance(color) {
    return rgb(color).reduce(function (total, channel, i) {
      var s = channel / 255;
      return (
        total + (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)) * [0.2126, 0.7152, 0.0722][i]
      );
    }, 0);
  }
  function contrast(a, b) {
    var first = luminance(a),
      second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  }
  function minimum(color, backgrounds) {
    return Math.min.apply(
      null,
      backgrounds.map(function (bg) {
        return contrast(color, bg);
      }),
    );
  }
  // Find the smallest tint/shade that satisfies every actual surface, preserving hue where possible.
  function fit(color, backgrounds, target) {
    var best = color,
      bestRatio = minimum(color, backgrounds);
    for (var step = 0; step <= 100; step++) {
      for (var end of ['#000000', '#ffffff']) {
        var candidate = mix(color, end, step / 100),
          ratio = minimum(candidate, backgrounds);
        if (ratio >= target) return candidate;
        if (ratio > bestRatio) {
          best = candidate;
          bestRatio = ratio;
        }
      }
    }
    return best;
  }
  function surfaces(colors) {
    return {
      canvas: colors.canvas,
      sunken: mix(colors.canvas, colors.text, 0.025),
      base: mix(colors.canvas, colors.paper, 0.6),
      raised: colors.paper,
      selected: mix(colors.paper, colors.accent, 0.1),
    };
  }
  function assess(entry) {
    var colors = entry.colors,
      backgrounds = Object.values(surfaces(colors));
    return [
      { label: '文字与纸面／背景', ratio: minimum(colors.text, backgrounds) },
      { label: '强调色与纸面／选中背景', ratio: minimum(colors.accent, backgrounds) },
    ];
  }
  function repair(entry) {
    var result = clone(entry),
      colors = result.colors,
      originalCanvas = colors.canvas;
    for (var step = 0; step <= 20; step++) {
      colors.canvas = mix(originalCanvas, colors.paper, step / 20);
      colors.text = fit(colors.text, Object.values(surfaces(colors)), 4.6);
      colors.accent = fit(colors.accent, Object.values(surfaces(colors)), 4.6);
      if (
        assess(result).every(function (item) {
          return item.ratio >= 4.5;
        })
      )
        break;
    }
    return result;
  }
  function isOriginal(entry, mode) {
    var original = fromPreset('original', mode);
    return fields.every(function (field) {
      return entry.colors[field] === original.colors[field];
    });
  }
  function tokens(entry, mode) {
    // Legacy surfaces/semantic colors still come from CSS. Preserve its saved
    // gray-green accent now that the shell and editor default to paper/navy.
    if (isOriginal(entry, mode))
      return {
        '--c-primary': mode === 'dark' ? '#82cfc4' : '#1f6964',
        '--c-primary-hover': mode === 'dark' ? '#a1e0d6' : '#18544f',
        '--c-primary-soft': mode === 'dark' ? '#234540' : '#ddeeea',
        '--c-primary-border': mode === 'dark' ? '#4e847a' : '#a3ccc5',
        '--c-focus-ring': mode === 'dark' ? 'rgba(130, 207, 196, 0.3)' : 'rgba(31, 105, 100, 0.22)',
      };
    var c = entry.colors,
      s = surfaces(c),
      backgrounds = Object.values(s),
      steps = (preset(entry.preset).inkSteps || {})[mode] || INK_STEPS;
    var onAccent = contrast(c.accent, '#ffffff') >= contrast(c.accent, '#000000') ? '#ffffff' : '#111111';
    if (contrast(c.accent, onAccent) < 4.5) onAccent = '#000000';
    var result = {
      '--surface-canvas': s.canvas,
      '--surface-sunken': s.sunken,
      '--surface-base': s.base,
      '--surface-raised': s.raised,
      '--c-ink': c.text,
      '--c-ink-2': fit(mix(c.text, c.paper, steps[0]), backgrounds, 4.5),
      '--c-ink-3': fit(mix(c.text, c.paper, steps[1]), backgrounds, 4.5),
      '--c-ink-4': fit(mix(c.text, c.paper, steps[2]), backgrounds, 4.5),
      '--c-border': fit(mix(c.paper, c.text, 0.3), backgrounds, 3),
      '--c-border-soft': mix(c.paper, c.text, 0.16),
      '--c-rule-strong': fit(mix(c.paper, c.text, 0.42), backgrounds, 3),
      '--c-primary': c.accent,
      '--c-primary-soft': s.selected,
      '--c-primary-hover': mix(c.accent, onAccent === '#ffffff' ? '#000000' : '#ffffff', 0.12),
      '--c-primary-border': fit(mix(c.paper, c.accent, 0.55), backgrounds, 3),
      '--c-focus': fit(c.accent, backgrounds, 3),
      '--c-focus-ring': mix(c.paper, c.accent, 0.3),
      '--c-on-accent': onAccent,
      '--c-row-alt': mix(c.paper, c.canvas, 0.25),
    };
    // Learning colors keep their own hues and paired backgrounds, independently of the chosen accent.
    var semantic = {
      ok: '#2d7d50',
      warn: '#a87028',
      danger: '#a83240',
      favorite: '#b07d2a',
      info: '#0f766e',
      grammar: c.accent,
      play: '#1b7a5a',
    };
    Object.keys(semantic).forEach(function (name) {
      var base = fit(semantic[name], backgrounds, 4.5),
        soft = mix(c.paper, base, 0.1);
      result['--c-' + name] = fit(base, backgrounds.concat([soft]), 4.5);
      result['--c-on-' + name] =
        contrast(result['--c-' + name], '#ffffff') >= contrast(result['--c-' + name], '#000000')
          ? '#ffffff'
          : '#000000';
      result['--c-' + name + '-soft'] = soft;
      result['--c-' + name + '-bg'] = soft;
      result['--c-' + name + '-text'] = fit(base, [soft], 4.5);
      result['--c-' + name + '-border'] = fit(base, backgrounds, 3);
    });
    // Today's ink desk (style.css .dashboard-shell, light mode) mixes text and
    // accent; its fixed kicker and meta tints need a fallback for palettes
    // where they drop below 4.5:1. Mirrors color-mix(ink 86%, primary).
    if (mode !== 'dark') {
      var desk = mix(c.text, c.accent, 0.14),
        kicker = '#f0a48e',
        deskMeta = mix(desk, '#f6f1e7', 0.64);
      if (contrast(kicker, desk) < 4.5) result['--desk-kicker-fit'] = fit(kicker, [desk], 4.6);
      if (contrast(deskMeta, desk) < 4.5) result['--desk-ink-3-fit'] = fit(deskMeta, [desk], 4.6);
    }
    result['--c-grammar-hover'] = result['--c-grammar'];
    result['--c-accent'] = result['--c-primary'];
    result['--c-accent-red'] = result['--c-danger'];
    result['--c-accent-gold'] = result['--c-favorite'];
    return result;
  }
  function paint(element, state, mode) {
    (owned.get(element) || []).forEach(function (key) {
      element.style.removeProperty(key);
    });
    var values = tokens(state[mode], mode),
      uiFont = font('ui', state.fonts.ui),
      jaFont = font('japanese', state.fonts.japanese);
    if (uiFont.value) values['--font-ui'] = uiFont.value;
    if (jaFont.value) {
      values['--font-ja-serif'] = jaFont.value;
      values['--font-ja-sans'] = jaFont.value;
    }
    Object.keys(values).forEach(function (key) {
      element.style.setProperty(key, values[key]);
    });
    owned.set(element, Object.keys(values));
    element.setAttribute('data-appearance', isOriginal(state[mode], mode) ? 'original' : 'custom');
    // The preset a palette is based on; style.css gives 简洁 its plain Today card (UI-ART-25).
    element.setAttribute('data-appearance-preset', state[mode].preset);
  }
  var current = read();
  function apply() {
    paint(document.documentElement, current, window.AppTheme.getTheme());
  }
  apply();
  window.addEventListener('app:theme-change', apply);
  window.addEventListener('storage', function (event) {
    if (event.key === KEY || event.key === null) {
      current = read();
      apply();
      window.dispatchEvent(new CustomEvent('app:appearance-change'));
    }
  });
  window.AppAppearance = {
    presets: clone(presets),
    fonts: clone(fonts),
    fields: fields.slice(),
    hex: hex,
    fromPreset: fromPreset,
    defaults: defaults,
    assess: assess,
    repair: repair,
    paint: paint,
    get: function () {
      return clone(current);
    },
    save: function (value) {
      var next = normalize(value);
      if (
        ['light', 'dark'].some(function (mode) {
          return assess(next[mode]).some(function (item) {
            return item.ratio < 4.5;
          });
        })
      )
        throw new Error('请先修正低对比度配色，再应用。');
      localStorage.setItem(KEY, JSON.stringify(next));
      current = next;
      apply();
      window.dispatchEvent(new CustomEvent('app:appearance-change'));
    },
  };
})();
