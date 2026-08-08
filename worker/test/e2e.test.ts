// 외부 REST 표면 E2E — SELF.fetch로 실제 HTTP 왕복만 사용한다 (내부 DO API 직접 호출 금지).
import { test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import type { ServerEvent } from '@shared';
import { readUntil } from './helpers';

// 테스트별로 다른 IP를 줘서 rate limit 카운터가 서로 간섭하지 않게 한다.
// SSE 응답을 제외한 모든 응답 body는 여기서 소비한다 — 미소비 body는 워커 격리 스토리지의
// 테스트 간 정리(teardown)를 방해해 SQLite 파일 잠금(EBUSY)을 유발할 수 있다(테스트/helpers.ts의
// post() 헬퍼와 동일한 이유).
async function api(path: string, opts: { body?: object; ip?: string } = {}) {
  const { body, ip } = opts;
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (ip) headers['cf-connecting-ip'] = ip;
  const res = await SELF.fetch(`http://x/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) return { status: res.status, res, json: null };
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, res, json };
}

test('E2E: 방 생성 → SSE 구독 → 발언 → 판정 수신 (mock AI)', async () => {
  const { status: createStatus, json: createBody } = await api('/rooms', {
    body: { nick: '테스터', config: { mode: 'single', personaId: 'caocao' } },
    ip: 'e2e-single',
  });
  expect(createStatus).toBe(200);
  const { code, playerId, token } = createBody as unknown as { code: string; playerId: string; token: string };
  expect(code).toMatch(/^[A-Z2-9]{4}$/);

  const { res: sse } = await api(`/rooms/${code}/events?playerId=${playerId}&token=${token}`, { ip: 'e2e-single' });
  expect(sse.status).toBe(200);
  expect(sse.headers.get('content-type')).toContain('text/event-stream');

  const reader = sse.body!.getReader();
  // 접속 즉시 스냅샷이 먼저 온다.
  await readUntil(reader, (ev) => ev.kind === 'snapshot');
  // 상황 확인 대기 — 방장이 proceed해야 참모 발언이 시작된다.
  const { status: proceedStatus } = await api(`/rooms/${code}/proceed`, {
    body: { playerId, token },
    ip: 'e2e-single',
  });
  expect(proceedStatus).toBe(200);
  // 내 순번이 될 때까지 대기 → 발언 → verdict feed 대기.
  await readUntil(reader, (ev) => ev.kind === 'turn' && ev.turn?.current === playerId);

  const { status: speakStatus } = await api(`/rooms/${code}/speak`, {
    body: { playerId, token, text: '제 생각은 이렇습니다.' },
    ip: 'e2e-single',
  });
  expect(speakStatus).toBe(200);

  const { ev } = await readUntil(
    reader,
    (e) => e.kind === 'feed' && (e as Extract<ServerEvent, { kind: 'feed' }>).item.type === 'verdict',
  );
  expect(ev.kind).toBe('feed');
  await reader.cancel();
}, 40000);

test('방 생성 rate limit: 같은 IP 연속 생성 제한(분당 5)', async () => {
  // multi 모드는 생성 시 자동 시작하지 않아 불필요한 AI 턴 처리 없이 rate limit 카운트만 확인한다.
  const mk = () => api('/rooms', { body: { nick: 'x', config: { mode: 'multi', personaId: 'liubei' } }, ip: 'e2e-ratelimit' });
  for (let i = 0; i < 5; i++) expect((await mk()).status).toBe(200);
  expect((await mk()).status).toBe(429);
});

test('존재하지 않는 방 join은 404', async () => {
  expect((await api('/rooms/ZZZZ/join', { body: { nick: 'x' }, ip: 'e2e-notfound' })).status).toBe(404);
});

test('캐치올로 /create 직접 호출은 404 — rate limit 우회 차단 (I3)', async () => {
  const r = await api('/rooms/ABCD/create', {
    body: { code: 'ABCD', nick: 'x', config: { mode: 'single', personaId: 'caocao' } },
    ip: 'e2e-i3',
  });
  expect(r.status).toBe(404);
});
