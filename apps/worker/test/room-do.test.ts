import { test, expect } from 'vitest';
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
