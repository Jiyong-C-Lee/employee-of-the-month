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
