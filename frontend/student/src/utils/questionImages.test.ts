import { describe, expect, it, vi } from 'vitest';
import { collectQuestionImageUrls, preloadImageUrls } from './questionImages';
import type { Question } from '../types';

describe('questionImages', () => {
  it('collects inline and attached question images without duplicates', () => {
    const question: Question = {
      id: 'q1',
      stem_text: '看图 {{IMG:0}} 再看 {{IMG:1}} 和 {{IMG:0}}',
      options: [],
      images: [
        { id: 'img1', image_path: '/static/a.png', image_type: 'stem', description: null },
        { id: 'img2', image_path: '/static/b.png', image_type: 'stem', description: null },
        { id: 'img3', image_path: '/static/c.png', image_type: 'explanation', description: null },
      ],
    };

    expect(collectQuestionImageUrls(question)).toEqual([
      '/static/a.png',
      '/static/b.png',
      '/static/c.png',
    ]);
  });

  it('preloads only a limited number of image urls', () => {
    const created: string[] = [];
    const imageFactory = vi.fn(() => ({
      set src(value: string) {
        created.push(value);
      },
    }));

    preloadImageUrls(['/a.png', '/b.png', '/c.png'], imageFactory as any, 2);

    expect(created).toEqual(['/a.png', '/b.png']);
  });
});
