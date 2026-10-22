import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const managerPath = new URL('../../../packaging/istoreos/luci-app-qidian/root/usr/libexec/istorec/qidian.sh', import.meta.url);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runPrepareControl(t, { symlinkAt } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'qidian-update-control-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const dockerRoot = join(root, 'docker');
  const dataDir = join(dockerRoot, 'volumes/qidian/data');
  const installDir = join(root, 'opt/qidian');
  const mockBin = join(root, 'mock-bin');
  const outside = join(root, 'outside-data');
  const controlPath = join(dataDir, '.qidian-update-control');
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(installDir, { recursive: true }),
    mkdir(mockBin, { recursive: true }),
    mkdir(outside, { recursive: true }),
  ]);
  await writeFile(join(dataDir, '.qidian-storage'), 'fixture\n');
  await writeFile(join(dataDir, 'user.sqlite'), 'preserved fixture data\n');
  if (symlinkAt === 'control' || symlinkAt === 'inbox' || symlinkAt === 'outbox') {
    const linkPath = symlinkAt === 'control' ? controlPath : join(controlPath, symlinkAt);
    if (symlinkAt !== 'control') await mkdir(controlPath, { recursive: true });
    try {
      await symlink(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
        t.skip('Windows sandbox does not permit creating directory links; this regression runs on Linux CI and in the elevated local check.');
        return null;
      }
      throw error;
    }
  }

  const mockCommands = {
    docker: `#!/bin/sh\nprintf 'docker %s\\n' "$*" >> "$QIDIAN_TEST_COMMAND_LOG"\n[ "$1" = info ] && [ "$2" = --format ] && printf '%s\\n' "$QIDIAN_TEST_DOCKER_ROOT"\n`,
    uci: `#!/bin/sh\nprintf 'uci %s\\n' "$*" >> "$QIDIAN_TEST_COMMAND_LOG"\ncase "$*" in '-q get qidian.main.data_path') printf '%s\\n' "$QIDIAN_TEST_DATA_DIR" ;; esac\n`,
    chown: `#!/bin/sh\nprintf 'chown %s\\n' "$*" >> "$QIDIAN_TEST_COMMAND_LOG"\n`,
    chmod: `#!/bin/sh\nprintf 'chmod %s\\n' "$*" >> "$QIDIAN_TEST_COMMAND_LOG"\n`,
  };
  await Promise.all(Object.entries(mockCommands).map(async ([name, contents]) => {
    const path = join(mockBin, name);
    await writeFile(path, contents);
    await chmod(path, 0o755);
  }));

  const pathResult = spawnSync(bash, ['-c', 'if command -v cygpath >/dev/null 2>&1; then cygpath -u "$QIDIAN_TEST_ROOT"; else printf "%s" "$QIDIAN_TEST_ROOT"; fi'], {
    env: { ...process.env, QIDIAN_TEST_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(pathResult.status, 0, pathResult.stderr);
  const shellRoot = pathResult.stdout.trim();
  const shellDockerRoot = `${shellRoot}/docker`;
  const shellDataDir = `${shellDockerRoot}/volumes/qidian/data`;
  const shellMockBin = `${shellRoot}/mock-bin`;
  const shellLog = `${shellRoot}/commands.log`;
  const source = (await readFile(managerPath, 'utf8'))
    .replaceAll('/tmp', `${shellRoot}/tmp`)
    .replaceAll('/opt/qidian', `${shellRoot}/opt/qidian`);
  await writeFile(join(root, 'qidian.sh'), source);

  const result = spawnSync(bash, ['-s'], {
    input: `export PATH=${quote(shellMockBin)}:"$PATH"\nexport QIDIAN_TEST_DOCKER_ROOT=${quote(shellDockerRoot)}\nexport QIDIAN_TEST_DATA_DIR=${quote(shellDataDir)}\nexport QIDIAN_TEST_COMMAND_LOG=${quote(shellLog)}\n/bin/sh ${quote(`${shellRoot}/qidian.sh`)} prepare-control\n`,
    env: {
      ...process.env,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.ifError(result.error);
  const commandLog = await readFile(join(root, 'commands.log'), 'utf8').catch(() => '');
  return { root, dataDir, installDir, outside, controlPath, result, commandLog };
}

for (const symlinkAt of ['control', 'inbox', 'outbox']) {
  test(`host update setup never follows a container-writable ${symlinkAt} symlink`, async t => {
    const state = await runPrepareControl(t, { symlinkAt });
    if (!state) return;
    const { outside, installDir, dataDir, result, commandLog } = state;

    assert.equal(result.status, 0, `stdout=${result.stdout}; stderr=${result.stderr}; commands=${commandLog}`);
    assert.equal(await exists(join(installDir, 'update-control/inbox')), true, `must create requests under the host-owned install directory; stdout=${result.stdout}; stderr=${result.stderr}; commands=${commandLog}`);
    assert.equal(await exists(join(installDir, 'update-control/outbox')), true, 'must create status under the host-owned install directory');
    assert.doesNotMatch(commandLog, /outside-data/, 'must not change host permissions through a container-controlled symlink');
    assert.equal(await readFile(join(dataDir, 'user.sqlite'), 'utf8'), 'preserved fixture data\n');
    assert.equal(await exists(join(outside, 'inbox')), false, 'must not create the request directory in a symlink target');
    assert.equal(await exists(join(outside, 'outbox')), false, 'must not create the status directory in a symlink target');
  });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
