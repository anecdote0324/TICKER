import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 개발 중에는 /api와 /ws를 내장 서버(apps/server, 8787)로 넘겨요.
// changeOrigin으로 Host를 서버 주소로 바꿔야 서버의 Host 검사를 통과해요.
const target = `http://127.0.0.1:${process.env.BT_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/ws': { target: target.replace('http', 'ws'), ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
});
