import type { CustomPersona, PublicRoom, RoomConfig } from './events';

export interface ApiErr { error: string }
export interface PersonaSummary {
  id: string; name: string; emoji: string; intro: string;
  axes: string[]; ranks: string[];
  advisors: { name: string; emoji: string; style: string }[];
  situationCount: number;
}
export interface CreateRoomReq { nick: string; avatar?: string; config: Partial<RoomConfig> & { personaId: string; customPersona?: CustomPersona } }
export interface CreateRoomRes { ok: true; code: string; playerId: string; token: string; room: PublicRoom }
export interface JoinRoomReq { nick: string; avatar?: string }
export interface JoinRoomRes { ok: true; code: string; playerId: string; token: string; room: PublicRoom }
export interface AuthedReq { playerId: string; token: string }
export interface SpeakReq extends AuthedReq { text: string }
export interface DebugReq extends AuthedReq { action: 'adoptMe' | 'noAdopt' | 'next' }
export interface OkRes { ok: true }
// 라운드 공유 링크 — 게임 화면과 동일하게 렌더할 라운드 스냅샷 (KV, TTL 30일)
export interface SharedRoundPayload {
  kind?: 'round';
  roundNo: number;
  persona: import('./events').PublicPersona;
  situation: import('./events').Situation;
  queue: import('./events').QueueEntry[];
  speeches: import('./events').Speech[];
  verdict: import('./events').Verdict;
  adopted: import('./events').AdoptedInfo | null;
  standings: import('./events').Standing[];
  epilogue?: string;
  players: import('./events').PublicPlayer[];
}
// 세션 종료(최종 결과) 공유 — 올해의 사원·명예의 전당·순위표 스냅샷
export interface SharedSessionPayload {
  kind: 'session';
  roundNo: number; // 진행된 라운드 수
  persona: import('./events').PublicPersona;
  players: import('./events').PublicPlayer[];
  standings: import('./events').Standing[];
  hall: import('./events').HallEntry[];
  reason: string;
}
export type SharedPayload = SharedRoundPayload | SharedSessionPayload;
export interface CreateShareRes { ok: true; id: string; url: string }

export interface HealthRes {
  ok: true;
  providers: { gemini: boolean; nvidia: boolean };
  models: { gemini: string; nvidia: string };
}
