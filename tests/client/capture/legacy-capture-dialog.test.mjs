import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLegacyCaptureDialog } from '../../../src/compat/capture/legacy-capture-dialog.ts';

const captureForm = `<div class="overlay" id="captureOverlay">
  <input id="captureName"><select id="captureType"></select>
  <input id="captureSource"><div id="capturePad" contenteditable="true"></div>
  <select id="capturePasteMode"><option value="rich">rich</option><option value="plain">plain</option></select>
</div>`;

test('legacy capture dialog resets each draft field and selects the requested type and paste mode', () => {
  const dom = new JSDOM(`<!doctype html><html><body>${captureForm}</body></html>`);
  const document = dom.window.document;
  const dialog = createLegacyCaptureDialog({
    document,
    escapeHtml: value => String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]),
  });

  document.querySelector('#captureName').value = 'stale title';
  document.querySelector('#captureSource').value = 'https://example.com/old';
  document.querySelector('#capturePad').innerHTML = '<p>stale body</p>';
  dialog.open({
    types: [{ id: 'clip', name: '网页摘录' }, { id: 'custom', name: '<研发>' }],
    defaultType: 'clip',
    pasteMode: 'plain',
  });

  assert.equal(document.querySelector('#captureOverlay').classList.contains('open'), true);
  assert.equal(document.querySelector('#captureType').value, 'clip');
  assert.equal(document.querySelector('#captureType option[value="custom"]').textContent, '<研发>');
  assert.equal(document.querySelector('#captureType option[value="custom"]').hasAttribute('onmouseover'), false);
  assert.equal(document.querySelector('#captureName').value, '');
  assert.equal(document.querySelector('#captureSource').value, '');
  assert.equal(document.querySelector('#capturePad').innerHTML, '');
  assert.equal(document.querySelector('#capturePasteMode').value, 'plain');

  dom.window.close();
});

test('legacy capture dialog reads the active form values and closes without persisting', () => {
  const dom = new JSDOM(`<!doctype html><html><body>${captureForm}</body></html>`);
  const document = dom.window.document;
  const dialog = createLegacyCaptureDialog({ document, escapeHtml: value => String(value) });
  dialog.open({ types: [{ id: 'clip', name: '网页摘录' }], defaultType: 'clip', pasteMode: 'rich' });
  document.querySelector('#captureName').value = '网络说明';
  document.querySelector('#captureType').value = 'clip';
  document.querySelector('#captureSource').value = ' https://example.com/guide ';
  document.querySelector('#capturePad').innerHTML = '<p>保存正文</p>';

  assert.deepEqual(dialog.readInput(), {
    title: '网络说明', type: 'clip',
    source: ' https://example.com/guide ', body: '<p>保存正文</p>',
  });
  dialog.close();
  assert.equal(document.querySelector('#captureOverlay').classList.contains('open'), false);

  dom.window.close();
});
