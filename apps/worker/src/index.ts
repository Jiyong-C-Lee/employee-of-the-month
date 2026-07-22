import { Hono } from 'hono';
import { listPersonas } from '@eotm/content';
import type { Env } from './env';
import type { HealthRes } from '@eotm/shared';
export { RoomDO } from './room-do';
export { QuotaDO } from './quota-do';

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

// /api/rooms* 라우팅은 Task 10에서 추가. 그 외는 정적 SPA (Workers Assets가 처리)
export default app;
