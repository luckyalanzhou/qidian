import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountEditorDocumentLifecycle } from '../../../src/features/editor/document-lifecycle.ts';

test('editor lifecycle saves on unload and warns only while edits remain unsaved', () => {
  const dom = new JSDOM('<!doctype html>');
  const { document, Event, window } = dom.window;
  const calls = [];
  let editing = true;
  let changed = true;
  let unsaved = false;
  const unmount = mountEditorDocumentLifecycle(document, {
    isEditing: () => editing,
    hasEditorChanges: () => { calls.push('check-edits'); return changed; },
    saveDraft: quiet => calls.push(['save', quiet]),
    hasUnsavedChanges: () => unsaved
  });

  const changedEvent = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(changedEvent);
  assert.equal(changedEvent.defaultPrevented, true);
  assert.deepEqual(calls, ['check-edits', ['save', true]]);

  editing = false;
  changed = false;
  unsaved = false;
  const cleanEvent = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(cleanEvent);
  assert.equal(cleanEvent.defaultPrevented, false);

  unmount();
  unsaved = true;
  const detachedEvent = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(detachedEvent);
  assert.equal(detachedEvent.defaultPrevented, false, 'unmount removes lifecycle listeners');
  dom.window.close();
});

test('editor lifecycle saves a draft when the page becomes hidden', () => {
  const dom = new JSDOM('<!doctype html>');
  const { document } = dom.window;
  const calls = [];
  let editing = true;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  const unmount = mountEditorDocumentLifecycle(document, {
    isEditing: () => editing,
    hasEditorChanges: () => false,
    saveDraft: quiet => calls.push(quiet),
    hasUnsavedChanges: () => false
  });
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  assert.deepEqual(calls, [true]);
  editing = false;
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  assert.deepEqual(calls, [true]);
  unmount();
  dom.window.close();
});
