import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handle } from '../../server/api.js';
import { PASSWORD_ITERATIONS, SESSION_IDLE_TTL, SESSION_TTL, sessionTokenFromCookie, hashSession } from '../../server/auth.js';
import { makeRegistrationCredential, makeLoginVerifier } from '../../src/features/auth/credentials.js';
import { sqliteAdapter } from '../../server/adapters/sqlite-adapter.mjs';
import { ASSET_PRUNE_GRACE_MS } from '../../server/application/asset-service.js';
import { isApiErrorResponse } from '../../shared/api-contracts.js';

let env, alice, bob;
const ALICE = { username: 'alice_notes', password: 'Correct horse battery 7!' };
const BOB = { username: 'bob_notes', password: 'Another secure phrase 4#' };
const legacyAssetId = '00000000-0000-4000-8000-000000000001';
const legacyNote = { id:'legacy-note', title:'旧单人库内容', type:'note', category:'遗留', tags:['迁移'], body:'<p>迁移前的笔记 ✅</p>', source:'', created:1, updated:2, pinned:false };
const legacyVault = { categories:['遗留'], notes:[legacyNote], theme:'light', pasteMode:'rich' };

function migrateStatements(sql) {
  return sql.match(/CREATE TRIGGER[\s\S]*?END;|(?:PRAGMA|CREATE TABLE|CREATE INDEX|INSERT INTO|UPDATE|ALTER TABLE|DROP TRIGGER)[\s\S]*?;/g) || [];
}
const MIGRATION_FILES = ['0001_initial.sql','0002_accounts.sql','0003_email_auth.sql','0004_account_profiles.sql','0005_snapshot_retention.sql','0006_username_only_login.sql','0007_session_idle_timeout.sql'];
async function migrateDatabase(DB) {
  for (const file of MIGRATION_FILES) {
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url),'utf8');
    if (file === '0006_username_only_login.sql') {
      await DB.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
      try {
        await DB.exec(sql);
        assert.deepEqual(await DB.prepare('PRAGMA foreign_key_check').all(), { results:[] });
        await DB.exec('COMMIT; PRAGMA foreign_keys=ON;');
      } catch (error) {
        await DB.exec('ROLLBACK; PRAGMA foreign_keys=ON;');
        throw error;
      }
      continue;
    }
    for (const statement of migrateStatements(sql)) await DB.prepare(statement).run();
  }
}
before(async () => {
  env = { DB:sqliteAdapter(), LOCAL_DEV:'true', REGISTRATION_ENABLED:'true' };
  await migrateDatabase(env.DB);
  await env.DB.prepare('UPDATE vault SET revision = 3, data = ?, updated = ? WHERE id = 1').bind(JSON.stringify(legacyVault), 10).run();
  await env.DB.prepare('INSERT INTO snapshots(revision, data, created) VALUES (?, ?, ?)').bind(2, JSON.stringify(legacyVault), 9).run();
  await env.DB.prepare('INSERT INTO assets VALUES (?, ?, ?, ?, ?)').bind(legacyAssetId, 'legacy.txt', 'application/octet-stream', 4, 8).run();
  await env.DB.prepare('INSERT INTO asset_chunks VALUES (?, ?, ?)').bind(legacyAssetId, 0, new Uint8Array([1,2,3,4])).run();
  alice = await registerAccount(ALICE);
});
after(async () => { env.DB.close(); });

function request(path, method = 'GET', body, extra = {}, cookie = '') {
  const headers = { Origin:'http://127.0.0.1', ...(body && typeof body === 'string' ? { 'Content-Type':'application/json' } : {}), ...extra };
  if (cookie) headers.Cookie = cookie;
  return new Request(`http://127.0.0.1/api${path}`, { method, headers, body });
}
const call = (path, method = 'GET', body, ...args) => {
  const cookie = args.length ? args.find(value => typeof value === 'string' && value.startsWith('qidian_session=')) || '' : alice.cookie;
  const extra = args.find(value => value && typeof value === 'object' && !ArrayBuffer.isView(value)) || {};
  return handle(request(path, method, body, extra, cookie), env);
};
async function registerAccount(user) {
  const credential = await makeRegistrationCredential(user.password);
  const response = await handle(request('/auth/register','POST',JSON.stringify({ username:user.username, ...credential })), env);
  const data = await response.json();
  return { response, data, cookie:response.headers.get('Set-Cookie')?.split(';')[0] || '' };
}
function noteData(title = '中文 Emoji ✅') {
  return { categories:['开发'], notes:[{ id:'n1', title, category:'开发', type:'note', tags:['SQLite'], body:'<h2>标题</h2><p>中文全文检索 ✅</p><table><tr><td>图文</td></tr></table>', source:'', created:1, updated:2, pinned:true }] };
}

test('first account adopts legacy notes, backups and attachment bytes', async () => {
  assert.equal(alice.response.status, 201);
  assert.equal(alice.data.legacyClaimed, true);
  const current = await (await call('/vault')).json();
  assert.equal(current.revision, 3);
  assert.deepEqual(current.data.notes, [legacyNote]);
  const backups = await (await call('/backups')).json();
  assert.ok(backups.some(item => item.revision === 2));
  assert.deepEqual(new Uint8Array(await (await call(`/assets/${legacyAssetId}`)).arrayBuffer()), new Uint8Array([1,2,3,4]));
});

test('API boundary returns errors matching the shared JSON error contract', async () => {
  const response = await call('/missing-endpoint');
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.deepEqual(body, { error:'接口不存在' });
  assert.equal(isApiErrorResponse(body), true);
});

test('account password sessions protect APIs on the self-hosted server', async () => {
  const config = await handle(new Request('https://qidian.local/api/auth/config'), env);
  assert.equal(config.status, 200);
  assert.deepEqual(await config.json(), { registrationEnabled:true, setupRequired:false });
  const missingAppSession = new Request('https://qidian.local/api/vault');
  assert.equal((await handle(missingAppSession, env)).status, 401);
  const sessionRequired = await handle(new Request('https://qidian.local/api/auth/session'), env);
  assert.equal(sessionRequired.status, 401);
  assert.deepEqual(await sessionRequired.json(), { error:'请登录栖点账号', registrationEnabled:true, setupRequired:false });
  const appSession = await handle(new Request('https://qidian.local/api/auth/session', { headers:{ Cookie:alice.cookie } }), env);
  const sessionData = await appSession.json();
  assert.equal(sessionData.id, alice.data.id);
  assert.equal(sessionData.username, ALICE.username);
  assert.equal(sessionData.revision, 3);
  assert.deepEqual(sessionData.data.notes, [legacyNote]);
  const withAccountSession = new Request('https://qidian.local/api/vault', { headers:{ Cookie:alice.cookie } });
  assert.equal((await handle(withAccountSession, env)).status, 200);
  const revisionOnly = await handle(new Request('https://qidian.local/api/vault/revision', { headers:{ Cookie:alice.cookie } }), env);
  assert.equal(revisionOnly.status, 200);
  assert.deepEqual(await revisionOnly.json(), { revision:3 });
  assert.equal((await handle(new Request('https://qidian.local/api/vault/revision'), env)).status, 401);
  const aliceToken = sessionTokenFromCookie(new Request('https://qidian.local', { headers:{ Cookie:alice.cookie } }));
  const aliceTokenHash = await hashSession(aliceToken);
  const initialSession = await env.DB.prepare('SELECT created, expires FROM sessions WHERE token_hash = ?').bind(aliceTokenHash).first();
  assert.equal(initialSession.expires - initialSession.created, SESSION_IDLE_TTL, 'new sessions start with a three-day inactivity deadline');
  await env.DB.prepare('UPDATE sessions SET created = ? WHERE token_hash = ?').bind(Date.now() - SESSION_TTL - 1, aliceTokenHash).run();
  assert.equal((await handle(new Request('https://qidian.local/api/auth/session', { headers:{ Cookie:alice.cookie } }), env)).status, 401, 'sessions created over seven days ago expire under the shorter policy');
  await env.DB.prepare('UPDATE sessions SET created = ? WHERE token_hash = ?').bind(Date.now(), aliceTokenHash).run();
  const activeCreated = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const nearlyIdle = Date.now() + 30 * 60 * 1000;
  await env.DB.prepare('UPDATE sessions SET created = ?, expires = ? WHERE token_hash = ?').bind(activeCreated, nearlyIdle, aliceTokenHash).run();
  assert.equal((await handle(new Request('https://qidian.local/api/auth/session', { headers:{ Cookie:alice.cookie } }), env)).status, 200);
  const refreshed = await env.DB.prepare('SELECT expires FROM sessions WHERE token_hash = ?').bind(aliceTokenHash).first();
  assert.ok(refreshed.expires > nearlyIdle, 'active sessions renew their inactivity deadline');
  assert.ok(refreshed.expires <= activeCreated + SESSION_TTL, 'renewal never exceeds the absolute lifetime');
  await env.DB.prepare('UPDATE sessions SET created = ?, expires = ? WHERE token_hash = ?').bind(Date.now(), Date.now() + SESSION_IDLE_TTL, aliceTokenHash).run();
  const missingDatabase = await handle(new Request('https://qidian.local/api/auth/config'), {});
  assert.equal(missingDatabase.status, 503);
});

test('self-hosted version checks require login and queue only a verified latest release update', async () => {
  const release = {
    tag_name:'v0.1.6', html_url:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.6',
    body:'修复问题\n- 更新容器', published_at:'2026-10-12T00:00:00Z', draft:false, prerelease:false,
    assets:[
      { name:'qidian-0.1.6.run', label:'栖点-0.1.6.run' },
      { name:'qidian-0.1.6.run.release.sha256', label:'栖点-0.1.6.run.sha256' }
    ]
  };
  let queued = 0;
  const updateEnv = {
    ...env, SELF_HOSTED:'true', QIDIAN_VERSION:'0.1.5',
    fetchRelease:async url => { assert.equal(url,'https://api.github.com/repos/luckyalanzhou/qidian/releases/latest'); return Response.json(release); },
    requestQidianUpdate:async () => { queued++; return queued === 1; },
    isQidianUpdaterReady:async () => true,
    readQidianUpdateStatus:async () => ({ state:'idle', version:'', updatedAt:null, logUpdatedAt:null, log:'' })
  };
  assert.equal((await handle(request('/system/version'), updateEnv)).status,401);
  const installed = await handle(request('/system/version?installed=1','GET',undefined,{},alice.cookie), {...updateEnv,fetchRelease:async()=>{throw Error('Release source offline')}});
  assert.deepEqual(await installed.json(),{currentVersion:'0.1.5'},'restart readiness is checked locally without the release source');
  const versionResponse = await handle(request('/system/version','GET',undefined,{},alice.cookie), updateEnv);
  assert.equal(versionResponse.status,200);
  assert.deepEqual(await versionResponse.json(), {
    currentVersion:'0.1.5', latestVersion:'0.1.6', updateAvailable:true, canUpdateDevice:true, installerAvailable:true, updaterAvailable:true,
    releaseUrl:release.html_url, notes:release.body, publishedAt:release.published_at
  });
  const submitted = await handle(request('/system/update','POST','{"action":"update"}',{},alice.cookie), updateEnv);
  assert.equal(submitted.status,202);
  assert.deepEqual(await submitted.json(),{ accepted:true, version:'0.1.6' });
  const duplicate = await handle(request('/system/update','POST','{"action":"update"}',{},alice.cookie), updateEnv);
  assert.equal(duplicate.status,409);
  const secondary = await registerAccount({ username:'update_reader', password:'Another strong phrase 5!' });
  const denied = await handle(request('/system/update','POST','{"action":"update"}',{},secondary.cookie), updateEnv);
  assert.equal(denied.status,403,'secondary accounts cannot update the host device');
  const status = await handle(request('/system/update-status','GET',undefined,{},alice.cookie), updateEnv);
  assert.deepEqual(await status.json(),{ state:'idle', version:'', updatedAt:null, logUpdatedAt:null, log:'' });
});

test('update API rejects unsupported deployments and releases without the checksummed installer', async () => {
  assert.equal((await handle(request('/system/version','GET',undefined,{},alice.cookie),env)).status,404);
  const response = await handle(request('/system/update','POST','{"action":"update"}',{},alice.cookie), {
    ...env, SELF_HOSTED:'true', QIDIAN_VERSION:'0.1.5',
    fetchRelease:async () => Response.json({ tag_name:'v0.1.6', html_url:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.6', assets:[] }),
    isQidianUpdaterReady:async () => true
  });
  assert.equal(response.status,503);

  const invalidComponentVersion = await handle(request('/system/version','GET',undefined,{},alice.cookie), {
    ...env, SELF_HOSTED:'true', QIDIAN_VERSION:'0.1.5',
    fetchRelease:async () => Response.json({
      tag_name:'v0.01.0',
      html_url:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.01.0',
      assets:[]
    })
  });
  assert.equal(invalidComponentVersion.status,503,'release versions reject leading zero components');

  const invalidPatchVersion = await handle(request('/system/version','GET',undefined,{},alice.cookie), {
    ...env, SELF_HOSTED:'true', QIDIAN_VERSION:'0.1.5',
    fetchRelease:async () => Response.json({
      tag_name:'v0.1.010',
      html_url:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.010',
      assets:[]
    })
  });
  assert.equal(invalidPatchVersion.status,503,'release Patch rejects leading zeros');

  const largeVersion = await handle(request('/system/version','GET',undefined,{},alice.cookie), {
    ...env, SELF_HOSTED:'true', QIDIAN_VERSION:'0.1.5',
    fetchRelease:async () => Response.json({
      tag_name:'v999999999999999999999999.1.0',
      html_url:'https://github.com/luckyalanzhou/qidian/releases/tag/v999999999999999999999999.1.0',
      assets:[]
    })
  });
  assert.equal(largeVersion.status,200,'large SemVer components are compared without numeric overflow');
  assert.equal((await largeVersion.json()).latestVersion,'999999999999999999999999.1.0');

  const unsafeReleaseLink = await handle(request('/system/version','GET',undefined,{},alice.cookie), {
    ...env, SELF_HOSTED:'true', QIDIAN_VERSION:'0.1.5',
    fetchRelease:async () => Response.json({
      tag_name:'v0.1.6', html_url:'https://example.com/releases/tag/v0.1.6', assets:[]
    })
  });
  assert.equal(unsafeReleaseLink.status,503,'release links are restricted to the public repository');
});

test('version reset offers two-digit Patch releases to devices on the previous 0.1.x line', async () => {
  const response = await handle(request('/system/version','GET',undefined,{},alice.cookie), {
    ...env,
    SELF_HOSTED:'true',
    QIDIAN_VERSION:'0.1.24',
    fetchRelease:async () => Response.json({
      tag_name:'v0.0.10',
      html_url:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.0.10',
      assets:[{ name:'栖点-0.0.10.run' },{ name:'栖点-0.0.10.run.sha256' }],
      draft:false,
      prerelease:false
    }),
    isQidianUpdaterReady:async () => true
  });
  assert.equal(response.status,200);
  assert.equal((await response.json()).updateAvailable,true);
});

test('registration is controlled by deployment configuration', async () => {
  const disabled = await handle(request('/auth/register','POST',JSON.stringify({ username:'closed_user' })), { ...env, LOCAL_DEV:'true', REGISTRATION_ENABLED:'false' });
  assert.equal(disabled.status,403);
});

test('concurrent first-owner registration creates exactly one account', async () => {
  const database = sqliteAdapter();
  let batchQueue = Promise.resolve();
  const DB = {
    ...database,
    batch(statements) {
      const current = batchQueue.then(() => database.batch(statements));
      batchQueue = current.catch(() => {});
      return current;
    }
  };
  try {
    await migrateDatabase(DB);
    const setupEnv = { DB, SELF_HOSTED:'true', REGISTRATION_ENABLED:'false' };
    const credentials = await Promise.all([
      makeRegistrationCredential('First owner phrase 7!'),
      makeRegistrationCredential('Second owner phrase 8!')
    ]);
    const responses = await Promise.all(credentials.map((credential, index) => handle(
      request('/auth/register','POST',JSON.stringify({ username:`bootstrap_owner_${index}`, ...credential })), setupEnv
    )));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS count FROM accounts').first()).count, 1);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS count FROM sessions').first()).count, 1);
  } finally {
    database.close();
  }
});

test('registration accepts account and password credentials', async () => {
  const user = { username:'verify_me', password:'Verification phrase 9!' };
  const created = await registerAccount(user);
  assert.equal(created.response.status,201);
  assert.equal(created.data.username,user.username);
  assert.match(created.cookie,/qidian_session=/);
});

test('production registration cannot claim an unclaimed legacy vault without verified ownership', async () => {
  const accountId = alice.data.id;
  await env.DB.prepare('UPDATE legacy_claim SET claimed_by = NULL WHERE id = 1').run();
  try {
    const credential = await makeRegistrationCredential('A different secure phrase 5!');
    const response = await handle(request('/auth/register','POST',JSON.stringify({ username:'racer_account', ...credential })), { ...env, LOCAL_DEV:undefined });
    assert.equal(response.status,409);
    assert.equal((await env.DB.prepare('SELECT revision FROM vault WHERE id = 1').first()).revision,3);
    assert.equal(await env.DB.prepare('SELECT id FROM accounts WHERE username_normalized = ?').bind('racer_account').first(),null);
  } finally {
    await env.DB.prepare('UPDATE legacy_claim SET claimed_by = ? WHERE id = 1').bind(accountId).run();
  }
});

test('writes require same Origin even before authentication', async () => {
  for (const origin of ['', 'https://evil.example']) {
    assert.equal((await handle(request('/vault','PUT','{}',{ Origin:origin }), env)).status, 403);
  }
});

test('accounts have isolated vaults, backups and assets; login uses the account name and password', async () => {
  bob = await registerAccount(BOB);
  assert.equal(bob.response.status, 201);
  assert.equal(bob.data.legacyClaimed, false);
  assert.equal((await (await call('/vault')).json()).data.notes[0].id, 'legacy-note');
  const bobVault = await (await call('/vault','GET',undefined,BOB.username,bob.cookie)).json();
  assert.deepEqual(bobVault.data.notes, []);
  const current = await (await call('/vault')).json();
  await env.DB.prepare('UPDATE account_vaults SET updated = ? WHERE account_id = ?').bind(Date.now()+60001,alice.data.id).run();
  const saved = await call('/vault','PUT',JSON.stringify({ revision:current.revision, data:noteData() }));
  assert.equal(saved.status, 200);
  assert.deepEqual((await (await call('/vault')).json()).data.notes.map(n=>n.title), ['中文 Emoji ✅']);
  assert.deepEqual((await (await call('/vault','GET',undefined,BOB.username,bob.cookie)).json()).data.notes, []);
  assert.deepEqual((await (await call('/assets','GET',undefined,BOB.username,bob.cookie)).json()), []);
  assert.equal((await call(`/assets/${legacyAssetId}`,'GET',undefined,BOB.username,bob.cookie)).status, 404);
  assert.ok((await (await call('/backups')).json()).some(item=>item.revision===3));
  assert.deepEqual(await (await call('/backups','GET',undefined,BOB.username,bob.cookie)).json(), []);

  const challenge = await (await call('/auth/challenge','POST',JSON.stringify({ username:ALICE.username }),BOB.username,'')).json();
  const verifier = await makeLoginVerifier(ALICE.password, challenge.salt);
  const login = await call('/auth/verify','POST',JSON.stringify({ id:challenge.id, verifier }),BOB.username,'');
  assert.equal(login.status,200);
  const loggedIn = await login.clone().json();
  assert.deepEqual(loggedIn, { id: alice.data.id }, 'verification should not duplicate the vault payload');
  assert.match(login.headers.get('Set-Cookie'),/HttpOnly/);
  assert.match(login.headers.get('Set-Cookie'),/SameSite=Strict/);
  const loggedInCookie=login.headers.get('Set-Cookie').split(';')[0];
  const loginSession=await (await call('/auth/session','GET',undefined,ALICE.username,loggedInCookie)).json();
  assert.equal(loginSession.id, alice.data.id);
  assert.equal(loginSession.revision, 4);
  assert.equal(loginSession.data.notes[0].title, '中文 Emoji ✅');
  assert.equal((await (await call('/vault','GET',undefined,BOB.username,loggedInCookie)).json()).data.notes[0].title,'中文 Emoji ✅');
  const invalidAccountName = await call('/auth/challenge','POST',JSON.stringify({ username:'alice@notes' }));
  assert.equal(invalidAccountName.status,400,'account names reject unsupported characters');
  const storedCredential = await env.DB.prepare('SELECT password_hash FROM accounts WHERE username_normalized = ?').bind(ALICE.username).first();
  assert.notEqual(storedCredential.password_hash, verifier);
  const databaseOnlyChallenge = await (await call('/auth/challenge','POST',JSON.stringify({ username:ALICE.username }),ALICE.username,'')).json();
  assert.equal((await call('/auth/verify','POST',JSON.stringify({ id:databaseOnlyChallenge.id, verifier:storedCredential.password_hash }),ALICE.username,'')).status,401);
  assert.equal((await registerAccount({ ...BOB, username:ALICE.username })).response.status,409);
});

test('account profile and avatar endpoints are private and validate uploaded image bytes', async () => {
  const profileResponse = await call('/account/profile');
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.equal(profile.username, ALICE.username);
  assert.deepEqual(Object.keys(profile).sort(), ['avatarMime','created','id','username']);
  assert.equal(profile.avatarMime, null);
  assert.equal((await call('/account/profile','GET',undefined,ALICE.username,'')).status,401);
  assert.equal((await call('/account/password-salt','GET',undefined,ALICE.username,'')).status,401);

  const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
  assert.equal((await call('/account/avatar','PUT',new Uint8Array([1,2,3]))).status,415);
  assert.equal((await call('/account/avatar','PUT',new Uint8Array(512*1024+1))).status,413);
  const uploaded = await call('/account/avatar','PUT',png);
  assert.equal(uploaded.status,200);
  assert.deepEqual(await uploaded.json(),{ ok:true, mime:'image/png' });
  assert.deepEqual(new Uint8Array(await (await call('/account/avatar')).arrayBuffer()),png);
  assert.equal((await call('/account/avatar','GET',undefined,BOB.username,bob.cookie)).status,404);
  assert.equal((await (await call('/account/profile','GET',undefined,BOB.username,bob.cookie)).json()).avatarMime,null);
  assert.equal((await call('/account/avatar','DELETE')).status,200);
  assert.equal((await call('/account/avatar')).status,404);
});

test('changing a password checks the current verifier and revokes other sessions only', async () => {
  const challenge = await (await call('/auth/challenge','POST',JSON.stringify({ username:ALICE.username }),ALICE.username,'')).json();
  const verifier = await makeLoginVerifier(ALICE.password,challenge.salt);
  const secondLogin = await call('/auth/verify','POST',JSON.stringify({ id:challenge.id, verifier }),ALICE.username,'');
  const secondCookie = secondLogin.headers.get('Set-Cookie').split(';')[0];
  const salt = await (await call('/account/password-salt')).json();
  const currentVerifier = await makeLoginVerifier(ALICE.password,salt.salt);
  const next = await makeRegistrationCredential('New secure password 8!');
  const changed = await call('/account/password','POST',JSON.stringify({ currentVerifier,...next }),ALICE.username,alice.cookie,{ 'Content-Type':'application/json' });
  assert.equal(changed.status,200);
  assert.deepEqual(await changed.json(),{ ok:true,otherSessionsRevoked:true });
  assert.equal((await call('/vault','GET',undefined,ALICE.username,alice.cookie)).status,200,'the session changing its own password stays active');
  assert.equal((await call('/vault','GET',undefined,ALICE.username,secondCookie)).status,401,'other sessions are revoked');

  const wrong = await makeLoginVerifier('Wrong current password 3!',next.salt);
  const replacement = await makeRegistrationCredential('Another valid password 9!');
  assert.equal((await call('/account/password','POST',JSON.stringify({ currentVerifier:wrong,...replacement }),ALICE.username,alice.cookie,{ 'Content-Type':'application/json' })).status,403);
  const oldChallenge = await (await call('/auth/challenge','POST',JSON.stringify({ username:ALICE.username }),ALICE.username,'')).json();
  assert.equal((await call('/auth/verify','POST',JSON.stringify({ id:oldChallenge.id, verifier }),ALICE.username,'')).status,401);
  const newChallenge = await (await call('/auth/challenge','POST',JSON.stringify({ username:ALICE.username }),ALICE.username,'')).json();
  const newVerifier = await makeLoginVerifier('New secure password 8!',newChallenge.salt);
  assert.equal((await call('/auth/verify','POST',JSON.stringify({ id:newChallenge.id, verifier:newVerifier }),ALICE.username,'')).status,200);
});

test('vault updates retain conflict detection and automatic snapshots per account', async () => {
  const current = await (await call('/vault')).json();
  await env.DB.prepare('DELETE FROM account_snapshots WHERE account_id = ?').bind(alice.data.id).run();
  await env.DB.prepare('UPDATE account_vaults SET updated = ? WHERE account_id = ?').bind(Date.now(),alice.data.id).run();
  const update = await call('/vault','PUT',JSON.stringify({ revision:current.revision, data:noteData() }));
  assert.equal(update.status,200);
  const saved = await (await call('/vault')).json();
  assert.deepEqual(saved.data.notes.map(n=>n.title), ['中文 Emoji ✅']);
  assert.equal((await call('/vault','PUT',JSON.stringify({ revision:current.revision, data:noteData('stale') }))).status,409);
  const backups = await (await call('/backups')).json();
  assert.ok(backups.some(item=>item.revision===current.revision));
});

test('autosave keeps useful recent snapshots instead of exhausting history on every keystroke', async()=>{
  const user={username:'history_user',password:'Snapshot history 8!'};
  const account=await registerAccount(user);let vault=await(await call('/vault','GET',undefined,user.username,account.cookie)).json();
  for(let index=0;index<5;index++){
    const data={...vault.data,theme:index%2?'dark':'light'};
    const saved=await call('/vault','PUT',JSON.stringify({revision:vault.revision,data}),user.username,account.cookie);
    assert.equal(saved.status,200);vault={...vault,revision:(await saved.json()).revision,data};
  }
  let history=await env.DB.prepare('SELECT revision, created FROM account_snapshots WHERE account_id = ?').bind(account.data.id).all();
  assert.equal(history.results.length,1,'rapid autosaves within a minute should share one history checkpoint');
  for(let index=0;index<24;index++){
    await env.DB.prepare('UPDATE account_vaults SET updated = ? WHERE account_id = ?').bind(Date.now()+(index+1)*60001,account.data.id).run();
    const data={...vault.data,theme:index%2?'light':'dark'};
    const saved=await call('/vault','PUT',JSON.stringify({revision:vault.revision,data}),user.username,account.cookie);
    assert.equal(saved.status,200);vault={...vault,revision:(await saved.json()).revision,data};
  }
  history=await env.DB.prepare('SELECT revision, created FROM account_snapshots WHERE account_id = ? ORDER BY created DESC, revision DESC').bind(account.data.id).all();
  assert.equal(history.results.length,20,'history should retain the 20 newest checkpoints by age');
  assert.ok(history.results[0].revision>history.results.at(-1).revision);
});

test('vault accepts custom note types and rejects notes referencing removed types', async () => {
  const current = await (await call('/vault')).json();
  const custom = { ...current.data, noteTypes:[...current.data.noteTypes, { id:'reading', name:'读书笔记' }], notes:[...current.data.notes, { id:'reading1', title:'阅读记录', type:'reading', category:'开发', tags:[], body:'正文', source:'', created:3, updated:4, pinned:false }] };
  const saved = await call('/vault','PUT',JSON.stringify({ revision:current.revision, data:custom }));
  assert.equal(saved.status,200);
  const loaded = await (await call('/vault')).json();
  assert.ok(loaded.data.noteTypes.some(t=>t.id==='reading'&&t.name==='读书笔记'));
  assert.equal(loaded.data.notes.at(-1).type,'reading');
  const invalid = { ...loaded.data, noteTypes:loaded.data.noteTypes.filter(t=>t.id!=='reading') };
  assert.equal((await call('/vault','PUT',JSON.stringify({ revision:loaded.revision, data:invalid })).then(r=>r.status)),400);
});

test('invalid and oversized vault requests leave account data intact', async () => {
  const current = await (await call('/vault')).json();
  const invalid = { ...noteData(), notes:[...noteData().notes,...noteData().notes] };
  assert.equal((await call('/vault','PUT',JSON.stringify({ revision:current.revision, data:invalid })).then(r=>r.status)),400);
  for (const body of ['null', '[]', '"text"']) {
    const response = await call('/vault','PUT',body);
    assert.equal(response.status,400,`${body} is not a valid JSON request object`);
    assert.deepEqual(await response.json(),{ error:'JSON 请求必须是对象' });
  }
  assert.equal((await call('/vault','PUT','x'.repeat(1_020_000)).then(r=>r.status)),413);
  assert.equal((await (await call('/vault')).json()).revision,current.revision);
});

test('chunked attachment round-trip preserves bytes and other accounts receive 404', async () => {
  const bytes = new Uint8Array(600000); crypto.getRandomValues(bytes.subarray(0,65000)); bytes.fill(43,65000);
  const posted = await call('/assets','POST',bytes,ALICE.username,alice.cookie,{ 'X-File-Name':encodeURIComponent('附件.html'), 'Content-Type':'image/png' });
  assert.equal(posted.status,201); const asset = await posted.json(); assert.equal(asset.mime,'application/octet-stream');
  const response = await call(`/assets/${asset.id}`,'GET',undefined,ALICE.username,alice.cookie);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  assert.match(response.headers.get('Content-Disposition'),/^attachment/);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await call(`/assets/${asset.id}`,'GET',undefined,BOB.username,bob.cookie)).status,404);
});

test('manual snapshots protect referenced attachments while orphan pruning reclaims unused bytes', async () => {
  const upload = async name => {
    const response = await call('/assets','POST',new TextEncoder().encode(name),ALICE.username,alice.cookie,{ 'X-File-Name':encodeURIComponent(name) });
    assert.equal(response.status,201);
    return response.json();
  };
  const referenced = await upload('referenced.txt'), orphan = await upload('orphan.txt');
  const current = await (await call('/vault')).json();
  const note = { id:'asset-note', title:'附件引用', category:'开发', type:'note', tags:[], body:`<p><a href="/api/assets/${referenced.id}?download=1">附件</a></p>`, source:'', created:10, updated:10, pinned:false };
  const saved = await call('/vault','PUT',JSON.stringify({ revision:current.revision, data:{ ...current.data, notes:[...current.data.notes,note] } }));
  assert.equal(saved.status,200);
  const snapshot = await call('/backups','POST');
  assert.equal(snapshot.status,201);
  assert.equal((await snapshot.json()).revision,current.revision+1);
  await env.DB.prepare('UPDATE account_assets SET created = ? WHERE account_id = ? AND id = ?')
    .bind(Date.now() - ASSET_PRUNE_GRACE_MS - 1, alice.data.id, orphan.id).run();

  const firstPrune = await call('/assets/prune','POST');
  assert.equal(firstPrune.status,200);
  assert.equal((await call(`/assets/${referenced.id}`)).status,200,'the active vault keeps referenced attachments');
  assert.equal((await call(`/assets/${orphan.id}`)).status,404,'an unreferenced attachment is reclaimed');

  const withAsset = await (await call('/vault')).json();
  const removed = await call('/vault','PUT',JSON.stringify({ revision:withAsset.revision, data:{ ...withAsset.data, notes:withAsset.data.notes.filter(item=>item.id!==note.id) } }));
  assert.equal(removed.status,200);
  await call('/assets/prune','POST');
  assert.equal((await call(`/assets/${referenced.id}`)).status,200,'retained snapshots keep historical attachment references valid');
  await env.DB.prepare('DELETE FROM account_snapshots WHERE account_id = ?').bind(alice.data.id).run();
  await env.DB.prepare('UPDATE account_assets SET created = ? WHERE account_id = ? AND id = ?')
    .bind(Date.now() - ASSET_PRUNE_GRACE_MS - 1, alice.data.id, referenced.id).run();
  const finalPrune = await (await call('/assets/prune','POST')).json();
  assert.ok(finalPrune.removed>=1);
  assert.equal((await call(`/assets/${referenced.id}`)).status,404);
});

test('per-account file quota is atomic and oversized or empty uploads do not write', async () => {
  const db=env.DB, account=await db.prepare('SELECT id FROM accounts WHERE username_normalized=?').bind(ALICE.username).first();
  for (let i=0;i<12;i++) await db.prepare('INSERT INTO account_assets(account_id,id,name,mime,size,created) VALUES(?,?,?,?,?,?)').bind(account.id,`quota-${i}`,'quota','application/octet-stream',8388608,0).run();
  const before=await db.prepare('SELECT COUNT(*) AS count FROM account_assets WHERE account_id=?').bind(account.id).first();
  assert.equal((await call('/assets','POST',new Uint8Array(8*1024*1024),ALICE.username,alice.cookie)).status,413);
  assert.deepEqual(await db.prepare('SELECT COUNT(*) AS count FROM account_assets WHERE account_id=?').bind(account.id).first(),before);
  assert.equal((await call('/assets','POST',new Uint8Array(),ALICE.username,alice.cookie)).status,400);
  assert.equal((await call('/assets','POST',new Uint8Array(8*1024*1024+1),ALICE.username,alice.cookie)).status,413);
});

test('nested bookmarks round-trip through authenticated vault and snapshots without leaking to another account', async () => {
  const original = await (await call('/vault')).json();
  await env.DB.prepare('DELETE FROM account_snapshots WHERE account_id = ?').bind(alice.data.id).run();
  const bobBefore = await (await call('/vault', 'GET', undefined, BOB.username, bob.cookie)).json();
  const bookmarks = [{ id:'bookmark-folder', title:'浏览器分组', kind:'folder', children:[{ id:'bookmark-site', title:'参考', kind:'link', url:'https://example.com/?page=1', pinned:true }] }];
  const trash = [{ id:'trash-bookmark', kind:'bookmark', deletedAt:Date.now(), item:{ id:'deleted-site', kind:'link', title:'已删除网址', url:'https://deleted.example.com/' }, parentId:'bookmark-folder', index:0, previousId:'', nextId:'' }];
  const changed = { ...original.data, bookmarks, trash };
  const response = await call('/vault', 'PUT', JSON.stringify({ revision:original.revision, data:changed }));
  assert.equal(response.status, 200);
  const current = await (await call('/vault')).json();
  assert.deepEqual(current.data.bookmarks, bookmarks);
  assert.deepEqual(current.data.trash, trash);
  const session = await (await call('/auth/session')).json();
  assert.deepEqual(session.data.bookmarks, bookmarks);
  assert.deepEqual(await (await call('/vault', 'GET', undefined, BOB.username, bob.cookie)).json(), bobBefore);
  await env.DB.prepare('UPDATE account_vaults SET updated = ? WHERE account_id = ?').bind(Date.now()+60001,alice.data.id).run();
  const restore = await call('/vault', 'PUT', JSON.stringify({ revision:current.revision, data:original.data }));
  assert.equal(restore.status, 200);
  const snapshot = await (await call(`/backups/${current.revision}`)).json();
  assert.deepEqual(snapshot.data.bookmarks, bookmarks);
  assert.deepEqual(snapshot.data.trash, trash);
  const bad = await call('/vault', 'PUT', JSON.stringify({ revision:current.revision+1, data:{ ...changed, bookmarks:[{ id:'bad', kind:'link', title:'bad', url:'javascript:alert(1)' }] } }));
  assert.equal(bad.status, 400);
});
