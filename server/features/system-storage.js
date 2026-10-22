/** Reports data-volume usage to an authenticated self-hosted workspace. */
export async function handleSystemStorageRoute({ request, env, path, json }) {
  if (path !== '/api/system/storage' || request.method !== 'GET' || typeof env.readStorageCapacity !== 'function') return null;
  return json(await env.readStorageCapacity(), 200, {}, 'storageCapacity');
}
