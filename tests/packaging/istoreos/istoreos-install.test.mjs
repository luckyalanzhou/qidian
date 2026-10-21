import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = (await readFile(new URL('../../../packaging/istoreos/install.sh', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

async function install(t, { existing = false, worker = false, fails = false, failsLuciCopy = false, locked = false, missingResult = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'qidian-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dirs = ['payload/root/usr/libexec/istorec', 'payload/root/etc/init.d', 'payload/root/etc/config',
    'payload/root/usr/lib/lua/luci/view/qidian', 'usr/lib/lua/luci/controller', 'usr/lib/lua/luci/model/cbi',
    'usr/lib/lua/luci/view/qidian', 'etc/config', 'etc/init.d', 'opt/qidian', 'tmp'];
  for (const dir of dirs) await mkdir(join(root, dir), { recursive: true });
  const marker = 'EXISTING USER CONFIGURATION\n';
  await writeFile(join(root, 'payload/compose.yaml'), 'services: {}\n');
  await writeFile(join(root, 'payload/.env.example'), 'APP_BIND_ADDRESS=0.0.0.0\n');
  await writeFile(join(root, 'payload/version'), '0.0.20\n');
  await writeFile(join(root, 'payload/root/etc/config/qidian'), 'config qidian main\n');
  await writeFile(join(root, 'payload/root/usr/lib/lua/luci/view/qidian/status.htm'), 'current page\n');
  await writeFile(join(root, 'payload/root/usr/lib/lua/luci/view/qidian/custom-v0.0.20.htm'), 'current versioned page\n');
  await writeFile(join(root, 'payload/root/usr/libexec/istorec/qidian-updater.sh'), '#!/bin/sh\nexit 0\n');
  await writeFile(join(root, 'payload/root/usr/libexec/istorec/qidian.sh'), `#!/bin/sh
printf '%s\\n' "$*" >> "$QIDIAN_TEST_ROOT/manager.log"
if [ "$1" = install-package ]; then
  [ "\${QIDIAN_INSTALL_LOCK_HELD:-0}" = 1 ] || exit 90
  [ -d "$QIDIAN_TEST_ROOT/tmp/qidian-operation.lock" ] || exit 91
  printf 'DEPLOY LOG\\n'
  [ "\${MOCK_SKIP_RESULT:-0}" != 1 ] || exit 0
  if [ "\${MOCK_DEPLOY_FAIL:-0}" = 1 ]; then
    printf 'failed\\n' > "$QIDIAN_TEST_ROOT/tmp/qidian-operation.result"
    exit 1
  fi
  printf 'success\\n' > "$QIDIAN_TEST_ROOT/tmp/qidian-operation.result"
fi
`);
  await writeFile(join(root, 'payload/root/etc/init.d/qidian-updater'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$QIDIAN_TEST_ROOT/agent.log"\n');
  if (existing) {
    await writeFile(join(root, 'etc/config/qidian'), marker);
    await writeFile(join(root, 'opt/qidian/.env'), marker);
    await mkdir(join(root, 'data'));
    await writeFile(join(root, 'data/user.sqlite'), marker);
  }
  if (locked) await mkdir(join(root, 'tmp/qidian-operation.lock'));
  await writeFile(join(root, 'tmp/qidian-operation.result'), 'success\n');
  await writeFile(join(root, 'usr/lib/lua/luci/view/qidian/status-v0.0.19.htm'), 'stale versioned page\n');
  await writeFile(join(root, 'usr/lib/lua/luci/view/qidian/logs_0.0.18.htm'), 'stale versioned page\n');
  await writeFile(join(root, 'usr/lib/lua/luci/view/qidian/custom.htm'), 'unversioned local page\n');
  const pathResult = spawnSync(bash, ['-c', 'if command -v cygpath >/dev/null 2>&1; then cygpath -u "$QIDIAN_TEST_ROOT"; else printf "%s" "$QIDIAN_TEST_ROOT"; fi'], {
    env: { ...process.env, QIDIAN_TEST_ROOT: root }, encoding: 'utf8'
  });
  assert.equal(pathResult.status, 0, pathResult.stderr);
  const shellRoot = pathResult.stdout.trim();
  // Redirect absolute device paths into this test's isolated temporary device.
  const staged = source.replace(/(?<![A-Za-z0-9_.])\/(opt\/qidian|usr|etc|tmp)(?=[/"})\s;]|$)/g, (_, p) => `${shellRoot}/${p}`);
  await writeFile(join(root, 'payload/install.sh'), staged);
  const result = spawnSync(bash, ['-s'], {
    input: `id() { printf '0\\n'; }
jsonfilter() { :; }
cp() { for arg do case "$arg" in */payload/root/usr/.) [ "\${MOCK_FAIL_LUCI_COPY:-0}" != 1 ] || return 73 ;; esac; done; command cp "$@"; }
uci() { case "$*" in '-q get qidian.main.registration_enabled') printf '0\\n' ;; *) : ;; esac; }
export -f id jsonfilter uci cp
export QIDIAN_TEST_ROOT='${shellRoot}'
export QIDIAN_UPDATE_WORKER=${worker ? '1' : '0'}
export MOCK_DEPLOY_FAIL=${fails ? '1' : '0'}
export MOCK_FAIL_LUCI_COPY=${failsLuciCopy ? '1' : '0'}
export MOCK_SKIP_RESULT=${missingResult ? '1' : '0'}
bash '${shellRoot}/payload/install.sh'
`,
    env: { ...process.env, QIDIAN_TEST_ROOT: root }, encoding: 'utf8', timeout: 15000
  });
  assert.ifError(result.error);
  if (existing) {
    assert.equal(await readFile(join(root, 'etc/config/qidian'), 'utf8'), marker);
    assert.equal(await readFile(join(root, 'opt/qidian/.env'), 'utf8'), marker);
    assert.equal(await readFile(join(root, 'data/user.sqlite'), 'utf8'), marker);
  }
  if (result.status === 0) {
    await access(join(root, 'usr/lib/lua/luci/view/qidian/status.htm'));
    await access(join(root, 'usr/lib/lua/luci/view/qidian/custom.htm'));
    await access(join(root, 'usr/lib/lua/luci/view/qidian/custom-v0.0.20.htm'));
    await assert.rejects(access(join(root, 'usr/lib/lua/luci/view/qidian/status-v0.0.19.htm')));
    await assert.rejects(access(join(root, 'usr/lib/lua/luci/view/qidian/logs_0.0.18.htm')));
  }
  return { root, result };
}

test('manual run installation deploys exactly once and releases its operation lock', async t => {
  const { root, result } = await install(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readFile(join(root, 'manager.log'), 'utf8')).trim().split('\n'), ['prepare-control', 'install-package']);
  assert.match(result.stdout, /DEPLOY LOG/);
  await assert.rejects(access(join(root, 'tmp/qidian-operation.lock')));
});

test('manual run upgrade preserves existing user configuration and data', async t => {
  const { result } = await install(t, { existing: true });
  assert.equal(result.status, 0, result.stderr);
});

test('online run installation leaves deployment to its existing worker', async t => {
  const { root, result } = await install(t, { existing: true, worker: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await readFile(join(root, 'manager.log'), 'utf8')).trim(), 'prepare-control');
  assert.equal((await readFile(join(root, 'agent.log'), 'utf8')).trim(), 'enable');
});

test('deployment failure preserves the installed UI, log and retry marker', async t => {
  const { root, result } = await install(t, { existing: true, fails: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /重试部署/);
  assert.match(await readFile(join(root, 'tmp/qidian-operation.log'), 'utf8'), /DEPLOY LOG/);
  await access(join(root, 'usr/libexec/istorec/qidian.sh'));
  await access(join(root, 'tmp/qidian-deployment.failed'));
  await assert.rejects(access(join(root, 'tmp/qidian-operation.lock')));
});

test('manual installer refuses an active operation without removing its lock', async t => {
  const { root, result } = await install(t, { existing: true, locked: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /另一项操作正在执行/);
  await access(join(root, 'tmp/qidian-operation.lock'));
  await assert.rejects(access(join(root, 'manager.log')));
});

test('a failed LuCI file copy keeps the previous versioned pages available', async t => {
  const { root, result } = await install(t, { existing: true, failsLuciCopy: true });
  assert.notEqual(result.status, 0);
  await access(join(root, 'usr/lib/lua/luci/view/qidian/status-v0.0.19.htm'));
  await access(join(root, 'usr/lib/lua/luci/view/qidian/logs_0.0.18.htm'));
});

test('a successful log pipe cannot mask a missing deployment result or reuse stale success', async t => {
  const { root, result } = await install(t, { existing: true, missingResult: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /重试部署/);
  assert.equal((await readFile(join(root, 'tmp/qidian-operation.result'), 'utf8')).trim(), 'failed');
});
