import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openSelfHostedDatabase } from '../../server/sqlite-migrations.mjs';

test('unbounded attachment migration preserves old metadata and chunks and removes byte quotas', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'qidian-asset-migration-'));
  t.after(() => rm(temp, { recursive:true, force:true }));
  const oldMigrations = join(temp, 'old-migrations');
  await mkdir(oldMigrations);
  for (const name of [
    '0001_initial.sql', '0002_accounts.sql', '0003_email_auth.sql', '0004_account_profiles.sql',
    '0005_snapshot_retention.sql', '0006_username_only_login.sql', '0007_session_idle_timeout.sql'
  ]) await copyFile(resolve('migrations', name), join(oldMigrations, name));

  const databasePath = join(temp, 'data', 'qidian.sqlite');
  const previous = await openSelfHostedDatabase({ databasePath, migrationsDir:oldMigrations });
  const accountId = 'old-attachment-account';
  try {
    await previous.prepare(`INSERT INTO accounts(id, username, username_normalized, password_salt, password_hash, password_iterations, created)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(accountId, 'legacy', 'legacy', 'salt', 'hash', 600000, 10).run();
    await previous.prepare(`INSERT INTO account_assets(account_id,id,name,mime,size,created) VALUES(?,?,?,?,?,?)`)
      .bind(accountId, 'old-asset', 'old.bin', 'application/octet-stream', 8*1024*1024, 11).run();
    await previous.prepare(`INSERT INTO account_asset_chunks(account_id,asset_id,ordinal,data) VALUES(?,?,?,?)`)
      .bind(accountId, 'old-asset', 0, new Uint8Array([4,5,6])).run();
  } finally {
    previous.close();
  }

  const current = await openSelfHostedDatabase({ databasePath, migrationsDir:resolve('migrations') });
  try {
    assert.deepEqual(await current.prepare('SELECT id,name,size FROM account_assets WHERE account_id=?')
      .bind(accountId).all(), { results:[{ id:'old-asset', name:'old.bin', size:8*1024*1024 }] });
    assert.deepEqual(await current.prepare('SELECT data FROM account_asset_chunks WHERE account_id=? AND asset_id=?')
      .bind(accountId, 'old-asset').all(), { results:[{ data:[4,5,6] }] });

    await current.prepare(`INSERT INTO account_assets(account_id,id,name,mime,size,created) VALUES(?,?,?,?,?,?)`)
      .bind(accountId, 'large-asset', 'large.bin', 'application/octet-stream', 120*1024*1024, 12).run();
    const total = await current.prepare('SELECT SUM(size) AS bytes FROM account_assets WHERE account_id=?').bind(accountId).first();
    assert.equal(total.bytes, 128*1024*1024, 'a single file and the account total may exceed the former 8/100 MiB limits');
    assert.deepEqual((await current.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally {
    current.close();
  }
});
