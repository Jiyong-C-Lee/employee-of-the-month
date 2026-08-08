import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 게임 루트가 아니라 web/ 아래에 있는 설정이라 root를 명시한다.
// 별칭은 tsconfig의 paths와 짝을 이룬다 — tsconfig는 타입만, Vite는 번들만 본다.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@shared', replacement: fileURLToPath(new URL('../shared/index.ts', import.meta.url)) },
      // 접두 별칭이 먼저 와야 한다 — 정확 일치(@content)보다 뒤에 두면 '@content/ui'가 안 잡힌다.
      // 웹은 '@content/ui'만 쓴다. 인덱스(@content)를 물면 packs.gen이 번들에 실려 상황이 샌다.
      { find: /^@content\//, replacement: `${fileURLToPath(new URL('../content/', import.meta.url))}` },
      { find: '@content', replacement: fileURLToPath(new URL('../content/index.ts', import.meta.url)) },
    ],
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787' } },
  },
});
