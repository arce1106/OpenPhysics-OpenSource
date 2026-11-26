export interface RecordingPreset {
  id: 'landscape' | 'portrait';
  width: number;
  height: number;
  framesPerSecond: number;
  query: string;
}

export const recordingPresets: RecordingPreset[] = [
  {
    id: 'landscape',
    width: 1920,
    height: 1080,
    framesPerSecond: 30,
    query: '?mode=recording&format=landscape',
  },
  {
    id: 'portrait',
    width: 1080,
    height: 1920,
    framesPerSecond: 30,
    query: '?mode=recording&format=portrait',
  },
];

export function recordingUrl(baseUrl: string, preset: RecordingPreset): string {
  return new URL(preset.query, baseUrl).toString();
}
