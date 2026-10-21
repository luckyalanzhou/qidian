import test from 'node:test';
import assert from 'node:assert/strict';
import { createViteTestServer as createServer } from '../../support/vite-test-server.mjs';
import { fileURLToPath } from 'node:url';

test('typed API transport keeps requests same-origin, uncached and maps HTTP failures', async t => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom'
  });
  t.after(() => server.close());
  const { ApiError, createApiClient, createJsonRequester } = await server.ssrLoadModule('/src/api/client.ts');
  const requests = [];
  const client = createApiClient(async (input, init) => {
    requests.push({ input, init });
    return Response.json({ revision: 4 });
  });

  const response = await client('/vault', { method: 'GET', credentials: 'include', cache: 'force-cache' });
  assert.deepEqual(await response.json(), { revision: 4 });
  assert.equal(requests[0].input, '/api/vault');
  assert.equal(requests[0].init.credentials, 'same-origin');
  assert.equal(requests[0].init.cache, 'no-store');
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  await assert.rejects(() => client('https://example.com/api/vault'), TypeError);
  await assert.rejects(() => client('/vault/../auth/session'), TypeError);
  await assert.rejects(() => client('/vault/%2e%2e/auth/session'), TypeError);

  const timedOut = createApiClient((_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }), 5);
  await assert.rejects(() => timedOut('/vault'), /请求超时/);

  const failed = createApiClient(async () => Response.json({ error: '版本冲突', code: 'REVISION_MISMATCH' }, { status: 409 }));
  await assert.rejects(() => failed('/vault', { method: 'PUT' }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.name, 'ApiError');
    assert.equal(error.status, 409);
    assert.equal(error.message, '版本冲突');
    assert.equal(error.details.code, 'REVISION_MISMATCH');
    return true;
  });

  const malformedError = createApiClient(async () => Response.json({ message:'无效错误' }, { status:500 }));
  await assert.rejects(() => malformedError('/vault'), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 500);
    assert.equal(error.message, '服务器返回了无效错误响应');
    assert.deepEqual(error.details, { error:'服务器返回了无效错误响应' });
    return true;
  });

  const validRequester = createJsonRequester(async () => Response.json({ revision: 4 }));
  assert.deepEqual(await validRequester('/vault/revision', 'revision'), { revision: 4 });
  const updateStatus = { state: 'running', version: '0.1.6', updatedAt: null, logUpdatedAt: 1791800000000.25, log: '正在更新' };
  const statusRequester = createJsonRequester(async () => Response.json(updateStatus));
  assert.deepEqual(await statusRequester('/system/update-status', 'updateStatus'), updateStatus);
  let sentUpdate = false;
  const requestContractClient = createJsonRequester(async () => {
    sentUpdate = true;
    return Response.json({ accepted: true, version: '0.1.6' });
  });
  await assert.rejects(() => requestContractClient('/system/update', 'updateAcceptance', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  }, 'systemUpdateRequest'), /API 请求不符合契约/);
  assert.equal(sentUpdate, false, 'invalid request data is rejected before network access');
  await requestContractClient('/system/update', 'updateAcceptance', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update' })
  }, 'systemUpdateRequest');
  assert.equal(sentUpdate, true);
  const malformedRequester = createJsonRequester(async () => Response.json({ revision: '4' }));
  await assert.rejects(() => malformedRequester('/vault/revision', 'revision'), /API 响应不符合契约/);
  const invalidJsonRequester = createJsonRequester(async () => new Response('{invalid'));
  await assert.rejects(() => invalidJsonRequester('/vault/revision', 'revision'), /服务器返回了无效响应/);
  const failedJsonRequester = createJsonRequester(createApiClient(async () => Response.json({ error: '需要登录' }, { status: 401 })));
  await assert.rejects(() => failedJsonRequester('/auth/session', 'authSession'), error => error instanceof ApiError && error.status === 401);
});
