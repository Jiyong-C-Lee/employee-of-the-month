// QuotaDO 테스트 — IP 분당 rate limit(RL_PER_MIN) + 프로바이더별 일일 한도(LLM_DAILY_LIMIT_*).
// 테스트용 wrangler.jsonc에서 RL_PER_MIN=2, LLM_DAILY_LIMIT_GEMINI=1, LLM_DAILY_LIMIT_GEMINI_FREE=1,
// LLM_DAILY_LIMIT_NVIDIA=1로 고정. 일일 한도 키는 UTC 날짜가 스코프에 들어간다(`llm:${provider}:${day}`)
// — take()의 선택 인자 `now`로 날짜 경계를 넘겨 리셋을 검증한다(실호출은 항상 Date.now() 기본값).
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { memQuota } from '../src/quota-mem';

function stubFor(name: string) {
  return env.QUOTA_DO.get(env.QUOTA_DO.idFromName(name));
}

describe('QuotaDO', () => {
  it('분당 한도를 넘으면 false를 준다', async () => {
    const stub = stubFor('rate-limit-test');
    expect(await stub.rateLimit('1.2.3.4')).toBe(true);
    expect(await stub.rateLimit('1.2.3.4')).toBe(true);
    expect(await stub.rateLimit('1.2.3.4')).toBe(false); // RL_PER_MIN=2 → 3번째 거부
  });

  it('다른 IP는 서로의 분당 한도에 영향받지 않는다', async () => {
    const stub = stubFor('rate-limit-isolation');
    expect(await stub.rateLimit('1.1.1.1')).toBe(true);
    expect(await stub.rateLimit('1.1.1.1')).toBe(true);
    expect(await stub.rateLimit('1.1.1.1')).toBe(false);
    expect(await stub.rateLimit('2.2.2.2')).toBe(true); // 별개 키 — 영향 없음
  });

  it('프로바이더 일일 한도를 넘으면 해당 프로바이더만 막힌다', async () => {
    const stub = stubFor('daily-limit-test');
    expect(await stub.take('gemini')).toBe(true); // LLM_DAILY_LIMIT_GEMINI=1 → 1회는 허용
    expect(await stub.take('gemini')).toBe(false); // 2번째부터 거부
    expect(await stub.take('nvidia')).toBe(true); // 다른 프로바이더는 별개 카운터라 영향 없음
  });

  it('gemini-free(무료) 소진이 gemini(유료) 버킷을 막지 않는다 — 프로바이더명별 분리 카운터', async () => {
    const stub = stubFor('gemini-free-vs-paid-test');
    // LLM_DAILY_LIMIT_GEMINI_FREE=1 → 무료 버킷 소진
    expect(await stub.take('gemini-free')).toBe(true);
    expect(await stub.take('gemini-free')).toBe(false);
    // 유료는 별개 카운터(LLM_DAILY_LIMIT_GEMINI=1)라 무료 소진과 무관하게 그대로 사용 가능
    expect(await stub.take('gemini')).toBe(true);
  });

  it('UTC 날짜가 바뀌면 프로바이더 일일 버킷이 리셋된다', async () => {
    const stub = stubFor('daily-reset-test');
    const day1 = Date.UTC(2026, 0, 1, 23, 59, 0); // 2026-01-01 23:59 UTC
    const day2 = Date.UTC(2026, 0, 2, 0, 0, 30); // 2026-01-02 00:00:30 UTC — 날짜가 바뀜
    expect(await stub.take('gemini', day1)).toBe(true); // LLM_DAILY_LIMIT_GEMINI=1 → 1회는 허용
    expect(await stub.take('gemini', day1)).toBe(false); // 같은 날 2번째는 거부
    expect(await stub.take('gemini', day2)).toBe(true); // 날짜가 바뀌어 버킷이 새로 생겨 다시 허용
  });

  it('incr은 임의 key·limit·윈도로 카운트한다 — eotm의 IP 한도 4종을 담는 진입점', async () => {
    const stub = stubFor('incr-generic');
    expect(await stub.incr('share-create:1.2.3.4', 2, 60_000)).toEqual({ ok: true, count: 1 });
    expect(await stub.incr('share-create:1.2.3.4', 2, 60_000)).toEqual({ ok: true, count: 2 });
    expect(await stub.incr('share-create:1.2.3.4', 2, 60_000)).toEqual({ ok: false, count: 2 });
    // 키가 다르면 별개 카운터 — 같은 IP라도 용도별 한도가 서로 안 막는다.
    expect(await stub.incr('feedback:1.2.3.4', 2, 60_000)).toEqual({ ok: true, count: 1 });
  });

  it('rateLimit은 한도를 인자로 덮어쓸 수 있다', async () => {
    const stub = stubFor('rate-limit-args');
    // RL_PER_MIN=2지만 인자로 1을 주면 1회만 허용된다.
    expect(await stub.rateLimit('9.9.9.9', 1)).toBe(true);
    expect(await stub.rateLimit('9.9.9.9', 1)).toBe(false);
  });
});

describe('memQuota', () => {
  it('DO 없이 같은 계약을 만족한다', async () => {
    const q = memQuota({ gemini: 1 });
    expect(await q.incr('k', 2, 1000)).toEqual({ ok: true, count: 1 });
    expect(await q.incr('k', 2, 1000)).toEqual({ ok: true, count: 2 });
    expect(await q.incr('k', 2, 1000)).toEqual({ ok: false, count: 2 });
    expect(await q.take('gemini')).toBe(true);
    expect(await q.take('gemini')).toBe(false); // 한도 1 소진
    expect(await q.take('nvidia')).toBe(false); // limits에 없으면 한도 0 — 안전 측 폴백
    expect(await q.rateLimit('1.1.1.1', 1)).toBe(true);
    expect(await q.rateLimit('1.1.1.1', 1)).toBe(false);
  });
});
