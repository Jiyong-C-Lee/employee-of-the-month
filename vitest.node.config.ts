// 콘텐츠·웹 테스트 — Workers 런타임이 필요 없는 순수 로직이다.
// (원본 packages/content와 apps/web의 기본 vitest 설정에 해당한다.)
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    name: 'node',
    include: ['content/test/**/*.test.ts', 'web/test/**/*.test.ts'],
  },
  // vite.config.ts와 같은 순서 규칙 — 접두 별칭이 정확 일치보다 먼저 와야 '@content/ui'가 잡힌다.
  resolve: {
    alias: [
      { find: '@shared', replacement: fileURLToPath(new URL('./shared/index.ts', import.meta.url)) },
      { find: /^@content\//, replacement: fileURLToPath(new URL('./content/', import.meta.url)) },
      { find: '@content', replacement: fileURLToPath(new URL('./content/index.ts', import.meta.url)) },
    ],
  },
});
