import { afterEach, describe, expect, it } from 'vitest';
import { shouldHideStudentWebNav } from './capacitorShell';

describe('Capacitor student shell routing', () => {
  afterEach(() => {
    delete window.Capacitor;
  });

  it('keeps browser routes on the normal web shell', () => {
    expect(shouldHideStudentWebNav('/sync')).toBe(false);
    expect(shouldHideStudentWebNav('/learn/check?kp=kp-1')).toBe(false);
    expect(shouldHideStudentWebNav('/history')).toBe(false);
  });

  it('uses the app shell for the main authenticated student routes in Capacitor', () => {
    window.Capacitor = { Plugins: {} };

    expect(shouldHideStudentWebNav('/')).toBe(true);
    expect(shouldHideStudentWebNav('/sync')).toBe(true);
    expect(shouldHideStudentWebNav('/directory')).toBe(true);
    expect(shouldHideStudentWebNav('/learn/check?kp=kp-1')).toBe(true);
    expect(shouldHideStudentWebNav('/train')).toBe(true);
    expect(shouldHideStudentWebNav('/review')).toBe(true);
    expect(shouldHideStudentWebNav('/history')).toBe(true);
  });

  it('keeps public and embedded pane routes outside the Capacitor app shell', () => {
    window.Capacitor = { Plugins: {} };

    expect(shouldHideStudentWebNav('/login')).toBe(false);
    expect(shouldHideStudentWebNav('/register')).toBe(false);
    expect(shouldHideStudentWebNav('/legal/privacy')).toBe(false);
    expect(shouldHideStudentWebNav('/legal/terms')).toBe(false);
    expect(shouldHideStudentWebNav('/legal/minors')).toBe(false);
    expect(shouldHideStudentWebNav('/login')).toBe(false);
    expect(shouldHideStudentWebNav('/question-pane')).toBe(false);
  });
});
