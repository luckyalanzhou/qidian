<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useReaderStore } from './store';
import { useNavigationActionsStore } from '../navigation/navigation-actions-store';
import { useToastStore } from '../notifications/store';
import { useReaderActionsStore } from './reader-actions-store';
import { mountCodeCopyButtons } from './code-copy';
import { mountHeadingObserver } from './heading-observer';

const reader = useReaderStore();
const navigationActions = useNavigationActionsStore();
const toast = useToastStore();
const readerActions = useReaderActionsStore();
const currentSection = ref('');
const readerBody = ref<HTMLElement | null>(null);
let cleanupHeadingObserver: (() => void) | null = null;
let cleanupCodeCopies: (() => void) | null = null;

function icon(name: string) {
  return `#i-${name}`;
}

function disconnectHeadings() {
  cleanupHeadingObserver?.();
  cleanupHeadingObserver = null;
}

async function connectHeadings() {
  disconnectHeadings();
  currentSection.value = '';
  if (!reader.active) return;

  await nextTick();
  if (!reader.active) return;

  const body = readerBody.value;
  if (!body) return;
  const shell = body.closest('.reader-shell');
  const headings = [...body.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')];
  const links = [...(shell?.querySelectorAll<HTMLAnchorElement>('.outline a') || [])];
  cleanupHeadingObserver = mountHeadingObserver(headings, links, id => { currentSection.value = id; });
}

watch(
  () => [reader.active, reader.snapshot.noteId, reader.snapshot.bodyHtml],
  () => {
    cleanupCodeCopies?.();
    cleanupCodeCopies = null;
    void connectHeadings();
    if (reader.active) void nextTick(() => {
      if (!reader.active) return;
      const body = readerBody.value;
      if (body) cleanupCodeCopies = mountCodeCopyButtons(body, message => toast.show(message));
    });
  },
  { flush: 'post' }
);

watch(
  () => [reader.active, reader.snapshot.noteId, reader.snapshot.title] as const,
  async ([active, noteId, title]) => {
    if (!active) return;
    await nextTick();
    if (!reader.active || reader.snapshot.noteId !== noteId) return;
    if (!noteId) {
      navigationActions.execute({ type: 'home', category: 'all' });
      return;
    }
    if (typeof document !== 'undefined') {
      document.querySelector<HTMLElement>('#dashboardHost')?.setAttribute('aria-label', title || '阅读笔记');
    }
  },
  { flush: 'post', immediate: true }
);

onBeforeUnmount(() => {
  disconnectHeadings();
  cleanupCodeCopies?.();
});
</script>

<template>
  <Teleport to="#dashboardHost">
    <div v-if="reader.active" class="note-shell reader-shell">
      <section>
        <div class="doc-head">
          <button class="doc-back" id="backDoc" type="button" @click.stop="navigationActions.execute({ type: 'back' })">
            <span class="ico"><svg aria-hidden="true"><use :href="icon('back')" /></svg></span>返回笔记列表
          </button>
          <div class="doc-meta">
            <span class="pill">{{ reader.snapshot.typeLabel }}</span>
            <span class="doc-date">更新于 {{ reader.snapshot.updatedLabel }} · 阅读约 {{ reader.snapshot.readingMinutes }} 分钟</span>
          </div>
          <h1 class="doc-title">{{ reader.snapshot.title }}</h1>
          <div class="doc-desc">
            <span v-for="(tag, index) in reader.snapshot.tags" :key="`${tag}-${index}`" class="tag">#{{ tag }}</span>
            <span v-if="reader.snapshot.source" class="reader-source">
              来源：<a :href="reader.snapshot.sourceUrl || '#'" target="_blank" rel="noopener noreferrer">原始网页 ↗</a>
            </span>
          </div>
          <div class="doc-action-row">
            <button v-if="reader.snapshot.publishLabel" class="primary-btn" id="publishDoc" type="button" @click.stop="readerActions.execute({ type: 'publish-current' })">
              <span class="ico"><svg aria-hidden="true"><use :href="icon('check')" /></svg></span>{{ reader.snapshot.publishLabel }}
            </button>
            <button class="primary-btn" id="editDoc" type="button" @click.stop="readerActions.execute({ type: 'edit-current' })">
              <span class="ico"><svg aria-hidden="true"><use :href="icon('edit')" /></svg></span>{{ reader.snapshot.editLabel }}
            </button>
            <button v-if="reader.snapshot.showPendingChanges" class="secondary-btn" id="showDraftView" type="button" @click.stop="readerActions.execute({ type: 'show-pending-changes' })">查看待发布修改</button>
            <button class="secondary-btn" id="pinDoc" type="button" @click.stop="readerActions.execute({ type: 'toggle-current-pin' })">
              <span class="ico"><svg aria-hidden="true"><use :href="icon('heart')" /></svg></span>{{ reader.snapshot.pinned ? '取消收藏' : '收藏' }}
            </button>
            <details class="item-menu document-more">
              <summary aria-label="更多笔记操作">···</summary>
              <div class="item-menu-panel">
                <button type="button" id="duplicateDoc" @click.stop="readerActions.execute({ type: 'duplicate-current' })"><span class="ico"><svg aria-hidden="true"><use :href="icon('clip')" /></svg></span>创建副本</button>
                <button type="button" class="danger-btn" id="deleteDoc" @click.stop="readerActions.execute({ type: 'delete-current' })"><span class="ico"><svg aria-hidden="true"><use :href="icon('trash')" /></svg></span>删除</button>
              </div>
            </details>
          </div>
        </div>

        <details v-if="reader.snapshot.outline.length" class="mobile-toc">
          <summary>本文目录 <span>{{ reader.snapshot.outline.length }} 个章节</span></summary>
          <nav class="outline" aria-label="本文目录">
            <a
              v-for="item in reader.snapshot.outline"
              :key="item.id"
              :href="`#${item.id}`"
              :class="[{ sub: item.level > 2 }, `toc-level-${item.level}`, { current: currentSection === item.id }]"
              :aria-current="currentSection === item.id ? 'location' : undefined"
            >{{ item.name }}</a>
          </nav>
        </details>

        <article class="read-paper">
          <div v-if="reader.snapshot.bodyHtml" id="docRead" ref="readerBody" class="doc-content" v-html="reader.snapshot.bodyHtml" />
          <div v-else id="docRead" ref="readerBody" class="doc-content"><p class="hint">这里还没有内容。点击“编辑笔记”开始。</p></div>
        </article>
      </section>

      <aside class="right-rail">
        <h3>本文目录</h3>
        <nav class="outline" aria-label="本文目录">
          <a
            v-for="item in reader.snapshot.outline"
            :key="item.id"
            :href="`#${item.id}`"
            :class="[{ sub: item.level > 2 }, `toc-level-${item.level}`, { current: currentSection === item.id }]"
            :aria-current="currentSection === item.id ? 'location' : undefined"
          >{{ item.name }}</a>
          <span v-if="!reader.snapshot.outline.length" class="hint">暂无标题</span>
        </nav>
        <div class="rail-rule" />
        <h3>笔记信息</h3>
        <div class="rail-source">
          创建：{{ reader.snapshot.createdLabel }}<br>
          类型：{{ reader.snapshot.typeLabel }}<br>
          来源：<a v-if="reader.snapshot.source" :href="reader.snapshot.sourceUrl || '#'" target="_blank" rel="noopener noreferrer">{{ reader.snapshot.source }}</a><span v-else>自己记录</span>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
