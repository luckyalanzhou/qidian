import { requestJson } from './client';

export function getStorageCapacity(signal?: AbortSignal) {
  return requestJson('/system/storage', 'storageCapacity', { signal });
}
