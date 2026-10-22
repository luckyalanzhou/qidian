<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getStorageCapacity } from '../../api/system-storage';
import { useWorkspaceShellStore } from '../navigation/workspace-shell-store';
import type { StorageCapacity } from '../../api/contracts';

const shell = useWorkspaceShellStore();
const capacity = ref<StorageCapacity | null>(null);
let pollTimer: number | undefined;
let requestController: AbortController | null = null;

async function refreshCapacity() {
  if (!shell.workspaceReady || shell.localPreview || document.visibilityState !== 'visible') return;
  requestController?.abort();
  requestController = new AbortController();
  try {
    capacity.value = await getStorageCapacity(requestController.signal);
  } catch {
    capacity.value = null;
  }
}

function stopMonitoring() {
  if (pollTimer !== undefined) window.clearInterval(pollTimer);
  pollTimer = undefined;
  requestController?.abort();
  requestController = null;
  capacity.value = null;
}

function startMonitoring() {
  stopMonitoring();
  if (!shell.workspaceReady || shell.localPreview) return;
  void refreshCapacity();
  pollTimer = window.setInterval(() => void refreshCapacity(), 60_000);
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') void refreshCapacity();
};

onMounted(() => {
  watch(() => [shell.workspaceReady, shell.localPreview] as const, startMonitoring, { immediate: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  stopMonitoring();
});
</script>

<template>
  <Teleport to="#storageWarningIsland">
    <div v-if="capacity?.warning" class="storage-capacity-warning" role="status" aria-live="polite">
      <strong>宿主数据盘使用率较高：</strong>
      当前已用 {{ capacity.usedPercent.toFixed(2) }}%，超过 70% 提醒阈值。建议及时清理或扩容数据盘；此提醒不会阻止保存。
    </div>
  </Teleport>
</template>
