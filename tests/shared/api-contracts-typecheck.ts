import type {
  ApiRequestMap,
  ApiRequestName,
  ApiResponseMap,
  ApiResponseName
} from '../../shared/api-contracts.js';
import examples from '../fixtures/api-contract-examples.json';

type ExactKeys<Left, Right> = [Exclude<Left, Right>, Exclude<Right, Left>] extends [never, never]
  ? true
  : false;
type Assert<Condition extends true> = Condition;

type RequestExamplesCoverTheTypes = Assert<ExactKeys<keyof typeof examples.requests, ApiRequestName>>;
type ResponseExamplesCoverTheTypes = Assert<ExactKeys<keyof typeof examples.responses, ApiResponseName>>;

const typedRequests = {
  ...examples.requests,
  systemUpdateRequest: { ...examples.requests.systemUpdateRequest, action: 'update' }
} satisfies ApiRequestMap;
const typedResponses = {
  ...examples.responses,
  sessionBootstrap: { ...examples.responses.sessionBootstrap, local: false },
  authLogout: { ...examples.responses.authLogout, ok: true },
  accountAvatarMutation: { ...examples.responses.accountAvatarMutation, ok: true },
  accountPasswordMutation: { ...examples.responses.accountPasswordMutation, ok: true, otherSessionsRevoked: true },
  updateAcceptance: { ...examples.responses.updateAcceptance, accepted: true },
  updateStatus: { ...examples.responses.updateStatus, state: 'idle' }
} satisfies ApiResponseMap;

// @ts-expect-error API mutation responses are only successful when ok is true.
const failedAvatarResponse: ApiResponseMap['accountAvatarMutation'] = { ok: false };
// @ts-expect-error Password changes always revoke other sessions.
const incompletePasswordResponse: ApiResponseMap['accountPasswordMutation'] = { ok: true };

void (null as unknown as RequestExamplesCoverTheTypes);
void (null as unknown as ResponseExamplesCoverTheTypes);
void typedRequests;
void typedResponses;
void failedAvatarResponse;
void incompletePasswordResponse;
