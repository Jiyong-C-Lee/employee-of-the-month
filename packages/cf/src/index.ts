// 계약 — 게임이 조합해 쓰는 부품의 인터페이스.
export type { RoomStore, Alarms, Conn, ConnHooks, Transport, Quota, Llm } from './interfaces.js';

// 부품 — CF 구현 + 테스트용 fake를 짝으로 낸다.
export { doRoomStore, memRoomStore } from './room-store.js';
export { doAlarms, fakeAlarms } from './alarms.js';
export type { FakeAlarms } from './alarms.js';
export { sseTransport } from './transport-sse.js';
export { wsTransport } from './transport-ws.js';
export type { WsTransport } from './transport-ws.js';
export { fakeTransport } from './transport-fake.js';
export type { FakeTransport } from './transport-fake.js';

// 로깅·쿼터·이그레스
export { QuotaDO } from './quota-do.js';
export type { QuotaEnv } from './quota-do.js';
export { memQuota } from './quota-mem.js';

// 라우팅 — Hono 미들웨어. createGameWorker를 대체한다.
export { rateLimit, roomDelegate } from './middleware.js';
export type { RateLimitOptions, RoomDelegateOptions } from './middleware.js';

export { createLogger, EVENT_LLM_CALL, EVENT_QUOTA_EXCEEDED } from './logger.js';
export type { CfLogger, LlmCallFields, QuotaExceededFields } from './logger.js';
export { EgressDO, egressFetch, ALLOWED_HOSTS, DEFAULT_EGRESS_LOCATION_HINT } from './egress-do.js';

// LLM 배선 — 이그레스가 기본으로 켜져 있다. 게임이 빠뜨릴 수 없다.
export { makeLlm } from './llm.js';
export type { MakeLlmOptions } from './llm.js';

