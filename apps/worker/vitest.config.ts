import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        // 테스트는 항상 mock AI 경로만 탄다 — .dev.vars의 실제 키가 흘러들면
        // 진짜 Gemini 호출로 쿼터를 태우고, 테스트 종료 후 응답이 도착해 격리 스토리지 오류를 낸다.
        miniflare: {
          bindings: {
            GOOGLE_AI_STUDIO_FREE_API_KEY: '',
            GOOGLE_AI_STUDIO_API_KEY: '',
            NVIDIA_API_KEY: '',
          },
        },
      },
    },
  },
});
