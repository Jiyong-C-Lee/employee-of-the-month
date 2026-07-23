import { Hono } from 'hono';
import { listPersonas, STRINGS } from '@eotm/content';
import { generatePersona, personaGenInputSchema } from './ai/persona-gen';
import { logger } from './log';
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

const PERSONA_GEN_LIMIT = 5;
const PERSONA_GEN_TTL_MS = 24 * 60 * 60 * 1000;

// POST /api/personas/generate — 커스텀 페르소나 AI 생성. IP당 일 5회.
app.post('/api/personas/generate', async (c) => {
  const ip = c.req.header('cf-connecting-ip');
  // 프로덕션은 Cloudflare가 cf-connecting-ip를 항상 채운다 — 헤더가 없으면 로컬 dev이므로 쿼터 면제.
  if (ip) {
    const quota = c.env.QUOTA_DO.get(c.env.QUOTA_DO.idFromName('global'));
    const rl = await quota
      .fetch('http://do/incr', {
        method: 'POST',
        body: JSON.stringify({ key: `persona-gen:${ip}`, limit: PERSONA_GEN_LIMIT, ttlMs: PERSONA_GEN_TTL_MS }),
      })
      .then((r) => r.json() as Promise<{ ok: boolean }>);
    if (!rl.ok) return c.json({ error: STRINGS.errors.personaGenQuota }, 429);
  }

  const parsed = personaGenInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: STRINGS.errors.personaBadInput }, 400);
  try {
    const persona = await generatePersona(c.env, parsed.data);
    const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
    logger.personaGenerated({ id, input: parsed.data, persona });
    return c.json({ ok: true, persona: { id, ...persona } });
  } catch {
    return c.json({ error: STRINGS.errors.personaGenFail }, 502);
  }
});

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
  const action = c.req.param('action');
  // /create는 정규 생성 플로우(POST /api/rooms, rate limit)로만 도달해야 한다 — 캐치올 우회 차단(I3).
  if (action === 'create') return c.json({ error: STRINGS.errors.noRoom }, 404);
  const code = c.req.param('code').toUpperCase();
  const room = c.env.ROOM_DO.get(c.env.ROOM_DO.idFromName(code));
  const url = new URL(c.req.raw.url);
  return room.fetch(`http://do/${action}${url.search}`, c.req.raw);
});

// 그 외는 정적 SPA (Workers Assets가 처리)
export default app;
