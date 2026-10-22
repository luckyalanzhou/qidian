import { validateVault } from './vault-validation.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = value => typeof value === 'string';
const isBoolean = value => typeof value === 'boolean';
const isNumber = value => Number.isSafeInteger(value) && value >= 0;
const isNullableTimestamp = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const isVaultData = value => {
  if (!isObject(value)) return false;
  try {
    validateVault(value);
    return true;
  } catch {
    return false;
  }
};
const isRevision = value => isObject(value) && isNumber(value.revision);
const isAssetInfo = value => isObject(value) && isString(value.id) && isString(value.name)
  && isString(value.mime) && isNumber(value.size) && isNumber(value.created);
const isStorageCapacity = value => isObject(value) && typeof value.usedPercent === 'number'
  && Number.isFinite(value.usedPercent) && value.usedPercent >= 0 && value.usedPercent <= 100
  && isBoolean(value.warning);
const isUpdateStatus = value => isObject(value)
  && ['idle', 'unavailable', 'queued', 'running', 'success', 'failed'].includes(value.state)
  && isString(value.version) && isNullableTimestamp(value.updatedAt)
  && isNullableTimestamp(value.logUpdatedAt) && isString(value.log);
const isOptionalBoolean = (value, key) => value[key] === undefined || isBoolean(value[key]);
const isOptionalString = (value, key) => value[key] === undefined || isString(value[key]);
const isCredential = value => isObject(value) && isString(value.salt) && isString(value.verifier)
  && Number.isSafeInteger(value.iterations) && value.iterations > 0;

const requestContracts = {
  registrationRequest: value => isObject(value) && isString(value.username) && isCredential(value),
  authChallengeRequest: value => isObject(value) && isString(value.username),
  authVerificationRequest: value => isObject(value) && isString(value.id) && isString(value.verifier),
  accountPasswordRequest: value => isObject(value) && isString(value.currentVerifier) && isCredential(value),
  vaultMutationRequest: value => isObject(value) && isNumber(value.revision) && isVaultData(value.data),
  systemUpdateRequest: value => isObject(value) && value.action === 'update'
};

export const API_REQUEST_NAMES = Object.freeze(Object.keys(requestContracts));

export function isApiErrorResponse(value) {
  return isObject(value) && isString(value.error)
    && isOptionalString(value, 'code')
    && isOptionalBoolean(value, 'registrationEnabled')
    && isOptionalBoolean(value, 'setupRequired');
}

export function assertApiErrorResponse(value) {
  if (!isApiErrorResponse(value)) throw new TypeError('API 错误响应不符合契约');
  return value;
}

export function isApiRequest(name, value) {
  return Object.prototype.hasOwnProperty.call(requestContracts, name) && requestContracts[name](value);
}

export function assertApiRequest(name, value) {
  if (!isApiRequest(name, value)) throw new TypeError(`API 请求不符合契约：${name}`);
  return value;
}

const responseContracts = {
  sessionBootstrap: value => isObject(value) && isString(value.owner) && isString(value.username) && value.local === false,
  authConfig: value => isObject(value) && isBoolean(value.registrationEnabled) && isBoolean(value.setupRequired),
  authSession: value => isObject(value) && isString(value.id) && isString(value.username)
    && isRevision(value) && isVaultData(value.data),
  registration: value => isObject(value) && isString(value.id) && isString(value.username) && isBoolean(value.legacyClaimed),
  authChallenge: value => isObject(value) && isString(value.id) && isString(value.salt) && isNumber(value.iterations),
  authVerification: value => isObject(value) && isString(value.id),
  authLogout: value => isObject(value) && value.ok === true,
  accountProfile: value => isObject(value) && isString(value.id) && isString(value.username)
    && isNumber(value.created) && (value.avatarMime === null || isString(value.avatarMime)),
  accountAvatarMutation: value => isObject(value) && value.ok === true
    && (value.mime === undefined || isString(value.mime)),
  passwordSalt: value => isObject(value) && isString(value.salt) && isNumber(value.iterations),
  accountPasswordMutation: value => isObject(value) && value.ok === true && value.otherSessionsRevoked === true,
  revision: isRevision,
  vault: value => isRevision(value) && isVaultData(value.data),
  backupSummaries: value => Array.isArray(value) && value.every(item => isRevision(item) && isNumber(item.created)),
  backupCreated: value => isRevision(value) && isNumber(value.created),
  backupSnapshot: value => isRevision(value) && isVaultData(value.data),
  assets: value => Array.isArray(value) && value.every(isAssetInfo),
  uploadedAsset: value => isAssetInfo(value) && isString(value.url),
  prunedAssets: value => isObject(value) && isNumber(value.removed) && isNumber(value.bytes),
  systemVersion: value => isObject(value) && isString(value.currentVersion)
    && (value.latestVersion === undefined || isString(value.latestVersion))
    && (value.updateAvailable === undefined || isBoolean(value.updateAvailable))
    && (value.canUpdateDevice === undefined || isBoolean(value.canUpdateDevice))
    && (value.installerAvailable === undefined || isBoolean(value.installerAvailable))
    && (value.updaterAvailable === undefined || isBoolean(value.updaterAvailable))
    && (value.releaseUrl === undefined || isString(value.releaseUrl))
    && (value.notes === undefined || isString(value.notes))
    && (value.publishedAt === undefined || value.publishedAt === null || isString(value.publishedAt)),
  updateAcceptance: value => isObject(value) && value.accepted === true && isString(value.version),
  updateStatus: isUpdateStatus,
  storageCapacity: isStorageCapacity
};

export const API_RESPONSE_NAMES = Object.freeze(Object.keys(responseContracts));

export function isApiResponse(name, value) {
  return Object.prototype.hasOwnProperty.call(responseContracts, name) && responseContracts[name](value);
}

export function assertApiResponse(name, value) {
  if (!isApiResponse(name, value)) throw new TypeError(`API 响应不符合契约：${name}`);
  return value;
}
