import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { DOMSerializer } from '@tiptap/pm/model';
import { qidianEditorExtensions } from '../editor/editor-extensions.js';
import { MAX_NOTE_BODY_CHARS } from '../../../shared/vault-validation.js';

export const qidianSchema = getSchema(qidianEditorExtensions);
const markdown = new MarkdownManager({ extensions: qidianEditorExtensions, markedOptions: { gfm: true } });

export function parseQidianMarkdown(source) {
  const value = String(source || '');
  if (value.length > MAX_NOTE_BODY_CHARS) throw new RangeError('粘贴内容超过正文长度上限，已停止结构化解析');
  return markdown.parse(value);
}

export function serializeQidianDocument(content) {
  const documentNode = qidianSchema.nodeFromJSON(content);
  documentNode.check();
  const container = document.createElement('div');
  const fragment = DOMSerializer.fromSchema(qidianSchema).serializeFragment(documentNode.content, { document });
  container.appendChild(fragment);
  return container.innerHTML;
}
