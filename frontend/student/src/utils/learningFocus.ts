import type { DirectoryKpNode } from '../types';
import { hasLearningState, learningStateFor } from '../components/learningPath/learningKpStatus';

interface ChapterFocus {
  volume: string;
  chapter: string;
  kps: DirectoryKpNode[];
}

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupByChapter(kps: DirectoryKpNode[]): ChapterFocus[] {
  const grouped = new Map<string, ChapterFocus>();
  kps.forEach(kp => {
    const volume = kp.volume || '未分类';
    const chapter = kp.chapter || '未分类';
    const key = `${volume}||${chapter}`;
    if (!grouped.has(key)) grouped.set(key, { volume, chapter, kps: [] });
    grouped.get(key)!.kps.push(kp);
  });
  return Array.from(grouped.values());
}

function hasProgressEvidence(chapter: ChapterFocus) {
  return chapter.kps.some(kp => timestamp(kp.last_practiced) > 0 || hasLearningState(kp, ['learning', 'practice', 'mastered']));
}

function latestPracticedAt(chapter: ChapterFocus) {
  return Math.max(0, ...chapter.kps.map(kp => timestamp(kp.last_practiced)));
}

function hasActiveLearning(chapter: ChapterFocus) {
  return chapter.kps.some(kp => hasLearningState(kp, ['learning', 'practice', 'to_learn']));
}

function isUnstarted(chapter: ChapterFocus) {
  return chapter.kps.every(kp => learningStateFor(kp) === 'locked' && !kp.last_practiced);
}

export function pickFocusedChapterKps(kps: DirectoryKpNode[], selectedChapterKey: string | null): DirectoryKpNode[] {
  if (selectedChapterKey) {
    const [volume, chapter] = selectedChapterKey.split('||');
    const selected = kps.filter(kp => kp.volume === volume && kp.chapter === chapter);
    if (selected.length > 0) return selected;
  }

  const chapters = groupByChapter(kps);
  const recentlyPracticed = chapters
    .filter(hasProgressEvidence)
    .sort((a, b) => latestPracticedAt(b) - latestPracticedAt(a));
  const focused = recentlyPracticed[0]
    || chapters.find(hasActiveLearning)
    || chapters.find(isUnstarted)
    || chapters[0];

  return focused?.kps || [];
}

export function pickFocusedChapterKey(kps: DirectoryKpNode[]): string | null {
  const focused = pickFocusedChapterKps(kps, null)[0];
  if (!focused?.volume || !focused?.chapter) return null;
  return `${focused.volume}||${focused.chapter}`;
}
