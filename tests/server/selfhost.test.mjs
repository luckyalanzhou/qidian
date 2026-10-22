import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openSelfHostedDatabase } from '../../server/sqlite-migrations.mjs';
import { createSelfHostedServer } from '../../server/http-server.mjs';
import { readStorageCapacity } from '../../server/storage-capacity.mjs';
import { QIDIAN_PORT } from '../../server/selfhost.mjs';
import { queueQidianUpdate, qidianUpdaterReady, readQidianUpdateStatus } from '../../server/host-updater.mjs';
import { makeRegistrationCredential } from '../../src/features/auth/credentials.js';

test('self-hosted application listens on its fixed container port', async () => {
  const source = await readFile(resolve('server/selfhost.mjs'), 'utf8');
  const config = await readFile(resolve('server/config.mjs'), 'utf8');
  const dockerfile = await readFile(resolve('Dockerfile'), 'utf8');
  const compose = await readFile(resolve('packaging/docker/compose.yaml'), 'utf8');
  assert.equal(QIDIAN_PORT, 9908);
  assert.match(config, /export const QIDIAN_PORT = 9908/);
  assert.match(source, /server\.listen\(config\.port, config\.host/);
  assert.doesNotMatch(source, /process\.env\.PORT/);
  assert.match(dockerfile, /EXPOSE 9908/);
  assert.match(compose, /:9908:9908/);
  assert.doesNotMatch(compose, /APP_PORT|PORT:/);
  assert.doesNotMatch(dockerfile, /PORT=9908/);
  assert.doesNotMatch(compose, /\bPORT:/);
});

test('self-hosted SQLite migrations back up schema changes and serve a private app over HTTP', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'qidian-selfhost-'));
  const data = join(temp, 'data');
  const staticRoot = join(temp, 'dist');
  await mkdir(staticRoot, { recursive: true });
  await mkdir(join(staticRoot, 'assets'), { recursive: true });
  await writeFile(join(staticRoot, 'index.html'), '<!doctype html><title>Qidian</title>');
  await writeFile(join(staticRoot, 'assets', 'editor-extensions-K4QiaSOV.js'), 'hashed asset');
  await writeFile(join(staticRoot, 'assets', 'plain.js'), 'unhashed asset');

  const DB = await openSelfHostedDatabase({ databasePath: join(data, 'qidian.sqlite'), migrationsDir: resolve('migrations') });
  const migrations = await DB.prepare('SELECT name FROM qidian_schema_migrations ORDER BY name').all();
  assert.deepEqual(migrations.results.map(item => item.name), [
    '0001_initial.sql', '0002_accounts.sql', '0003_email_auth.sql', '0004_account_profiles.sql', '0005_snapshot_retention.sql', '0006_username_only_login.sql', '0007_session_idle_timeout.sql', '0008_streamed_unbounded_assets.sql'
  ]);
  const backups = await (await import('node:fs/promises')).readdir(join(data, 'migration-backups'));
  assert.equal(backups.length, 7, 'each data or schema migration after the first leaves a pre-change database copy');

  const server = createSelfHostedServer({ DB, root: staticRoot, storagePath:data, registrationEnabled: true, trustProxy: true, trustedProxies:['127.0.0.1'] });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    DB.close();
    await rm(temp, { recursive: true, force: true });
  });

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Qidian/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(page.headers.get('content-security-policy'), /worker-src 'self'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const hashedAsset = await fetch(`${base}/assets/editor-extensions-K4QiaSOV.js`);
  assert.equal(hashedAsset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const unhashedAsset = await fetch(`${base}/assets/plain.js`);
  assert.equal(unhashedAsset.headers.get('cache-control'), 'no-store');
  const ready = await fetch(`${base}/readyz`);
  assert.equal(ready.status,200);
  assert.equal(await ready.text(),'ready');
  assert.equal(server.headersTimeout,15_000);
  assert.equal(server.requestTimeout,0);
  assert.equal(server.timeout,120_000);
  const unauthenticated = await fetch(`${base}/api/vault`);
  assert.equal(unauthenticated.status, 401);
  const missingFile = await fetch(`${base}/missing.js`);
  assert.equal(missingFile.status, 404);

  const credential = await makeRegistrationCredential('Selfhost secure phrase 8!');
  const registered = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://qidian.local:9908',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'qidian.local:9908',
      'X-Forwarded-For': '198.51.100.4'
    },
    body: JSON.stringify({ username: 'selfhost_user', ...credential })
  });
  assert.equal(registered.status, 201, await registered.text());
  assert.match(registered.headers.get('set-cookie'), /; Secure/);
  const created = await (await DB.prepare('SELECT id FROM accounts WHERE username_normalized = ?').bind('selfhost_user').first());
  assert.ok(created?.id);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS count FROM auth_throttles WHERE bucket_key LIKE ?').bind('%').first()).count, 2);
  const unauthenticatedStorage = await fetch(`${base}/api/system/storage`);
  assert.equal(unauthenticatedStorage.status,401,'storage usage is private');
  const storage = await fetch(`${base}/api/system/storage`, { headers:{ Cookie:registered.headers.get('set-cookie').split(';')[0], Origin:base } });
  assert.equal(storage.status,200);
  assert.deepEqual(await storage.json(),await readStorageCapacity(data),'self-hosted endpoint reads the mounted data directory capacity');
  const largeBytes = new Uint8Array(8*1024*1024+1).fill(29);
  const largeUpload = await fetch(`${base}/api/assets`, {
    method:'POST',
    headers:{ Origin:base, Cookie:registered.headers.get('set-cookie').split(';')[0], 'X-File-Name':'large.bin' },
    body:largeBytes
  });
  assert.equal(largeUpload.status,201,await largeUpload.clone().text());
  const largeAsset = await largeUpload.json();
  assert.equal(largeAsset.size,largeBytes.length);
  const largeDownload = await fetch(`${base}/api/assets/${largeAsset.id}`, {
    headers:{ Origin:base, Cookie:registered.headers.get('set-cookie').split(';')[0] }
  });
  assert.equal(largeDownload.status,200);
  let streamedBytes=0, firstByte=-1, lastByte=-1;
  const assetReader=largeDownload.body.getReader();
  for (;;) {
    const { done, value } = await assetReader.read();
    if (done) break;
    if (firstByte < 0 && value.length) firstByte=value[0];
    if (value.length) lastByte=value.at(-1);
    streamedBytes+=value.length;
  }
  assert.equal(streamedBytes,largeBytes.length);
  assert.equal(firstByte,29);
  assert.equal(lastByte,29);

  const plainHttpCredential = await makeRegistrationCredential('Plain http phrase 9!');
  const plainHttpRegistration = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: 'plain_http_user', ...plainHttpCredential })
  });
  assert.equal(plainHttpRegistration.status, 201, await plainHttpRegistration.text());
  assert.doesNotMatch(plainHttpRegistration.headers.get('set-cookie'), /; Secure/);
});

test('self-hosted registration permits one owner bootstrap and then closes by default', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'qidian-bootstrap-'));
  const staticRoot = join(temp, 'dist');
  await mkdir(staticRoot, { recursive: true });
  await writeFile(join(staticRoot, 'index.html'), '<!doctype html><title>Qidian</title>');
  const DB = await openSelfHostedDatabase({ databasePath: join(temp, 'data', 'qidian.sqlite'), migrationsDir: resolve('migrations') });
  const server = createSelfHostedServer({ DB, root: staticRoot, registrationEnabled: false });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    DB.close();
    await rm(temp, { recursive: true, force: true });
  });

  assert.deepEqual(await (await fetch(`${base}/api/auth/config`)).json(), { registrationEnabled: true, setupRequired: true });
  const credential = await makeRegistrationCredential('Bootstrap secure phrase 8!');
  const registered = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: 'owner_user', ...credential })
  });
  assert.equal(registered.status, 201, await registered.text());
  assert.deepEqual(await (await fetch(`${base}/api/auth/config`)).json(), { registrationEnabled: false, setupRequired: false });

  const nextCredential = await makeRegistrationCredential('Second secure phrase 8!');
  const nextRegistration = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: 'second_user', ...nextCredential })
  });
  assert.equal(nextRegistration.status, 403);
});

test('self-hosted update bridge exposes bounded logs and accepts only one queued update', async t => {
  const control = await mkdtemp(join(tmpdir(), 'qidian-update-bridge-'));
  t.after(() => rm(control, { recursive:true, force:true }));
  const inbox=join(control,'inbox'),outbox=join(control,'outbox');
  await mkdir(inbox);await mkdir(outbox);
  assert.equal(await qidianUpdaterReady(outbox), false);
  assert.equal(await queueQidianUpdate(inbox), true);
  assert.equal(await queueQidianUpdate(inbox), false, 'an existing update request cannot be overwritten');
  assert.deepEqual(await readQidianUpdateStatus(outbox,inbox), { state:'queued', version:'', updatedAt:null, logUpdatedAt:null, log:'' });
  await writeFile(join(outbox,'update-agent-ready'),'ready');
  await writeFile(join(outbox,'update-status'),'running\t0.1.6\t1791763200\n');
  await writeFile(join(outbox,'update.log'),'x'.repeat(70000));
  const status = await readQidianUpdateStatus(outbox,inbox);
  assert.equal(status.state,'running');
  assert.equal(status.version,'0.1.6');
  assert.equal(status.log.length,65536);
  assert.ok(Number.isFinite(status.logUpdatedAt),'log timestamp reflects the log file modification time');
  assert.equal(await qidianUpdaterReady(outbox),true);
  await rm(join(outbox,'update-agent-ready'));
  assert.equal((await readQidianUpdateStatus(outbox,inbox)).state,'running','the persisted update state survives a brief updater-agent restart');
  await rm(join(inbox,'update-request'));
  assert.equal(await queueQidianUpdate(inbox,outbox),false,'an active update cannot be queued again after its marker is claimed');
});

test('a new pending update does not display the previous failed job or its stale log', async t => {
  const control=await mkdtemp(join(tmpdir(),'qidian-pending-update-'));
  t.after(()=>rm(control,{recursive:true,force:true}));
  const inbox=join(control,'inbox'),outbox=join(control,'outbox');
  await mkdir(inbox);await mkdir(outbox);
  await writeFile(join(outbox,'update-agent-ready'),'ready');
  await writeFile(join(outbox,'update-status'),'failed\t0.1.14\t1791763200\n');
  await writeFile(join(outbox,'update.log'),'old task failure');
  await writeFile(join(inbox,'update-request'),'update\n');
  assert.deepEqual(await readQidianUpdateStatus(outbox,inbox),{state:'queued',version:'',updatedAt:null,logUpdatedAt:null,log:''});
  await rm(join(inbox,'update-request'));
  const previous=await readQidianUpdateStatus(outbox,inbox);
  assert.equal(previous.state,'failed');
  assert.equal(previous.log,'old task failure');
});
