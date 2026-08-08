// 방 상태 모델 — 원본 server/rooms.js의 sycophant 경로 이식(debate 분기 제거, DO storage 저장용 순수 상태).
import { getPersona, STRINGS, type FullPersona } from '@content';
import { shuffledIndices } from './logic';
import type {
  FeedItem, HallEntry, PublicPlayer, PublicRoom, QueueEntry, RoomConfig, Situation, Speech, Standing, Verdict,
} from '@shared';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 문자 제외

export function genCode(): string {
  return Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

export function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function newToken(): string {
  return crypto.randomUUID();
}

export type PlayerState = PublicPlayer;

export interface RoundState {
  situation: Situation;
  queue: QueueEntry[];
  speeches: Speech[];
  turnIdx: number;
  skipped: string[];
  usedApproaches: string[];
  verdict: Verdict | null;
  // 멀티 동시 입력: playerId -> 제출 본문 (공개 전까지 클라이언트에 안 나간다). 구버전 스냅샷엔 없을 수 있다.
  submissions?: Record<string, string>;
  // 순차 공개 진행 중 플래그 — 재기동 시 공개 루프 재개 판단용.
  revealing?: boolean;
}

export interface RoomState {
  code: string;
  hostId: string;
  state: 'LOBBY' | 'PLAYING' | 'ENDED';
  phase: PublicRoom['phase'];
  roundNo: number;
  players: PlayerState[];
  config: RoomConfig;
  advisorFavor: Record<string, number>;
  // 참모 이름 -> 직전 라운드에 쓴 버릇 (다음 라운드 샘플링에서 제외용). 구버전 스냅샷엔 없을 수 있다.
  advisorLastQuirk?: Record<string, string>;
  // 상황 덱 — 세션 시작 시 섞어둔 situations 인덱스 순열. 라운드 n은 situationOrder[n-1]을 쓴다.
  // 구버전 스냅샷엔 없을 수 있다(그 경우 엔진이 정의 순서로 폴백).
  situationOrder?: number[];
  // 커스텀 페르소나 팩 전체 — 있으면 내장 팩 대신 이것을 쓴다(roomPersona). storage에 그대로 영속.
  customPersona?: FullPersona;
  hall: HallEntry[];
  round: RoundState | null;
  feed: FeedItem[];
  seq: number;
  tokens: Record<string, string>;
  pendingChampion: string | null;
  lastActivity: number;
  // 종료 사유 — 재기동 후 스냅샷의 ended 페이로드를 room 상태에서 재구성하기 위해 저장한다(직렬화 가능).
  endedReason: string | null;
}

// 아바타는 문자열이고 다음 두 형식 중 하나일 때만 허용한다. 그 외엔 조용히 무시(에러 아님) —
// 잘못된 값을 보내는 클라이언트를 막을 필요는 없고, 그냥 기본 아바타(색원+이니셜)로 폴백시키면 된다.
// - data:image/ dataURL (업로드 사진), 길이 4만자 이하
// - emoji:😎 (프리셋 아이콘), 길이 24자 이하
const AVATAR_MAX_LEN = 40000;
const AVATAR_EMOJI_MAX_LEN = 24;

function isValidAvatar(avatar: unknown): avatar is string {
  if (typeof avatar !== 'string') return false;
  if (avatar.startsWith('data:image/')) return avatar.length <= AVATAR_MAX_LEN;
  if (avatar.startsWith('emoji:')) return avatar.length <= AVATAR_EMOJI_MAX_LEN;
  return false;
}

function makePlayer(nick: string, joinOrder: number, rank: string, avatar?: unknown): PlayerState {
  const player: PlayerState = {
    id: newId(),
    nick: nick.trim().slice(0, 16) || `게스트${joinOrder + 1}`,
    rank,
    joinOrder,
    favor: 0,
    connected: true,
  };
  if (isValidAvatar(avatar)) player.avatar = avatar;
  return player;
}

export function createRoomState(
  code: string,
  hostNick: string,
  config: Partial<RoomConfig> & { personaId: string },
  avatar?: unknown,
  customPersona?: FullPersona,
): { room: RoomState; playerId: string; token: string } {
  const persona = customPersona ?? getPersona(config.personaId);
  if (!persona) throw new Error(STRINGS.errors.noPersona);

  const mode = config.mode === 'multi' ? 'multi' : 'single';
  const normalized: RoomConfig = {
    mode,
    personaId: persona.id,
    // 싱글은 제한시간 없음(0). 멀티는 1/2/3분.
    speakTime: mode === 'single' ? 0 : ([60, 120, 180].includes(Number(config.speakTime)) ? Number(config.speakTime) : 60),
    // 싱글은 AI 조언자가 항상 채택 경쟁자. 멀티는 방장 옵션(기본 off).
    aiCompete: mode === 'single' ? true : Boolean(config.aiCompete),
    // 조언자 완성도(난이도): easy=정답의 60% / normal=75% / hard=90%
    difficulty: ['easy', 'normal', 'hard'].includes(config.difficulty as string) ? (config.difficulty as RoomConfig['difficulty']) : 'normal',
    maxPlayers: mode === 'single' ? 1 : Math.min(6, Math.max(2, Number(config.maxPlayers) || 4)),
    // 라운드 상한 — 허용값 외엔 기본 10. 상황 덱(20개)을 넘지 않는 선택지만 노출한다.
    maxRounds: [5, 10, 15].includes(Number(config.maxRounds)) ? Number(config.maxRounds) : 5,
  };
  // 상황 덱보다 많은 라운드는 불가 — 커스텀 팩(상황 10개)에서 20라운드를 고르는 경우 클램프.
  normalized.maxRounds = Math.min(normalized.maxRounds, persona.situations.length);

  const host = makePlayer(hostNick, 0, persona.ranks[0]!, avatar);
  const token = newToken();
  const now = Date.now();

  const room: RoomState = {
    code,
    hostId: host.id,
    state: 'LOBBY',
    phase: null,
    roundNo: 0,
    players: [host],
    config: normalized,
    advisorFavor: {}, // 조언자 이름 -> 채택 수 (연출·현황용)
    advisorLastQuirk: {},
    ...(customPersona ? { customPersona } : {}),
    situationOrder: shuffledIndices(persona.situations.length), // 상황 덱 셔플 — 판마다 등장 순서가 다르다

    hall: [], // 라운드별 채택자 — 명예의 전당
    round: null,
    feed: [],
    seq: 0,
    tokens: { [host.id]: token },
    pendingChampion: null,
    lastActivity: now,
    endedReason: null,
  };

  return { room, playerId: host.id, token };
}

// 방의 페르소나 단일 조회 경로 — 커스텀이 있으면 커스텀, 없으면 내장 팩.
export function roomPersona(room: RoomState): FullPersona {
  const p = room.customPersona ?? getPersona(room.config.personaId);
  if (!p) throw new Error(STRINGS.errors.noPersona);
  return p;
}

export function addPlayer(room: RoomState, nick: string, avatar?: unknown): { playerId: string; token: string } | { error: string } {
  if (room.state !== 'LOBBY') return { error: STRINGS.errors.roomStarted! };
  if (room.players.length >= room.config.maxPlayers) return { error: STRINGS.errors.roomFull! };

  const persona = roomPersona(room);

  const player = makePlayer(nick, room.players.length, persona.ranks[0]!, avatar);
  const token = newToken();
  room.players.push(player);
  room.tokens[player.id] = token;
  room.lastActivity = Date.now();

  return { playerId: player.id, token };
}

export function authPlayer(room: RoomState, playerId: string, token: string): boolean {
  // 비문자열·빈 값은 거부 — tokens에 빈 키가 우연히 매칭되는 우회를 막는다(M1).
  if (typeof playerId !== 'string' || typeof token !== 'string' || !playerId || !token) return false;
  return room.tokens[playerId] === token;
}

// 총애 내림차순(동률은 입장순) 순위표. 엔진·재기동 스냅샷(ended 재구성)이 공유한다.
export function computeStandings(room: RoomState): Standing[] {
  return [...room.players]
    .sort((a, b) => b.favor - a.favor || a.joinOrder - b.joinOrder)
    .map((p) => ({ id: p.id, nick: p.nick, rank: p.rank, favor: p.favor, connected: p.connected }));
}

// 화면 전송용 방 스냅샷 (tokens 등 내부 필드 제외).
export function publicRoom(room: RoomState): PublicRoom {
  const persona = roomPersona(room);

  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    phase: room.phase,
    roundNo: room.roundNo,
    config: room.config,
    players: room.players.map((p) => ({
      id: p.id,
      nick: p.nick,
      rank: p.rank,
      joinOrder: p.joinOrder,
      favor: p.favor,
      connected: p.connected,
      avatar: p.avatar,
    })),
    persona: {
      id: persona.id,
      name: persona.name,
      emoji: persona.emoji,
      intro: persona.intro,
      axes: persona.axes,
      ranks: persona.ranks,
      advisors: persona.advisors.map((a) => ({ name: a.name, emoji: a.emoji, style: a.style })),
    },
    situation: room.round?.situation ?? null,
    round: room.round
      ? {
        queue: room.round.queue,
        speeches: room.round.speeches.map((s) => ({ key: s.key, name: s.name, kind: s.kind, text: s.text })),
        submitted: Object.keys(room.round.submissions ?? {}), // 제출 여부만 공개 — 본문은 공개 시점까지 비밀
        revealing: room.round.revealing ?? false,
      }
      : null,
    advisorFavor: room.advisorFavor,
    capacity: room.config.maxPlayers,
  };
}
