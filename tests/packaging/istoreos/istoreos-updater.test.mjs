import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('device updater clears stale output and records failures in its configured status directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'qidian-updater-test-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  const outbox = join(root, 'outbox');
  await Promise.all([mkdir(outbox), mkdir(join(root, 'operation.lock')), mkdir(join(root, 'web.lock'))]);
  await writeFile(join(root, 'request'), 'update\n');
  await writeFile(join(outbox, 'update.log'), 'OLD UPDATE SUCCEEDED\n');
  const source = await readFile(new URL('../../../packaging/istoreos/luci-app-qidian/root/usr/libexec/istorec/qidian-updater.sh', import.meta.url), 'utf8');
  const entry = source.lastIndexOf('\ncase "${1:-serve}" in');
  assert.ok(entry > 0);
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const result = spawnSync(bash, ['-s'], {
    input: `${source.slice(0, entry)}\nif command -v cygpath >/dev/null 2>&1; then QIDIAN_TEST_ROOT=$(cygpath -u "$QIDIAN_TEST_ROOT"); fi\nCONTROL_ROOT=$QIDIAN_TEST_ROOT\nOPERATION_LOCK="$QIDIAN_TEST_ROOT/operation.lock"\ndownload() { return 1; }\nrun_update "$QIDIAN_TEST_ROOT/request" "$QIDIAN_TEST_ROOT/web.lock" "$QIDIAN_TEST_ROOT/outbox"\n`,
    env: { ...process.env, QIDIAN_TEST_ROOT:root.replaceAll('\\', '/') },
    encoding:'utf8', timeout:15000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, `updater subprocess status=${result.status}; stdout=${result.stdout}; stderr=${result.stderr}`);
  assert.doesNotMatch(result.stderr, /can't create|No such file/);
  const log = await readFile(join(outbox, 'update.log'), 'utf8');
  assert.doesNotMatch(log, /OLD UPDATE SUCCEEDED/);
  assert.match(log, /无法读取最新 Release/);
  assert.match(log, /更新未完成/);
  assert.match(await readFile(join(outbox, 'update-status'), 'utf8'), /^failed\t\t\d+/);
  await assert.rejects(access(join(root, 'request')));
  await assert.rejects(access(join(root, 'operation.lock')));
  await assert.rejects(access(join(root, 'web.lock')));
});
