import type { Question } from '../types';
import { resolveAssetUrl } from '../api/baseUrl';

const INLINE_IMAGE_RE = /\{\{IMG:(\d+)\}\}/g;

export function collectQuestionImageUrls(question: Question | null | undefined): string[] {
  if (!question?.images?.length) return [];
  const urls: string[] = [];
  const seen = new Set<string>();

  const add = (url?: string | null) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(resolveAssetUrl(url));
  };

  let match: RegExpExecArray | null;
  INLINE_IMAGE_RE.lastIndex = 0;
  while ((match = INLINE_IMAGE_RE.exec(question.stem_text || ''))) {
    const image = question.images[Number(match[1])];
    add(image?.image_path);
  }

  question.images.forEach(image => add(image.image_path));
  return urls;
}

export function preloadImageUrls(
  urls: string[],
  imageFactory: () => { src: string } = () => new Image(),
  limit = 4,
) {
  urls.slice(0, limit).forEach(url => {
    const img = imageFactory();
    img.src = url;
  });
}
