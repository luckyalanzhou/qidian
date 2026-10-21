import { assertApiErrorResponse, assertApiRequest, assertApiResponse } from '../../shared/api-contracts.js';
import type { ApiErrorResponse, ApiRequestName, ApiResponseMap, ApiResponseName } from './contracts';

export type ApiErrorDetails = ApiErrorResponse;

export class ApiError extends Error {
  readonly status: number;
  readonly details: ApiErrorDetails;

  constructor(status: number, details: ApiErrorDetails) {
    super(details.error || `请求失败 (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const DEFAULT_API_TIMEOUT_MS = 30_000;

export function createApiClient(
  fetcher: ApiFetch = (input, init) => globalThis.fetch(input, init),
  timeoutMs = DEFAULT_API_TIMEOUT_MS
) {
  return async function api(path: string, options: RequestInit = {}): Promise<Response> {
    const pathname = typeof path === 'string' ? path.split(/[?#]/, 1)[0] : '';
    let decodedPath = '';
    try { decodedPath = decodeURIComponent(pathname); } catch {}
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('#')
      || !decodedPath.startsWith('/') || decodedPath.includes('\\')
      || decodedPath.split('/').some(segment => segment === '.' || segment === '..')) {
      throw new TypeError('API 路径必须是站内绝对路径');
    }
    const requestTimeoutMs = pathname === '/assets' || pathname.startsWith('/assets/')
      ? Math.max(timeoutMs, 120_000)
      : timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutHandle = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Request timed out', 'TimeoutError'));
    }, requestTimeoutMs);
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    let response: Response;
    try {
      response = await fetcher(`/api${path}`, { ...options, signal: controller.signal, credentials: 'same-origin', cache: 'no-store' });
    } catch (error) {
      if (timedOut && !options.signal?.aborted) throw new Error('请求超时，请检查网络后重试');
      if (error instanceof TypeError && !options.signal?.aborted) throw new Error('网络连接失败，请检查网络后重试');
      throw error;
    } finally {
      globalThis.clearTimeout(timeoutHandle);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      let details: ApiErrorDetails;
      try { details = assertApiErrorResponse(body); }
      catch { details = { error: '服务器返回了无效错误响应' }; }
      throw new ApiError(response.status, details);
    }
    return response;
  };
}

export const api = createApiClient();

export function createJsonRequester(apiRequest: typeof api = api) {
  return async function requestJson<Name extends ApiResponseName>(
    path: string,
    contract: Name,
    options?: RequestInit,
    requestContract?: ApiRequestName
  ): Promise<ApiResponseMap[Name]> {
    if (requestContract) {
      let body: unknown;
      try { body = JSON.parse(String(options?.body ?? '')); }
      catch { throw new TypeError(`API 请求不符合契约：${requestContract}`); }
      assertApiRequest(requestContract, body);
    }
    const response = await apiRequest(path, options);
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new TypeError('服务器返回了无效响应，请刷新页面后重试'); }
    return assertApiResponse(contract, body);
  };
}

export const requestJson = createJsonRequester();
