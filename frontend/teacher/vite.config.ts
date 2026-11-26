import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // frontend/shared has no node_modules of its own; its KaTeX import resolves here.
    alias: { katex: fileURLToPath(new URL('./node_modules/katex', import.meta.url)) },
  },
  server: {
    host: '0.0.0.0',
    port: 5176,
    allowedHosts: ['teacher-frontend'],
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/static': { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
    globals: true,
    exclude: [...configDefaults.exclude],
  },
});
