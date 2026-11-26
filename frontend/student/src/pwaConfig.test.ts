import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  studentPwaManifest,
  studentPwaPrecacheGlobPatterns,
  workboxNavigateFallbackDenylist,
  workboxRuntimeCaching,
} from './pwaConfig';

describe('student PWA shell config', () => {
  it('keeps iOS home-screen metadata aligned with the student web app', () => {
    expect(studentPwaManifest.name).toBe('OpenPhysics - 物理学习');
    expect(studentPwaManifest.short_name).toBe('物理学习');
    expect(studentPwaManifest.display).toBe('standalone');
    expect(studentPwaManifest.orientation).toBe('any');
    expect(studentPwaManifest.start_url).toBe('/');
    expect(studentPwaManifest.scope).toBe('/');
    expect(studentPwaManifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }),
        expect.objectContaining({ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }),
        expect.objectContaining({ src: '/icon-512.png', sizes: '512x512', purpose: 'maskable' }),
      ]),
    );
  });

  it('does not cache authenticated API responses in the shared service worker', () => {
    const apiCache = workboxRuntimeCaching.find((entry) => String(entry.urlPattern).includes('/api'));

    expect(apiCache).toBeUndefined();
  });

  it('precaches the modern math-font format without legacy duplicate copies', () => {
    expect(studentPwaPrecacheGlobPatterns).toEqual([
      '**/*.{js,css,html,ico,png,svg,woff2}',
    ]);
    expect(studentPwaPrecacheGlobPatterns.join(',')).not.toMatch(/(?:^|[,{])woff(?:[,}])/);
    expect(studentPwaPrecacheGlobPatterns.join(',')).not.toMatch(/(?:^|[,{])ttf(?:[,}])/);
  });

  it('keeps admin, embedded and support pages out of the student PWA navigation fallback', () => {
    const denied = (path: string) => workboxNavigateFallbackDenylist.some(pattern => pattern.test(path));

    expect(denied('/admin')).toBe(true);
    expect(denied('/admin/')).toBe(true);
    expect(denied('/admin/assets/index.js')).toBe(true);
    expect(denied('/panes/learning-content/')).toBe(true);
    expect(denied('/panes/learning-content/assets/index.js')).toBe(true);
    expect(denied('/question-pane')).toBe(true);
    expect(denied('/support.html')).toBe(true);
    expect(denied('/support.html?from=app-store')).toBe(true);
    expect(denied('/sync')).toBe(false);
    expect(denied('/login')).toBe(false);
  });

  it('lets scanned and pasted Android download links reach the server', () => {
    const denied = (path: string) => workboxNavigateFallbackDenylist.some(pattern => pattern.test(path));

    for (const path of [
      '/downloads',
      '/downloads/',
      '/downloads/openphysics-android.apk',
      '/downloads/openphysics-android.apk?from=qr',
      '/downloads/android-latest.json',
      '/downloads/openphysics-android-download-qr.svg',
    ]) {
      expect(denied(path), path).toBe(true);
    }
    expect(denied('/login')).toBe(false);
    expect(denied('/sync')).toBe(false);
  });

  it('lets teacher navigations reach their own application after visiting the student app', () => {
    const denied = (path: string) => workboxNavigateFallbackDenylist.some(pattern => pattern.test(path));

    for (const path of [
      '/teacher', '/teacher/', '/teacher?from=student',
      '/teacher/classes/class-1', '/teacher/assignments/task-1?tab=students',
      '/TEACHER/',
    ]) {
      expect(denied(path), path).toBe(true);
    }
    for (const path of ['/teachership', '/login', '/learn', '/sync']) {
      expect(denied(path), path).toBe(false);
    }
  });

  it('declares iOS Safari home-screen tags without changing app markup', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="物理学习"');
    expect(html).toContain('rel="apple-touch-icon"');
  });

  it('keeps the app navbar clear of iPad standalone status bars', () => {
    const css = readFileSync(resolve(__dirname, './index.css'), 'utf8');

    expect(css).toContain(
      'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
    );
    const accountCss = readFileSync(resolve(__dirname, './components/StudentAccountMenu.css'), 'utf8');
    expect(accountCss).toContain('.navbar .student-account-trigger');
    expect(accountCss).toContain('background: transparent;');
    expect(accountCss).toContain('min-height: 44px;');
  });
});
