import { statfs } from 'node:fs/promises';

export const STORAGE_WARNING_THRESHOLD_PERCENT = 70;

/** Return aggregate usage against space available to an unprivileged app process. */
export async function readStorageCapacity(path, readFilesystem = statfs) {
  if (typeof path !== 'string' || !path) throw new TypeError('A data directory is required');
  const filesystem = await readFilesystem(path, { bigint: true });
  const blocks = BigInt(filesystem.blocks);
  if (filesystem.bavail === undefined) throw new Error('Filesystem available capacity is unavailable');
  const availableBlocks = BigInt(filesystem.bavail);
  if (blocks <= 0n) throw new Error('Filesystem capacity is unavailable');

  const usedBlocks = blocks - availableBlocks;
  const boundedUsedBlocks = usedBlocks < 0n ? 0n : usedBlocks > blocks ? blocks : usedBlocks;
  const usedPercent = Number((boundedUsedBlocks * 10000n) / blocks) / 100;
  return {
    usedPercent,
    warning: boundedUsedBlocks * 100n > blocks * BigInt(STORAGE_WARNING_THRESHOLD_PERCENT)
  };
}
