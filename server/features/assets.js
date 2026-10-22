import { HttpError } from '../validation.js';
import * as assetRepository from '../repositories/asset-repository.js';
import { createAssetService } from '../application/asset-service.js';

const assetService = createAssetService(assetRepository);

export async function handleAssetRoute({ request, env, accountId, path, json, headers }) {
  if (path === '/api/assets' && request.method === 'GET') {
    return json(await assetService.list(env.DB, accountId), 200, {}, 'assets');
  }
  if (path === '/api/assets' && request.method === 'POST') {
    let name;
    try { name = decodeURIComponent(request.headers.get('X-File-Name') || '附件'); }
    catch { throw new HttpError(400, '文件名无效'); }
    const asset = await assetService.create(env.DB, accountId, name, request.body);
    return json({ ...asset, url: `/api/assets/${asset.id}` }, 201, {}, 'uploadedAsset');
  }
  if (path === '/api/assets/prune' && request.method === 'POST') {
    return json(await assetService.prune(env.DB, accountId), 200, {}, 'prunedAssets');
  }
  const asset = path.match(/^\/api\/assets\/([a-f0-9-]{36})$/);
  if (asset && request.method === 'GET') {
    const file = await assetService.read(env.DB, accountId, asset[1]);
    const url = new URL(request.url);
    return new Response(file.stream, { headers: { ...headers, 'Content-Type': file.mime,
      'Content-Disposition': `${file.mime.startsWith('image/') && !url.searchParams.has('download') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox" } });
  }
  return null;
}
