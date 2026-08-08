import { test, expect } from 'vitest';
import { createRoomState, addPlayer, authPlayer, publicRoom } from '../game/state';

test('싱글 방 생성: speakTime 0, aiCompete 강제, 정원 1', () => {
  const { room, playerId, token } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' });
  expect(room.config).toMatchObject({ mode: 'single', speakTime: 0, aiCompete: true, maxPlayers: 1 });
  expect(room.players[0]!.rank).toBe('사원'); // caocao 데이터의 1계급 (전 페르소나 공통 회사 직급)
  expect(authPlayer(room, playerId, token)).toBe(true);
  expect(authPlayer(room, playerId, 'wrong')).toBe(false);
});

test('멀티 방: speakTime 정규화(허용 외 → 60), 입장·정원', () => {
  const { room } = createRoomState('AB12', '호스트', { mode: 'multi', personaId: 'liubei', speakTime: 45, maxPlayers: 2 });
  expect(room.config.speakTime).toBe(60);
  const j = addPlayer(room, '게스트');
  expect('playerId' in j).toBe(true);
  expect('error' in addPlayer(room, '넘침')).toBe(true); // 정원 2 초과
});

test('없는 페르소나는 생성 거부', () => {
  expect(() => createRoomState('AB12', 'h', { mode: 'single', personaId: 'nope' })).toThrow();
});

test('publicRoom은 내부 필드를 숨기고 페르소나 요약을 포함', () => {
  const { room } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' });
  const pub = publicRoom(room);
  expect(pub).not.toHaveProperty('tokens');
  expect(pub.persona.name).toBe('조조 회장'); // 실제 팩 데이터의 persona.name
  expect(pub.persona).not.toHaveProperty('situations');
  expect(pub.capacity).toBe(1);
});

test('avatar 검증: 유효한 data URL만 저장, 형식이 아니거나 길이 초과면 조용히 무시', () => {
  const validAvatar = 'data:image/jpeg;base64,AAAA';
  const { room: ok } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' }, validAvatar);
  expect(ok.players[0]!.avatar).toBe(validAvatar);

  const { room: badFormat } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' }, 'not-a-data-url');
  expect(badFormat.players[0]!.avatar).toBeUndefined();

  const tooLong = `data:image/jpeg;base64,${'A'.repeat(40001)}`;
  const { room: tooLongRoom } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' }, tooLong);
  expect(tooLongRoom.players[0]!.avatar).toBeUndefined();
});

test('avatar 검증: emoji: 접두 프리셋 아이콘도 허용, 그 외 형식은 무시', () => {
  const { room: ok } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' }, 'emoji:😎');
  expect(ok.players[0]!.avatar).toBe('emoji:😎');

  const tooLong = `emoji:${'a'.repeat(20)}`; // 'emoji:' 6자 + 20자 = 26자 > 24자 한도
  const { room: tooLongRoom } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' }, tooLong);
  expect(tooLongRoom.players[0]!.avatar).toBeUndefined();

  const { room: weirdRoom } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' }, 'javascript:alert(1)');
  expect(weirdRoom.players[0]!.avatar).toBeUndefined();

  const { room: emptyRoom } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' }, '');
  expect(emptyRoom.players[0]!.avatar).toBeUndefined();
});

test('addPlayer도 avatar를 같은 규칙으로 검증한다', () => {
  const { room } = createRoomState('AB12', '호스트', { mode: 'multi', personaId: 'liubei', maxPlayers: 3 });
  const validAvatar = 'data:image/png;base64,BBBB';
  const joined = addPlayer(room, '게스트', validAvatar);
  expect('playerId' in joined).toBe(true);
  const p1 = room.players.find((p) => p.id === (joined as { playerId: string }).playerId);
  expect(p1?.avatar).toBe(validAvatar);

  const joined2 = addPlayer(room, '게스트2', 12345); // 문자열이 아님 → 무시
  const p2 = room.players.find((p) => p.id === (joined2 as { playerId: string }).playerId);
  expect(p2?.avatar).toBeUndefined();
});

test('RoomState는 JSON 왕복이 된다', () => {
  const { room } = createRoomState('AB12', 'h', { mode: 'single', personaId: 'caocao' });
  expect(JSON.parse(JSON.stringify(room))).toEqual(room);
});

// ---- 커스텀 페르소나 ----
import { CUSTOM_PERSONA } from './fixtures';
import { personaSchema } from '@content';

test('customPersona로 방을 만들면 그 페르소나로 방이 선다', () => {
  const custom = personaSchema.parse(CUSTOM_PERSONA);
  const { room } = createRoomState('AB12', '호스트', { personaId: custom.id, mode: 'single' }, undefined, custom);
  expect(room.customPersona?.name).toBe('건물주 할머니');
  expect(publicRoom(room).persona.name).toBe('건물주 할머니');
  expect(room.players[0]!.rank).toBe(custom.ranks[0]);
});

test('customPersona의 maxRounds는 상황 수를 넘지 않는다', () => {
  const custom = personaSchema.parse(CUSTOM_PERSONA);
  const { room } = createRoomState('AB12', '호스트', { personaId: custom.id, mode: 'single', maxRounds: 15 }, undefined, custom);
  expect(room.config.maxRounds).toBe(custom.situations.length); // 10
});
