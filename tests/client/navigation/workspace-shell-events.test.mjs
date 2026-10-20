import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceShellEvents } from '../../../src/features/navigation/workspace-shell-events.ts';
import { createWorkspaceShellActions } from '../../../src/features/navigation/workspace-shell-actions.ts';

function harness(overrides = {}) {
  const calls = [];
  const dependencies = Object.fromEntries([
    'closeThemeMenu', 'toggleThemeMenu', 'closeAccountMenu', 'toggleAccountMenu',
    'openProfileSettings', 'openAppSettings', 'signOut', 'closeSlashMenu',
    'toggleNoteTypes', 'addNoteType', 'toast', 'moveNoteToTrash', 'render', 'closeSearch'
  ].map(name => [name, (...args) => { calls.push([name, ...args]); return name === 'moveNoteToTrash' ? true : undefined; }]));
  Object.assign(dependencies, {
    applyTheme: theme => calls.push(['applyTheme', theme]),
    openTypeDialog: (...args) => calls.push(['openTypeDialog', ...args]),
    noteTypeCount: () => 2,
    confirmDeleteNote: async id => { calls.push(['confirmDeleteNote', id]); return true; },
    closeTarget: id => calls.push(['closeTarget', id]),
    ...overrides
  });
  const actions = createWorkspaceShellActions(dependencies);
  const events = createWorkspaceShellEvents({
    execute: actions.execute,
    closeThemeMenu: dependencies.closeThemeMenu,
    closeAccountMenu: dependencies.closeAccountMenu,
    closeSlashMenu: dependencies.closeSlashMenu,
    closeSearch: dependencies.closeSearch,
    closeTarget: dependencies.closeTarget
  });
  return { actions, events, calls };
}

function click(selector, attributes = {}) {
  return {
    target: {
      closest(candidate) {
        const matches = candidate.split(',').map(value => value.trim());
        return matches.includes(selector) ? {
          getAttribute(name) { return attributes[name] ?? null; }
        } : null;
      }
    }
  };
}

test('theme and account actions preserve menu close and persistence routing', async () => {
  const h = harness();
  assert.equal(await h.events.handle(click('[data-theme-choice]', { 'data-theme-choice': 'dark' })), true);
  assert.equal(await h.events.handle(click('#accountButton')), true);
  assert.deepEqual(h.calls, [
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'],
    ['applyTheme', 'dark'],
    ['closeThemeMenu'],
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'],
    ['toggleAccountMenu']
  ]);
});

test('type deletion protects the last built-in note type', async () => {
  const h = harness({ noteTypeCount: () => 1 });
  assert.equal(await h.events.handle(click('[data-type-delete]', { 'data-type-delete': 'note' })), true);
  assert.deepEqual(h.calls, [
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'],
    ['toast', '至少保留“普通笔记”作为默认类型']
  ]);
});

test('note deletion requires confirmation and only renders after moving the note', async () => {
  const h = harness();
  assert.equal(await h.events.handle(click('[data-note-delete]', { 'data-note-delete': 'n-1' })), true);
  assert.deepEqual(h.calls, [
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'],
    ['confirmDeleteNote', 'n-1'], ['moveNoteToTrash', 'n-1'], ['render']
  ]);
});

test('overlay close and search bookmark actions are routed through shell events', async () => {
  const h = harness();
  assert.equal(await h.events.handle(click('[data-close]', { 'data-close': 'settingsOverlay' })), true);
  assert.equal(await h.events.handle(click('[data-search-bookmark]')), true);
  assert.deepEqual(h.calls, [
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'], ['closeTarget', 'settingsOverlay'],
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'], ['closeSearch']
  ]);
});

test('typed Vue sidebar actions share the shell boundary and delete workflow', async () => {
  const h = harness();
  assert.equal(h.actions.execute({ type: 'toggle-note-types' }), true);
  assert.equal(h.actions.execute({ type: 'add-note-type' }), true);
  assert.equal(h.actions.execute({ type: 'edit-note-type', id: 'command' }), true);
  assert.equal(h.actions.execute({ type: 'delete-note-type', id: 'command' }), true);
  assert.equal(await h.actions.execute({ type: 'delete-note', id: 'n-2' }), true);
  assert.deepEqual(h.calls, [
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'], ['toggleNoteTypes'],
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'], ['addNoteType'],
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'], ['openTypeDialog', 'edit', 'command'],
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'], ['openTypeDialog', 'delete', 'command'],
    ['closeThemeMenu'], ['closeAccountMenu'], ['closeSlashMenu'],
    ['confirmDeleteNote', 'n-2'], ['moveNoteToTrash', 'n-2'], ['render']
  ]);
});
