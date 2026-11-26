import type { SimulationCatalogEntry } from '../core/types';
import { horizontalGroundBlockBoardScenario } from './blockBoard';

export const simulationCatalog: SimulationCatalogEntry[] = [
  horizontalGroundBlockBoardScenario,
  {
    id: 'conveyor-belt',
    title: '传送带模型',
    shortTitle: '传送带模型',
    description: '分析摩擦力方向、共速条件和运动阶段。',
    dimension: '2d',
    status: 'planned',
    knowledgePointIds: ['v1c4s5k05'],
  },
  {
    id: 'incline-connected-bodies',
    title: '斜面连接体',
    shortTitle: '斜面连接体',
    description: '分解受力并比较不同连接条件下的加速度。',
    dimension: '2d',
    status: 'planned',
    knowledgePointIds: ['v1c4s5k03'],
  },
];
