import { describe, expect, it } from 'vitest';
import { resolveApiOriginForRuntime } from './baseUrl';

describe('student API base URL resolution', () => {
  it('keeps browser development on the same-origin Vite proxy by default', () => {
    expect(resolveApiOriginForRuntime('', {
      isCapacitor: false,
      hostname: 'localhost',
    })).toBe('');
  });

  it('routes the local Capacitor WebView directly to the backend instead of Vite proxy', () => {
    expect(resolveApiOriginForRuntime('', {
      isCapacitor: true,
      hostname: '10.0.2.2',
    })).toBe('http://10.0.2.2:8000');
  });

  it('honors an explicit API origin over the Capacitor local fallback', () => {
    expect(resolveApiOriginForRuntime('https://openphysics.example/', {
      isCapacitor: true,
      hostname: '10.0.2.2',
    })).toBe('https://openphysics.example');
  });
});
