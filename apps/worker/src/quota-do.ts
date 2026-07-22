// 범용 카운터 DO: LLM 일일 쿼터 + IP rate limit. key별 [count, expiresAt]를 storage에 유지.
import type { Env } from './env';

export class QuotaDO implements DurableObject {
  constructor(readonly ctx: DurableObjectState, readonly env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/incr') {
      const { key, limit, ttlMs } = (await req.json()) as { key: string; limit: number; ttlMs: number };
      const now = Date.now();
      const cur = (await this.ctx.storage.get<{ count: number; expiresAt: number }>(key)) ?? { count: 0, expiresAt: now + ttlMs };
      const fresh = cur.expiresAt <= now ? { count: 0, expiresAt: now + ttlMs } : cur;
      if (fresh.count >= limit) return Response.json({ ok: false, count: fresh.count });
      fresh.count += 1;
      await this.ctx.storage.put(key, fresh);
      return Response.json({ ok: true, count: fresh.count });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }
}
