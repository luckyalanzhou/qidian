<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useCaptureDialogStore } from './capture-dialog-store';

const store = useCaptureDialogStore();
const contentPad = ref<HTMLDivElement | null>(null);
let returnFocus: HTMLElement | null = null;
let focusTransition = 0;

watch(() => store.visible, async visible => {
  const transition = ++focusTransition;
  if (visible) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    if (transition !== focusTransition || !store.visible) return;
    if (contentPad.value) contentPad.value.innerHTML = '';
    contentPad.value?.focus();
    return;
  }
  await nextTick();
  if (transition !== focusTransition || store.visible) return;
  if (contentPad.value) contentPad.value.innerHTML = '';
  returnFocus = null;
});

async function closeDialog() {
  if (store.saving) return;
  const target = returnFocus;
  store.close();
  if (!store.visible && store.restoreFocusOnClose && target?.isConnected) {
    await nextTick();
    if (!store.visible && store.restoreFocusOnClose && target.isConnected) target.focus({ preventScroll: true });
  }
}

async function submit() {
  const body = contentPad.value?.innerHTML || '';
  const saved = await store.submit(body);
  if (!saved) {
    if (contentPad.value && contentPad.value.innerHTML !== body) contentPad.value.innerHTML = body;
  }
}
</script>

<template>
  <div
    id="captureOverlay"
    v-show="store.visible"
    class="overlay"
    :class="{ open: store.visible }"
    @click.self="closeDialog"
    @keydown.esc.stop.prevent="closeDialog"
  >
    <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="captureTitle" @submit.prevent="submit">
      <div class="dialog-head">
        <h2 id="captureTitle">快速收集</h2>
        <button class="round-btn" type="button" aria-label="关闭" :disabled="store.saving" @click.stop="closeDialog">
          <span class="ico"><svg><use href="#i-close" /></svg></span>
        </button>
      </div>
      <div class="dialog-body">
        <label class="form-label" for="captureName">笔记标题</label>
        <input id="captureName" v-model="store.title" class="form-text" placeholder="例如：一篇值得收藏的网页教程" :disabled="store.saving">
        <label class="form-label" for="captureType">内容类型</label>
        <select id="captureType" v-model="store.type" class="form-text" :disabled="store.saving">
          <option v-for="item in store.types" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <label class="form-label" for="captureSource">来源网址（可选）</label>
        <input id="captureSource" v-model="store.source" class="form-text" placeholder="https://..." :disabled="store.saving">
        <label class="form-label" for="capturePad">内容 <span style="font-weight:400">· 可粘贴网页、纯文本或截图；支持网页格式、Markdown 和纯文本</span></label>
        <div
          id="capturePad"
          ref="contentPad"
          class="capture-pad doc-content"
          role="textbox"
          aria-multiline="true"
          aria-label="摘录内容"
          data-placeholder="在这里粘贴网页图文、表格、命令，或者输入任意笔记..."
          :contenteditable="store.saving ? 'false' : 'true'"
          @paste="store.handlePaste"
        />
        <div class="hint" style="margin-top:9px">
          粘贴模式：
          <select id="capturePasteMode" v-model="store.pasteMode" class="field" :disabled="store.saving">
            <option value="rich">网页格式 / 自动识别</option>
            <option value="match">整理文本（兼容）</option>
            <option value="markdown">按 Markdown 解析</option>
            <option value="plain">仅纯文本</option>
          </select>
          原网页的复杂样式和远程图片不保证完整保留。
        </div>
        <p id="captureMessage" class="hint" role="status" aria-live="polite">{{ store.message }}</p>
      </div>
      <div class="dialog-foot">
        <span class="hint">保存到私人空间</span>
        <button class="secondary-btn" type="button" :disabled="store.saving" @click.stop="closeDialog">取消</button>
        <button id="captureSave" class="primary-btn" type="submit" :disabled="store.saving" @click.stop>{{ store.saving ? '保存中…' : '收集并保存' }}</button>
      </div>
    </form>
  </div>
</template>
