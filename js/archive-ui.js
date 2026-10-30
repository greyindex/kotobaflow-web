(function () {
  'use strict';
  var dialog, status, preview, incoming;
  var busy = false;
  var restored = false;
  var api = window.JPLearn.archive;
  function summary(snapshot) {
    var v = snapshot.vocabulary;
    return (
      '已认识 ' +
      v.known.length +
      ' · 模糊 ' +
      v.fuzzy.length +
      ' · 未掌握 ' +
      v.unknown.length +
      ' · 收藏 ' +
      v.favorite.length +
      ' · 语法收藏 ' +
      v.grammarFavorite.length +
      ' · SRS ' +
      v.srs.length +
      ' · 学习历史 ' +
      v.history.length +
      ' · ' +
      Object.keys(snapshot.usage).length +
      ' 天学习记录 · 每日目标 ' +
      snapshot.plan.dailyMinutes +
      ' 分钟'
    );
  }
  async function download(snapshot) {
    var archive = await api.exportArchive(snapshot);
    var url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }));
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'kotobaflow-progress-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 60000);
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    dialog.querySelectorAll('button, input, select').forEach(function (control) {
      control.disabled = true;
    });
    status.textContent = '正在处理…';
    try {
      await action();
    } catch (error) {
      status.textContent = error.message || '操作失败，现有记录未被替换';
      preview = incoming = null;
      document.getElementById('archivePreview').hidden = true;
      if (error.restoreCommitted) {
        restored = true;
        document.getElementById('archiveReload').hidden = false;
      }
    } finally {
      busy = false;
      dialog.querySelectorAll('button, input, select').forEach(function (control) {
        control.disabled = false;
      });
      document.getElementById('archiveRestore').disabled = !preview || !incoming;
      if (restored) {
        ['archiveClose', 'archiveFile', 'archiveMode'].forEach(function (id) {
          document.getElementById(id).disabled = true;
        });
      }
    }
  }
  function init() {
    dialog = document.getElementById('archiveDialog');
    status = document.getElementById('archiveStatus');
    if (!dialog) return;
    window.JPLearn.topLayer.register('archive', {
      close: function () {
        if (!busy && !restored) dialog.close();
      },
    });
    document.getElementById('appArchiveOpen').addEventListener('click', function () {
      window.JPLearn.topLayer.requestOpen('archive');
      dialog.showModal();
      preview = incoming = null;
      document.getElementById('archivePreview').hidden = true;
      document.getElementById('archiveRestore').disabled = true;
      document.getElementById('archiveFile').value = '';
      status.textContent = '备份包含学习记录、计划、时长、阅读位置和未完成会话，不包含登录凭据。';
    });
    dialog.addEventListener('cancel', function (event) {
      if (busy || restored) event.preventDefault();
    });
    dialog.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy && !restored) dialog.close();
    });
    dialog.addEventListener('close', function () {
      window.ProgressStore.cancelRestorePreview();
      window.JPLearn.topLayer.release('archive');
      document.getElementById('appSettingsToggle').focus();
    });
    document.getElementById('archiveClose').addEventListener('click', function () {
      dialog.close();
    });
    document.getElementById('archiveExport').addEventListener('click', function () {
      run(async function () {
        await download(window.ProgressStore.exportProgress());
        status.textContent = '备份已生成，请妥善保存下载的 JSON 文件。';
      });
    });
    document.getElementById('archiveBackup').addEventListener('click', function () {
      run(async function () {
        var backup = window.ProgressStore.getRestoreBackup();
        if (!backup) throw new Error('还没有恢复前备份');
        await download(backup);
        status.textContent = '恢复前的页面记录备份已生成。';
      });
    });
    document.getElementById('archiveFile').addEventListener('change', function (event) {
      var file = event.target.files[0];
      preview = incoming = null;
      document.getElementById('archivePreview').hidden = true;
      document.getElementById('archiveRestore').disabled = true;
      if (!file) return;
      run(async function () {
        if (file.size > api.MAX_BYTES) throw new Error('存档超过 8 MB 限制');
        incoming = await api.validate(await file.text());
        preview = await window.ProgressStore.prepareRestore();
        document.getElementById('archiveCurrent').textContent = '当前页面：' + summary(preview.snapshot);
        document.getElementById('archiveIncoming').textContent = '导入文件：' + summary(incoming);
        document.getElementById('archiveRemote').textContent = preview.remote
          ? '本机服务：' + summary(preview.remote)
          : '';
        document.getElementById('archivePreview').hidden = false;
        status.textContent = '校验通过，尚未修改记录。选择恢复方式后再确认。';
      });
    });
    document.getElementById('archiveRemoteBackup').addEventListener('click', function () {
      run(async function () {
        var backup = window.ProgressStore.getRestoreBackup('remote');
        if (!backup) throw new Error('没有本机服务的恢复前备份');
        await download(backup);
        status.textContent = '恢复前的本机服务备份已生成。';
      });
    });
    document.getElementById('archiveRestore').addEventListener('click', function () {
      run(async function () {
        var mode = document.getElementById('archiveMode').value;
        var base = preview.remote ? api.merge(preview.snapshot, preview.remote) : preview.snapshot;
        var next = mode === 'merge' ? api.merge(base, incoming) : incoming;
        await window.ProgressStore.restoreProgress(next, preview);
        restored = true;
        preview = incoming = null;
        document.getElementById('archivePreview').hidden = true;
        document.getElementById('archiveReload').hidden = false;
        status.textContent = '恢复已保存。请重新加载以恢复阅读位置和未完成会话；恢复前备份仍可下载。';
      });
    });
    document.getElementById('archiveReload').addEventListener('click', function () {
      window.location.reload();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
