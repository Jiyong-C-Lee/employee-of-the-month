import { test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

test('GET /api/health — 공급자 상태를 준다', async () => {
  const res = await SELF.fetch('http://x/api/health');
  expect(res.status).toBe(200);
  const body = await res.json() as { ok: boolean; providers: { gemini: boolean; nvidia: boolean } };
  expect(body.ok).toBe(true);
  expect(typeof body.providers.gemini).toBe('boolean');
});

test('GET /api/personas — 전 팩 요약, 상황 본문 없음', async () => {
  const res = await SELF.fetch('http://x/api/personas');
  const list = await res.json() as Record<string, unknown>[];
  expect(list.length).toBeGreaterThanOrEqual(2); // 팩 추가 시 테스트 수정 없이 통과
  expect(list[0]).not.toHaveProperty('situations');
  expect(list[0]).not.toHaveProperty('personaPrompt');
});

// ---- 라운드 공유 링크 ----
const SHARE_PAYLOAD = {
  roundNo: 1,
  persona: { id: 'caocao', name: '조조 회장', emoji: '🦁', intro: 'x', axes: ['실리', '기지', '체면'], ranks: ['사원'], advisors: [] },
  situation: { text: '상황', question: '어찌하면 좋겠는가?' },
  queue: [{ kind: 'user', key: 'p1', name: '나' }],
  speeches: [{ key: 'p1', name: '나', kind: 'user', text: '제 생각은 이렇습니다.' }],
  verdict: { perSpeaker: [{ key: 'p1', name: '나', kind: 'user', axisScores: { 실리: 5 }, total: 5, comment: '평' }], adoptedKey: 'p1', adoptReason: '사유', totals: { p1: 5 } },
  adopted: { key: 'p1', name: '나', kind: 'user' },
  standings: [],
  epilogue: '그 후 이야기',
  players: [],
};

test('POST /api/share → GET /api/share/:id 라운드트립', async () => {
  const res = await SELF.fetch('http://x/api/share', { method: 'POST', body: JSON.stringify(SHARE_PAYLOAD) });
  expect(res.status).toBe(200);
  const { id, url } = await res.json() as { id: string; url: string };
  expect(url).toContain(`/s/${id}`);
  const got = await SELF.fetch(`http://x/api/share/${id}`);
  expect(got.status).toBe(200);
  const back = await got.json() as typeof SHARE_PAYLOAD;
  expect(back.persona.name).toBe('조조 회장');
  expect(back.speeches[0]!.text).toBe('제 생각은 이렇습니다.');
});

test('공유: 구조 위반은 400, 없는 id는 404', async () => {
  const bad = await SELF.fetch('http://x/api/share', { method: 'POST', body: JSON.stringify({ hello: 1 }) });
  expect(bad.status).toBe(400);
  const missing = await SELF.fetch('http://x/api/share/zzzzzzzz');
  expect(missing.status).toBe(404);
});

test('세션 결과 공유 + OG 이미지 업로드·서빙', async () => {
  const sessionPayload = {
    kind: 'session', roundNo: 10,
    persona: SHARE_PAYLOAD.persona,
    players: [], standings: [{ id: 'p1', nick: '나', rank: '사장', favor: 6, connected: true }],
    hall: [{ roundNo: 1, key: 'p1', name: '나', kind: 'user' }],
    reason: '사장 승진으로 세션 종료',
  };
  const res = await SELF.fetch('http://x/api/share', { method: 'POST', body: JSON.stringify(sessionPayload) });
  expect(res.status).toBe(200);
  const { id } = await res.json() as { id: string };

  // OG PNG 업로드 → 서빙
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const put = await SELF.fetch(`http://x/api/share/${id}/og`, { method: 'PUT', body: png });
  expect(put.status).toBe(200);
  const img = await SELF.fetch(`http://x/og/${id}.png`);
  expect(img.status).toBe(200);
  expect(img.headers.get('content-type')).toBe('image/png');
  expect(new Uint8Array(await img.arrayBuffer()).length).toBe(png.length);

  // 없는 OG는 기본 이미지로 리다이렉트
  const missing = await SELF.fetch('http://x/og/zzzzzzzz.png', { redirect: 'manual' });
  expect([301, 302].includes(missing.status)).toBe(true);
});

test('익명 피드백: 저장 200, 빈 내용 400', async () => {
  const ok = await SELF.fetch('http://x/api/feedback', { method: 'POST', body: JSON.stringify({ text: '참모가 너무 웃겨요' }) });
  expect(ok.status).toBe(200);
  const empty = await SELF.fetch('http://x/api/feedback', { method: 'POST', body: JSON.stringify({ text: ' ' }) });
  expect(empty.status).toBe(400);
});
