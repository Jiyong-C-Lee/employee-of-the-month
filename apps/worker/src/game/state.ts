// 방 상태 모델 — 원본 server/rooms.js의 sycophant 경로 이식(debate 분기 제거, DO storage 저장용 순수 상태).
import { getPersona, STRINGS } from '@eotm/content';
import type {
  FeedItem, HallEntry, PublicPlayer, PublicRoom, QueueEntry, RoomConfig, Situation, Speech, Verdict,
} from '@eotm/shared';

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
  hall: HallEntry[];
  round: RoundState | null;
  feed: FeedItem[];
  seq: number;
  tokens: Record<string, string>;
  pendingChampion: string | null;
  lastActivity: number;
}

function makePlayer(nick: string, joinOrder: number, rank: string): PlayerState {
  return {
    id: newId(),
    nick: nick.trim().slice(0, 16) || `게스트${joinOrder + 1}`,
    rank,
    joinOrder,
    favor: 0,
    connected: true,
  };
}

export function createRoomState(
  code: string,
  hostNick: string,
  config: Partial<RoomConfig> & { personaId: string },
): { room: RoomState; playerId: string; token: string } {
  const persona = getPersona(config.personaId);
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
  };

  const host = makePlayer(hostNick, 0, persona.ranks[0]!);
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
    hall: [], // 라운드별 채택자 — 명예의 전당
    round: null,
    feed: [],
    seq: 0,
    tokens: { [host.id]: token },
    pendingChampion: null,
    lastActivity: now,
  };

  return { room, playerId: host.id, token };
}

export function addPlayer(room: RoomState, nick: string): { playerId: string; token: string } | { error: string } {
  if (room.state !== 'LOBBY') return { error: STRINGS.errors.roomStarted! };
  if (room.players.length >= room.config.maxPlayers) return { error: STRINGS.errors.roomFull! };

  const persona = getPersona(room.config.personaId);
  if (!persona) throw new Error(STRINGS.errors.noPersona);

  const player = makePlayer(nick, room.players.length, persona.ranks[0]!);
  const token = newToken();
  room.players.push(player);
  room.tokens[player.id] = token;
  room.lastActivity = Date.now();

  return { playerId: player.id, token };
}

export function authPlayer(room: RoomState, playerId: string, token: string): boolean {
  return room.tokens[playerId] === token;
}

// 화면 전송용 방 스냅샷 (tokens 등 내부 필드 제외).
export function publicRoom(room: RoomState): PublicRoom {
  const persona = getPersona(room.config.personaId);
  if (!persona) throw new Error(STRINGS.errors.noPersona);

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
      ? { queue: room.round.queue, speeches: room.round.speeches.map((s) => ({ key: s.key, name: s.name, kind: s.kind, text: s.text })) }
      : null,
    advisorFavor: room.advisorFavor,
    capacity: room.config.maxPlayers,
  };
}
