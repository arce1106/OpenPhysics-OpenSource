import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import {
  studentPwaManifest,
  studentPwaPrecacheGlobPatterns,
  workboxNavigateFallbackDenylist,
  workboxRuntimeCaching,
} from './src/pwaConfig'

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8000';
const cacheDir = process.env.VITE_CACHE_DIR || undefined;

export default defineConfig(() => {
  return {
    cacheDir,
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: studentPwaManifest,
        workbox: {
          globPatterns: studentPwaPrecacheGlobPatterns,
          navigateFallbackDenylist: workboxNavigateFallbackDenylist,
          runtimeCaching: workboxRuntimeCaching,
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': apiTarget,
        '/static': apiTarget,
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router-dom/')) {
              return 'vendor-react';
            }
            if (id.includes('/katex/')) {
              return 'vendor-katex';
            }
            return undefined;
          },
        },
      },
    },
  };
})
