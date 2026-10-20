import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceContentEvents } from '../../../src/features/navigation/workspace-content-events.ts';

const ACTIONS = [
  'openCreateMenu', 'openCapture', 'beginEdit', 'showDraftPreview', 'publishNote', 'togglePinned',
  'duplicateNote', 'deleteEditorNote', 'deleteCurrentNote', 'saveEditor', 'chooseAttachment',
  'exportCurrentNote', 'chooseImage', 'saveCapture', 'addNoteType',
  'saveNoteType', 'downloadBackup', 'restoreBackup', 'openSearch', 'closeSearch'
];

function harness() {
  const calls = [];
  const dependencies = Object.fromEntries(ACTIONS.map(name => [name, (...args) => { calls.push([name, ...args]); }]));
  dependencies.searchOpen = () => true;
  const events = createWorkspaceContentEvents(dependencies);
  return { events, calls };
}

function click(selector, attributes = {}) {
  return {
    closest(candidate) {
      return candidate.split(',').map(value => value.trim()).includes(selector) ? {
        getAttribute(name) { return attributes[name] ?? null; }
      } : null;
    }
  };
}

test('note and editor controls route to explicit feature actions synchronously where possible', () => {
  const h = harness();
  for (const [selector, action] of [
    ['#newSide', 'openCreateMenu'], ['#editDoc', 'beginEdit'], ['#showDraftView', 'showDraftPreview'],
    ['#publishDoc', 'publishNote'], ['#duplicateDoc', 'duplicateNote'], ['#saveEditor', 'saveEditor'],
    ['#addAttachment', 'chooseAttachment'], ['#addImgButton', 'chooseImage'],
    ['#addNoteType', 'addNoteType']
  ]) {
    assert.equal(h.events.handleClick(click(selector)), true, `${selector} is handled`);
    assert.equal(h.calls.at(-1)[0], action);
  }
});

test('async document mutations are awaited and handled once', async () => {
  const h = harness();
  for (const [selector, action] of [
    ['#pinDoc', 'togglePinned'], ['#deleteEditorNote', 'deleteEditorNote'], ['#deleteDoc', 'deleteCurrentNote'],
    ['#captureSave', 'saveCapture'], ['#typeDialogConfirm', 'saveNoteType']
  ]) {
    assert.equal(await h.events.handleClick(click(selector)), true);
    assert.equal(h.calls.at(-1)[0], action);
  }
});

test('backup actions keep their identifiers and outside-search behavior', () => {
  const h = harness();
  assert.equal(h.events.handleClick(click('[data-backup-download]', { 'data-backup-download': '42' })), true);
  assert.equal(h.events.handleClick(click('[data-backup-restore]', { 'data-backup-restore': '21' })), true);
  assert.equal(h.events.handleClick(click('#searchTop')), true);
  assert.equal(h.events.handleClick(click('.outside')), true);
  assert.deepEqual(h.calls, [
    ['downloadBackup', '42'], ['restoreBackup', '21'], ['openSearch'], ['closeSearch']
  ]);
});
