import type { VaultData } from '../../../shared/api-contracts.js';
import type { VaultMutationPort } from '../vault/mutation.ts';

export type CaptureInput = {
  title: string;
  type: string;
  source: string;
  body: string;
};

type Dependencies = {
  getVault: () => VaultData;
  mutateVault: VaultMutationPort;
  cleanBody: (html: string) => string;
  bodyText: (html: string) => string;
  now?: () => number;
  createId?: (timestamp: number) => string;
};

export function createCaptureFlow(dependencies: Dependencies) {
  async function save(input: CaptureInput) {
    const title = input.title.trim();
    const body = dependencies.cleanBody(input.body);
    const text = dependencies.bodyText(body).trim();
    if (!title && !text) throw new Error('请至少填写标题或内容');

    const timestamp = (dependencies.now || Date.now)();
    const note = {
      id: (dependencies.createId || (value => `n${value}`))(timestamp),
      title: title || text.slice(0, 35) || '新收藏',
      category: '未分类',
      type: input.type,
      tags: [],
      body,
      source: input.source.trim(),
      updated: timestamp,
      created: timestamp,
      pinned: false,
      status: 'draft' as const,
      publishedAt: null
    };

    const { persisted } = dependencies.mutateVault.execute(vault => {
      vault.notes.unshift(note);
    });
    await persisted;
    return note;
  }

  return { save };
}
