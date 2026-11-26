const CANONICAL_KP_NAMES: Record<string, string> = {
  v1c1s3k02: '平均速度与瞬时速度',
  v1c1s2k01: '时刻与时间间隔',
  v1c2s3k02: '速度与位移的关系',
  v1c2s2k01: '速度与时间的关系',
  v1c1s1k02: '参考系',
};

export function canonicalKpName(kpId: string, currentName?: string | null) {
  if (currentName && currentName !== kpId) return currentName;
  return CANONICAL_KP_NAMES[kpId] || kpId;
}

export function replaceKnownKpIds(text: string) {
  return Object.entries(CANONICAL_KP_NAMES).reduce(
    (acc, [kpId, name]) => acc.split(kpId).join(name),
    text,
  );
}
