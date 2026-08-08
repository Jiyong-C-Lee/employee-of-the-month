// 콘텐츠·웹 테스트 — Workers 런타임이 필요 없는 순수 로직이다.
// (원본 packages/content와 apps/web의 기본 vitest 설정에 해당한다.)
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    name: 'node',
    include: ['content/test/**/*.test.ts', 'web/test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared/index.ts', import.meta.url)),
      '@content': fileURLToPath(new URL('./content/index.ts', import.meta.url)),
    },
  },
});
