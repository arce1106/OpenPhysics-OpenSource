import type { BlockBoardParameters } from '../core/blockBoard';
import type { SimulationScenario } from './types';

export const horizontalGroundBlockBoardScenario: SimulationScenario<BlockBoardParameters> = {
  id: 'block-board-horizontal-ground',
  title: '水平地面上的木板—滑块',
  shortTitle: '木板—滑块',
  description: '比较静止、共同运动与相对滑动，观察两个接触面的摩擦作用。',
  dimension: '2d',
  status: 'available',
  knowledgePointIds: ['v1c4s5k04'],
  maximumDuration: 8,
  defaultParameters: {
    appliedForce: 10,
    boardMass: 5,
    blockMass: 2,
    groundFrictionCoefficient: 0.08,
    blockBoardFrictionCoefficient: 0.3,
    gravity: 9.8,
    boardLength: 7,
    blockLength: 1.4,
    initialBlockOffset: 0,
  },
  teachingGoals: [
    '先判断外力能否克服木板与地面的最大摩擦力。',
    '再判断滑块与木板之间是否发生相对滑动。',
    '分别对滑块和木板列牛顿第二定律。',
    '用相对位移判断滑块何时到达木板边缘。',
  ],
};
