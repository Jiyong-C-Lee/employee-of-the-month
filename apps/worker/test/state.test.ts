import { test, expect } from 'vitest';
import { createRoomState, addPlayer, authPlayer, publicRoom } from '../src/game/state';

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

test('RoomState는 JSON 왕복이 된다', () => {
  const { room } = createRoomState('AB12', 'h', { mode: 'single', personaId: 'caocao' });
  expect(JSON.parse(JSON.stringify(room))).toEqual(room);
});
