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
    providers: {
      geminiFree: Boolean(c.env.GOOGLE_AI_STUDIO_FREE_API_KEY),
      gemini: Boolean(c.env.GOOGLE_AI_STUDIO_API_KEY),
      nvidia: Boolean(c.env.NVIDIA_API_KEY),
    },
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

// ---- 라운드 공유 링크 (KV, TTL 30일) ----

const SHARE_TTL_SECONDS = 30 * 24 * 60 * 60;
const SHARE_MAX_CHARS = 256_000; // 아바타 dataURL 포함 여유
const SHARE_CREATE_LIMIT = 30; // IP당 일 30회
const SHARE_CREATE_TTL_MS = 24 * 60 * 60 * 1000;

function shareId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

// 최소 구조 검증 — 렌더에 필요한 핵심 필드만 확인하고 나머지는 통과시킨다.
function isShareable(p: Record<string, unknown> | null): boolean {
  if (!p || typeof p !== 'object') return false;
  const persona = p.persona as Record<string, unknown> | undefined;
  if (!persona || typeof persona.name !== 'string' || !Array.isArray(persona.axes)) return false;
  if (typeof p.roundNo !== 'number') return false;
  if (p.kind === 'session') {
    // 세션 결과 공유 — 순위표·명예의 전당·종료 사유
    return Array.isArray(p.standings) && Array.isArray(p.hall) && typeof p.reason === 'string';
  }
  return Boolean(
    p.situation && Array.isArray(p.speeches) && Array.isArray(p.queue) &&
    p.verdict && Array.isArray((p.verdict as Record<string, unknown>).perSpeaker),
  );
}

app.post('/api/share', async (c) => {
  const ip = c.req.header('cf-connecting-ip');
  if (ip) {
    const quota = c.env.QUOTA_DO.get(c.env.QUOTA_DO.idFromName('global'));
    const rl = await quota
      .fetch('http://do/incr', {
        method: 'POST',
        body: JSON.stringify({ key: `share-create:${ip}`, limit: SHARE_CREATE_LIMIT, ttlMs: SHARE_CREATE_TTL_MS }),
      })
      .then((r) => r.json() as Promise<{ ok: boolean }>);
    if (!rl.ok) return c.json({ error: STRINGS.errors.rateLimited }, 429);
  }
  const raw = await c.req.text();
  if (raw.length > SHARE_MAX_CHARS) return c.json({ error: STRINGS.errors.shareTooBig }, 400);
  let payload: Record<string, unknown> | null = null;
  try { payload = JSON.parse(raw); } catch { /* isShareable이 거른다 */ }
  if (!isShareable(payload)) return c.json({ error: STRINGS.errors.shareInvalid }, 400);
  const id = shareId();
  await c.env.SHARE_KV.put(`s:${id}`, raw, { expirationTtl: SHARE_TTL_SECONDS });
  const url = new URL(c.req.url);
  return c.json({ ok: true, id, url: `${url.origin}/s/${id}` });
});

app.get('/api/share/:id', async (c) => {
  const raw = await c.env.SHARE_KV.get(`s:${c.req.param('id')}`);
  if (!raw) return c.json({ error: STRINGS.errors.shareNotFound }, 404);
  return c.body(raw, 200, { 'Content-Type': 'application/json' });
});

// 공유용 OG 카드 이미지 — 공유 생성 직후 클라이언트가 canvas로 그려 올린다 (1200×630 PNG).
const SHARE_OG_MAX_BYTES = 400_000;

app.put('/api/share/:id/og', async (c) => {
  const id = c.req.param('id');
  if (!(await c.env.SHARE_KV.get(`s:${id}`))) return c.json({ error: STRINGS.errors.shareNotFound }, 404);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > SHARE_OG_MAX_BYTES) {
    return c.json({ error: STRINGS.errors.shareTooBig }, 400);
  }
  await c.env.SHARE_KV.put(`og:${id}`, buf, { expirationTtl: SHARE_TTL_SECONDS });
  return c.json({ ok: true });
});

// GET /og/<id>.png — 공유별 OG 이미지. 없으면 기본 og.png로 리다이렉트 (스크래퍼는 리다이렉트를 따라간다).
app.get('/og/:file', async (c) => {
  const id = c.req.param('file').replace(/\.png$/, '');
  const buf = await c.env.SHARE_KV.get(`og:${id}`, 'arrayBuffer');
  if (!buf) return c.redirect('/og.png');
  return c.body(buf, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
});

// GET /s/:id — SPA 셸에 공유 라운드의 OG 메타를 주입해 서빙 (카톡·트위터 미리보기 카드).
app.get('/s/:id', async (c) => {
  const url = new URL(c.req.url);
  const shell = await c.env.ASSETS.fetch(new Request(`${url.origin}/index.html`));
  let html = await shell.text();
  if (!html) return c.redirect('/'); // 셸 확보 실패 — OG 없이라도 게임으로
  const id = c.req.param('id');
  const data = await c.env.SHARE_KV.get<{
    kind?: string; persona?: { name?: string }; roundNo?: number;
    adopted?: { name?: string } | null; standings?: { nick?: string; rank?: string }[];
  }>(`s:${id}`, 'json').catch(() => null);
  if (data?.persona?.name) {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const top = data.standings?.[0];
    const title = data.kind === 'session'
      ? esc(`${data.persona.name}의 회사에서 살아남기 — 이달의 우수사원`)
      : esc(`${data.persona.name}의 회의실 R.${data.roundNo} — 이달의 우수사원`);
    const desc = data.kind === 'session'
      ? esc(top?.nick ? `올해의 사원: ${top.nick} (${top.rank}). 당신도 승진에 도전해 보세요.` : '당신도 승진에 도전해 보세요.')
      : esc(data.adopted?.name ? `이번 라운드 채택: ${data.adopted.name}. 당신의 아부 실력도 시험해 보세요.` : '당신의 아부 실력도 시험해 보세요.');
    html = html
      .replace(/(property="og:title" content=")[^"]*(")/, `$1${title}$2`)
      .replace(/(property="og:description" content=")[^"]*(")/, `$1${desc}$2`)
      .replace(/(property="og:image" content=")[^"]*(")/, `$1${url.origin}/og/${esc(id)}.png$2`);
  }
  return c.html(html);
});

// ---- 익명 피드백 (KV 저장, 90일 보관) ----
// 확인: npx wrangler kv key list --namespace-id <SHARE_KV id> --prefix fb: / get으로 본문 조회.
// 로그(feedback 이벤트)로도 남아 Workers Logs에서 바로 보인다.

const FEEDBACK_TTL_SECONDS = 90 * 24 * 60 * 60;
const FEEDBACK_LIMIT = 5; // IP당 일 5건
const FEEDBACK_TTL_MS = 24 * 60 * 60 * 1000;

app.post('/api/feedback', async (c) => {
  const ip = c.req.header('cf-connecting-ip');
  if (ip) {
    const quota = c.env.QUOTA_DO.get(c.env.QUOTA_DO.idFromName('global'));
    const rl = await quota
      .fetch('http://do/incr', {
        method: 'POST',
        body: JSON.stringify({ key: `feedback:${ip}`, limit: FEEDBACK_LIMIT, ttlMs: FEEDBACK_TTL_MS }),
      })
      .then((r) => r.json() as Promise<{ ok: boolean }>);
    if (!rl.ok) return c.json({ error: STRINGS.errors.rateLimited }, 429);
  }
  const body = (await c.req.json().catch(() => null)) as { text?: unknown; contact?: unknown } | null;
  const text = String(body?.text ?? '').trim().slice(0, 1000);
  const contact = String(body?.contact ?? '').trim().slice(0, 100);
  if (text.length < 2) return c.json({ error: STRINGS.errors.feedbackEmpty }, 400);
  const entry = { text, contact, ts: Date.now(), ua: c.req.header('user-agent') ?? '' };
  await c.env.SHARE_KV.put(`fb:${new Date().toISOString()}-${crypto.randomUUID().slice(0, 6)}`, JSON.stringify(entry), {
    expirationTtl: FEEDBACK_TTL_SECONDS,
  });
  logger.feedback({ text, contact });
  return c.json({ ok: true });
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
