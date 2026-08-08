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
    alias: {
      '@shared': fileURLToPath(new URL('../shared/index.ts', import.meta.url)),
      '@content': fileURLToPath(new URL('../content/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787' } },
  },
});
