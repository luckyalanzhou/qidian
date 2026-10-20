import type { TrashEntry } from '../../../shared/api-contracts.js';

export type TrashEntryView = {
  id: string;
  title: string;
  kindLabel: string;
  detail: string;
  deletedLabel: string;
  expiresLabel: string;
};

export type TrashSnapshot = {
  count: number;
  entries: TrashEntryView[];
};

const dateLabel = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const retentionMs = 30 * 24 * 60 * 60 * 1000;

export function createTrashSnapshot(trash: readonly TrashEntry[], now = Date.now()): TrashSnapshot {
  const entries = [...trash].sort((left, right) => right.deletedAt - left.deletedAt);
  return {
    count: entries.length,
    entries: entries.map(entry => {
      const expiresIn = Math.max(0, Math.ceil((entry.deletedAt + retentionMs - now) / 86400000));
      const kindLabel = entry.kind === 'note' ? '笔记' : entry.item.kind === 'folder' ? '书签分组' : '书签';
      const title = entry.kind === 'note'
        ? entry.item.title?.trim() || '无标题笔记'
        : entry.item.kind === 'folder' ? `分组：${entry.item.title}` : entry.item.title;
      const detail = entry.kind === 'bookmark' && entry.item.kind === 'link' ? entry.item.url
        : entry.kind === 'note' ? (entry.item.tags || []).slice(0, 3).map(tag => `#${tag}`).join(' · ')
          : '';
      return {
        id: entry.id,
        title,
        kindLabel,
        detail,
        deletedLabel: dateLabel(entry.deletedAt),
        expiresLabel: expiresIn ? `${expiresIn} 天后清理` : '即将清理'
      };
    })
  };
}
