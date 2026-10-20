import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoteController } from '../../../src/features/notes/create-note-controller.ts';

const makeVault = (noteTypes = [
  { id: 'note', name: '普通笔记' },
  { id: 'command', name: '命令速查' }
]) => ({ notes: [], noteTypes, categories: [], bookmarks: [], trash: [] });

test('note creation saves the active draft, applies the current type and leaves legacy category data at its default', () => {
  const vault = makeVault();
  const steps = [];
  const controller = createNoteController({
    getContext: () => ({ editing: true, typeFilter: 'command', active: '网络' }),
    getVault: () => vault,
    mutateVault: operation => { steps.push('mutate'); return operation(vault); },
    saveDraft: quiet => { steps.push(['save', quiet]); },
    activate: note => { steps.push(['activate', note]); },
    closeMenu: () => steps.push('close-menu'),
    render: () => steps.push('render'),
    scrollToTop: () => steps.push('scroll'),
    focusTitle: () => steps.push('focus')
  });

  const note = controller.create();

  assert.deepEqual(steps.map(step => Array.isArray(step) ? step[0] : step), [
    'save', 'mutate', 'activate', 'close-menu', 'render', 'scroll', 'focus'
  ]);
  assert.equal(steps[0][1], true, 'the current draft is saved quietly before creating another note');
  assert.equal(note.type, 'command', 'the selected type filter is honored for a generic new-note action');
  assert.equal(note.category, '未分类', 'removed category navigation no longer changes the legacy storage field');
  assert.equal(vault.notes[0], note);
});

test('note creation falls back to the first available type and default category for invalid context values', () => {
  const vault = makeVault();
  const controller = createNoteController({
    getContext: () => ({ editing: false, typeFilter: 'all', active: 'recent' }),
    getVault: () => vault,
    mutateVault: operation => operation(vault),
    saveDraft() {}, activate() {}, closeMenu() {}, render() {}, scrollToTop() {}, focusTitle() {}
  });

  const note = controller.create('missing');

  assert.equal(note.type, 'note');
  assert.equal(note.category, '未分类');
});

test('note creation with no configured types leaves navigation untouched', () => {
  const vault = makeVault([]);
  let activated = false;
  const controller = createNoteController({
    getContext: () => ({ editing: false, typeFilter: 'all', active: 'all' }),
    getVault: () => vault,
    mutateVault: operation => operation(vault),
    saveDraft() {}, activate() { activated = true; }, closeMenu() {}, render() {}, scrollToTop() {}, focusTitle() {}
  });

  assert.throws(() => controller.create(), /请先创建笔记类型/);
  assert.equal(activated, false);
  assert.equal(vault.notes.length, 0);
});
