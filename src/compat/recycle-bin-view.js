import { validateVault } from '../../shared/vault-validation.js';
import { restoreTrashEntry, TRASH_RETENTION_MS } from '../domain/trash-data.js';
import { createTrashSnapshot } from '../features/trash/snapshot.ts';

export function createRecycleBinView({ main, getData, mutateData = operation => operation(getData()), save, notify, onChange = () => render() }) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const icon = name => `<span class="ico"><svg aria-hidden="true"><use href="#i-${name}"/></svg></span>`;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'trashClearOverlay';
  document.body.append(overlay);
  let busy = false;
  const restoring = new Set();

  function pruneExpired(now = Date.now()) {
    const data = getData(), before = Array.isArray(data.trash) ? data.trash : [];
    const retained = before.filter(entry => now - entry.deletedAt < TRASH_RETENTION_MS);
    if (retained.length === before.length) return 0;
    mutateData(current=>{current.trash = retained});
    void Promise.resolve(save()).catch(error=>{mutateData(current=>{current.trash=before});notify(error.message||'过期内容尚未清理')});
    return before.length - retained.length;
  }

  function itemTitle(entry) {
    if (entry.kind === 'note') return entry.item.title?.trim() || '无标题笔记';
    return entry.item.kind === 'folder' ? `分组：${entry.item.title}` : entry.item.title;
  }

  function snapshot() {
    return createTrashSnapshot(getData().trash || []);
  }

  async function restoreEntry(id) {
    if (busy || restoring.has(id)) return false;
    restoring.add(id);
    const previous = structuredClone(getData());
    let restored = false;
    try {
      const candidate = structuredClone(getData());
      restoreTrashEntry(candidate, id);
      const validated = validateVault(candidate);
      mutateData(current=>Object.assign(current, validated));
      await save();
      restored = true;
    } catch (error) {
      mutateData(current=>Object.assign(current, previous));
      notify(error.message || '还原失败');
    } finally {
      restoring.delete(id);
    }
    if (restored) onChange();
    return restored;
  }

  function entryMarkup(entry) {
    const removedAt = new Date(entry.deletedAt).toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    const expiresIn = Math.max(0, Math.ceil((entry.deletedAt + TRASH_RETENTION_MS - Date.now()) / 86400000));
    const kind = entry.kind === 'note' ? '笔记' : entry.item.kind === 'folder' ? '书签分组' : '书签';
    const detail = entry.kind === 'bookmark' && entry.item.kind === 'link' ? `<p class="trash-entry-detail">${esc(entry.item.url)}</p>` :
      entry.kind === 'note' ? `<p class="trash-entry-detail">${esc((entry.item.tags || []).slice(0, 3).map(tag => `#${tag}`).join(' · '))}</p>` : '';
    return `<article class="trash-entry"><div class="trash-entry-copy"><span class="pill">${kind}</span><h2>${esc(itemTitle(entry))}</h2>${detail}<p class="hint">删除于 ${removedAt} · ${expiresIn ? `${expiresIn} 天后清理` : '即将清理'}</p></div><button type="button" class="secondary-btn" data-trash-restore="${esc(entry.id)}">${icon('back')} 还原</button></article>`;
  }

  function render() {
    const entries = [...(getData().trash || [])].sort((left, right) => right.deletedAt - left.deletedAt);
    main.innerHTML = `<section class="trash-page"><header class="section-head workspace-page-head"><div><h1>回收站</h1><p class="muted">删除的笔记和书签保留 30 天，到期后自动清理。当前 ${entries.length} 项</p></div><div class="workspace-page-actions"><button type="button" class="secondary-btn trash-clear-btn" data-trash-clear ${entries.length && !busy ? '' : 'disabled'}>清空回收站</button></div></header>${entries.length ? `<div class="trash-entry-list">${entries.map(entryMarkup).join('')}</div>` : `<div class="empty trash-empty"><span>${icon('trash')}</span><strong>回收站为空</strong><p>删除的笔记和书签会在这里保留 30 天。</p></div>`}</section>`;
  }

  function closeDialog() {
    if (!busy) overlay.classList.remove('open');
  }

  function openClearDialog() {
    const snapshot = structuredClone(getData()), serialized = JSON.stringify(snapshot), count = snapshot.trash?.length || 0;
    if (!count || busy) return;
    overlay.innerHTML = `<section class="dialog trash-clear-dialog" role="dialog" aria-modal="true" aria-labelledby="trashClearTitle"><div class="dialog-head"><div><h2 id="trashClearTitle">永久清空回收站？</h2><p class="hint">此操作无法撤销</p></div><button type="button" class="round-btn" data-trash-cancel aria-label="关闭">${icon('close')}</button></div><form><div class="dialog-body"><p>将永久删除回收站中的 <strong>${count}</strong> 项内容，无法再还原。</p><p class="trash-clear-message" role="status"></p></div><div class="dialog-foot"><button type="button" class="secondary-btn" data-trash-cancel>取消</button><button type="submit" class="primary-btn danger-btn">永久清空回收站</button></div></form></section>`;
    overlay.classList.add('open');
    overlay.querySelector('[data-trash-cancel]').focus();
    overlay.querySelectorAll('[data-trash-cancel]').forEach(button => button.addEventListener('click', closeDialog));
    overlay.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      const submit = overlay.querySelector('[type=submit]');
      busy = true; submit.disabled = true;
      const previousTrash = getData().trash;
      let cleared = false;
      try {
        if (JSON.stringify(getData()) !== serialized) throw new Error('回收站内容已变化，请关闭窗口后重新确认');
        mutateData(current=>{current.trash = []});
        await save();
        overlay.classList.remove('open');
        cleared = true;
      } catch (error) {
        mutateData(current=>{current.trash = previousTrash});
        notify(error.message || '清空未完成');
      } finally {
        busy = false;
        if (overlay.classList.contains('open')) { overlay.classList.remove('open'); render(); }
      }
      if (cleared) onChange();
    };
  }

  main.addEventListener('click', async event => {
    const restore = event.target.closest('[data-trash-restore]');
    if (restore) {
      await restoreEntry(restore.dataset.trashRestore);
      return;
    }
    if (event.target.closest('[data-trash-clear]')) openClearDialog();
  });
  overlay.addEventListener('click', event => { if (event.target === overlay) closeDialog(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') closeDialog(); });

  return { render, pruneExpired, snapshot, restore:restoreEntry, openClearDialog };
}
