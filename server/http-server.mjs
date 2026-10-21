import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { validateTrustedProxyConfig } from './config.mjs';
import { handle } from './api.js';
import { qidianUpdaterReady, queueQidianUpdate, readQidianUpdateStatus } from './host-updater.mjs';

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const DEFAULT_MAX_REQUEST_BYTES = 8 * 1024 * 1024 + 10_000;
const HOP_BY_HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

function normalizedAddress(value='') { return String(value).replace(/^::ffff:/,''); }
function proxyIsTrusted(request, trustProxy, trustedProxies=[]) {
  if (!trustProxy || !trustedProxies.length) return false;
  return trustedProxies.map(normalizedAddress).includes(normalizedAddress(request.socket.remoteAddress));
}

function externalOrigin(request, trustProxy, trustedProxies) {
  const trusted = proxyIsTrusted(request, trustProxy, trustedProxies);
  const forwardedProto = trusted ? request.headers['x-forwarded-proto'] : undefined;
  const forwardedHost = trusted ? request.headers['x-forwarded-host'] : undefined;
  const protoValue = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const hostValue = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  const protocol = (typeof protoValue === 'string' ? protoValue : '').split(',')[0].trim()
    || (request.socket.encrypted ? 'https' : 'http');
  const host = (typeof hostValue === 'string' ? hostValue : '').split(',')[0].trim()
    || request.headers.host;
  if (!host || !['http', 'https'].includes(protocol)) throw new Error('A valid Host header is required');
  return `${protocol}://${host}`;
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks, size) : undefined;
}

function forwardedClientIp(request, trustProxy, trustedProxies) {
  if (proxyIsTrusted(request, trustProxy, trustedProxies)) {
    const forwarded = request.headers['x-forwarded-for'];
    const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = (typeof forwardedValue === 'string' ? forwardedValue : '').split(',')[0].trim();
    if (first && first.length <= 128) return first;
  }
  return request.socket.remoteAddress || 'unknown-client';
}

function writeHead(response, statusCode, headers = {}) {
  response.writeHead(statusCode, { ...headers, ...SECURITY_HEADERS });
}

function safeStaticPath(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const relative = decoded === '/' ? '/index.html' : decoded;
  const path = resolve(root, `.${relative}`);
  return path === root || path.startsWith(`${root}${sep}`) ? path : null;
}

export function isImmutableStaticAsset(path) {
  const segments = String(path).split(/[\\/]/);
  const filename = segments.at(-1) || '';
  return segments.includes('assets') && /(?:^|[.-])[A-Za-z0-9_-]{8,}(?=[.-])/.test(filename);
}

export function createSelfHostedServer({ DB, root = resolve('dist'), registrationEnabled = false, trustProxy = false, trustedProxies = [],
  updateRequestDir, updateStatusDir, qidianVersion = PACKAGE_VERSION || '0.0.0', fetchRelease = globalThis.fetch } = {}) {
  if (!DB) throw new Error('A configured SQLite database is required before serving requests');
  ({ trustProxy, trustedProxies } = validateTrustedProxyConfig(trustProxy, trustedProxies));
  const staticRoot = resolve(root);
  const handler = async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url || '/', externalOrigin(incoming, trustProxy, trustedProxies));
      if (url.pathname === '/healthz' && incoming.method === 'GET') {
        writeHead(outgoing, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        outgoing.end('ok');
        return;
      }
      if (url.pathname === '/readyz' && incoming.method === 'GET') {
        const ready = await DB.prepare('SELECT 1 AS ready').first();
        if (ready?.ready !== 1) throw new Error('Database readiness check failed');
        writeHead(outgoing, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        outgoing.end('ready');
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        const body = ['GET', 'HEAD'].includes(incoming.method || 'GET')
          ? undefined : await readBody(incoming, DEFAULT_MAX_REQUEST_BYTES);
        const headers = new Headers();
        for (const [name, raw] of Object.entries(incoming.headers)) {
          const key = name.toLowerCase();
          if (HOP_BY_HOP_HEADERS.has(key) || raw === undefined) continue;
          headers.set(key, Array.isArray(raw) ? raw.join(', ') : String(raw));
        }
        headers.set('X-Client-IP', forwardedClientIp(incoming, trustProxy, trustedProxies));
        const request = new Request(url, {
          method: incoming.method || 'GET', headers,
          ...(body ? { body, duplex: 'half' } : {})
        });
        const response = await handle(request, {
          DB,
          SELF_HOSTED: 'true',
          REGISTRATION_ENABLED: registrationEnabled ? 'true' : 'false',
          QIDIAN_VERSION: qidianVersion,
          fetchRelease,
          ...(updateRequestDir && updateStatusDir ? {
            requestQidianUpdate: () => queueQidianUpdate(updateRequestDir, updateStatusDir),
            readQidianUpdateStatus: () => readQidianUpdateStatus(updateStatusDir, updateRequestDir),
            isQidianUpdaterReady: () => qidianUpdaterReady(updateStatusDir)
          } : {})
        });
        writeHead(outgoing, response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
        return;
      }

      if (!['GET', 'HEAD'].includes(incoming.method || 'GET')) {
        writeHead(outgoing, 405, { 'Allow': 'GET, HEAD', 'Cache-Control': 'no-store' });
        outgoing.end();
        return;
      }
      const path = safeStaticPath(staticRoot, url.pathname);
      if (!path) {
        writeHead(outgoing, 404, { 'Cache-Control': 'no-store' });
        outgoing.end();
        return;
      }
      const actualRoot = await realpath(staticRoot), actualPath = await realpath(path).catch(() => null);
      if (!actualPath || !(actualPath === actualRoot || actualPath.startsWith(`${actualRoot}${sep}`))) {
        outgoing.writeHead(404, { 'Cache-Control': 'no-store' });
        outgoing.end();
        return;
      }
      const content = await readFile(actualPath);
      const hashedAsset = isImmutableStaticAsset(actualPath);
      writeHead(outgoing, 200, {
        'Content-Type': MIME[extname(actualPath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': hashedAsset ? 'public, max-age=31536000, immutable' : 'no-store',
        'Content-Length': content.byteLength
      });
      outgoing.end(incoming.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const status = error.status === 413 ? 413 : 500;
      console.error('Self-hosted request failed:', error);
      if (!outgoing.headersSent) writeHead(outgoing, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      outgoing.end(JSON.stringify({ error: status === 413 ? '请求内容过大' : '服务器暂时无法完成操作' }));
    }
  };
  const server = createServer(handler);
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
