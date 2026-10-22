import { authorize, checkOrigin } from './auth.js';
import { HttpError, MAX_VAULT_BYTES } from './validation.js';
import { jsonHeaders as headers, jsonResponse as json } from './http-responses.js';
import { isApiRequest } from '../shared/api-contracts.js';
import { handleAuthRoute } from './features/auth.js';
import { handleAccountRoute } from './features/account.js';
import { handleAssetRoute } from './features/assets.js';
import { handleBackupRoute } from './features/backups.js';
import { handleSystemUpdateRoute } from './features/system-updates.js';
import { handleSystemStorageRoute } from './features/system-storage.js';
import { handleVaultRoute } from './features/vault.js';

async function readJson(request, maxBytes = MAX_VAULT_BYTES + 10000, contract) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, '需要 JSON 请求');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '请求为空');
  const parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, '请求过大'); } parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, 'JSON 无效'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'JSON 请求必须是对象');
  }
  if (contract && !isApiRequest(contract, value)) throw new HttpError(400, `请求数据格式无效：${contract}`);
  return value;
}

export async function handle(request, env) {
  try {
    checkOrigin(request);
    const path = new URL(request.url).pathname.replace(/\/$/, '');
    if (path.startsWith('/api/auth/')) {
      const response = await handleAuthRoute({ request, env, path, json, readJson });
      if (response) return response;
    }
    const account = await authorize(request, env);
    const accountId = account.id;
    if (path === '/api/session' && request.method === 'GET') return json({ owner: accountId, username: account.username, local: false }, 200, {}, 'sessionBootstrap');
    if (!env.DB) throw new HttpError(503, '尚未配置数据库');
    const systemResponse = await handleSystemUpdateRoute({ request, env, accountId, path, json, readJson });
    if (systemResponse) return systemResponse;
    const storageResponse = await handleSystemStorageRoute({ request, env, path, json });
    if (storageResponse) return storageResponse;
    const accountResponse = await handleAccountRoute({ request, env, accountId, path, json, headers, readJson });
    if (accountResponse) return accountResponse;
    const vaultResponse = await handleVaultRoute({ request, env, accountId, path, json, readJson });
    if (vaultResponse) return vaultResponse;
    const backupResponse = await handleBackupRoute({ request, env, accountId, path, json });
    if (backupResponse) return backupResponse;
    const assetResponse = await handleAssetRoute({ request, env, accountId, path, json, headers });
    if (assetResponse) return assetResponse;
    throw new HttpError(404, '接口不存在');
  } catch (error) {
    return json({ error: error instanceof HttpError ? error.message : '服务器暂时无法完成操作' }, error instanceof HttpError ? error.status : 500);
  }
}
