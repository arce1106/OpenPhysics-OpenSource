import type { DirectoryKpNode } from '../../types';
import { getLearningKpStatus } from './learningKpStatus';

export interface KnowledgeModule {
  id: string;
  title: string;
  kps: DirectoryKpNode[];
  masteredCount: number;
  avgMastery: number;
}

export interface KnowledgeMapNode {
  kp: DirectoryKpNode;
  moduleId: string;
  moduleTitle: string;
  dependencies: string[];
  successors: string[];
  status: ReturnType<typeof getLearningKpStatus>;
}

export interface ChapterKnowledgeMapModel {
  nodes: KnowledgeMapNode[];
  nodeById: Map<string, KnowledgeMapNode>;
}

const FALLBACK_MODULE = {
  id: 'chapter-other',
  title: '本章其他知识点',
};

function normalizeName(name: string) {
  return name.replace(/\s+/g, '').toLowerCase();
}

function findFirstByKeywords(kps: DirectoryKpNode[], keywords: string[]) {
  return kps.find(kp => {
    const name = normalizeName(kp.name);
    return keywords.some(keyword => name.includes(normalizeName(keyword)));
  });
}

function addDependency(dependencies: Map<string, Set<string>>, target: DirectoryKpNode | undefined, source: DirectoryKpNode | undefined) {
  if (!target || !source || target.id === source.id) return;
  if (!dependencies.has(target.id)) dependencies.set(target.id, new Set());
  dependencies.get(target.id)!.add(source.id);
}

export function buildChapterKnowledgeMap(modules: KnowledgeModule[]): ChapterKnowledgeMapModel {
  const orderedKps = modules.flatMap(module => module.kps);
  const dependencies = new Map<string, Set<string>>();

  orderedKps.forEach((kp, index) => {
    if (index === 0) return;
    dependencies.set(kp.id, new Set([orderedKps[index - 1].id]));
  });

  const particle = findFirstByKeywords(orderedKps, ['质点']);
  const reference = findFirstByKeywords(orderedKps, ['参考系']);
  const coordinate = findFirstByKeywords(orderedKps, ['坐标系']);
  const time = findFirstByKeywords(orderedKps, ['时刻', '时间间隔']);
  const displacement = findFirstByKeywords(orderedKps, ['位移']);
  const velocity = findFirstByKeywords(orderedKps, ['速度']);
  const acceleration = findFirstByKeywords(orderedKps, ['加速度']);
  const vtGraph = findFirstByKeywords(orderedKps, ['v-t', 'v－t', 'v–t']);
  const xtGraph = findFirstByKeywords(orderedKps, ['x-t', 'x－t', 'x–t']);

  addDependency(dependencies, reference, particle);
  addDependency(dependencies, coordinate, reference);
  addDependency(dependencies, displacement, coordinate);
  addDependency(dependencies, velocity, displacement);
  addDependency(dependencies, velocity, time);
  addDependency(dependencies, acceleration, velocity);
  addDependency(dependencies, vtGraph, velocity);
  addDependency(dependencies, vtGraph, acceleration);
  addDependency(dependencies, xtGraph, displacement);
  addDependency(dependencies, xtGraph, time);

  const successors = new Map<string, Set<string>>();
  dependencies.forEach((sources, targetId) => {
    sources.forEach(sourceId => {
      if (!successors.has(sourceId)) successors.set(sourceId, new Set());
      successors.get(sourceId)!.add(targetId);
    });
  });

  const moduleByKpId = new Map<string, KnowledgeModule>();
  modules.forEach(module => module.kps.forEach(kp => moduleByKpId.set(kp.id, module)));

  const nodes = orderedKps.map(kp => {
    const module = moduleByKpId.get(kp.id);
    return {
      kp,
      moduleId: module?.id || FALLBACK_MODULE.id,
      moduleTitle: module?.title || FALLBACK_MODULE.title,
      dependencies: Array.from(dependencies.get(kp.id) || []),
      successors: Array.from(successors.get(kp.id) || []),
      status: getLearningKpStatus(kp),
    };
  });

  return {
    nodes,
    nodeById: new Map(nodes.map(node => [node.kp.id, node])),
  };
}
