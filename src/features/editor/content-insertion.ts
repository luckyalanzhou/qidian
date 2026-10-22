import { MAX_NOTE_BODY_CHARS } from '../../../shared/vault-validation.js';

type EditorBookmark = {
  resolve: (document: any) => any;
};

type InsertionEditor = {
  isDestroyed: boolean;
  isActive: (name: string) => boolean;
  schema: any;
  state: {
    doc: any;
    selection: { getBookmark: () => EditorBookmark };
    tr: { setSelection: (selection: any) => any };
  };
  commands: { insertContent: (content: any, options?: any) => boolean };
  view: { dispatch: (transaction: any) => void };
};

type ContentInsertionDependencies = {
  window: Window & typeof globalThis;
  document: Document;
  purifier: { sanitize: (value: string) => string };
  getMode: (fieldId: 'editPasteMode' | 'capturePasteMode') => string;
  classifyClipboard: (input: { html?: string; text?: string; mode?: string }) => string;
  plainTextToDocument: (value: string) => any;
  sanitizeMarkdownDocument: (document: any, schema: any, safeUrl: (value: string) => boolean) => any;
  loadMarkdownTools: () => Promise<any>;
  cleanHTML: (html: string, keepStyles?: boolean) => string;
  plainTextToStructuredHTML: (value: string) => string;
  safeUrl: (value: string, image?: boolean) => boolean;
  escapeHTML: (value: string) => string;
  autofillPastedTitle: (fieldId: string, html: string, text: string) => void;
  upload: (file: File) => Promise<{ url: string; mime: string }>;
  insertEditorHTML: (html: string) => void;
  getEditor: () => InsertionEditor | null;
  insertCaptureHTML: (html: string, range?: Range | null) => void;
  insertCaptureText: (text: string, range?: Range | null) => void;
  captureSelection: (pad: HTMLElement) => Range | null;
  toast: (message: string) => void;
};

export function createContentInsertionController(dependencies: ContentInsertionDependencies) {
  const { document, window } = dependencies;
  const oversizedClipboardMessage = '粘贴内容超过 100 万字符上限，未插入；请减少内容后重试。';

  function clipboardText(html: string, plain: string) {
    if (plain) return String(plain);
    if (!html) return '';
    const parsed = new window.DOMParser().parseFromString(dependencies.purifier.sanitize(String(html)), 'text/html');
    parsed.querySelectorAll('img').forEach(node => node.replaceWith(parsed.createTextNode(node.getAttribute('alt') || '')));
    parsed.querySelectorAll('br').forEach(node => node.replaceWith(parsed.createTextNode('\n')));
    parsed.querySelectorAll('p,div,li,pre,h1,h2,h3,h4,h5,h6,tr,blockquote').forEach(node => node.append(parsed.createTextNode('\n')));
    return parsed.body.textContent || '';
  }

  function boundedClipboard(html: string, plain: string) {
    const sourceHTML = String(html || ''), sourceText = String(plain || '');
    if (sourceText.length > MAX_NOTE_BODY_CHARS) return { accepted: false as const };
    if (sourceHTML.length > MAX_NOTE_BODY_CHARS) {
      return sourceText
        ? { accepted: true as const, html: '', text: sourceText, htmlTooLarge: true }
        : { accepted: false as const };
    }
    const text = clipboardText(sourceHTML, sourceText);
    if (text.length > MAX_NOTE_BODY_CHARS) return { accepted: false as const };
    return { accepted: true as const, html: sourceHTML, text, htmlTooLarge: false };
  }

  function isCodeSelection(editor: InsertionEditor) {
    return editor.isActive('codeBlock') || editor.isActive('code');
  }

  function insertPlainDocument(editor: InsertionEditor, text: string) {
    const value = String(text || '');
    if (isCodeSelection(editor)) {
      if (value) editor.commands.insertContent({ type: 'text', text: value });
      return;
    }
    editor.commands.insertContent(dependencies.plainTextToDocument(value));
  }

  async function insertMarkdownDocument(editor: InsertionEditor, text: string, bookmark: EditorBookmark) {
    const { parseQidianMarkdown, serializeQidianDocument } = await dependencies.loadMarkdownTools();
    if (editor.isDestroyed) return null;
    const parsed = parseQidianMarkdown(text);
    const safe = dependencies.sanitizeMarkdownDocument(parsed, editor.schema, dependencies.safeUrl);
    if (serializeQidianDocument(safe).length > MAX_NOTE_BODY_CHARS) {
      throw new RangeError('Markdown 转换后超过正文上限');
    }
    try { editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc))); } catch {}
    if (!editor.commands.insertContent(safe)) throw new Error('编辑器拒绝了转换后的内容');
    return safe;
  }

  function plainDocumentHTML(documentJSON: any) {
    if (documentJSON?.type !== 'doc' || !Array.isArray(documentJSON.content)) throw new TypeError('纯文本转换结构无效');
    return documentJSON.content.map((block: any) => {
      if (block.type !== 'paragraph') throw new TypeError('纯文本段落类型不受支持');
      return `<p>${(block.content || []).map((node: any) => node.type === 'hardBreak' ? '<br>' : node.type === 'text' ? dependencies.escapeHTML(node.text) : '').join('')}</p>`;
    }).join('') || '<p></p>';
  }

  function hasRemoteImage(node: any): boolean {
    if (node?.type === 'image' && /^https?:\/\//i.test(String(node.attrs?.src || ''))) return true;
    return (node?.content || []).some(hasRemoteImage);
  }

  async function storeImage(file: File, destination: 'edit' | 'capture', editorBookmark: EditorBookmark | null = null, captureRange: Range | null = null) {
    if (!file.type.startsWith('image/')) return;
    try {
      const asset = await dependencies.upload(file);
      if (!asset.mime.startsWith('image/')) throw Error('仅支持 PNG、JPEG、GIF、WebP 图像');
      const html = `<figure><img src="${asset.url}" alt="${dependencies.escapeHTML(file.name)}"><figcaption>${dependencies.escapeHTML(file.name)}</figcaption></figure><p></p>`;
      if (destination === 'capture') dependencies.insertCaptureHTML(dependencies.cleanHTML(html, true), captureRange);
      else {
        const editor = dependencies.getEditor();
        if (editorBookmark && editor) {
          try { editor.view.dispatch(editor.state.tr.setSelection(editorBookmark.resolve(editor.state.doc))); } catch {}
        }
        dependencies.insertEditorHTML(html);
      }
      dependencies.toast('图片已存入私人空间');
    } catch (error) {
      dependencies.toast((error as Error)?.message || '图片上传失败');
    }
  }

  function handleEditorPaste({ event, editor }: { event: ClipboardEvent; editor: InsertionEditor }) {
    const mode = dependencies.getMode('editPasteMode') || 'rich';
    const clip = event.clipboardData;
    if (!clip) return false;
    const html = clip.getData('text/html'), plain = clip.getData('text/plain');
    const hasHTML = html.length > MAX_NOTE_BODY_CHARS || Boolean(html.trim());
    const file = Array.from(clip.files).find(item => item.type.startsWith('image/'));
    if (file && !hasHTML && !plain) {
      event.preventDefault();
      void storeImage(file, 'edit', editor.state.selection.getBookmark());
      return true;
    }
    if (!hasHTML && !plain) return false;
    const bounded = boundedClipboard(html, plain);
    if (!bounded.accepted) {
      event.preventDefault();
      dependencies.toast(oversizedClipboardMessage);
      return true;
    }
    const pasteHTML = bounded.html, text = bounded.text, hasPasteHTML = Boolean(pasteHTML.trim());
    if (bounded.htmlTooLarge) dependencies.toast('网页格式超过处理上限，已按纯文本插入');
    dependencies.autofillPastedTitle('editTitle', pasteHTML, text);
    if (isCodeSelection(editor)) {
      event.preventDefault();
      insertPlainDocument(editor, text);
      return true;
    }
    const selectedMode = mode === 'match' ? 'legacy' : mode;
    const kind = dependencies.classifyClipboard({ html: hasPasteHTML ? pasteHTML : '', text, mode: selectedMode });
    event.preventDefault();
    if (kind === 'html') {
      let safe: string;
      try { safe = dependencies.cleanHTML(pasteHTML, mode === 'rich'); }
      catch {
        insertPlainDocument(editor, text);
        dependencies.toast('网页内容过于复杂，已按纯文本插入，原文字未丢失');
        return true;
      }
      if (!editor.commands.insertContent(safe, { parseOptions: { preserveWhitespace: 'full' } })) {
        insertPlainDocument(editor, text);
        dependencies.toast('网页格式无法插入，已按纯文本保留内容');
        return true;
      }
      if (mode === 'rich' && /<img/i.test(pasteHTML) && !/(?:src=["'](?:\/api\/assets\/|data:image\/))/i.test(pasteHTML)) {
        dependencies.toast('已粘贴图文；原网页的远程图片可能会失效，建议另行上传');
      }
      return true;
    }
    if (kind === 'markdown') {
      // Automatic detection should keep Markdown source editable and copyable.
      // The explicit conversion mode remains available for rich-text editing.
      if (mode !== 'markdown') {
        insertPlainDocument(editor, text);
        return true;
      }
      const bookmark = editor.state.selection.getBookmark();
      void insertMarkdownDocument(editor, text, bookmark)
        .then(safe => { if (safe && hasRemoteImage(safe)) dependencies.toast('已粘贴远程图片链接；原站可能限制访问，建议上传到私人空间保存'); })
        .catch(error => {
          if (editor.isDestroyed) return;
          try { editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc))); } catch {}
          insertPlainDocument(editor, text);
          dependencies.toast(error instanceof RangeError && /正文上限/.test(error.message)
            ? 'Markdown 转换后超过正文上限，已按原文插入；请缩短内容后重试格式化'
            : 'Markdown 解析失败，已按纯文本插入，原内容未丢失');
        });
      return true;
    }
    if (kind === 'legacy') {
      try {
        const safe = dependencies.cleanHTML(dependencies.plainTextToStructuredHTML(text), false);
        if (!editor.commands.insertContent(safe, { parseOptions: { preserveWhitespace: 'full' } })) throw new Error('编辑器拒绝了兼容转换结果');
      } catch {
        insertPlainDocument(editor, text);
        dependencies.toast('兼容整理失败，已按原文插入');
      }
      return true;
    }
    insertPlainDocument(editor, text);
    return true;
  }

  async function handleCapturePaste(event: ClipboardEvent) {
    const mode = dependencies.getMode('capturePasteMode') || 'rich';
    const clip = event.clipboardData;
    if (!clip) return;
    const html = clip.getData('text/html'), plain = clip.getData('text/plain');
    const hasHTML = html.length > MAX_NOTE_BODY_CHARS || Boolean(html.trim());
    const file = Array.from(clip.files).find(item => item.type.startsWith('image/'));
    const pad = event.currentTarget as HTMLElement;
    const captureRange = dependencies.captureSelection(pad);
    if (file && !hasHTML && !plain) {
      event.preventDefault();
      await storeImage(file, 'capture', null, captureRange);
      return;
    }
    if (!hasHTML && !plain) return;
    const bounded = boundedClipboard(html, plain);
    if (!bounded.accepted) {
      event.preventDefault();
      dependencies.toast(oversizedClipboardMessage);
      return;
    }
    const pasteHTML = bounded.html, text = bounded.text, hasPasteHTML = Boolean(pasteHTML.trim());
    if (bounded.htmlTooLarge) dependencies.toast('网页格式超过处理上限，已按纯文本插入');
    dependencies.autofillPastedTitle('captureName', pasteHTML, text);
    const selectionNode = window.getSelection()?.anchorNode;
    const selectionElement = selectionNode?.nodeType === 1 ? selectionNode as Element : selectionNode?.parentElement;
    if (selectionElement?.closest('pre,code')) {
      event.preventDefault();
      dependencies.insertCaptureText(text, captureRange);
      return;
    }
    const selectedMode = mode === 'match' ? 'legacy' : mode;
    const kind = dependencies.classifyClipboard({ html: hasPasteHTML ? pasteHTML : '', text, mode: selectedMode });
    event.preventDefault();
    if (kind === 'html') {
      try { dependencies.insertCaptureHTML(dependencies.cleanHTML(pasteHTML, mode === 'rich'), captureRange); }
      catch {
        dependencies.insertCaptureText(text, captureRange);
        dependencies.toast('网页内容过于复杂，已按纯文本插入，原文字未丢失');
        return;
      }
      if (mode === 'rich' && /<img/i.test(pasteHTML)) dependencies.toast('已粘贴图文；原网页的远程图片可能会失效，建议上传保存');
      return;
    }
    if (kind === 'markdown') {
      try {
        const { parseQidianMarkdown, qidianSchema, serializeQidianDocument } = await dependencies.loadMarkdownTools();
        const parsed = parseQidianMarkdown(text);
        const safe = dependencies.sanitizeMarkdownDocument(parsed, qidianSchema, dependencies.safeUrl);
        const html = dependencies.cleanHTML(serializeQidianDocument(safe), true);
        if (html.length > MAX_NOTE_BODY_CHARS) throw new RangeError('Markdown 转换后超过正文上限');
        dependencies.insertCaptureHTML(html, captureRange);
        if (hasRemoteImage(safe)) dependencies.toast('已粘贴远程图片链接；需要长期保留时请上传到私人空间');
      } catch (error) {
        dependencies.insertCaptureText(text, captureRange);
        dependencies.toast(error instanceof RangeError && /正文上限/.test(error.message)
          ? 'Markdown 转换后超过正文上限，已按原文插入；请缩短内容后重试格式化'
          : 'Markdown 解析失败，已按纯文本插入，原内容未丢失');
      }
      return;
    }
    if (kind === 'legacy') {
      try { dependencies.insertCaptureHTML(dependencies.cleanHTML(dependencies.plainTextToStructuredHTML(text), false), captureRange); }
      catch {
        dependencies.insertCaptureText(text, captureRange);
        dependencies.toast('兼容整理失败，已按原文插入');
      }
      return;
    }
    try { dependencies.insertCaptureHTML(dependencies.cleanHTML(plainDocumentHTML(dependencies.plainTextToDocument(text)), true), captureRange); }
    catch {
      dependencies.insertCaptureText(text, captureRange);
      dependencies.toast('文本排版失败，已按原文插入');
    }
  }

  return { handleEditorPaste, handleCapturePaste, storeImage };
}
