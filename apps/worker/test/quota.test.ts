import { test, expect } from 'vitest';
import { env } from 'cloudflare:test';

async function incr(stub: DurableObjectStub, key: string, limit: number) {
  const res = await stub.fetch('http://do/incr', {
    method: 'POST',
    body: JSON.stringify({ key, limit, ttlMs: 60000 }),
  });
  return res.json() as Promise<{ ok: boolean; count: number }>;
}

test('한도 내 incr는 ok, 초과부터 거부', async () => {
  const stub = env.QUOTA_DO.get(env.QUOTA_DO.idFromName('test'));
  expect((await incr(stub, 'k', 2)).ok).toBe(true);
  expect((await incr(stub, 'k', 2)).ok).toBe(true);
  const third = await incr(stub, 'k', 2);
  expect(third.ok).toBe(false);
  expect(third.count).toBe(2);
});
