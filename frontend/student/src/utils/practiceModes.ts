export type PracticeMode = 'diagnostic' | 'check' | 'practice';

export function parsePracticeMode(value: string | null | undefined): PracticeMode {
  if (value === 'diagnostic' || value === 'practice' || value === 'check') return value;
  return 'check';
}

export function getPracticeModeCopy(mode: PracticeMode) {
  if (mode === 'diagnostic') {
    return {
      title: '掌握评估',
      printTitle: '掌握评估',
      loading: '加载评估题中...',
      empty: '暂无可用评估题目',
      subtitle: '先判断当前掌握情况',
      result: '评估结果',
      paperTitle: '掌握评估',
    };
  }
  if (mode === 'practice') {
    return {
      title: '巩固小练',
      printTitle: '巩固小练',
      loading: '加载练习中...',
      empty: '暂无可用练习题目',
      subtitle: '用几道题巩固当前知识点',
      result: '练习结果',
      paperTitle: '巩固小练',
    };
  }
  return {
    title: '掌握评估',
    printTitle: '掌握评估',
    loading: '加载评估题中...',
    empty: '暂无可用题目',
    subtitle: '用 3 道题检查是否真正会用',
    result: '评估结果',
    paperTitle: '掌握评估',
  };
}
