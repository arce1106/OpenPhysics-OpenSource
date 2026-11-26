// Textbook order and colours, matching the admin question bank (frontend/admin/src/common/labels.ts).

export const VOLUME_ORDER: Record<string, number> = {
  '必修 第一册': 1, '必修 第二册': 2, '必修 第三册': 3,
  '选择性必修 第一册': 4, '选择性必修 第二册': 5, '选择性必修 第三册': 6,
};

export const VOLUME_COLORS: Record<string, string> = {
  '必修 第一册': '#4C78A8', '必修 第二册': '#F58518', '必修 第三册': '#E45756',
  '选择性必修 第一册': '#72B7B2', '选择性必修 第二册': '#54A24B', '选择性必修 第三册': '#B279A2',
};

export const TIER_COLORS: Record<string, string> = {
  easy: '#52c41a', moderate_easy: '#73d13d', medium: '#faad14',
  moderate_hard: '#ff7a45', hard: '#ff4d4f',
};

const CHINESE_DIGITS = '一二三四五六七八九十';

/** Sort key for "第三章 …" style names; unknown names sort last, in text order. */
export function chapterRank(name: string): number {
  const match = /^第([一二三四五六七八九十]+)章/.exec(name);
  if (!match) return 99;
  const text = match[1];
  if (text === '十') return 10;
  if (text.startsWith('十')) return 10 + CHINESE_DIGITS.indexOf(text[1]) + 1;
  if (text.endsWith('十')) return (CHINESE_DIGITS.indexOf(text[0]) + 1) * 10;
  return CHINESE_DIGITS.indexOf(text[0]) + 1;
}

/** Sort key for "1.质点 参考系" style section names. */
export function sectionRank(name: string): number {
  const match = /^(\d+)/.exec(name);
  return match ? Number(match[1]) : 99;
}
