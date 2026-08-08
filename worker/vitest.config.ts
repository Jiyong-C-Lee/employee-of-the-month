// 워커 테스트 — Workers 런타임(@cloudflare/vitest-pool-workers)에서 돈다.
// 원본 apps/worker/vitest.config.ts 이식. wrangler.jsonc 경로만 게임 루트로 바뀌었다.
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { fileURLToPath } from 'node:url';

export default defineWorkersConfig({
  test: {
    name: 'worker',
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: '../wrangler.jsonc' },
        // 테스트는 항상 mock AI 경로만 탄다 — .dev.vars의 실제 키가 흘러들면
        // 진짜 Gemini 호출로 쿼터를 태우고, 테스트 종료 후 응답이 도착해 격리 스토리지 오류를 낸다.
        miniflare: {
          bindings: {
            GOOGLE_AI_STUDIO_FREE_API_KEY: '',
            GOOGLE_AI_STUDIO_API_KEY: '',
            NVIDIA_API_KEY: '',
            // 연출 지연을 끈다. 참모 발언 사이 텀(speechGapMs, 최대 7초)을 실제로 기다리면
            // room-do·e2e 테스트만 36초를 먹는다. 게임 로직은 그대로 돌고 대기만 사라진다.
            DELAY_SCALE: '0',
          },
        },
      },
    },
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/index.ts', import.meta.url)),
      '@content': fileURLToPath(new URL('../content/index.ts', import.meta.url)),
    },
  },
});
