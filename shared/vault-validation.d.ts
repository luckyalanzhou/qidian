import type { VaultData } from './api-contracts.js';

export class VaultValidationError extends Error {
  status: number;
  constructor(status: number, message: string);
}

export const MAX_VAULT_BYTES: number;
export const MAX_NOTE_BODY_CHARS: number;
export const DEFAULT_NOTE_TYPES: { id: string; name: string }[];
export function validateVault(input: unknown): VaultData;
