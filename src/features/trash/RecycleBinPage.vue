<script setup lang="ts">
import { ref } from 'vue';
import { useTrashStore } from './store';

const trash = useTrashStore();
const restoringIds = ref(new Set<string>());
const clearing = ref(false);

async function clearAll() {
  if (clearing.value || !trash.snapshot.count) return;
  clearing.value = true;
  try {
    await trash.clearAll();
  } finally {
    clearing.value = false;
  }
}

async function restore(id: string) {
  if (restoringIds.value.has(id)) return;
  restoringIds.value = new Set([...restoringIds.value, id]);
  try {
    await trash.restore(id);
  } finally {
    const next = new Set(restoringIds.value);
    next.delete(id);
    restoringIds.value = next;
  }
}

function icon(name: string) {
  return `#i-${name}`;
}
</script>

<template>
  <Teleport to="#dashboardHost">
    <section v-if="trash.active" class="trash-page">
      <header class="section-head workspace-page-head">
        <div>
          <h1>回收站</h1>
          <p class="muted">删除的笔记和书签保留 30 天，到期后自动清理。当前 {{ trash.snapshot.count }} 项</p>
        </div>
        <div class="workspace-page-actions">
          <button type="button" class="secondary-btn trash-clear-btn" data-trash-clear :disabled="!trash.snapshot.count || clearing" @click="clearAll">{{ clearing ? '正在清空…' : '清空回收站' }}</button>
        </div>
      </header>

      <div v-if="trash.snapshot.entries.length" class="trash-entry-list">
        <article v-for="entry in trash.snapshot.entries" :key="entry.id" class="trash-entry">
          <div class="trash-entry-copy">
            <span class="pill">{{ entry.kindLabel }}</span>
            <h2>{{ entry.title }}</h2>
            <p v-if="entry.detail" class="trash-entry-detail">{{ entry.detail }}</p>
            <p class="hint">删除于 {{ entry.deletedLabel }} · {{ entry.expiresLabel }}</p>
          </div>
          <button type="button" class="secondary-btn" :data-trash-restore="entry.id" :disabled="restoringIds.has(entry.id)" @click="restore(entry.id)">
            <span class="ico"><svg aria-hidden="true"><use :href="icon('back')" /></svg></span>
            {{ restoringIds.has(entry.id) ? '正在还原…' : '还原' }}
          </button>
        </article>
      </div>
      <div v-else class="empty trash-empty">
        <span class="ico"><svg aria-hidden="true"><use :href="icon('trash')" /></svg></span>
        <strong>回收站为空</strong>
        <p>删除的笔记和书签会在这里保留 30 天。</p>
      </div>
    </section>
  </Teleport>
</template>
