import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupWorkflows } from '../../../src/features/settings/backup-workflows.ts';

const vault = (title = '当前内容') => ({ notes: [{ id: title, title, body: '<p>正文</p>' }], theme: 'light', trash: [] });

function makeHarness(options = {}) {
  const events = [];
  const current = vault();
  const restored = options.restored || vault('历史内容');
  const workflows = createBackupWorkflows({
    localPreview: options.localPreview ?? false,
    getData: () => { events.push(['get-data']); return structuredClone(current); },
    saveActiveEditor: async () => { events.push(['save-editor']); if (options.saveError) throw Error(options.saveError); },
    confirmAction: async (message, config) => { events.push(['confirm', message, config]); return options.confirmed ?? true; },
    getBackup: async revision => { events.push(['get-backup', revision]); if (options.backupError) throw Error(options.backupError); return structuredClone(options.snapshot || restored); },
    exportBackup: async data => { events.push(['export-backup', structuredClone(data)]); if (options.exportError) throw Error(options.exportError); },
    createBackupSnapshot: async () => { events.push(['create-snapshot']); if (options.snapshotError) throw Error(options.snapshotError); },
    readBackup: async file => { events.push(['read-backup', file]); if (options.readError) throw Error(options.readError); return structuredClone(restored); },
    validateVault: data => { events.push(['validate', structuredClone(data)]); if (options.validationError) throw Error(options.validationError); return data; },
    cleanHTML: html => `safe:${html || ''}`,
    commitSave: async data => { events.push(['commit-save', structuredClone(data)]); if (options.commitError) throw Error(options.commitError); },
    replaceWorkspace: (data, mode) => events.push(['replace-workspace', structuredClone(data), mode]),
    downloadJSON: (data, filename) => events.push(['download', structuredClone(data), filename]),
    pruneAssets: async () => { events.push(['prune-assets']); if (options.pruneError) throw Error(options.pruneError); },
    clearImportFile: () => events.push(['clear-import-file']),
    notify: message => events.push(['notify', message])
  });
  return { workflows, events, current };
}

test('history restore backs up and snapshots current data before the SQLite replacement', async () => {
  const harness = makeHarness();
  await harness.workflows.restoreSnapshot(12);
  const names = harness.events.map(event => event[0]);
  assert.ok(names.indexOf('export-backup') < names.indexOf('create-snapshot'));
  assert.ok(names.indexOf('create-snapshot') < names.indexOf('commit-save'));
  assert.ok(names.indexOf('commit-save') < names.indexOf('replace-workspace'));
  assert.deepEqual(harness.events.find(event => event[0] === 'replace-workspace')[1].notes[0].body, 'safe:<p>正文</p>');
  assert.equal(harness.events.find(event => event[0] === 'replace-workspace')[2], 'restore');
  assert.equal(harness.events.find(event => event[0] === 'notify')[1], '历史版本已恢复');
});

test('history restore reports committed success when post-restore asset cleanup fails', async () => {
  const harness = makeHarness({ pruneError: '磁盘暂时不可用' });

  await harness.workflows.restoreSnapshot(12);

  const names = harness.events.map(event => event[0]);
  assert.ok(names.indexOf('commit-save') < names.indexOf('replace-workspace'));
  const notice = harness.events.find(event => event[0] === 'notify')[1];
  assert.match(notice, /^历史版本已恢复/);
  assert.match(notice, /附件清理未完成：磁盘暂时不可用/);
  assert.doesNotMatch(notice, /恢复未完成/);
});

test('cancelled history restore performs no backup, snapshot, or replacement', async () => {
  const harness = makeHarness({ confirmed: false });
  await harness.workflows.restoreSnapshot(12);
  assert.deepEqual(harness.events.map(event => event[0]), ['confirm']);
});

test('failed history replacement leaves the current workspace in place', async () => {
  const harness = makeHarness({ commitError: '服务端提交失败' });
  await harness.workflows.restoreSnapshot(12);
  assert.equal(harness.events.some(event => event[0] === 'replace-workspace'), false);
  assert.ok(harness.events.some(event => event[0] === 'notify' && /恢复未完成：服务端提交失败/.test(event[1])));
});

test('backup import saves the editor, exports a recovery copy, then commits before replacing data', async () => {
  const harness = makeHarness();
  const file = { name: 'backup.json' };
  await harness.workflows.importBackup(file);
  const names = harness.events.map(event => event[0]);
  assert.ok(names.indexOf('save-editor') < names.indexOf('export-backup'));
  assert.ok(names.indexOf('export-backup') < names.indexOf('create-snapshot'));
  assert.ok(names.indexOf('create-snapshot') < names.indexOf('read-backup'));
  assert.ok(names.indexOf('commit-save') < names.indexOf('replace-workspace'));
  assert.equal(harness.events.find(event => event[0] === 'read-backup')[1], file);
  assert.equal(harness.events.find(event => event[0] === 'replace-workspace')[2], 'import');
  assert.equal(harness.events.find(event => event[0] === 'notify')[1], '导入完成，知识库已更新');
  assert.equal(names.at(-1), 'clear-import-file');
});

test('backup import reports committed success when post-import asset cleanup fails', async () => {
  const harness = makeHarness({ pruneError: '磁盘暂时不可用' });

  await harness.workflows.importBackup({ name: 'backup.json' });

  const names = harness.events.map(event => event[0]);
  assert.ok(names.indexOf('commit-save') < names.indexOf('replace-workspace'));
  const notice = harness.events.find(event => event[0] === 'notify')[1];
  assert.match(notice, /^导入完成，知识库已更新/);
  assert.match(notice, /附件清理未完成：磁盘暂时不可用/);
  assert.doesNotMatch(notice, /导入失败/);
  assert.equal(names.at(-1), 'clear-import-file');
});

test('local preview backup import does not claim to create a server snapshot or write Docker data', async () => {
  const harness = makeHarness({ localPreview: true });
  await harness.workflows.importBackup({ name: 'backup.json' });
  const confirmation = harness.events.find(event => event[0] === 'confirm')[1];
  const notification = harness.events.find(event => event[0] === 'notify')[1];
  assert.doesNotMatch(confirmation, /服务端快照/);
  assert.equal(notification, '导入完成，本地预览数据已更新');
});

test('cancelled backup import never changes data and still clears the file input', async () => {
  const harness = makeHarness({ confirmed: false });
  await harness.workflows.importBackup({ name: 'backup.json' });
  assert.deepEqual(harness.events.map(event => event[0]), ['confirm', 'clear-import-file']);
});

test('failed backup import does not prune account-wide attachments', async () => {
  const harness = makeHarness({ readError: '备份文件无效' });

  await harness.workflows.importBackup({ name: 'invalid.zip' });

  assert.equal(harness.events.some(event => event[0] === 'prune-assets'), false);
  assert.equal(harness.events.some(event => event[0] === 'replace-workspace'), false);
  assert.ok(harness.events.some(event => event[0] === 'notify' && /导入失败/.test(event[1])));
});

test('full export falls back to a JSON copy if the complete backup export fails', async () => {
  const harness = makeHarness({ exportError: '附件读取失败' });
  await harness.workflows.exportFullBackup();
  const download = harness.events.find(event => event[0] === 'download');
  assert.equal(download[2], '栖点-紧急正文草稿.json');
  assert.equal(download[1].notes[0].title, '当前内容');
  assert.ok(harness.events.some(event => event[0] === 'notify' && /完整备份失败：附件读取失败/.test(event[1])));
});
