import { test, expect } from 'vitest';
import { runInDurableObject } from 'cloudflare:test';
import type { ServerEvent } from '@eotm/shared';
import { stub, post, readUntil } from './helpers';

test('생성→SSE 스냅샷→발언→판정 이벤트가 스트림에 흐른다 (싱글, mock AI)', async () => {
  const s = stub('TEST1');
  const create = await post(s, '/create', {
    code: 'TEST1', nick: '나', config: { mode: 'single', personaId: 'caocao' },
  });
  expect(create.status).toBe(200);
  const { playerId, token } = create.body as { playerId: string; token: string };

  const res = await s.fetch(`http://do/events?playerId=${playerId}&token=${token}`);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain('"kind":"snapshot"');

  // 내 순번이 될 때까지 이벤트 소비 → 발언 → verdict feed 수신 확인.
  await readUntil(reader, (ev) => ev.kind === 'turn' && ev.turn?.current === playerId);
  const spoke = await post(s, '/speak', { playerId, token, text: '제 생각은 이렇습니다.' });
  expect(spoke.status).toBe(200);

  const { ev } = await readUntil(
    reader,
    (e) => e.kind === 'feed' && (e as Extract<ServerEvent, { kind: 'feed' }>).item.type === 'verdict',
  );
  expect(ev.kind).toBe('feed');
  await reader.cancel();
}, 40000);

test('중복 생성은 409, 잘못된 토큰은 401', async () => {
  const s = stub('TEST2');
  await post(s, '/create', { code: 'TEST2', nick: '나', config: { mode: 'single', personaId: 'liubei' } });
  expect((await post(s, '/create', { code: 'TEST2', nick: '또', config: { mode: 'single', personaId: 'liubei' } })).status).toBe(409);
  expect((await post(s, '/speak', { playerId: 'x', token: 'y', text: 'ㅎ' })).status).toBe(401);
});

test('스냅샷은 캐시가 아니라 room 상태에서 speakTurn을 재구성한다 — 재접속 시 사람 턴 입력창 복구 (C1)', async () => {
  const s = stub('TESTC1');
  const create = await post(s, '/create', {
    code: 'TESTC1', nick: '나', config: { mode: 'single', personaId: 'caocao' },
  });
  const { playerId, token } = create.body as { playerId: string; token: string };

  // 첫 접속으로 내 순번까지 진행시킨다.
  const res1 = await s.fetch(`http://do/events?playerId=${playerId}&token=${token}`);
  const r1 = res1.body!.getReader();
  await readUntil(r1, (ev) => ev.kind === 'turn' && ev.turn?.current === playerId);
  await r1.cancel();

  // 재접속 스냅샷 — lastTurn 캐시가 제거됐으므로 speakTurn은 room 상태에서 재구성돼야 한다(재기동 안전).
  const res2 = await s.fetch(`http://do/events?playerId=${playerId}&token=${token}`);
  const r2 = res2.body!.getReader();
  const { ev } = await readUntil(r2, (e) => e.kind === 'snapshot');
  const snap = ev as Extract<ServerEvent, { kind: 'snapshot' }>;
  expect(snap.speakTurn?.current).toBe(playerId);
  expect(snap.speakTurn?.speakTime).toBe(0); // 싱글 무제한
  await r2.cancel();
}, 40000);

test('멀티 입력 창: 일부만 제출해도 공용 마감 알람이 유지된다 (I1)', async () => {
  const s = stub('TESTI1');
  const create = await post(s, '/create', {
    code: 'TESTI1', nick: '호스트', config: { mode: 'multi', personaId: 'caocao', maxPlayers: 2, speakTime: 60 },
  });
  const { playerId: hostId, token: hostTok } = create.body as { playerId: string; token: string };
  await post(s, '/join', { nick: '게스트' });
  expect((await post(s, '/start', { playerId: hostId, token: hostTok })).status).toBe(200);

  const res = await s.fetch(`http://do/events?playerId=${hostId}&token=${hostTok}`);
  const reader = res.body!.getReader();
  // 입력 창이 열리면 전원 공용 타이머(입력 마감)가 흐른다.
  await readUntil(reader, (ev) => ev.kind === 'timer' && ev.timer !== null);
  expect((await post(s, '/speak', { playerId: hostId, token: hostTok, text: '호스트 의견' })).status).toBe(200);
  // 제출 인원 갱신이 방 상태로 흐른다 (본문은 공개 전 비밀).
  await readUntil(reader, (ev) => ev.kind === 'room' && Boolean(ev.room?.round?.submitted?.includes(hostId)));
  await reader.cancel();

  // 게스트가 아직 미제출 — 입력 창 마감 알람은 그대로 살아 있어야 한다.
  await runInDurableObject(s, async (_instance, state) => {
    const tag = await state.storage.get<string>('alarmTag');
    expect(tag?.startsWith('inputWindow:')).toBe(true);
    expect(await state.storage.getAlarm()).toBeTruthy();
  });
}, 40000);

test('debug 액션은 DEBUG_ACTIONS 설정 시에만 허용된다 (I4)', async () => {
  const s = stub('TESTDBG');
  const create = await post(s, '/create', {
    code: 'TESTDBG', nick: '나', config: { mode: 'single', personaId: 'caocao' },
  });
  const { playerId, token } = create.body as { playerId: string; token: string };

  // 미설정 — 404로 차단. 로컬 .dev.vars에 DEBUG_ACTIONS가 켜져 있어도 테스트는 명시적으로 끄고 검증한다.
  const blocked = await runInDurableObject(s, async (instance) => {
    const inst = instance as unknown as { env: Record<string, string | undefined>; fetch: (r: Request) => Promise<Response> };
    inst.env = { ...inst.env, DEBUG_ACTIONS: undefined };
    const res = await inst.fetch(new Request('http://do/debug', {
      method: 'POST',
      body: JSON.stringify({ playerId, token, action: 'adoptMe' }),
    }));
    await res.json(); // Windows teardown 이슈 — body 소비
    return res.status;
  });
  expect(blocked).toBe(404);

  // DO 인스턴스 env에 DEBUG_ACTIONS 주입 후에만 허용 (프로덕션에선 미설정=비활성).
  const status = await runInDurableObject(s, async (instance) => {
    const inst = instance as unknown as { env: Record<string, string>; fetch: (r: Request) => Promise<Response> };
    inst.env = { ...inst.env, DEBUG_ACTIONS: 'true' };
    const res = await inst.fetch(new Request('http://do/debug', {
      method: 'POST',
      body: JSON.stringify({ playerId, token, action: 'adoptMe' }),
    }));
    await res.json(); // Windows teardown 이슈 — body 소비
    return res.status;
  });
  expect(status).toBe(200);
});
