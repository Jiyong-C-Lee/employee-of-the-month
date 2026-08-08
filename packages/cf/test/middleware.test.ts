// Hono 미들웨어 계약 — IP rate limit 429·로컬 dev 면제·roomDelegate의 DO 위임.
// 테스트 앱은 test/worker.ts가 /mw 아래에 붙여 둔다.
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('rateLimit 미들웨어', () => {
  it('한도를 넘으면 429를 준다', async () => {
    const headers = { 'cf-connecting-ip': '5.5.5.5' };
    expect((await SELF.fetch('https://x/mw/ping', { headers })).status).toBe(200);
    expect((await SELF.fetch('https://x/mw/ping', { headers })).status).toBe(200);
    const third = await SELF.fetch('https://x/mw/ping', { headers });
    expect(third.status).toBe(429); // RL_PER_MIN=2
    expect(await third.json()).toEqual({ error: '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' });
  });

  it('cf-connecting-ip가 없으면 통과시킨다 — 로컬 dev 면제', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await SELF.fetch('https://x/mw/ping');
      expect(res.status).toBe(200);
      await res.json();
    }
  });
});

describe('roomDelegate', () => {
  it('경로 파라미터로 뽑은 room-id의 DO에 위임한다', async () => {
    const res = await SELF.fetch('https://x/mw/rooms/ABCD/save', {
      method: 'POST',
      body: JSON.stringify({ action: 'save', value: { room: 'ABCD' } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const back = await SELF.fetch('https://x/mw/rooms/ABCD/load', {
      method: 'POST',
      body: JSON.stringify({ action: 'load' }),
    });
    expect(await back.json()).toEqual({ value: { room: 'ABCD' } });
  });

  it('room-id가 다르면 다른 DO로 간다', async () => {
    const res = await SELF.fetch('https://x/mw/rooms/WXYZ/load', {
      method: 'POST',
      body: JSON.stringify({ action: 'load' }),
    });
    expect(await res.json()).toEqual({ value: null });
  });
});
