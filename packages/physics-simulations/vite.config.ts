import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(__dirname, 'gallery'),
  plugins: [react()],
  server: {
    port: 5180,
    fs: {
      allow: [resolve(__dirname)],
    },
  },
  preview: {
    port: 4180,
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: [resolve(__dirname, 'tests/**/*.test.ts')],
  },
});
