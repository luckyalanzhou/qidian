import test from 'node:test';
import assert from 'node:assert/strict';
import { findVault, findVaultRevision, saveVaultAtRevision } from '../../server/repositories/vault-repository.js';
import { createCurrentVaultSnapshot, findVaultSnapshot, listVaultSnapshots } from '../../server/repositories/backup-repository.js';
import { deleteAccountAssets, findAccountAsset, findAssetPruneCandidates, listAccountAssetChunks, listAccountAssets, saveAccountAsset } from '../../server/repositories/asset-repository.js';
import { clearAccountAvatar, findAccountAvatar, findAccountPasswordHash, findAccountPasswordSalt, findAccountProfile, findFirstAccount, saveAccountAvatar, updateAccountPassword } from '../../server/repositories/account-repository.js';
import {
  consumeAuthChallenge, createAuthChallenge, createRegisteredAccount, createSession,
  deleteSession, findAccountByNormalizedUsername, findAuthChallenge, findChallengeAccount,
  findAuthorizedSession, findLegacyClaim, findLegacyDataForFirstOwner, findRegistrationName,
  hasAccountVault, recordAuthThrottleAttempts, refreshSessionExpiry
} from '../../server/repositories/auth-repository.js';
import { findLocalAccountForPasswordReset, resetLocalAccountPassword } from '../../server/repositories/local-account-repository.mjs';

function database({ firstResults = [] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        first: async () => { calls.push({ sql, parameters: [] }); return firstResults.shift() ?? null; },
        bind(...parameters) {
          const statement = { sql, parameters };
          calls.push(statement);
          statement.first = async () => firstResults.shift() ?? null;
          statement.all = async () => ({ results: [] });
          statement.run = async () => ({ meta: { changes: 1 } });
          return statement;
        }
      };
    },
    async batch(statements) { calls.push({ batch: statements }); }
  };
}

test('vault repository keeps every lookup and revision-checked write scoped to one account', async () => {
  const db = database({ firstResults: [{ revision: 4, data: '{"notes":[]}' }, { revision: 4 }] });
  assert.deepEqual(await findVault(db, 'account-a'), { revision: 4, data: '{"notes":[]}' });
  assert.deepEqual(await findVaultRevision(db, 'account-a'), { revision: 4 });
  const saved = await saveVaultAtRevision(db, {
    accountId: 'account-a', revision: 4, data: '{"notes":[1]}', updated: 100
  });
  assert.equal(saved.meta.changes, 1);
  assert.deepEqual(db.calls.map(call => call.parameters), [
    ['account-a'], ['account-a'], ['{"notes":[1]}', 100, 'account-a', 4]
  ]);
  assert.match(db.calls[2].sql, /WHERE account_id = \? AND revision = \?/);
});

test('snapshot repository scopes list, read, create and retention cleanup by account', async () => {
  const db = database({ firstResults: [{ revision: 7, data: '{"notes":[]}' }, { revision: 6, data: '{"notes":[1]}' }] });
  await listVaultSnapshots(db, 'account-a');
  assert.deepEqual(await createCurrentVaultSnapshot(db, 'account-a', 500), { revision: 7, created: 500 });
  const batch = db.calls[4].batch;
  assert.equal(batch.length, 2);
  assert.deepEqual(batch[0].parameters, ['account-a', 7, '{"notes":[]}', 500]);
  assert.deepEqual(batch[1].parameters, ['account-a', 'account-a']);
  assert.match(batch[1].sql, /LIMIT 20/);
  assert.deepEqual(await findVaultSnapshot(db, 'account-a', 6), { revision: 6, data: '{"notes":[1]}' });
  assert.deepEqual(db.calls.at(-1).parameters, ['account-a', 6]);
  assert.equal(await createCurrentVaultSnapshot(database(), 'account-a', 600), null, 'missing account data creates no snapshot');
});

test('asset repository chunks uploads and scopes metadata, content, pruning and deletion by account', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return { bind(...parameters) {
        const statement = { sql, parameters };
        calls.push(statement);
        statement.first = async () => ({ id: 'asset-1', size: 2 });
        statement.all = async () => ({ results: [] });
        return statement;
      } };
    },
    async batch(statements) { calls.push({ batch: statements }); }
  };
  const chunkSize = 256 * 1024, bytes = new Uint8Array(chunkSize + 2);
  bytes[chunkSize] = 7;
  await saveAccountAsset(db, { accountId: 'account-a', id: 'asset-1', name: 'a.bin', mime: 'application/octet-stream', size: bytes.length, created: 10, bytes });
  const upload = calls.find(call => call.batch)?.batch;
  assert.equal(upload.length, 3, 'metadata and two ordered chunks are written together');
  assert.deepEqual(upload.map(statement => statement.parameters.slice(0, 3)), [
    ['account-a', 'asset-1', 'a.bin'], ['account-a', 'asset-1', 0], ['account-a', 'asset-1', 1]
  ]);
  await listAccountAssets(db, 'account-a');
  await findAccountAsset(db, 'account-a', 'asset-1');
  await listAccountAssetChunks(db, 'account-a', 'asset-1');
  await findAssetPruneCandidates(db, 'account-a');
  await deleteAccountAssets(db, 'account-a', ['asset-1']);
  const sql = calls.filter(call => call.sql).map(call => call.sql);
  assert.ok(sql.every(statement => /account_id/.test(statement)), 'every asset mutation carries an account ID');
  assert.ok(sql.filter(statement => /^(SELECT|DELETE)/.test(statement)).every(statement => /WHERE account_id = \?/.test(statement)), 'every asset read and delete filters by account');
  assert.ok(sql.some(statement => /SELECT id, size, created FROM account_assets/.test(statement)), 'pruning reads asset ages before deleting unreferenced uploads');
  assert.deepEqual(calls.at(-1).batch[0].parameters, ['account-a', 'asset-1']);
});

test('account repository scopes account data and keeps password update plus session revocation conditional', async () => {
  const db = database();
  await findAccountProfile(db, 'account-a');
  await findAccountAvatar(db, 'account-a');
  await saveAccountAvatar(db, { accountId: 'account-a', bytes: new ArrayBuffer(4), mime: 'image/png', updated: 10 });
  await clearAccountAvatar(db, 'account-a', 11);
  await findAccountPasswordSalt(db, 'account-a');
  await findAccountPasswordHash(db, 'account-a');
  await findFirstAccount(db);
  await updateAccountPassword(db, {
    accountId: 'account-a', expectedHash: 'old-hash', salt: 'new-salt', hash: 'new-hash', iterations: 600000, currentSessionHash: 'session-hash'
  });
  const statements = db.calls.at(-1).batch;
  assert.equal(statements.length, 2, 'credential update and revocation are submitted in one database batch');
  assert.deepEqual(statements[0].parameters, ['new-salt', 'new-hash', 600000, 'account-a', 'old-hash']);
  assert.deepEqual(statements[1].parameters, ['account-a', 'session-hash', 'account-a', 'new-hash']);
  assert.match(statements[0].sql, /WHERE id = \? AND password_hash = \?/);
  assert.match(statements[1].sql, /WHERE account_id = \?/);
  assert.ok(db.calls.slice(0, 6).every(call => call.parameters.includes('account-a')));
  assert.equal(db.calls[6].sql, 'SELECT id FROM accounts ORDER BY rowid LIMIT 1', 'device ownership is based on the first account, not the caller account');
});

test('auth repository owns challenge, session and atomic first-owner registration SQL', async () => {
  const db = database({ firstResults: [
    { claimed_by: null },
    { revision: 0, data: '{"categories":[],"notes":[],"theme":"light","pasteMode":"rich"}' },
    { count: 0 }, { count: 0 }, { id: 'account-a', username_normalized: 'alan', password_salt: 'salt' },
    { meta: { changes: 1 } }, { id: 'challenge-1', account_id: 'account-a' }, { meta: { changes: 1 } },
    { id: 'account-a', username: 'alan', password_hash: 'hash' },
    { account_id: 'account-a' }, { meta: { changes: 1 } }, { meta: { changes: 1 } }
  ] });

  await findRegistrationName(db, 'alan');
  await findLegacyClaim(db);
  assert.deepEqual(await findLegacyDataForFirstOwner(db), {
    vault: { revision: 0, data: '{"categories":[],"notes":[],"theme":"light","pasteMode":"rich"}' }, snapshotCount: 0, assetCount: 0
  });
  await findAccountByNormalizedUsername(db, 'alan');
  await createAuthChallenge(db, { id: 'challenge-1', accountId: 'account-a', username: 'alan', salt: 'salt', created: 1, expires: 2 });
  await findAuthChallenge(db, 'challenge-1', 1);
  assert.equal((await consumeAuthChallenge(db, 'challenge-1', 1)).meta.changes, 1);
  await findChallengeAccount(db, 'account-a');
  await hasAccountVault(db, 'account-a');
  await createSession(db, { tokenHash: 'token-hash', accountId: 'account-a', created: 1, expires: 2 });
  await deleteSession(db, 'token-hash');

  await createRegisteredAccount(db, {
    accountId: 'account-a', username: 'alan', salt: 'salt', passwordHash: 'hash', iterations: 600000,
    tokenHash: 'token-hash', now: 1, sessionExpires: 3, registrationEnabled: false
  });
  const batch = db.calls.at(-1).batch;
  assert.equal(batch.length, 8, 'owner creation, legacy claim, data adoption, empty vault and session are one atomic batch');
  assert.deepEqual(batch[0].parameters, ['account-a', 'alan', 'alan', 'salt', 'hash', 600000, 1, 0]);
  assert.deepEqual(batch.at(-1).parameters, ['token-hash', 'account-a', 1, 3, 'account-a']);
  assert.ok(batch.slice(2, 6).every(statement => statement.parameters[0] === 'account-a' && statement.parameters[1] === 'account-a'));
  assert.match(db.calls[6].sql, /INSERT INTO auth_challenges/);
  assert.match(db.calls[8].sql, /DELETE FROM auth_challenges/);
  assert.match(db.calls[12].sql, /DELETE FROM sessions/);
});

test('auth repository owns session lookup, conditional renewal and throttle SQL', async () => {
  const db = database({ firstResults: [
    { id: 'account-a', username: 'alan', revision: 4, data: '{}', session_created: 100, session_expires: 200 },
    { attempts: 2 }, { attempts: 5 }
  ] });
  const session = await findAuthorizedSession(db, {
    tokenHash: 'session-hash', now: 150, minimumCreated: 50, includeVault: true
  });
  assert.equal(session.username, 'alan');
  assert.match(db.calls[0].sql, /JOIN account_vaults v ON v\.account_id = a\.id/);
  assert.match(db.calls[0].sql, /s\.token_hash = \? AND s\.expires > \? AND s\.created > \?/);
  assert.deepEqual(db.calls[0].parameters, ['session-hash', 150, 50]);

  await refreshSessionExpiry(db, { tokenHash: 'session-hash', expectedExpiry: 200, expires: 300 });
  assert.deepEqual(db.calls[1].parameters, [300, 'session-hash', 200]);
  assert.match(db.calls[1].sql, /WHERE token_hash = \? AND expires = \?/);

  const counts = await recordAuthThrottleAttempts(db, {
    scopes: [
      { bucketKey: 'login:ip:hash:1000' },
      { bucketKey: 'login:identity:hash:1000' }
    ],
    now: 1500,
    windowStart: 1000,
    retentionCutoff: -86398500
  });
  assert.deepEqual(counts, [{ attempts: 2 }, { attempts: 5 }]);
  const batch = db.calls.find(call => call.batch)?.batch;
  assert.equal(batch.length, 5);
  assert.deepEqual(batch.slice(0, 3).map(statement => statement.parameters), [[-86398500], [1500], [1500]]);
  assert.deepEqual(batch.slice(3).map(statement => statement.parameters), [
    ['login:ip:hash:1000', 1000], ['login:identity:hash:1000', 1000]
  ]);
  const throttleReads = db.calls.filter(call => /SELECT attempts FROM auth_throttles WHERE bucket_key = \?/.test(call.sql));
  assert.equal(throttleReads.length, 2);
  assert.deepEqual(throttleReads.map(call => call.parameters), [['login:ip:hash:1000'], ['login:identity:hash:1000']]);
});

test('local SQLite account repository owns password reset transaction and rollback', () => {
  const calls = [];
  const db = {
    exec(sql) { calls.push({ type: 'exec', sql }); },
    prepare(sql) {
      return {
        get(...parameters) { calls.push({ type: 'get', sql, parameters }); return { id: 'account-a', username: 'alan' }; },
        run(...parameters) {
          calls.push({ type: 'run', sql, parameters });
          return { changes: /UPDATE accounts/.test(sql) ? 1 : /DELETE FROM sessions/.test(sql) ? 2 : 1 };
        }
      };
    }
  };
  assert.deepEqual(findLocalAccountForPasswordReset(db, 'alan'), { id: 'account-a', username: 'alan' });
  assert.deepEqual(resetLocalAccountPassword(db, {
    accountId: 'account-a', salt: 'salt', passwordHash: 'hash', iterations: 600000
  }), { sessionsRevoked: 2 });
  assert.deepEqual(calls.map(call => call.type === 'exec' ? call.sql : call.parameters), [
    ['alan'], 'BEGIN IMMEDIATE', ['salt', 'hash', 600000, 'account-a'], ['account-a'], ['account-a'], 'COMMIT'
  ]);

  calls.length = 0;
  const missingAccount = { ...db, prepare(sql) {
    return { run(...parameters) { calls.push({ type: 'run', sql, parameters }); return { changes: 0 }; } };
  } };
  assert.throws(() => resetLocalAccountPassword(missingAccount, {
    accountId: 'missing', salt: 'salt', passwordHash: 'hash', iterations: 600000
  }), /账号不存在/);
  assert.deepEqual(calls.map(call => call.sql), [
    'BEGIN IMMEDIATE',
    'UPDATE accounts SET password_salt = ?, password_hash = ?, password_iterations = ? WHERE id = ?',
    'ROLLBACK'
  ]);
});
