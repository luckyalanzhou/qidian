import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonHeaders, jsonResponse } from '../../server/http-responses.js';
import { isApiRequest } from '../../shared/api-contracts.js';
import { isImmutableStaticAsset } from '../../server/http-server.mjs';

test('Vite hashed assets use immutable caching across its case and underscore hash alphabet', () => {
  for (const path of [
    'dist/assets/index-Dr5n82IP.css',
    'dist/assets/editor-extensions-K4QiaSOV.js',
    'dist\\assets\\workspace-app-fsnlJvSm.js'
  ]) assert.equal(isImmutableStaticAsset(path), true, path);
  assert.equal(isImmutableStaticAsset('dist/assets/index.html'), false);
  assert.equal(isImmutableStaticAsset('dist/assets/main.css'), false);
});

test('shared request contracts accept only documented write DTOs', () => {
  assert.equal(isApiRequest('systemUpdateRequest', { action: 'update' }), true);
  assert.equal(isApiRequest('systemUpdateRequest', {}), false);
  assert.equal(isApiRequest('vaultMutationRequest', { revision: 1, data: { notes: [], categories: [] } }), true);
  assert.equal(isApiRequest('vaultMutationRequest', { revision: '1', data: { notes: [], categories: [] } }), false);
});

test('success JSON responses require and enforce a shared response contract', async () => {
  assert.throws(() => jsonResponse({ revision: 3 }), /必须声明 API 契约/);
  assert.throws(() => jsonResponse({ revision: '3' }, 200, {}, 'revision'), /不符合契约/);

  const response = jsonResponse({ revision: 3 }, 200, { 'X-Request-Id': 'req-1' }, 'revision');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('X-Request-Id'), 'req-1');
  assert.deepEqual(await response.json(), { revision: 3 });
  assert.equal(Object.isFrozen(jsonHeaders), true);
});

test('error JSON responses use the shared error contract without a success contract', async () => {
  const response = jsonResponse({ error: '登录状态已失效', code: 'AUTH_REQUIRED' }, 401);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: '登录状态已失效', code: 'AUTH_REQUIRED' });
  assert.throws(() => jsonResponse({ error: 7 }, 500), /错误响应不符合契约/);
});
