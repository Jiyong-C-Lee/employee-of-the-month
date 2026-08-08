// 테스트 전용 워커 엔트리 — wrangler.jsonc(테스트 전용)의 main이 가리키는 파일.
// 패키지 공개 API(src/index.ts)에 픽스처를 섞지 않으려고 여기서 재노출 + 픽스처 DO를
// 더한다. 실배포 워커는 src/index.ts만 import한다.
//
// default export는 Hono 미들웨어 테스트(SELF.fetch)가 때릴 앱이다. /mw 아래에만 붙인다.
import { Hono } from 'hono';
import { rateLimit, roomDelegate } from '../src/middleware';

export * from '../src/index';
export { TestDO } from './fixtures/test-do';

const app = new Hono();

app.use('/mw/ping', rateLimit({ binding: 'QUOTA_DO' }));
app.get('/mw/ping', (c) => c.json({ ok: true }));

app.all(
  '/mw/rooms/:code/:action',
  roomDelegate({
    binding: 'TEST_DO',
    roomIdFrom: (c) => c.req.param('code').toUpperCase(),
    // TestDO는 경로를 안 보고 본문의 action으로 분기한다 — 여기선 루트로 넘긴다.
    path: () => '/',
  }),
);

export default app;
