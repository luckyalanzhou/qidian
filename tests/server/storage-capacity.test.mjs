import test from 'node:test';
import assert from 'node:assert/strict';
import { readStorageCapacity } from '../../server/storage-capacity.mjs';

function stats(blocks, freeBlocks, availableBlocks = freeBlocks) {
  return async (path, options) => {
    assert.equal(path, '/private/data');
    assert.deepEqual(options, { bigint: true });
    return { blocks: BigInt(blocks), bfree: BigInt(freeBlocks), bavail: BigInt(availableBlocks) };
  };
}

test('storage warning stays off at exactly 70 percent and turns on above it', async () => {
  assert.deepEqual(await readStorageCapacity('/private/data', stats(10000, 3100, 3000)), {
    usedPercent: 70,
    warning: false
  });
  assert.deepEqual(await readStorageCapacity('/private/data', stats(10000, 3100, 2999)), {
    usedPercent: 70.01,
    warning: true
  });
});

test('storage warning counts filesystem blocks reserved from the application', async () => {
  assert.deepEqual(await readStorageCapacity('/private/data', stats(100, 35, 25)), {
    usedPercent: 75,
    warning: true
  });
});

test('storage percentage is bounded and an unavailable filesystem fails closed', async () => {
  assert.deepEqual(await readStorageCapacity('/private/data', stats(100, 110)), {
    usedPercent: 0,
    warning: false
  });
  await assert.rejects(readStorageCapacity('/private/data', async () => ({ blocks: 100n, bfree: 30n })), /available capacity is unavailable/);
  await assert.rejects(readStorageCapacity('/private/data', stats(0, 0)), /capacity is unavailable/);
  await assert.rejects(readStorageCapacity('', stats(100, 30)), /data directory is required/);
});
