import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { createContentInsertionController } from '../../../src/features/editor/content-insertion.ts';
import { parseQidianMarkdown } from '../../../src/features/content/markdown.js';

function harness(options = {}) {
  const dom = new JSDOM('<div id="capture"></div>');
  const events = [];
  const editor = options.editor || {
    isDestroyed: false,
    isActive: () => false,
    schema: {},
    state: { doc: {}, selection: { getBookmark: () => ({ resolve: () => 'bookmark-selection' }) }, tr: { setSelection: value => value } },
    commands: { insertContent: (...args) => { events.push(['insert', ...args]); return true; } },
    view: { dispatch: transaction => events.push(['dispatch', transaction]) }
  };
  const controller = createContentInsertionController({
    window: dom.window,
    document: dom.window.document,
    purifier: options.purifier || createDOMPurify(dom.window),
    getMode: options.getMode || (() => 'rich'),
    classifyClipboard: options.classifyClipboard || (({ html }) => html ? 'html' : 'plain'),
    plainTextToDocument: text => ({ type: 'doc', text }),
    sanitizeMarkdownDocument: value => value,
    loadMarkdownTools: options.loadMarkdownTools || (async () => options.markdownTools || {}),
    cleanHTML: options.cleanHTML || (value => value),
    plainTextToStructuredHTML: value => `<p>${value}</p>`,
    safeUrl: () => true,
    escapeHTML: value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]),
    autofillPastedTitle: options.autofillPastedTitle || (() => {}),
    upload: options.upload || (async file => ({ url: '/api/assets/00000000-0000-4000-8000-000000000001', mime: file.type })),
    insertEditorHTML: value => events.push(['insert-editor-html', value]),
    getEditor: () => editor,
    insertCaptureHTML: (value, range) => events.push(['insert-capture-html', value, range]),
    insertCaptureText: (value, range) => events.push(['insert-capture-text', value, range]),
    captureSelection: () => null,
    toast: message => events.push(['toast', message])
  });
  return { dom, events, editor, controller };
}

test('editor paste falls back to plain text when sanitizing rich HTML fails', () => {
  const harnessed = harness({ cleanHTML: () => { throw new Error('oversized markup'); } });
  let prevented = false;
  const handled = harnessed.controller.handleEditorPaste({
    event: {
      clipboardData: { getData: type => type === 'text/html' ? '<p>内容</p>' : '内容', files: [] },
      preventDefault: () => { prevented = true; }
    },
    editor: harnessed.editor
  });
  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.deepEqual(harnessed.events.find(event => event[0] === 'insert')[1], { type: 'doc', text: '内容' });
  assert.match(harnessed.events.find(event => event[0] === 'toast')[1], /原文字未丢失/);
  harnessed.dom.window.close();
});

test('automatically detected Markdown is inserted as editable source without invoking the rich parser', () => {
  const source = '## 参考\n\n- [项目](https://example.com)';
  const harnessed = harness({ classifyClipboard: () => 'markdown' });
  let prevented = false;
  const handled = harnessed.controller.handleEditorPaste({
    event: {
      clipboardData: { getData: type => type === 'text/plain' ? source : '', files: [] },
      preventDefault: () => { prevented = true; }
    },
    editor: harnessed.editor
  });
  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.deepEqual(harnessed.events.find(event => event[0] === 'insert')[1], { type: 'doc', text: source });
  assert.equal(harnessed.events.some(event => event[0] === 'toast'), false);
  harnessed.dom.window.close();
});

test('Markdown parser uses the shared note body size limit', () => {
  assert.throws(() => parseQidianMarkdown('x'.repeat(1_000_001)), /超过正文长度上限/);
});

test('editor refuses Markdown longer than the body limit instead of inserting its parser fallback', async () => {
  const source = '#'.repeat(1_000_001);
  let parsed = false, prevented = false;
  const harnessed = harness({
    getMode: () => 'markdown',
    classifyClipboard: () => 'markdown',
    loadMarkdownTools: async () => ({ parseQidianMarkdown: () => { parsed = true; throw new RangeError('too large'); } })
  });
  harnessed.controller.handleEditorPaste({
    event: {
      clipboardData: { getData: type => type === 'text/plain' ? source : '', files: [] },
      preventDefault: () => { prevented = true; }
    },
    editor: harnessed.editor
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(prevented, true);
  assert.equal(parsed, false);
  assert.equal(harnessed.events.some(event => event[0] === 'insert'), false);
  assert.match(harnessed.events.find(event => event[0] === 'toast')[1], /超过.*上限/);
  harnessed.dom.window.close();
});

test('capture refuses oversized plain text before Markdown parsing or insertion', async () => {
  const source = 'x'.repeat(1_000_001);
  let parsed = false, prevented = false;
  const harnessed = harness({
    getMode: () => 'markdown',
    classifyClipboard: () => 'markdown',
    loadMarkdownTools: async () => ({ parseQidianMarkdown: () => { parsed = true; return {}; } })
  });
  await harnessed.controller.handleCapturePaste({
    clipboardData: { getData: type => type === 'text/plain' ? source : '', files: [] },
    currentTarget: harnessed.dom.window.document.querySelector('#capture'),
    preventDefault: () => { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(parsed, false);
  assert.equal(harnessed.events.some(event => event[0] === 'insert-capture-text' || event[0] === 'insert-capture-html'), false);
  assert.match(harnessed.events.find(event => event[0] === 'toast')[1], /超过.*上限/);
  harnessed.dom.window.close();
});

test('oversized clipboard HTML is rejected before sanitizing or parsing', () => {
  const source = `<p>${'x'.repeat(1_000_001)}</p>`;
  let sanitized = false, classified = false, prevented = false;
  const harnessed = harness({
    purifier: { sanitize: () => { sanitized = true; throw new Error('must not sanitize oversized HTML'); } },
    classifyClipboard: () => { classified = true; return 'html'; }
  });
  harnessed.controller.handleEditorPaste({
    event: {
      clipboardData: { getData: type => type === 'text/html' ? source : '', files: [] },
      preventDefault: () => { prevented = true; }
    },
    editor: harnessed.editor
  });
  assert.equal(prevented, true);
  assert.equal(sanitized, false);
  assert.equal(classified, false);
  assert.equal(harnessed.events.some(event => event[0] === 'insert'), false);
  assert.match(harnessed.events.find(event => event[0] === 'toast')[1], /超过.*上限/);
  harnessed.dom.window.close();
});

test('oversized rich HTML drops markup but keeps available short plain text', () => {
  const source = `<p>${'x'.repeat(1_000_001)}</p>`;
  const classified = [];
  const harnessed = harness({ classifyClipboard: input => { classified.push(input); return 'plain'; } });
  let prevented = false;
  harnessed.controller.handleEditorPaste({
    event: {
      clipboardData: { getData: type => type === 'text/html' ? source : type === 'text/plain' ? '保留纯文本' : '', files: [] },
      preventDefault: () => { prevented = true; }
    },
    editor: harnessed.editor
  });
  assert.equal(prevented, true);
  assert.deepEqual(classified, [{ html: '', text: '保留纯文本', mode: 'rich' }]);
  assert.deepEqual(harnessed.events.find(event => event[0] === 'insert')[1], { type: 'doc', text: '保留纯文本' });
  assert.match(harnessed.events.find(event => event[0] === 'toast')[1], /网页格式.*纯文本/);
  harnessed.dom.window.close();
});

test('editor paste preserves Markdown as source when rich conversion exceeds the saved body limit', async () => {
  const source = '**x** '.repeat(60000);
  const harnessed = harness({
    getMode: () => 'markdown',
    classifyClipboard: () => 'markdown',
    markdownTools: {
      parseQidianMarkdown: () => ({ type: 'doc' }),
      serializeQidianDocument: () => 'x'.repeat(1_000_001)
    }
  });
  harnessed.controller.handleEditorPaste({
    event: {
      clipboardData: { getData: type => type === 'text/plain' ? source : '', files: [] },
      preventDefault() {}
    },
    editor: harnessed.editor
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  const inserted = harnessed.events.find(event => event[0] === 'insert')[1];
  assert.equal(inserted.type, 'doc');
  assert.equal(inserted.text.length, source.length);
  assert.equal(inserted.text.slice(0, 32), source.slice(0, 32));
  assert.equal(inserted.text.slice(-32), source.slice(-32));
  assert.match(harnessed.events.find(event => event[0] === 'toast')[1], /正文上限/);
  harnessed.dom.window.close();
});

test('quick capture preserves Markdown as source when rich conversion exceeds the saved body limit', async () => {
  const source = '**x** '.repeat(60000);
  const harnessed = harness({
    classifyClipboard: () => 'markdown',
    markdownTools: {
      parseQidianMarkdown: () => ({ type: 'doc' }),
      qidianSchema: {},
      serializeQidianDocument: () => 'x'.repeat(1_000_001)
    }
  });
  await harnessed.controller.handleCapturePaste({
    clipboardData: { getData: type => type === 'text/plain' ? source : '', files: [] },
    currentTarget: harnessed.dom.window.document.querySelector('#capture'),
    preventDefault() {}
  });

  assert.equal(harnessed.events.some(event => event[0] === 'insert-capture-html'), false);
  const inserted = harnessed.events.find(event => event[0] === 'insert-capture-text')[1];
  assert.equal(inserted.length, source.length);
  assert.equal(inserted.slice(0, 32), source.slice(0, 32));
  assert.equal(inserted.slice(-32), source.slice(-32));
  assert.match(harnessed.events.find(event => event[0] === 'toast')[1], /正文上限/);
  harnessed.dom.window.close();
});

test('uploaded editor images restore the saved selection and reject non-image server responses', async () => {
  const harnessed = harness();
  const file = new harnessed.dom.window.File(['image-bytes'], '图像.png', { type: 'image/png' });
  const bookmark = { resolve: () => 'restored-selection' };
  await harnessed.controller.storeImage(file, 'edit', bookmark);
  assert.deepEqual(harnessed.events[0], ['dispatch', 'restored-selection']);
  assert.match(harnessed.events.find(event => event[0] === 'insert-editor-html')[1], /图像\.png/);
  assert.equal(harnessed.events.at(-1)[1], '图片已存入私人空间');
  harnessed.dom.window.close();

  const rejected = harness({ upload: async () => ({ url: '/api/assets/not-an-image', mime: 'application/octet-stream' }) });
  const rejectedFile = new rejected.dom.window.File(['bytes'], 'file.png', { type: 'image/png' });
  await rejected.controller.storeImage(rejectedFile, 'edit');
  assert.equal(rejected.events.some(event => event[0] === 'insert-editor-html'), false);
  assert.equal(rejected.events.at(-1)[1], '仅支持 PNG、JPEG、GIF、WebP 图像');
  rejected.dom.window.close();
});
