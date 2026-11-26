import { expect, test } from 'vitest';
import { buildCatalog, scopeFromPicks, scopeLabel } from './ScopePicker';

const kp = (id: string, volume: string, chapter: string, section: string | null) =>
  ({ id, name: id, volume, chapter, section });

const catalog = buildCatalog([
  kp('a', '必修 第一册', '第一章 运动的描述', '1.质点 参考系'),
  kp('b', '必修 第一册', '第一章 运动的描述', '2.时间 位移'),
  kp('c', '必修 第一册', '第二章 匀变速直线运动的研究', null),
  kp('d', '必修 第二册', '第五章 抛体运动', '1.曲线运动'),
]);

test('whole volumes and chapters collapse; a partly picked chapter lists its sections', () => {
  const picks = new Set([
    '必修 第一册||第一章 运动的描述||2.时间 位移',
    '必修 第二册||第五章 抛体运动||1.曲线运动',
  ]);
  expect(scopeFromPicks(catalog, picks)).toEqual([
    { volume: '必修 第一册', chapter: '第一章 运动的描述', section: '2.时间 位移' },
    { volume: '必修 第二册' },
  ]);
  picks.add('必修 第一册||第一章 运动的描述||1.质点 参考系');
  expect(scopeFromPicks(catalog, picks)[0]).toEqual({ volume: '必修 第一册', chapter: '第一章 运动的描述' });
  picks.add('必修 第一册||第二章 匀变速直线运动的研究||');
  expect(scopeFromPicks(catalog, picks).map(scopeLabel)).toEqual(['必修 第一册（整册）', '必修 第二册（整册）']);
});
