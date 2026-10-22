export type NoteType = { id: string; name: string };

export type PublishedNoteVersion = {
  title: string;
  type: string;
  category: string;
  tags: string[];
  body: string;
  source: string;
  updated: number;
};

export type VaultNote = {
  id: string;
  title: string;
  type: string;
  category: string;
  tags: string[];
  body: string;
  source: string;
  created: number;
  updated: number;
  pinned: boolean;
  status?: 'draft' | 'published';
  publishedAt?: number | null;
  publishedSnapshot?: PublishedNoteVersion;
};

export type BookmarkLink = { id: string; kind: 'link'; title: string; url: string; pinned?: true };
export type BookmarkFolder = { id: string; kind: 'folder'; title: string; children: BookmarkItem[] };
export type BookmarkItem = BookmarkLink | BookmarkFolder;

type TrashEntryMetadata = {
  id: string;
  deletedAt: number;
  parentId?: string;
  index: number;
  previousId?: string;
  nextId?: string;
  releasedChildren?: string[];
};
export type TrashEntry = TrashEntryMetadata & (
  | { kind: 'note'; item: VaultNote }
  | { kind: 'bookmark'; item: BookmarkItem }
);

export type VaultData = {
  categories: string[];
  noteTypes?: NoteType[];
  notes: VaultNote[];
  bookmarks?: BookmarkItem[];
  trash?: TrashEntry[];
  theme?: 'system' | 'light' | 'dark';
  pasteMode?: 'rich' | 'match' | 'plain';
  noteTypesExpanded?: boolean;
  dashboardBookmarkLayout?: 'single' | 'double';
  dashboardBookmarkFolders?: Record<string, boolean>;
  bookmarkDirectoryOpen?: boolean | null;
  bookmarkFolderStates?: Record<string, boolean>;
};

export type RevisionResponse = { revision: number };
export type VaultResponse = RevisionResponse & { data: VaultData };
export type AuthConfig = { registrationEnabled: boolean; setupRequired: boolean };
export type AuthSession = { id: string; username: string; revision: number; data: VaultData };
export type SessionBootstrap = { owner: string; username: string; local: false };
export type AuthChallenge = { id: string; salt: string; iterations: number };
export type AuthVerification = { id: string };
export type RegistrationResult = { id: string; username: string; legacyClaimed: boolean };
export type SystemVersion = {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  canUpdateDevice?: boolean;
  installerAvailable?: boolean;
  updaterAvailable?: boolean;
  releaseUrl?: string;
  notes?: string;
  publishedAt?: string | null;
};
export type UpdateAcceptance = { accepted: boolean; version: string };
export type UpdateStatus = {
  state: 'idle' | 'unavailable' | 'queued' | 'running' | 'success' | 'failed';
  version: string;
  updatedAt: number | null;
  logUpdatedAt: number | null;
  log: string;
};

export type StorageCapacity = {
  usedPercent: number;
  warning: boolean;
};
export type AccountProfile = { id: string; username: string; created: number; avatarMime: string | null };
export type PasswordSalt = { salt: string; iterations: number };
export type AccountAvatarMutation = { ok: true; mime?: string };
export type AccountPasswordMutation = { ok: true; otherSessionsRevoked: true };
export type AssetInfo = { id: string; name: string; mime: string; size: number; created: number };
export type UploadedAsset = AssetInfo & { url: string };
export type AssetPruneResult = { removed: number; bytes: number };
export type BackupSummary = { revision: number; created: number };
export type BackupSnapshot = { revision: number; data: VaultData };
export type BackupCreated = RevisionResponse & { created: number };

export type CredentialRequest = { salt: string; verifier: string; iterations: number };
export type ApiRequestMap = {
  registrationRequest: { username: string } & CredentialRequest;
  authChallengeRequest: { username: string };
  authVerificationRequest: { id: string; verifier: string };
  accountPasswordRequest: { currentVerifier: string } & CredentialRequest;
  vaultMutationRequest: { revision: number; data: VaultData };
  systemUpdateRequest: { action: 'update' };
};
export type ApiRequestName = keyof ApiRequestMap;

export type ApiResponseMap = {
  sessionBootstrap: SessionBootstrap;
  authConfig: AuthConfig;
  authSession: AuthSession;
  registration: RegistrationResult;
  authChallenge: AuthChallenge;
  authVerification: AuthVerification;
  authLogout: { ok: true };
  accountProfile: AccountProfile;
  accountAvatarMutation: AccountAvatarMutation;
  passwordSalt: PasswordSalt;
  accountPasswordMutation: AccountPasswordMutation;
  revision: RevisionResponse;
  vault: VaultResponse;
  backupSummaries: BackupSummary[];
  backupCreated: BackupCreated;
  backupSnapshot: BackupSnapshot;
  assets: AssetInfo[];
  uploadedAsset: UploadedAsset;
  prunedAssets: AssetPruneResult;
  systemVersion: SystemVersion;
  updateAcceptance: UpdateAcceptance;
  updateStatus: UpdateStatus;
  storageCapacity: StorageCapacity;
};

export type ApiResponseName = keyof ApiResponseMap;
export const API_REQUEST_NAMES: readonly ApiRequestName[];
export const API_RESPONSE_NAMES: readonly ApiResponseName[];
export type ApiErrorResponse = {
  error: string;
  code?: string;
  registrationEnabled?: boolean;
  setupRequired?: boolean;
  [key: string]: unknown;
};

export function isApiResponse(name: ApiResponseName | string, value: unknown): value is ApiResponseMap[ApiResponseName];
export function assertApiResponse<Name extends ApiResponseName>(name: Name, value: unknown): ApiResponseMap[Name];
export function isApiRequest<Name extends ApiRequestName>(name: Name | string, value: unknown): value is ApiRequestMap[Name];
export function assertApiRequest<Name extends ApiRequestName>(name: Name, value: unknown): ApiRequestMap[Name];
export function isApiErrorResponse(value: unknown): value is ApiErrorResponse;
export function assertApiErrorResponse(value: unknown): ApiErrorResponse;
