import type { DIFFICULTIES } from './constants';

export type Phase = 'SITUATION' | 'PLAYER_TURNS' | 'JUDGING' | 'RESULT' | 'END';
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface Situation { text: string; question: string }
export interface RoomConfig {
  mode: 'single' | 'multi';
  personaId: string;
  speakTime: number;        // 0 = 무제한(싱글)
  aiCompete: boolean;
  difficulty: Difficulty;
  maxPlayers: number;
  maxRounds: number;        // 라운드 상한 — 도달 시 '올해의 사원'(최고 총애) 발표로 종료
}
export interface PublicPlayer {
  id: string; nick: string; rank: string; joinOrder: number; favor: number; connected: boolean;
  avatar?: string; // 커스텀 프로필 이미지(JPEG dataURL) — 없으면 클라이언트가 색원+이니셜로 대체
}
export interface PublicPersona {
  id: string; name: string; emoji: string; intro: string;
  axes: string[]; ranks: string[];
  advisors: { name: string; emoji: string; style: string }[];
}
// 커스텀 페르소나 팩 (클라 localStorage 보관 → 방 생성 시 서버로 전달; 서버는 content zod로 재검증)
export interface CustomPersona {
  id: string; name: string; emoji: string; intro: string;
  axes: string[]; ranks: string[];
  personaPrompt: string; judgeAddress?: string; listenerBrief?: string;
  advisors: { name: string; emoji: string; style: string; core: string; voice?: string; quirks: string[] }[];
  situations: { text: string; question: string }[];
}
// rank: 라운드 시작 시점의 직급을 박아 둔다. 화면이 players에서 현재 직급을 읽으면
// 승진하는 순간 지난 라운드 컷의 이름표까지 새 직급으로 바뀐다.
export interface QueueEntry { kind: 'ai' | 'user'; key: string; name: string; rank?: string }
export interface Speech { key: string; name: string; kind: 'ai' | 'user'; text: string }
export interface PublicRoom {
  code: string; hostId: string;
  state: 'LOBBY' | 'PLAYING' | 'ENDED';
  phase: Phase | null; roundNo: number;
  config: RoomConfig; players: PublicPlayer[];
  persona: PublicPersona; situation: Situation | null;
  // 이번 상황 앞에 붙는 보스의 회고 대사 (지난 라운드 채택의 결과). 없으면 생략.
  bridge?: string | null;
  // submitted: 멀티 동시 입력 창에서 제출을 마친 플레이어 id 목록(본문은 공개 전까지 비밀).
  // revealing: 전원 제출(또는 마감) 후 순차 공개가 진행 중인지.
  round: { queue: QueueEntry[]; speeches: Speech[]; submitted: string[]; revealing: boolean } | null;
  advisorFavor: Record<string, number>;
  capacity: number;
}
export interface VerdictSpeaker {
  key: string; name: string; kind: 'ai' | 'user';
  axisScores: Record<string, number>; total: number; comment: string;
}
export interface Verdict {
  perSpeaker: VerdictSpeaker[]; adoptedKey: string | null;
  adoptReason: string; totals: Record<string, number>;
}
export interface Standing { id: string; nick: string; rank: string; favor: number; connected: boolean }
export interface HallEntry { roundNo: number; key: string; name: string; kind: 'ai' | 'user'; rank?: string; emoji?: string }
export interface AdoptedInfo { key: string; name: string; kind: 'ai' | 'user'; rank?: string; emoji?: string }

export type FeedItem =
  | { type: 'system'; text: string; tag?: string; ts: number }
  | { type: 'speech'; speakerType: 'ai' | 'user'; playerId?: string; name: string; emoji?: string; style?: string; rank?: string; text: string; ts: number }
  | { type: 'verdict'; roundNo: number; situation: Situation; verdict: Verdict; adoptedName: string | null; adopted: AdoptedInfo | null; standings: Standing[]; source: string; ts: number }
  | { type: 'epilogue'; roundNo: number; story: string; source: string; ts: number };

export interface SpeakTurn { current: string; nick: string; speakTime: number }
export interface TimerInfo { phase: string; deadline: number; total: number } // deadline = epoch ms. 카운트다운은 클라 로컬 렌더
export interface EndedPayload { reason: string; standings: Standing[]; hall: HallEntry[] }

export type ServerEvent =
  | { kind: 'snapshot'; seq: number; room: PublicRoom; feed: FeedItem[]; speakTurn: SpeakTurn | null; timer: TimerInfo | null; ended: EndedPayload | null }
  | { kind: 'room'; seq: number; room: PublicRoom }
  | { kind: 'phase'; seq: number; phase: Phase; roundNo: number; situation?: Situation; bridge?: string }
  | { kind: 'turn'; seq: number; turn: SpeakTurn | null }
  | { kind: 'timer'; seq: number; timer: TimerInfo | null }
  | { kind: 'feed'; seq: number; item: FeedItem }
  | { kind: 'ended'; seq: number; payload: EndedPayload };
