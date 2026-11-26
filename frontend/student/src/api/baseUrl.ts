const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL || '';

interface RuntimeApiOriginContext {
  isCapacitor: boolean;
  hostname: string;
}

export function resolveApiOriginForRuntime(
  configuredOrigin: string,
  runtime: RuntimeApiOriginContext,
): string {
  const normalizedConfiguredOrigin = configuredOrigin.replace(/\/+$/, '');
  if (normalizedConfiguredOrigin) return normalizedConfiguredOrigin;
  if (runtime.isCapacitor && runtime.hostname === '10.0.2.2') {
    return 'http://10.0.2.2:8000';
  }
  return '';
}

export const API_ORIGIN = resolveApiOriginForRuntime(configuredApiOrigin, {
  isCapacitor: typeof window !== 'undefined' && typeof window.Capacitor !== 'undefined',
  hostname: typeof window !== 'undefined' ? window.location.hostname : '',
});
export const STUDENT_API_BASE = `${API_ORIGIN}/api/student`;

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${STUDENT_API_BASE}${normalizedPath}`;
}

export function buildStudentApiUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(apiUrl(path), window.location.origin);
  if (params) {
    Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return url.toString();
}

export function resolveAssetUrl(url?: string | null): string {
  if (!url) return '';
  if (!API_ORIGIN || /^[a-z][a-z\d+\-.]*:/i.test(url)) return url;
  return url.startsWith('/') ? `${API_ORIGIN}${url}` : url;
}
