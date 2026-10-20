import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountWorkspaceStaticDomEvents } from '../../../src/features/navigation/workspace-static-dom-events.ts';

test('workspace static DOM events route paste, dialog keys, and overlay dismissal', () => {
  const dom = new JSDOM(`
    <div id="slashMenu"></div>
    <div id="typeDialogBody"><input id="typeNameInput"></div>
    <div id="capturePad"></div>
    <div id="createOverlay" class="open"><span id="createChild"></span></div>
    <div id="captureOverlay" class="open"><span id="captureChild"></span></div>
    <div id="typeOverlay" class="open"></div>
  `);
  const { document, Event, KeyboardEvent, MouseEvent } = dom.window;
  const calls = [];
  const unmount = mountWorkspaceStaticDomEvents(document, {
    closeCapture: () => calls.push('close-capture'),
    closeCreateMenu: () => calls.push('close-create-menu'),
    handleCapturePaste: () => calls.push('paste'),
    saveNoteType: () => calls.push('save-type')
  });

  const slashMouseDown = new MouseEvent('mousedown', { cancelable: true, bubbles: true });
  document.querySelector('#slashMenu').dispatchEvent(slashMouseDown);
  assert.equal(slashMouseDown.defaultPrevented, true);

  document.querySelector('#createChild').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(document.querySelector('#createOverlay').classList.contains('open'), true);
  document.querySelector('#createOverlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls, ['close-create-menu']);

  const typeEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  document.querySelector('#typeNameInput').dispatchEvent(typeEnter);
  assert.equal(typeEnter.defaultPrevented, true);
  document.querySelector('#capturePad').dispatchEvent(new Event('paste'));

  document.querySelector('#captureChild').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls, ['close-create-menu', 'save-type', 'paste']);
  document.querySelector('#captureOverlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.querySelector('#typeOverlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(document.querySelector('#typeOverlay').classList.contains('open'), false);
  assert.deepEqual(calls.slice(-1), ['close-capture']);

  unmount();
  document.querySelector('#captureOverlay').classList.add('open');
  document.querySelector('#captureOverlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls.slice(-1), ['close-capture'], 'unmount removes mounted listeners');
  dom.window.close();
});
