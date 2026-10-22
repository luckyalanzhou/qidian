import {
  DEFAULT_NOTE_TYPES,
  MAX_VAULT_BYTES,
  VaultValidationError,
  validateVault as validateSharedVault
} from '../shared/vault-validation.js';

export { DEFAULT_NOTE_TYPES, MAX_VAULT_BYTES };

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function validateVault(input) {
  try {
    return validateSharedVault(input);
  } catch (error) {
    if (error instanceof VaultValidationError) throw new HttpError(error.status, error.message);
    throw error;
  }
}
