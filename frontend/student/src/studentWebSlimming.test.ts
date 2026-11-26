import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = resolve(__dirname);
const projectRoot = resolve(srcRoot, '..');

describe('student web slimming contract', () => {
  it('does not keep the old standalone scratch paper path', () => {
    expect(existsSync(resolve(srcRoot, 'components/ScratchPaper.tsx'))).toBe(false);
    expect(existsSync(resolve(srcRoot, 'components/ScratchPaper.test.tsx'))).toBe(false);
  });

  it('does not keep handwriting trace UI styles', () => {
    const css = readFileSync(resolve(srcRoot, 'index.css'), 'utf8');

    expect(css).not.toContain('process-grading-trace');
    expect(css).not.toContain('review-process-trace');
  });

  it('does not keep the old Capacitor Android wrapper path', () => {
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
    const dependencies = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };

    expect(existsSync(resolve(projectRoot, 'capacitor.config.ts'))).toBe(false);
    expect(existsSync(resolve(projectRoot, 'android'))).toBe(false);
    expect(Object.keys(dependencies).some(name => name.startsWith('@capacitor/'))).toBe(false);
    expect(Object.keys(packageJson.scripts || {}).some(name => name.startsWith('cap:') || name === 'android:open')).toBe(false);

    const entry = readFileSync(resolve(srcRoot, 'main.tsx'), 'utf8');
    const css = readFileSync(resolve(srcRoot, 'index.css'), 'utf8');
    expect(entry).not.toContain('@capacitor/');
    expect(css).not.toContain('openphysics-native-shell');
  });
});
