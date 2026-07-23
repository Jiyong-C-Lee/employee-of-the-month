// 게임 규칙 상수 — 원본 server/sycophant/logic.js·rooms.js의 값을 승계.
export const MAX_SPEECH_CHARS = 160;
// 참모 대사 길이 밴드 — 프롬프트(50~120자)와 쌍. 하한 미달은 zod 페일오버, 상한 초과는 문장 경계 클램프.
export const ADVISOR_SPEECH_MIN_CHARS = 40;
export const ADVISOR_SPEECH_MAX_CHARS = 120;
export const SPEAK_TIME_OPTIONS = [60, 120, 180] as const; // 멀티 발언 제한시간(초). 싱글은 0(무제한)
export const DEFAULT_SPEAK_TIME = 60;
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export const MAX_ROOM_PLAYERS = 6;
export const ROOM_TTL_MS = 30 * 60 * 1000; // 마지막 활동 후 방 청소
