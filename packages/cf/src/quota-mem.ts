// 테스트용 인메모리 카운터. QuotaDO와 같은 계약을 만족해 게임 로직 테스트가 DO 없이 돈다.
import type { Quota } from './interfaces.js';

const RL_WINDOW_MS = 60_000;
const DAILY_WINDOW_MS = 86_400_000;
const DEFAULT_RL_PER_MIN = 30;

/** limits: 프로바이더별 일일 한도. 없는 프로바이더는 한도 0(전부 거부)으로 안전 측 폴백. */
export function memQuota(limits: Record<string, number> = {}): Quota {
  const counters = new Map<string, { count: number; expiresAt: number }>();

  const quota: Quota = {
    async incr(key: string, limit: number, ttlMs: number) {
      const now = Date.now();
      const cur = counters.get(key) ?? { count: 0, expiresAt: now + ttlMs };
      const fresh = cur.expiresAt <= now ? { count: 0, expiresAt: now + ttlMs } : cur;
      if (fresh.count >= limit) return { ok: false, count: fresh.count };
      fresh.count += 1;
      counters.set(key, fresh);
      return { ok: true, count: fresh.count };
    },

    async take(provider: string, now: number = Date.now()) {
      const day = new Date(now).toISOString().slice(0, 10); // UTC YYYY-MM-DD
      const { ok } = await quota.incr(`llm:${provider}:${day}`, limits[provider] ?? 0, DAILY_WINDOW_MS);
      return ok;
    },

    async rateLimit(ip: string, limit: number = DEFAULT_RL_PER_MIN, windowMs: number = RL_WINDOW_MS) {
      const { ok } = await quota.incr(`rl:${ip}`, limit, windowMs);
      return ok;
    },
  };

  return quota;
}
