import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { useWorkspaceShellActionsStore } from '../../../src/features/navigation/workspace-shell-actions-store.ts';

test('workspace shell action store delegates typed sidebar operations to the application boundary', () => {
  const store = useWorkspaceShellActionsStore(createPinia());
  const commands = [];
  store.bind(command => { commands.push(command); return true; });

  assert.equal(store.execute({ type: 'delete-note', id: 'note-9' }), true);
  assert.deepEqual(commands, [{ type: 'delete-note', id: 'note-9' }]);
});

test('workspace shell action store is inert until its application boundary is bound', () => {
  const store = useWorkspaceShellActionsStore(createPinia());
  assert.equal(store.execute({ type: 'delete-note', id: 'note-9' }), false);
});
