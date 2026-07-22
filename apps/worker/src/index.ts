import { Hono } from 'hono';
import { listPersonas, STRINGS } from '@eotm/content';
import { genCode } from './game/state';
import type { Env } from './env';
import type { HealthRes } from '@eotm/shared';
export { RoomDO } from './room-do';
export { QuotaDO } from './quota-do';

const ROOM_CREATE_LIMIT = 5;
const ROOM_CREATE_TTL_MS = 60_000;
const CODE_ALLOC_RETRIES = 5;

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => {
  const res: HealthRes = {
    ok: true,
    providers: { gemini: Boolean(c.env.GOOGLE_AI_STUDIO_API_KEY), nvidia: Boolean(c.env.NVIDIA_API_KEY) },
    models: { gemini: c.env.GEMINI_MODEL, nvidia: c.env.NVIDIA_MODEL },
  };
  return c.json(res);
});

app.get('/api/personas', (c) => c.json(listPersonas()));

// POST /api/rooms — 방 생성. IP당 분당 5회 rate limit (QuotaDO).
app.post('/api/rooms', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const quota = c.env.QUOTA_DO.get(c.env.QUOTA_DO.idFromName('global'));
  const rl = await quota
    .fetch('http://do/incr', {
      method: 'POST',
      body: JSON.stringify({ key: `room-create:${ip}`, limit: ROOM_CREATE_LIMIT, ttlMs: ROOM_CREATE_TTL_MS }),
    })
    .then((r) => r.json() as Promise<{ ok: boolean }>);
  if (!rl.ok) return c.json({ error: STRINGS.errors.rateLimited }, 429);

  const body = await c.req.json();
  // 코드 충돌 시 재시도 (DO /create가 409를 돌려준다).
  for (let i = 0; i < CODE_ALLOC_RETRIES; i++) {
    const code = genCode();
    const room = c.env.ROOM_DO.get(c.env.ROOM_DO.idFromName(code));
    const res = await room.fetch('http://do/create', { method: 'POST', body: JSON.stringify({ ...body, code }) });
    if (res.status !== 409) return new Response(res.body, res);
  }
  return c.json({ error: STRINGS.errors.codeAllocFail }, 503);
});

// /api/rooms/:code/* — RoomDO로 위임 (GET events 포함)
app.all('/api/rooms/:code/:action', (c) => {
  const code = c.req.param('code').toUpperCase();
  const room = c.env.ROOM_DO.get(c.env.ROOM_DO.idFromName(code));
  const url = new URL(c.req.raw.url);
  return room.fetch(`http://do/${c.req.param('action')}${url.search}`, c.req.raw);
});

// 그 외는 정적 SPA (Workers Assets가 처리)
export default app;
