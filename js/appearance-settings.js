(function () {
  'use strict';
  var api = window.AppAppearance;
  function init() {
    var dialog = document.getElementById('appearanceDialog');
    if (!dialog || !api) return;
    var escape = window.JPLearn.html.escape;
    var preview = document.getElementById('appearancePreview');
    var status = document.getElementById('appearanceStatus');
    var applyButton = document.getElementById('appearanceApply');
    var draft,
      raw,
      mode,
      stale,
      saving,
      restoreFocus = true;
    var names = { accent: '强调色', canvas: '页面背景', paper: '阅读纸面', text: '主要文字' };
    var labels = { light: '浅色', dark: '深色' };

    document.getElementById('appearanceColors').innerHTML = api.fields
      .map(function (field) {
        return (
          '<label class="appearance-color"><span>' +
          names[field] +
          '</span><span class="appearance-color-inputs">' +
          '<input type="color" data-color="' +
          field +
          '" aria-label="' +
          names[field] +
          '选择器">' +
          '<input type="text" data-hex="' +
          field +
          '" aria-label="' +
          names[field] +
          '颜色值" aria-describedby="appearanceColorHelp" spellcheck="false" autocomplete="off" maxlength="7"></span></label>'
        );
      })
      .join('');
    Object.keys(api.fonts).forEach(function (group) {
      document.getElementById('appearanceFont-' + group).innerHTML = api.fonts[group]
        .map(function (item) {
          return '<option value="' + item.id + '">' + escape(item.name) + '</option>';
        })
        .join('');
    });
    function resetRaw() {
      raw = { light: Object.assign({}, draft.light.colors), dark: Object.assign({}, draft.dark.colors) };
    }
    function hasInvalid(theme) {
      return api.fields.some(function (field) {
        return !api.hex(raw[theme][field]);
      });
    }
    function renderPresets() {
      var entry = draft[mode];
      document.getElementById('appearancePresets').innerHTML = api.presets
        .map(function (item) {
          var colors = api.fromPreset(item.id, mode).colors;
          var selected = api.fields.every(function (field) {
            return entry.colors[field] === colors[field];
          });
          return (
            '<button type="button" class="appearance-preset" data-preset="' +
            item.id +
            '" aria-pressed="' +
            selected +
            '">' +
            '<span class="appearance-swatches" aria-hidden="true">' +
            ['canvas', 'paper', 'text', 'accent']
              .map(function (field) {
                return '<i style="background:' + colors[field] + '"></i>';
              })
              .join('') +
            '</span><strong>' +
            escape(item.name) +
            '</strong><small>' +
            escape(item.note) +
            '</small></button>'
          );
        })
        .join('');
    }
    function updatePreview() {
      preview.setAttribute('data-theme', mode);
      api.paint(preview, draft, mode);
      var selected = api.fromPreset(draft[mode].preset, mode);
      var custom = api.fields.some(function (field) {
        return selected.colors[field] !== draft[mode].colors[field];
      });
      var name = api.presets.find(function (item) {
        return item.id === draft[mode].preset;
      }).name;
      document.getElementById('appearancePreviewName').textContent =
        labels[mode] + ' · ' + (custom ? '自定义（基于' + name + '）' : name);
      document.getElementById('appearanceModeHint').textContent =
        '正在编辑' + labels[mode] + '配色；当前页面使用' + labels[window.AppTheme.getTheme()] + '。';
      var report = api.assess(draft[mode]);
      var invalid = hasInvalid('light') || hasInvalid('dark');
      var lowModes = ['light', 'dark'].filter(function (theme) {
        return api.assess(draft[theme]).some(function (item) {
          return item.ratio < 4.5;
        });
      });
      document.getElementById('appearanceContrast').textContent = report
        .map(function (item) {
          return item.label + ' ' + item.ratio.toFixed(2) + ':1';
        })
        .join('；');
      document.getElementById('appearanceContrast').setAttribute(
        'data-low',
        String(
          report.some(function (item) {
            return item.ratio < 4.5;
          }),
        ),
      );
      document.getElementById('appearanceRepair').hidden = !report.some(function (item) {
        return item.ratio < 4.5;
      });
      applyButton.disabled = invalid || lowModes.length > 0 || stale;
      status.textContent = stale
        ? '另一页面已更新外观。请取消并重新打开，再继续编辑。'
        : invalid
          ? '请输入 #RRGGBB 或 #RGB 颜色值；无效输入不会进入预览。'
          : lowModes.length
            ? lowModes
                .map(function (theme) {
                  return labels[theme];
                })
                .join('、') + '配色对比度偏低，请修正至 4.5:1 后应用。'
            : '仅预览，应用后保存到这台设备。';
    }
    function renderFields() {
      document.getElementById('appearanceEditMode').value = mode;
      api.fields.forEach(function (field) {
        dialog.querySelector('[data-color="' + field + '"]').value = draft[mode].colors[field];
        var input = dialog.querySelector('[data-hex="' + field + '"]');
        input.value = raw[mode][field];
        input.setAttribute('aria-invalid', String(!api.hex(input.value)));
      });
      Object.keys(api.fonts).forEach(function (group) {
        document.getElementById('appearanceFont-' + group).value = draft.fonts[group];
      });
      renderPresets();
      updatePreview();
    }
    function close(focus) {
      restoreFocus = focus !== false;
      dialog.close();
    }
    window.JPLearn.topLayer.register('appearance', { close: close });
    document.getElementById('appAppearanceOpen').addEventListener('click', function () {
      preview.appendChild(document.getElementById('appearanceSampleTemplate').content.cloneNode(true));
      draft = api.get();
      resetRaw();
      mode = window.AppTheme.getTheme();
      stale = saving = false;
      restoreFocus = true;
      dialog.setAttribute('data-theme', mode);
      renderFields();
      window.JPLearn.topLayer.requestOpen('appearance');
      dialog.showModal();
      document.getElementById('appearanceEditMode').focus();
      document.getElementById('appearanceBody').scrollTop = 0;
    });
    dialog.addEventListener('close', function () {
      window.JPLearn.topLayer.release('appearance');
      draft = null;
      var sample = preview.querySelector('.appearance-sample-content');
      if (sample) sample.remove();
      if (restoreFocus) document.getElementById('appSettingsToggle').focus({ preventScroll: true });
    });
    dialog.addEventListener('keydown', function (event) {
      // Do not let the underlying settings/global shortcuts steal a modal's focus.
      event.stopPropagation();
      if (event.key === 'Tab') {
        var controls = Array.from(
          dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])'),
        ).filter(function (el) {
          return el.getClientRects().length && !el.closest('[hidden]');
        });
        var first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    });
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      close(true);
    });
    ['appearanceCancel', 'appearanceClose'].forEach(function (id) {
      document.getElementById(id).addEventListener('click', function () {
        close(true);
      });
    });
    document.getElementById('appearanceEditMode').addEventListener('change', function () {
      mode = this.value;
      renderFields();
    });
    document.getElementById('appearancePresets').addEventListener('click', function (event) {
      var button = event.target.closest('[data-preset]');
      if (!button) return;
      var id = button.getAttribute('data-preset');
      draft[mode] = api.fromPreset(id, mode);
      raw[mode] = Object.assign({}, draft[mode].colors);
      renderFields();
      dialog.querySelector('[data-preset="' + id + '"]').focus({ preventScroll: true });
    });
    document.getElementById('appearanceColors').addEventListener('input', function (event) {
      var field = event.target.getAttribute('data-hex') || event.target.getAttribute('data-color');
      if (!field) return;
      raw[mode][field] = event.target.value;
      var value = api.hex(event.target.value);
      if (value) draft[mode].colors[field] = value;
      var hexInput = dialog.querySelector('[data-hex="' + field + '"]');
      hexInput.setAttribute('aria-invalid', String(!value));
      if (event.target.hasAttribute('data-color')) hexInput.value = value;
      else if (value) dialog.querySelector('[data-color="' + field + '"]').value = value;
      renderPresets();
      updatePreview();
    });
    Object.keys(api.fonts).forEach(function (group) {
      document.getElementById('appearanceFont-' + group).addEventListener('change', function () {
        draft.fonts[group] = this.value;
        updatePreview();
      });
    });
    document.getElementById('appearanceRestorePreset').addEventListener('click', function () {
      draft[mode] = api.fromPreset(draft[mode].preset, mode);
      raw[mode] = Object.assign({}, draft[mode].colors);
      renderFields();
    });
    document.getElementById('appearanceReset').addEventListener('click', function () {
      draft = api.defaults();
      resetRaw();
      renderFields();
      status.textContent = '已预览浅深两套默认配色（简洁）与字体；应用后保存。';
    });
    document.getElementById('appearanceRepair').addEventListener('click', function () {
      draft[mode] = api.repair(draft[mode]);
      raw[mode] = Object.assign({}, draft[mode].colors);
      renderFields();
      status.textContent = '已修正文字与强调色，必要时调整背景明度；应用后保存。';
    });
    document.getElementById('appearanceApply').addEventListener('click', function () {
      try {
        saving = true;
        api.save(draft);
        close(true);
      } catch (error) {
        status.textContent = '未能保存外观，原设置仍保留。请重试或取消。';
      } finally {
        saving = false;
      }
    });
    document.getElementById('appearancePreviewJump').addEventListener('click', function () {
      document.getElementById('appearancePreviewName').focus();
    });
    preview.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button) return;
      if (button.id === 'appearancePreviewAction')
        document.getElementById('appearancePreviewFeedback').textContent =
          '预览完成。喜欢这套外观的话，可以点击应用。';
      if (button.id === 'appearancePreviewFavorite') {
        var selected = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(selected));
        button.textContent = selected ? '已收藏' : '收藏';
      }
    });
    window.addEventListener('app:appearance-change', function () {
      if (dialog.open && !saving) {
        stale = true;
        updatePreview();
      }
    });
    window.addEventListener('app:theme-change', function () {
      if (dialog.open) updatePreview();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
