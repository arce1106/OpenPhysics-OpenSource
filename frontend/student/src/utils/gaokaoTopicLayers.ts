import type { LearningCatalogTopicLayer } from '../types';

export type GaokaoTrainingLayer = Exclude<
  LearningCatalogTopicLayer,
  'diagnostic' | 'paper'
>;

export interface GaokaoTopicLayerDefinition {
  id: GaokaoTrainingLayer;
  number: string;
  name: string;
  questionCount: number;
  difficulty: string;
  description: string;
}

export const GAOKAO_TOPIC_LAYERS: readonly GaokaoTopicLayerDefinition[] = [
  {
    id: 'foundation',
    number: '01',
    name: '基础巩固',
    questionCount: 5,
    difficulty: '专题内基础梯度',
    description: '以基础概念与基本方法为主，题型结构按专题特点安排。',
  },
  {
    id: 'breakthrough',
    number: '02',
    name: '典型突破',
    questionCount: 4,
    difficulty: '专题内中段梯度',
    description: '突出典型模型与关键方法，实验专题会提高实验题占比。',
  },
  {
    id: 'transfer',
    number: '03',
    name: '综合迁移',
    questionCount: 4,
    difficulty: '专题内较高梯度',
    description: '侧重综合迁移与复杂情境，题型结构按专题特点安排。',
  },
] as const;

const QUESTION_COUNTS: Record<LearningCatalogTopicLayer, number> = {
  diagnostic: 8,
  foundation: 5,
  breakthrough: 4,
  transfer: 4,
  paper: 10,
};

export function gaokaoLayerQuestionCount(layer: LearningCatalogTopicLayer) {
  return QUESTION_COUNTS[layer];
}
