import { test, expect, vi } from 'vitest';
import { Engine, type EngineBus, type EngineEvent } from '../game/engine';
import { ADVISORS_PER_ROUND } from '../game/logic';
import { createRoomState, addPlayer } from '../game/state';
import { STRINGS, getPersona } from '@content';
import type { Deps } from '../ai/orchestrate';

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

// 키 없음 → 체인을 건너뛰고 게임 고유 mock. 결정적이라 엔진 테스트가 안정된다.
const deps: Deps = { hasKey: false, llm: () => { throw new Error('키가 없는데 체인을 불렀다'); } };
const waitUntil = (p: () => boolean) => vi.waitUntil(p, { timeout: 3000 });

function findFeed(events: EngineEvent[], type: string) {
  return events.filter(
    (e) => e.kind === 'feed' && (e as { item: { type: string } }).item.type === type,
  );
}

test('상황 공개 후 대기: 방장이 proceed해야 발언(AI 배치 요청)이 시작된다', async () => {
  const { room, playerId } = createRoomState('P1', '나', { mode: 'single', personaId: 'caocao' });
  const { bus, events } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(playerId)).toEqual({ ok: true });

  // 자동 진행 없음 — 상황을 읽는 동안 SITUATION에 멈춰 있고 발언 피드도 없다.
  expect(room.phase).toBe('SITUATION');
  await new Promise((r) => setTimeout(r, 50));
  expect(room.phase).toBe('SITUATION');
  expect(findFeed(events, 'speech').length).toBe(0);

  // 방장만 진행할 수 있다.
  expect(eng.proceed('stranger')).toEqual({ error: STRINGS.errors.notHostNext });
  expect(eng.proceed(playerId)).toEqual({ ok: true });
  await waitUntil(() => room.phase === 'PLAYER_TURNS');
  // 이미 진행된 뒤의 중복 proceed는 거부된다.
  expect(eng.proceed(playerId)).toEqual({ error: STRINGS.errors.notNow });
});

test('재기동 재개: SITUATION은 자동 진행하지 않고 방장 proceed를 기다린다', async () => {
  const { room, playerId } = createRoomState('P2', '나', { mode: 'single', personaId: 'caocao' });
  const b1 = fakeBus();
  const eng1 = new Engine(room, b1.bus, deps);
  expect(eng1.start(playerId)).toEqual({ ok: true });

  // 재기동 시뮬레이션 — SITUATION에서 멈춘 방은 그대로 대기해야 한다.
  const b2 = fakeBus();
  const eng2 = new Engine(room, b2.bus, deps);
  eng2.resumeAfterRestore();
  await new Promise((r) => setTimeout(r, 50));
  expect(room.phase).toBe('SITUATION');

  // 재기동 후에도 방장 proceed로 정상 진행된다.
  expect(eng2.proceed(playerId)).toEqual({ ok: true });
  await waitUntil(() => room.phase === 'PLAYER_TURNS');
});

test('싱글 1라운드: 시작→조언자 발언→내 발언→판정→RESULT', async () => {
  const { room, playerId } = createRoomState('T1', '나', { mode: 'single', personaId: 'caocao' });
  const { bus, events } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(playerId)).toEqual({ ok: true });
  expect(eng.proceed(playerId)).toEqual({ ok: true });

  // mock AI 배치는 비동기 — 조언자 발언·내 순번까지 진행을 기다린다.
  await waitUntil(
    () => room.phase === 'PLAYER_TURNS' && room.round!.queue[room.round!.turnIdx]?.kind === 'user',
  );
  // 이번 라운드 출전 조언자(풀에서 발탁된 인원)가 먼저 발언한다.
  const expected = Math.min(getPersona('caocao')!.advisors.length, ADVISORS_PER_ROUND);
  expect(findFeed(events, 'speech').length).toBe(expected);

  eng.handleSpeak(playerId, '제 생각은 이렇습니다.');
  await waitUntil(() => room.phase === 'RESULT');
  expect(findFeed(events, 'verdict').length).toBe(1);
  expect(room.round!.verdict).not.toBeNull();
});

test('라운드 상한: 기본 5라운드가 지나면 올해의 사원 발표로 세션 종료', async () => {
  const { room, playerId } = createRoomState('T5', '나', { mode: 'single', personaId: 'caocao' });
  expect(room.config.maxRounds).toBe(5); // 기본 라운드 수
  const { bus } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(playerId)).toEqual({ ok: true });

  for (let r = 1; r <= 5; r++) {
    expect(room.roundNo).toBe(r);
    await waitUntil(() => ['SITUATION', 'PLAYER_TURNS', 'JUDGING'].includes(room.phase ?? ''));
    expect(eng.debug(playerId, 'noAdopt')).toEqual({ ok: true });
    await waitUntil(() => room.phase === 'RESULT');
    eng.debug(playerId, 'next');
  }
  expect(room.state).toBe('ENDED');
  expect(room.endedReason).toContain('올해의 사원');
});

test('라운드 시작 시 자막(round.intro·round.question)은 중복이라 발행하지 않는다', async () => {
  const { room, playerId } = createRoomState('T1Q', '나', { mode: 'single', personaId: 'liubei' });
  const { bus, events } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(playerId)).toEqual({ ok: true });

  const situation = room.round!.situation;
  const systemTexts = findFeed(events, 'system').map((e) => (e as { item: { text: string } }).item.text);
  // 상황 카드(SituationCut)가 본문·질문을 모두 렌더하므로 라운드 자막은 없어야 한다.
  expect(systemTexts.some((t) => t.includes(situation.question))).toBe(false);
  expect(systemTexts.some((t) => t.includes(situation.text))).toBe(false);
});

test('멀티: 동시 입력 — 제출 수집·중복 거부, 전원 제출 시 순차 공개→판정', async () => {
  const { room, playerId: hostId } = createRoomState('T2', '호스트', {
    mode: 'multi', personaId: 'caocao', maxPlayers: 2, speakTime: 60,
  });
  const guestId = (addPlayer(room, '게스트') as { playerId: string }).playerId;

  const { bus, events, scheduled } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(hostId)).toEqual({ ok: true });
  expect(eng.proceed(hostId)).toEqual({ ok: true });
  await waitUntil(() => room.phase === 'PLAYER_TURNS');

  // 라운드당 하나의 공용 마감 알람이 예약된다.
  expect(scheduled).toContain(`inputWindow:${room.roundNo}`);

  // 순번 없이 아무나 제출할 수 있고, 중복 제출은 거부된다.
  expect(eng.handleSpeak(guestId, '게스트 의견')).toBeUndefined();
  expect(eng.handleSpeak(guestId, '두 번째')).toEqual({ error: STRINGS.errors.alreadySubmitted });
  // 공개 전에는 발언 피드가 없다(본문 비밀 유지).
  expect(findFeed(events, 'speech').length).toBe(0);

  // 마지막 사람이 제출하면 순차 공개가 시작돼 판정까지 진행된다.
  expect(eng.handleSpeak(hostId, '호스트 의견')).toBeUndefined();
  await waitUntil(() => room.phase === 'RESULT');
  expect(room.round!.speeches.filter((s) => s.kind === 'user').length).toBe(2);
});

test('멀티: 입력 마감 알람 — 미제출자 기권 처리 후 제출분만 공개', async () => {
  const { room, playerId: hostId } = createRoomState('T2T', '호스트', {
    mode: 'multi', personaId: 'caocao', maxPlayers: 2, speakTime: 60,
  });
  const guestId = (addPlayer(room, '게스트') as { playerId: string }).playerId;
  const { bus, events } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(hostId)).toEqual({ ok: true });
  expect(eng.proceed(hostId)).toEqual({ ok: true });
  await waitUntil(() => room.phase === 'PLAYER_TURNS');

  expect(eng.handleSpeak(hostId, '호스트 의견')).toBeUndefined();
  eng.onAlarm(`inputWindow:${room.roundNo}`);
  await waitUntil(() => room.phase === 'RESULT');
  expect(room.round!.skipped).toContain(guestId);
  expect(room.round!.speeches.filter((s) => s.kind === 'user').length).toBe(1);
  expect(
    findFeed(events, 'system').some((e) => (e as { item: { tag?: string } }).item.tag === 'timeout'),
  ).toBe(true);
});

test('재기동 재개(멀티): 입력 창 유지, 이후 제출·공개가 정상 진행 (C1)', async () => {
  const { room, playerId: hostId } = createRoomState('T3', '호스트', {
    mode: 'multi', personaId: 'caocao', maxPlayers: 2, speakTime: 60,
  });
  const guestId = (addPlayer(room, '게스트') as { playerId: string }).playerId;
  const b1 = fakeBus();
  const eng1 = new Engine(room, b1.bus, deps);
  expect(eng1.start(hostId)).toEqual({ ok: true });
  expect(eng1.proceed(hostId)).toEqual({ ok: true });
  await waitUntil(() => room.phase === 'PLAYER_TURNS');
  expect(eng1.handleSpeak(hostId, '호스트 의견')).toBeUndefined();

  // 재기동 시뮬레이션: 같은 room 상태로 새 엔진을 만들고 resumeAfterRestore.
  const b2 = fakeBus();
  const eng2 = new Engine(room, b2.bus, deps);
  eng2.resumeAfterRestore();

  // 아직 게스트 미제출 — 입력 창이 유지되고 공개가 시작되지 않는다 (마감 알람은 DO storage에 살아 있음).
  expect(room.phase).toBe('PLAYER_TURNS');
  expect(room.round!.revealing).toBe(false);

  // 재기동 후 제출도 정상 동작 → 전원 제출로 공개·판정까지 진행.
  expect(eng2.handleSpeak(guestId, '게스트 의견')).toBeUndefined();
  await waitUntil(() => room.phase === 'RESULT');
  expect(room.round!.speeches.filter((s) => s.kind === 'user').length).toBe(2);
});

test('재기동 재개: 발언 종료 후 심판 대기 창에서 beginJudging 재킥 (I5)', async () => {
  const { room, playerId } = createRoomState('T4', '나', { mode: 'single', personaId: 'caocao' });
  const b1 = fakeBus();
  const eng1 = new Engine(room, b1.bus, deps);
  expect(eng1.start(playerId)).toEqual({ ok: true });
  expect(eng1.proceed(playerId)).toEqual({ ok: true });
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

test('한 판 더: 방장이 종료된 멀티 방을 로비로 리셋 — 총애·직급·피드 초기화', () => {
  const { room, playerId } = createRoomState('RM1', '호스트', { mode: 'multi', personaId: 'caocao', maxPlayers: 2 });
  const j = addPlayer(room, '게스트');
  const guestId = 'playerId' in j ? j.playerId : '';
  const { bus } = fakeBus();
  const eng = new Engine(room, bus, deps);
  // 종료 상태를 직접 구성 (세션 완주는 다른 테스트가 커버)
  room.state = 'ENDED';
  room.phase = 'END';
  room.roundNo = 5;
  room.hall = [{ roundNo: 1, key: playerId, name: '호스트', kind: 'user' }];
  room.feed = [{ type: 'system', text: '끝', ts: 0 }];
  room.players[0]!.favor = 3;
  room.players[0]!.rank = '과장';

  expect(eng.rematch(guestId)).toEqual({ error: STRINGS.errors.notHost });
  expect(eng.rematch(playerId)).toEqual({ ok: true });
  expect(room.state).toBe('LOBBY');
  expect(room.roundNo).toBe(0);
  expect(room.hall).toEqual([]);
  expect(room.feed).toEqual([]);
  expect(room.players.map((p) => p.favor)).toEqual([0, 0]);
  expect(room.players[0]!.rank).toBe('사원');
  // 종료 전에는 거부
  expect(eng.rematch(playerId)).toEqual({ error: STRINGS.errors.notEnded });
});

test('한 판 더: 싱글은 로비 없이 즉시 재시작', async () => {
  const { room, playerId } = createRoomState('RM2', '나', { mode: 'single', personaId: 'caocao' });
  const { bus } = fakeBus();
  const eng = new Engine(room, bus, deps);
  room.state = 'ENDED';
  room.phase = 'END';
  room.roundNo = 7;
  expect(eng.rematch(playerId)).toEqual({ ok: true });
  expect(room.state).toBe('PLAYING');
  expect(room.roundNo).toBe(1);
  expect(room.phase).toBe('SITUATION'); // 재시작도 상황 확인 대기부터
  expect(eng.proceed(playerId)).toEqual({ ok: true });
  await waitUntil(() => room.phase === 'PLAYER_TURNS');
});

// ── sparse 링크 진행 ──

// 덱 순서를 원하는 상황으로 고정하는 헬퍼 — 링크 전개를 결정적으로 시험한다.
function forceDeck(room: ReturnType<typeof createRoomState>['room'], ids: string[]) {
  const persona = getPersona(room.config.personaId)!;
  room.situationOrder = ids.map((id) => persona.situations.findIndex((s) => s.id === id));
  room.deckPos = 0;
}

test('무조건 링크(then): 상황을 치르면 다음 상황이 lead 브릿지와 함께 확정 연결된다', async () => {
  const persona = getPersona('caocao')!;
  const { room, playerId } = createRoomState('L1', '나', { mode: 'single', personaId: 'caocao' });
  forceDeck(room, ['hanshil-chairman', 'gyeruk', 'maesil', 'jangsong-data', 'dongjak-tower']);
  const { bus } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(playerId)).toEqual({ ok: true });
  expect(room.round!.situation.text).toContain('한실그룹');

  expect(eng.debug(playerId, 'noAdopt')).toEqual({ ok: true });
  await waitUntil(() => room.phase === 'RESULT');
  // 판의 결말이 다음 상황을 확정 연결했다.
  expect(room.nextLink?.to).toBe('boncho-ultimatum');
  eng.debug(playerId, 'next');
  expect(room.round!.situation.text).toContain('최후통첩');
  // 링크 전환의 브릿지는 저작된 lead가 기본값 (AI 없는 mock 환경에서도 연결 유지).
  expect(room.round!.bridge).toContain('본색');
  // 링크로 나온 상황은 출현 기록에 남는다.
  expect(room.playedIds).toContain('boncho-ultimatum');
});

test('분기 링크(branch): mock 판정은 첫 노선 — 여포를 들이면 인질극이 온다', async () => {
  const { room, playerId } = createRoomState('L2', '나', { mode: 'single', personaId: 'caocao' });
  forceDeck(room, ['yeopo-apply', 'gyeruk', 'maesil', 'jangsong-data', 'dongjak-tower']);
  const { bus } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(playerId)).toEqual({ ok: true });
  expect(eng.proceed(playerId)).toEqual({ ok: true });
  await waitUntil(
    () => room.phase === 'PLAYER_TURNS' && room.round!.queue[room.round!.turnIdx]?.kind === 'user',
  );
  eng.handleSpeak(playerId, '여포는 뽑아야 합니다. 실력이 전부입니다.');
  await waitUntil(() => room.phase === 'RESULT');
  // mock 판정의 노선 분류 폴백 = 첫 키(hire) → 인질극 상황으로 확정 연결.
  expect(room.nextLink?.to).toBe('yeopo-stock-demand');
  eng.debug(playerId, 'next');
  expect(room.round!.situation.text).toContain('스톡옵션');
});

test('링크로 이미 나온 상황은 덱에서 건너뛴다 · 랜덤 덱엔 linkedOnly가 없다', async () => {
  const persona = getPersona('caocao')!;
  // 새 방의 랜덤 덱은 linkedOnly 제외.
  const { room, playerId } = createRoomState('L3', '나', { mode: 'single', personaId: 'caocao' });
  const linkedOnlyIdx = new Set(persona.situations.map((s, i) => (s.linkedOnly ? i : -1)).filter((i) => i >= 0));
  expect(linkedOnlyIdx.size).toBeGreaterThan(0);
  expect(room.situationOrder!.some((i) => linkedOnlyIdx.has(i))).toBe(false);

  // 덱 2번째(resume-folder)가 1라운드(heoyu)의 링크로 먼저 등장하면, 덱 차례에서 건너뛴다.
  forceDeck(room, ['heoyu', 'resume-folder', 'gyeruk', 'maesil', 'dongjak-tower']);
  const { bus } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(playerId)).toEqual({ ok: true });

  const play = async () => {
    await waitUntil(() => ['SITUATION', 'PLAYER_TURNS', 'JUDGING'].includes(room.phase ?? ''));
    expect(eng.debug(playerId, 'noAdopt')).toEqual({ ok: true });
    await waitUntil(() => room.phase === 'RESULT');
    eng.debug(playerId, 'next');
  };
  await play(); // R1 heoyu → 링크 resume-folder
  expect(room.round!.situation.text).toContain('이력서');
  await play(); // R2 resume-folder → 링크 boncho-heirs
  expect(room.round!.situation.text).toContain('소송전');
  await play(); // R3 boncho-heirs (링크 없음) → 덱: resume-folder는 이미 나왔으니 건너뛰고 gyeruk
  expect(room.round!.situation.text).toContain('계륵');
});

test('리매치: 덱·출현 기록·링크·스토리 기록이 초기화된다', async () => {
  const { room, playerId } = createRoomState('L4', '나', { mode: 'single', personaId: 'caocao', maxRounds: 5 });
  forceDeck(room, ['gyeruk', 'maesil', 'dongjak-tower', 'security-app', 'yeonpanjang']);
  const { bus } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(playerId)).toEqual({ ok: true });
  for (let r = 1; r <= 5; r++) {
    await waitUntil(() => ['SITUATION', 'PLAYER_TURNS', 'JUDGING'].includes(room.phase ?? ''));
    expect(eng.debug(playerId, 'noAdopt')).toEqual({ ok: true });
    await waitUntil(() => room.phase === 'RESULT');
    eng.debug(playerId, 'next');
  }
  expect(room.state).toBe('ENDED');
  expect(room.scenarioHistory!.length).toBe(5);

  expect(eng.rematch(playerId)).toEqual({ ok: true }); // 싱글은 즉시 재시작
  expect(room.roundNo).toBe(1);
  expect(room.playedIds!.length).toBe(1); // 새 1라운드 상황만
  expect(room.nextLink).toBeNull();
  expect(room.scenarioHistory).toEqual([]);
});
