import type { Editor } from '@tiptap/core';
import type { EditorToolbarState } from '../../features/editor/types';

type Dependencies = {
  document: Document;
  window: Window & typeof globalThis;
  getToolbar: () => HTMLElement | null;
  getMain: () => HTMLElement;
  getElement: (selector: string) => HTMLElement | null;
  getToolbarState: (editor: Editor) => EditorToolbarState;
  getEditing: () => boolean;
  icons: (name: string) => string;
  onEditorAction: (action: string) => void;
  onParagraphAction: (action: string) => void;
  onDeleteCallout: () => void;
};

const FORMAT_MARKS = [
  ['bold', 'bold'],
  ['italic', 'italic'],
  ['underline', 'underline'],
  ['strikeThrough', 'strikeThrough'],
  ['insertUnorderedList', 'bulletList'],
  ['insertOrderedList', 'orderedList'],
  ['code', 'code']
] as const;

export function createLegacyEditorToolbarView(dependencies: Dependencies) {
  const { document, window } = dependencies;

  function sync(editor: Editor) {
    const toolbar = dependencies.getToolbar();
    if (!toolbar) return;
    const state = dependencies.getToolbarState(editor);

    for (const [command, mark] of FORMAT_MARKS) {
      const active = mark === 'bulletList' || mark === 'orderedList' ? editor.isActive(mark) : state.marks[mark];
      toolbar.querySelector(`[data-fmt="${command}"]`)?.setAttribute('aria-pressed', String(active));
    }

    const blockSelect = dependencies.getElement('#blockSelect') as HTMLSelectElement | null;
    if (blockSelect) blockSelect.value = state.block;

    const tableTools = toolbar.querySelector<HTMLElement>('.table-tools');
    if (tableTools) tableTools.hidden = !state.inTable;
    toolbar.querySelectorAll<HTMLButtonElement>('[data-table-action]').forEach(button => { button.disabled = !state.inTable; });

    const codeTools = toolbar.querySelector<HTMLElement>('.code-tools');
    if (codeTools) codeTools.hidden = !state.inCodeBlock;
    const deleteCodeBlock = toolbar.querySelector<HTMLButtonElement>('[data-editor-action="delete-code-block"]');
    if (deleteCodeBlock) deleteCodeBlock.disabled = !state.inCodeBlock;

    const paragraphTools = toolbar.querySelector<HTMLElement>('.paragraph-tools');
    if (paragraphTools) {
      paragraphTools.hidden = !state.paragraph.visible;
      for (const action of ['moveUp', 'moveDown', 'duplicate', 'delete'] as const) {
        const button = paragraphTools.querySelector<HTMLButtonElement>(`[data-block-action="${action}"]`);
        if (button) button.disabled = !state.paragraph[action];
      }
    }

    const convertTable = toolbar.querySelector<HTMLButtonElement>('[data-editor-action="convert-table"]');
    if (convertTable) convertTable.disabled = !state.canConvertTable;

    let actions = toolbar.querySelector<HTMLElement>('.editor-core-actions');
    if (!actions) {
      actions = document.createElement('span');
      actions.className = 'editor-core-actions';
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', '编辑操作');
      actions.innerHTML = '<span class="tool-divider"></span><button type="button" class="tool-btn" data-editor-action="undo" title="撤销（Ctrl / ⌘ Z）" aria-label="撤销">↶</button><button type="button" class="tool-btn" data-editor-action="redo" title="重做（Ctrl / ⌘ Shift Z）" aria-label="重做">↷</button><span class="tool-divider"></span><button type="button" class="tool-btn" data-editor-action="clear-format" title="清除格式" aria-label="清除格式">Tx</button><button type="button" class="tool-btn" data-editor-action="unlink" title="取消链接" aria-label="取消链接" disabled>×链</button><button type="button" class="tool-btn" data-fmt="code" title="行内代码" aria-label="行内代码">&lt;/&gt;</button>';
      actions.addEventListener('click', event => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-editor-action]');
        if (button) dependencies.onEditorAction(button.dataset.editorAction || '');
      });
      toolbar.append(actions);
    }

    const undo = actions.querySelector<HTMLButtonElement>('[data-editor-action="undo"]');
    const redo = actions.querySelector<HTMLButtonElement>('[data-editor-action="redo"]');
    const unlink = toolbar.querySelector<HTMLButtonElement>('[data-editor-action="unlink"]');
    if (undo) undo.disabled = !state.canUndo;
    if (redo) redo.disabled = !state.canRedo;
    if (unlink) unlink.disabled = !state.hasLink;

    let deleteCallout = toolbar.querySelector<HTMLButtonElement>('[data-delete-block="callout"]');
    if (!deleteCallout) {
      deleteCallout = document.createElement('button');
      deleteCallout.type = 'button';
      deleteCallout.className = 'tool-btn callout-delete';
      deleteCallout.dataset.deleteBlock = 'callout';
      deleteCallout.title = '删除提示块（先将光标放入提示块）';
      deleteCallout.setAttribute('aria-label', '删除当前提示块');
      deleteCallout.innerHTML = dependencies.icons('trash');
      deleteCallout.addEventListener('click', dependencies.onDeleteCallout);
      toolbar.append(deleteCallout);
    }
    deleteCallout.disabled = !state.inCallout;
  }

  function organizeDocumentActions() {
    const row = dependencies.getMain().querySelector('.doc-action-row');
    if (!row) return;
    const ids = dependencies.getEditing() ? ['exportHtml', 'deleteEditorNote'] : ['duplicateDoc', 'deleteDoc'];
    const controls = ids.map(id => dependencies.getElement(`#${id}`)).filter((node): node is HTMLElement => !!node);
    if (!controls.length) return;
    const menu = document.createElement('details');
    menu.className = 'item-menu document-more';
    menu.innerHTML = '<summary aria-label="更多笔记操作">···</summary><div class="item-menu-panel"></div>';
    controls.forEach(node => menu.lastElementChild?.append(node));
    row.append(menu);
  }

  function organize() {
    organizeDocumentActions();
    const toolbar = dependencies.getToolbar();
    if (!toolbar) return;
    const fields = toolbar.previousElementSibling?.querySelectorAll('.editor-fields');
    if (fields?.length) {
      const properties = document.createElement('details');
      properties.className = 'editor-properties';
      properties.open = !window.matchMedia?.('(max-width: 720px)').matches;
      properties.innerHTML = '<summary>笔记属性 <span>类型、标签与来源</span></summary>';
      fields.forEach(node => properties.append(node));
      toolbar.previousElementSibling?.append(properties);
    }

    const extra = document.createElement('details');
    extra.className = 'editor-extra-tools item-menu';
    extra.innerHTML = '<summary aria-label="更多格式">更多</summary><div class="item-menu-panel editor-extra-panel"><button type="button" class="tool-btn" data-editor-action="convert-table" title="将选中的制表符或 Markdown 表格文本转换为表格">选中文本转表格</button><span class="paragraph-tools" role="group" aria-label="当前段落操作" hidden><button type="button" class="tool-btn" data-block-action="moveUp" title="段落上移">上移</button><button type="button" class="tool-btn" data-block-action="moveDown" title="段落下移">下移</button><button type="button" class="tool-btn" data-block-action="duplicate" title="复制当前段落">复制段落</button><button type="button" class="tool-btn contextual-delete" data-block-action="delete" title="删除当前段落">删除段落</button></span></div>';
    extra.lastElementChild?.addEventListener('click', event => {
      const target = event.target as Element | null;
      const action = target?.closest<HTMLButtonElement>('[data-editor-action]');
      if (action) dependencies.onEditorAction(action.dataset.editorAction || '');
      const block = target?.closest<HTMLButtonElement>('[data-block-action]');
      if (block) dependencies.onParagraphAction(block.dataset.blockAction || '');
    });
    const selectors = '[data-fmt="strikeThrough"],[data-fmt="justifyLeft"],[data-fmt="justifyCenter"],[data-fmt="code"],#editorFindToggle,.table-tools,.code-tools,[data-editor-action="clear-format"],[data-editor-action="unlink"],input[type="color"],[data-insert="emoji"],[data-insert="rule"],[data-insert="callout"],[data-insert="details"],[data-delete-block="callout"]';
    toolbar.querySelectorAll(selectors).forEach(node => extra.lastElementChild?.append(node));
    const extraPanel = extra.lastElementChild;
    dependencies.getMain().querySelectorAll('.bottom-action [data-insert]').forEach(node => {
      const kind = (node as HTMLElement).dataset.insert;
      if (kind && extraPanel?.querySelector(`[data-insert="${kind}"]`)) {
        node.remove();
        return;
      }
      (node as HTMLElement).className = 'tool-btn';
      extraPanel?.append(node);
    });
    dependencies.getMain().querySelector('.bottom-action')?.remove();
    toolbar.append(extra);
    toolbar.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach(button => {
      if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', button.title || button.textContent || '');
    });
  }

  return { sync, organize, organizeDocumentActions };
}
