import { test, expect } from 'vitest';
import { reducer, initialState } from '../src/store';
import type { ServerEvent } from '@eotm/shared';

const snap = {
  kind: 'snapshot', seq: 5,
  room: { code: 'AB12', phase: 'PLAYER_TURNS' } as never,
  feed: [{ type: 'system', text: '안녕', ts: 1 }],
  speakTurn: { current: 'p1', nick: '나', speakTime: 0 },
  timer: null, ended: null,
} satisfies ServerEvent;

test('snapshot은 feed를 리셋하고 상태를 채운다', () => {
  const s = reducer(initialState, { type: 'server', ev: snap });
  expect(s.room?.code).toBe('AB12');
  expect(s.feed.length).toBe(1);
  expect(s.speakTurn?.current).toBe('p1');
});

test('feed 이벤트는 누적되고 _k가 부여된다', () => {
  let s = reducer(initialState, { type: 'server', ev: snap });
  s = reducer(s, { type: 'server', ev: { kind: 'feed', seq: 6, item: { type: 'system', text: '둘', ts: 2 } } });
  expect(s.feed.length).toBe(2);
  expect(s.feed[1]).toHaveProperty('_k');
});

test('중복 seq는 무시한다 (재접속 스냅샷 직후 이벤트 중복 방지)', () => {
  let s = reducer(initialState, { type: 'server', ev: snap });
  s = reducer(s, { type: 'server', ev: { kind: 'feed', seq: 5, item: { type: 'system', text: '중복', ts: 2 } } });
  expect(s.feed.length).toBe(1);
});

test('restore는 새로고침 시 playerId·code를 복원한다 (입력창 게이팅 복구)', () => {
  // 새로고침: session 액션 없이 restore + snapshot만 들어온다. playerId가 채워져야 내 차례 게이팅이 성립한다.
  let s = reducer(initialState, { type: 'restore', code: 'AB12', playerId: 'p1' });
  expect(s.playerId).toBe('p1');
  s = reducer(s, { type: 'server', ev: snap });
  // snapshot이 speakTurn·phase를 채우고, restore가 채운 playerId와 일치해 "내 차례"가 성립.
  expect(s.playerId).toBe('p1');
  expect(s.phase).toBe('PLAYER_TURNS');
  expect(s.speakTurn?.current).toBe(s.playerId);
});

test('timer 이벤트는 deadline 원본을 저장한다', () => {
  let s = reducer(initialState, { type: 'server', ev: snap });
  s = reducer(s, { type: 'server', ev: { kind: 'timer', seq: 7, timer: { phase: 'PLAYER_TURNS', deadline: Date.now() + 60000, total: 60 } } });
  expect(s.deadline?.total).toBe(60);
});

test('reset은 메인으로 나가기 시 세션·방 상태를 초기값으로 되돌린다', () => {
  let s = reducer(initialState, { type: 'restore', code: 'AB12', playerId: 'p1' });
  s = reducer(s, { type: 'server', ev: snap });
  expect(s.room).not.toBeNull();
  s = reducer(s, { type: 'reset' });
  expect(s).toEqual(initialState);
});
