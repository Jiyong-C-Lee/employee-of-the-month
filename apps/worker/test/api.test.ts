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
