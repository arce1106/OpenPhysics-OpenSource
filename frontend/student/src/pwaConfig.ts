import type { ManifestOptions } from 'vite-plugin-pwa';

export type StudentRuntimeCaching = {
  urlPattern: RegExp;
  handler: 'NetworkFirst';
  options: {
    cacheName: string;
    expiration: {
      maxEntries: number;
      maxAgeSeconds: number;
    };
  };
};

export const studentPwaManifest: Partial<ManifestOptions> = {
  id: '/',
  name: 'OpenPhysics - 物理学习',
  short_name: '物理学习',
  description: '物理自适应学习系统',
  theme_color: '#1a1d23',
  background_color: '#f4f1ea',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui', 'browser'],
  orientation: 'any',
  lang: 'zh-CN',
  dir: 'ltr',
  scope: '/',
  start_url: '/',
  categories: ['education'],
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

export const workboxNavigateFallbackDenylist: RegExp[] = [
  // Scanned/pasted APK links are navigations too: they must reach the download
  // server instead of receiving the cached student app shell.
  /^\/downloads(?:\/|\?|$)/i,
  /^\/admin(?:\/.*)?$/i,
  // These independent apps share this origin, but never the student app shell.
  /^\/teacher(?:\/|\?|$)/i,
  /^\/panes(?:\/.*)?$/i,
  /^\/question-pane(?:\/.*)?$/i,
  /^\/support\.html(?:\?.*)?$/i,
];

// Current iPad, Android and desktop targets all support WOFF2. Keep WOFF/TTF
// files in the production build as browser fallbacks, but do not add those
// legacy copies to every student's offline cache.
export const studentPwaPrecacheGlobPatterns = [
  '**/*.{js,css,html,ico,png,svg,woff2}',
];

// Authenticated learning data must never enter a shared service-worker cache.
export const workboxRuntimeCaching: StudentRuntimeCaching[] = [];
