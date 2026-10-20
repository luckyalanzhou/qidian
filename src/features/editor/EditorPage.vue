<script setup lang="ts">
import { nextTick, watch } from 'vue';
import { useEditorStore } from './store';
import { useNavigationActionsStore } from '../navigation/navigation-actions-store';
import { useEditorPageActionsStore } from './editor-page-actions-store';
import type { EditorAction } from './types';

const editor = useEditorStore();
const navigationActions = useNavigationActionsStore();
const pageActions = useEditorPageActionsStore();
const propertiesOpen = typeof window === 'undefined' || !window.matchMedia?.('(max-width: 720px)').matches;

function icon(name: string) {
  return `#i-${name}`;
}

function onFormInput() {
  editor.formChanged();
}

function onFormBlur() {
  editor.formBlurred();
}

function goToHeading(position: number) {
  void editor.dispatch({ group: 'outline', action: 'goto', position });
}

function dispatchEditorAction(action: EditorAction) {
  void editor.dispatch(action);
}

function onBlockChange(event: Event) {
  dispatchEditorAction({ group: 'format', action: 'formatBlock', value: (event.target as HTMLSelectElement).value });
}

function onFontColorChange(event: Event) {
  dispatchEditorAction({ group: 'format', action: 'foreColor', value: (event.target as HTMLInputElement).value });
}

watch(
  () => [editor.active, editor.snapshot.noteId, editor.snapshot.revision],
  async () => {
    if (!editor.active) return;
    await nextTick();
    if (editor.active) editor.initialize();
  },
  { flush: 'post' }
);
</script>

<template>
  <Teleport to="#dashboardHost">
    <div v-if="editor.active" class="note-shell">
      <section>
        <div class="doc-head">
          <button class="doc-back" id="backDoc" type="button" @click.stop="navigationActions.execute({ type: 'back' })">
            <span class="ico"><svg aria-hidden="true"><use :href="icon('back')" /></svg></span>返回阅读
          </button>
          <div class="doc-meta"><span class="pill">编辑笔记</span></div>
          <div class="doc-action-row">
            <button class="primary-btn" id="saveEditor" type="button" @click.stop="pageActions.execute({ type: 'save-current' })"><span class="ico"><svg aria-hidden="true"><use :href="icon('check')" /></svg></span>{{ editor.snapshot.publishLabel }}</button>
            <button class="secondary-btn" id="addAttachment" type="button" @click.stop="pageActions.execute({ type: 'choose-attachment' })">＋ 附件</button>
            <button class="secondary-btn" id="exportHtml" type="button" @click.stop="pageActions.execute({ type: 'export-html' })">导出 HTML</button>
            <button class="secondary-btn" id="addImgButton" type="button" @click.stop="pageActions.execute({ type: 'choose-image' })"><span class="ico"><svg aria-hidden="true"><use :href="icon('image')" /></svg></span>插入图片</button>
            <button class="secondary-btn danger-btn" id="deleteEditorNote" type="button" @click.stop="pageActions.execute({ type: 'delete-current' })"><span class="ico"><svg aria-hidden="true"><use :href="icon('trash')" /></svg></span>删除笔记</button>
          </div>
        </div>

        <div class="editor-card">
          <div class="editor-head">
            <label class="editor-label" for="editTitle">标题</label>
            <input id="editTitle" v-model="editor.form.title" class="title-input" placeholder="输入笔记标题..." @input="onFormInput" @blur="onFormBlur">
            <details class="editor-properties" :open="propertiesOpen">
              <summary>笔记属性 <span>类型、标签与来源</span></summary>
              <div class="editor-properties-fields">
              <div class="editor-fields">
                <label>类型
              <select id="editType" v-model="editor.form.type" class="field" @change="onFormInput" @blur="onFormBlur">
                  <option v-for="type in editor.snapshot.noteTypes" :key="type.id" :value="type.id">{{ type.label }}</option>
                </select>
                </label>
              <label class="tags">标签
                <input id="editTags" v-model="editor.form.tags" class="field tags" placeholder="例如：Linux, 教程" @input="onFormInput" @blur="onFormBlur">
                </label>
              </div>
              <div class="editor-fields">
              <label style="width:100%">来源网址
                <input id="editSource" v-model="editor.form.source" class="field" placeholder="https://...（可选）" style="max-width:100%;flex:1" @input="onFormInput" @blur="onFormBlur">
              </label>
              </div>
              </div>
            </details>
          </div>

          <div class="editor-bar" id="editorToolbar">
            <select id="blockSelect" class="tool-select" :value="editor.toolbar.block" aria-label="段落类型" @change.stop="onBlockChange"><option value="p">正文</option><option value="h2">标题 H2</option><option value="h3">标题 H3</option><option value="blockquote">引用</option></select>
            <span class="tool-divider" />
            <button class="tool-btn k" data-fmt="bold" :aria-pressed="editor.toolbar.marks.bold" title="加粗" type="button" @click.stop="dispatchEditorAction({ group: 'format', action: 'bold' })">B</button>
            <button class="tool-btn" data-fmt="italic" :aria-pressed="editor.toolbar.marks.italic" title="斜体" type="button" @click.stop="dispatchEditorAction({ group: 'format', action: 'italic' })"><i>I</i></button>
            <button class="tool-btn" data-fmt="underline" :aria-pressed="editor.toolbar.marks.underline" title="下划线" type="button" @click.stop="dispatchEditorAction({ group: 'format', action: 'underline' })"><u>U</u></button>
            <span class="tool-divider" />
            <button class="tool-btn" data-fmt="insertUnorderedList" title="项目列表" type="button" @click.stop="dispatchEditorAction({ group: 'format', action: 'insertUnorderedList' })">☷</button>
            <button class="tool-btn" data-fmt="insertOrderedList" title="编号列表" type="button" @click.stop="dispatchEditorAction({ group: 'format', action: 'insertOrderedList' })">☰</button>
            <button class="tool-btn" data-fmt="toggleTaskList" title="待办清单" aria-label="待办清单" type="button" @click.stop="dispatchEditorAction({ group: 'format', action: 'toggleTaskList' })">☑</button>
            <span class="tool-divider" />
            <button class="tool-btn" data-insert="code" title="代码块" type="button" @click.stop="dispatchEditorAction({ group: 'insert', action: 'code' })">&lt;/&gt;</button>
            <button class="tool-btn" data-insert="table" title="表格" type="button" @click.stop="dispatchEditorAction({ group: 'insert', action: 'table' })">▦</button>
            <button class="tool-btn" data-insert="link" title="链接" type="button" @click.stop="dispatchEditorAction({ group: 'insert', action: 'link' })">↗</button>
            <button class="tool-btn" data-insert="image" title="图片" type="button" @click.stop="dispatchEditorAction({ group: 'insert', action: 'image' })">▧</button>
          <details class="editor-extra-tools item-menu">
            <summary aria-label="更多格式">更多</summary>
            <div class="item-menu-panel editor-extra-panel">
              <button class="tool-btn" data-fmt="strikeThrough" :aria-pressed="editor.toolbar.marks.strikeThrough" title="删除线" type="button" @click.stop="dispatchEditorAction({ group: 'format', action: 'strikeThrough' })"><s>S</s></button>
              <button class="tool-btn" data-fmt="justifyLeft" title="左对齐" type="button" @click.stop="dispatchEditorAction({ group: 'format', action: 'justifyLeft' })">≡</button>
              <button class="tool-btn" data-fmt="justifyCenter" title="居中" type="button" @click.stop="dispatchEditorAction({ group: 'format', action: 'justifyCenter' })">☷</button>
              <button class="tool-btn" id="editorFindToggle" title="查找本文（Ctrl / ⌘ F）" aria-label="查找本文" type="button">⌕</button>
              <span class="table-tools" role="group" aria-label="表格操作" :hidden="!editor.toolbar.inTable">
                <button class="tool-btn" data-table-action="addRowAfter" title="下方添加行" aria-label="下方添加行" type="button" @click.stop="dispatchEditorAction({ group: 'table', action: 'addRowAfter' })">＋行</button>
                <button class="tool-btn" data-table-action="addColumnAfter" title="右侧添加列" aria-label="右侧添加列" type="button" @click.stop="dispatchEditorAction({ group: 'table', action: 'addColumnAfter' })">＋列</button>
                <button class="tool-btn" data-table-action="deleteRow" title="删除当前行" aria-label="删除当前行" type="button" @click.stop="dispatchEditorAction({ group: 'table', action: 'deleteRow' })">−行</button>
                <button class="tool-btn" data-table-action="deleteColumn" title="删除当前列" aria-label="删除当前列" type="button" @click.stop="dispatchEditorAction({ group: 'table', action: 'deleteColumn' })">−列</button>
                <button class="tool-btn contextual-delete" data-table-action="deleteTable" title="删除整个表格" aria-label="删除整个表格" type="button" @click.stop="dispatchEditorAction({ group: 'table', action: 'deleteTable' })">删表</button>
              </span>
              <span class="code-tools" role="group" aria-label="命令块操作" :hidden="!editor.toolbar.inCodeBlock"><button class="tool-btn contextual-delete" data-editor-action="delete-code-block" title="删除整个命令块" aria-label="删除整个命令块" type="button" @click.stop="dispatchEditorAction({ group: 'editor', action: 'delete-code-block' })">删命令</button></span>
              <button class="tool-btn" data-editor-action="undo" :disabled="!editor.toolbar.canUndo" title="撤销（Ctrl / ⌘ Z）" aria-label="撤销" type="button" @click.stop="dispatchEditorAction({ group: 'editor', action: 'undo' })">↶</button>
              <button class="tool-btn" data-editor-action="redo" :disabled="!editor.toolbar.canRedo" title="重做（Ctrl / ⌘ Shift Z）" aria-label="重做" type="button" @click.stop="dispatchEditorAction({ group: 'editor', action: 'redo' })">↷</button>
              <button class="tool-btn" data-editor-action="clear-format" title="清除格式" aria-label="清除格式" type="button" @click.stop="dispatchEditorAction({ group: 'editor', action: 'clear-format' })">Tx</button>
              <button class="tool-btn" data-editor-action="unlink" :disabled="!editor.toolbar.hasLink" title="取消链接" aria-label="取消链接" type="button" @click.stop="dispatchEditorAction({ group: 'editor', action: 'unlink' })">×链</button>
              <button class="tool-btn" data-fmt="code" :aria-pressed="editor.toolbar.marks.code" title="行内代码" aria-label="行内代码" type="button" @click.stop="dispatchEditorAction({ group: 'format', action: 'code' })">&lt;/&gt;</button>
              <button class="tool-btn contextual-delete" data-editor-action="delete-callout" :disabled="!editor.toolbar.inCallout" title="删除当前提示块" aria-label="删除当前提示块" type="button" @click.stop="dispatchEditorAction({ group: 'editor', action: 'delete-callout' })">删提示</button>
              <input type="color" class="tool-color" id="fontColor" title="文字颜色" value="#5261cf" @change.stop="onFontColorChange">
              <button class="tool-btn" data-insert="emoji" title="插入表情" type="button" @click.stop="dispatchEditorAction({ group: 'insert', action: 'emoji' })">☺</button>
              <button class="tool-btn" data-insert="rule" title="分隔线" type="button" @click.stop="dispatchEditorAction({ group: 'insert', action: 'rule' })">—</button>
              <button class="tool-btn" data-editor-action="convert-table" :disabled="!editor.toolbar.canConvertTable" title="将选中的制表符或 Markdown 表格文本转换为表格" type="button" @click.stop="dispatchEditorAction({ group: 'editor', action: 'convert-table' })">选中文本转表格</button>
              <span class="paragraph-tools" role="group" aria-label="当前段落操作" :hidden="!editor.toolbar.paragraph.visible">
                <button class="tool-btn" data-block-action="moveUp" :disabled="!editor.toolbar.paragraph.moveUp" title="段落上移" type="button" @click.stop="dispatchEditorAction({ group: 'paragraph', action: 'moveUp' })">上移</button>
                <button class="tool-btn" data-block-action="moveDown" :disabled="!editor.toolbar.paragraph.moveDown" title="段落下移" type="button" @click.stop="dispatchEditorAction({ group: 'paragraph', action: 'moveDown' })">下移</button>
                <button class="tool-btn" data-block-action="duplicate" :disabled="!editor.toolbar.paragraph.duplicate" title="复制当前段落" type="button" @click.stop="dispatchEditorAction({ group: 'paragraph', action: 'duplicate' })">复制段落</button>
                <button class="tool-btn contextual-delete" data-block-action="delete" :disabled="!editor.toolbar.paragraph.delete" title="删除当前段落" type="button" @click.stop="dispatchEditorAction({ group: 'paragraph', action: 'delete' })">删除段落</button>
              </span>
              <button class="tool-btn" data-insert="callout" type="button" @click.stop="dispatchEditorAction({ group: 'insert', action: 'callout' })">＋ 提示块</button>
              <button class="tool-btn" data-insert="details" type="button" @click.stop="dispatchEditorAction({ group: 'insert', action: 'details' })">＋ 折叠内容</button>
            </div>
          </details>
          </div>

          <div class="editor-find" role="search" hidden>
            <input id="editorFindInput" type="search" placeholder="查找本文" aria-label="查找本文">
            <span id="editorFindCount" aria-live="polite" />
            <button id="editorFindPrev" aria-label="上一个匹配项" title="上一个匹配项" type="button">↑</button>
            <button id="editorFindNext" aria-label="下一个匹配项" title="下一个匹配项" type="button">↓</button>
            <button id="editorFindClose" aria-label="关闭查找" title="关闭查找" type="button">×</button>
          </div>
          <details v-if="editor.outline.length" class="editor-outline-mobile"><summary>本文目录</summary><nav class="outline editor-outline-links"><button v-for="heading in editor.outline" :key="heading.position" type="button" class="editor-outline-link" :class="`level-${heading.level}`" @click.stop="goToHeading(heading.position)">{{ heading.text }}</button></nav></details>
          <div id="editorSurface" />
          <div id="editorMarkdownPreview" class="doc-content editor-markdown-preview" hidden />
          <div class="editor-bottom"><span class="paste-modes">粘贴方式 <select id="editPasteMode"><option value="rich">保留网页格式 / Markdown 原文</option><option value="match">整理纯文本（兼容）</option><option value="markdown">Markdown 转换为富文本</option><option value="plain">仅纯文本</option></select></span><button class="secondary-btn editor-preview-toggle" id="editorMarkdownPreviewToggle" type="button" aria-pressed="false">预览笔记格式</button></div>
        </div>
      </section>
      <aside v-if="editor.outline.length" class="right-rail edit-inspector"><div class="inspector-card"><h3>本文目录</h3><nav class="outline editor-outline-links"><button v-for="heading in editor.outline" :key="heading.position" type="button" class="editor-outline-link" :class="`level-${heading.level}`" @click.stop="goToHeading(heading.position)">{{ heading.text }}</button></nav></div></aside>
    </div>
  </Teleport>
</template>
