import type { PublicRoom, RoomConfig } from './events';

export interface ApiErr { error: string }
export interface PersonaSummary {
  id: string; name: string; emoji: string; intro: string;
  axes: string[]; ranks: string[];
  advisors: { name: string; emoji: string; style: string }[];
  situationCount: number;
}
export interface CreateRoomReq { nick: string; config: Partial<RoomConfig> & { personaId: string } }
export interface CreateRoomRes { ok: true; code: string; playerId: string; token: string; room: PublicRoom }
export interface JoinRoomReq { nick: string }
export interface JoinRoomRes { ok: true; code: string; playerId: string; token: string; room: PublicRoom }
export interface AuthedReq { playerId: string; token: string }
export interface SpeakReq extends AuthedReq { text: string }
export interface DebugReq extends AuthedReq { action: 'adoptMe' | 'noAdopt' | 'next' }
export interface OkRes { ok: true }
export interface HealthRes {
  ok: true;
  providers: { gemini: boolean; nvidia: boolean };
  models: { gemini: string; nvidia: string };
}
