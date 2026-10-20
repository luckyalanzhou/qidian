import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRemoteEditorRefresh } from '../../../src/features/editor/remote-refresh.ts';

function harness({ editorHTML = '<p>旧正文</p>', selection = 4, documentSize = 40 } = {}) {
  const dom = new JSDOM('<input id="editTitle"><input id="editType"><input id="editTags"><input id="editSource"><input id="editCategory" type="hidden">');
  const calls = [];
  let draft = null;
  let baseline = null;
  const editor = {
    html: editorHTML,
    state: { selection: { from: selection }, doc: { content: { size: documentSize } } },
    getHTML() { return this.html; },
    commands: {
      setContent(html, options) { calls.push(['set-content', html, options]); editor.html = html; },
      setTextSelection(position) { calls.push(['set-selection', position]); }
    }
  };
  const controller = createRemoteEditorRefresh({
    document: dom.window.document,
    setEditingDraft: note => { draft = note; },
    setBaseline: value => { baseline = value; },
    snapshot: note => ({ id: note.id, updated: note.updated }),
    cleanBody: body => body.trim(),
    getEditor: () => editor,
    syncToolbarState: () => calls.push(['sync-toolbar'])
  });
  return { dom, controller, calls, editor, getDraft: () => draft, getBaseline: () => baseline };
}

test('remote editor refresh updates visible fields and preserves hidden legacy category data', () => {
  const h = harness();
  const remote = { id: 'note-1', title: '远端标题', type: 'command', category: '网络', tags: ['OpenWrt', 'DNS'], source: 'https://example.com', body: '<p>远端正文</p>', updated: 8 };

  h.controller.refresh(remote, false);

  const document = h.dom.window.document;
  assert.equal(document.querySelector('#editTitle').value, '远端标题');
  assert.equal(document.querySelector('#editType').value, 'command');
  assert.equal(document.querySelector('#editTags').value, 'OpenWrt, DNS');
  assert.equal(document.querySelector('#editSource').value, 'https://example.com');
  assert.equal(document.querySelector('#editCategory').value, '网络');
  assert.equal(document.querySelector('#editCategory').type, 'hidden');
  assert.equal(h.getDraft().category, '网络');
  assert.notEqual(h.getDraft(), remote, 'the editor receives an isolated note snapshot');
  assert.deepEqual(h.getBaseline(), { id: 'note-1', updated: 8 });
  assert.deepEqual(h.calls, [
    ['set-content', '<p>远端正文</p>', { emitUpdate: false }],
    ['set-selection', 4],
    ['sync-toolbar']
  ]);
  h.dom.window.close();
});

test('remote refresh does not replace the local edit baseline and clamps a stale selection', () => {
  const h = harness({ selection: 100, documentSize: 9 });
  h.controller.refresh({ id: 'note-1', body: '<p>更新</p>' }, true);

  assert.equal(h.getBaseline(), null, 'local baseline is kept while the editor has pending changes');
  assert.deepEqual(h.calls, [
    ['set-content', '<p>更新</p>', { emitUpdate: false }],
    ['set-selection', 8],
    ['sync-toolbar']
  ]);
  h.dom.window.close();
});

test('identical remote editor content does not reset selection or toolbar state', () => {
  const h = harness({ editorHTML: '<p>相同</p>' });
  h.controller.refresh({ id: 'note-1', body: '<p>相同</p>' }, false);
  assert.deepEqual(h.calls, []);
  h.dom.window.close();
});
