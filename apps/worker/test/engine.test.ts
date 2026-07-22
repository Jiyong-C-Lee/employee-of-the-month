import { test, expect, vi } from 'vitest';
import { Engine, type EngineBus, type EngineEvent } from '../src/game/engine';
import { createRoomState, addPlayer } from '../src/game/state';
import { STRINGS } from '@eotm/content';
import type { Env } from '../src/env';

// FakeBus: 이벤트를 배열에 모으고, delay는 즉시 실행(연출 지연 생략), schedule은 태그만 기록.
function fakeBus() {
  const events: EngineEvent[] = [];
  const scheduled: string[] = [];
  const bus: EngineBus = {
    emit: (ev) => { events.push(ev); },
    persist: async () => {},
    schedule: async (_at, tag) => { scheduled.push(tag); },
    cancelSchedule: async () => {},
    delay: (_ms, fn) => { fn(); }, // 연출 지연 생략 — 즉시 진행
  };
  return { bus, events, scheduled };
}

const deps = { env: {} as Env }; // 키 없음 → mock 경로(결정적)
const waitUntil = (p: () => boolean) => vi.waitUntil(p, { timeout: 3000 });

function findFeed(events: EngineEvent[], type: string) {
  return events.filter(
    (e) => e.kind === 'feed' && (e as { item: { type: string } }).item.type === type,
  );
}

test('싱글 1라운드: 시작→조언자 발언→내 발언→판정→RESULT', async () => {
  const { room, playerId } = createRoomState('T1', '나', { mode: 'single', personaId: 'caocao' });
  const { bus, events } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(playerId)).toEqual({ ok: true });

  // mock AI 배치는 비동기 — 조언자 발언·내 순번까지 진행을 기다린다.
  await waitUntil(
    () => room.phase === 'PLAYER_TURNS' && room.round!.queue[room.round!.turnIdx]?.kind === 'user',
  );
  // caocao 조언자 3명이 먼저 발언한다.
  expect(findFeed(events, 'speech').length).toBe(3);

  eng.handleSpeak(playerId, '제 생각은 이렇습니다.');
  await waitUntil(() => room.phase === 'RESULT');
  expect(findFeed(events, 'verdict').length).toBe(1);
  expect(room.round!.verdict).not.toBeNull();
});

test('멀티: 순번 아닌 발언 거부, 타임아웃 알람 예약·발동', async () => {
  const { room, playerId: hostId } = createRoomState('T2', '호스트', {
    mode: 'multi', personaId: 'caocao', maxPlayers: 2, speakTime: 60,
  });
  const added = addPlayer(room, '게스트');
  const guestId = (added as { playerId: string }).playerId;

  const { bus, events, scheduled } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(hostId)).toEqual({ ok: true });

  // 조언자 발언이 끝나고 사람(호스트) 순번에 멈출 때까지 대기.
  await waitUntil(
    () => room.phase === 'PLAYER_TURNS' && room.round!.queue[room.round!.turnIdx]?.kind === 'user',
  );
  const cur = room.round!.queue[room.round!.turnIdx]!;
  expect(cur.key).toBe(hostId); // 사람 블록은 입장순 — 호스트가 먼저

  // 순번이 아닌 게스트의 발언은 거부.
  expect(eng.handleSpeak(guestId, '제가 먼저요')).toEqual({ error: STRINGS.errors.notYourTurn });

  // 제한시간(멀티)이 있으므로 턴 마감 알람이 예약된다.
  const tag = scheduled.find((t) => t.startsWith(`turnTimeout:${room.roundNo}:`));
  expect(tag).toBeTruthy();

  // 알람 발동 → 호스트 기권 처리 후 다음 순번(게스트)으로 진행.
  const idxBefore = room.round!.turnIdx;
  eng.onAlarm(tag!);
  expect(room.round!.turnIdx).toBeGreaterThan(idxBefore);
  expect(
    findFeed(events, 'system').some((e) => (e as { item: { tag?: string } }).item.tag === 'timeout'),
  ).toBe(true);
});

test('재기동 재개: 사람 턴에서 turn 이벤트 재발행 + 턴 알람 재무장 (C1)', async () => {
  const { room, playerId: hostId } = createRoomState('T3', '호스트', {
    mode: 'multi', personaId: 'caocao', maxPlayers: 2, speakTime: 60,
  });
  addPlayer(room, '게스트');
  const b1 = fakeBus();
  const eng1 = new Engine(room, b1.bus, deps);
  expect(eng1.start(hostId)).toEqual({ ok: true });
  await waitUntil(
    () => room.phase === 'PLAYER_TURNS' && room.round!.queue[room.round!.turnIdx]?.kind === 'user',
  );

  // 재기동 시뮬레이션: 같은 room 상태로 새 엔진을 만들고 resumeAfterRestore.
  const b2 = fakeBus();
  const eng2 = new Engine(room, b2.bus, deps);
  eng2.resumeAfterRestore();

  // 사람 턴이 turn 이벤트로 재발행되고(입력창 복구), 멀티라 턴 마감 알람도 재무장된다.
  const turnEv = b2.events.find((e) => e.kind === 'turn');
  expect(turnEv).toBeTruthy();
  expect((turnEv as { turn: { current: string } }).turn.current).toBe(room.round!.queue[room.round!.turnIdx]!.key);
  expect(b2.scheduled.some((t) => t.startsWith('turnTimeout:'))).toBe(true);
});

test('재기동 재개: 발언 종료 후 심판 대기 창에서 beginJudging 재킥 (I5)', async () => {
  const { room, playerId } = createRoomState('T4', '나', { mode: 'single', personaId: 'caocao' });
  const b1 = fakeBus();
  const eng1 = new Engine(room, b1.bus, deps);
  expect(eng1.start(playerId)).toEqual({ ok: true });
  await waitUntil(
    () => room.phase === 'PLAYER_TURNS' && room.round!.queue[room.round!.turnIdx]?.kind === 'user',
  );

  // 모든 순번이 끝난 직후(turnIdx==queue.length)이지만 phase는 아직 PLAYER_TURNS인 창을 만든다.
  room.round!.turnIdx = room.round!.queue.length;

  // 재기동: 새 엔진으로 재개 → 심판을 재킥해 정지하지 않고 RESULT로 진행해야 한다.
  const b2 = fakeBus();
  const eng2 = new Engine(room, b2.bus, deps);
  eng2.resumeAfterRestore();
  await waitUntil(() => room.phase === 'RESULT');
  expect(room.round!.verdict).not.toBeNull();
});
