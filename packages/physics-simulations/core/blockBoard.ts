const EPSILON = 1e-9;

export interface BlockBoardParameters {
  appliedForce: number;
  boardMass: number;
  blockMass: number;
  groundFrictionCoefficient: number;
  blockBoardFrictionCoefficient: number;
  gravity: number;
  boardLength: number;
  blockLength: number;
  initialBlockOffset: number;
}

export type BlockBoardRegime = 'stationary' | 'together' | 'sliding';

export type BlockBoardPhase = BlockBoardRegime | 'at-edge';

export interface BlockBoardSolution {
  parameters: BlockBoardParameters;
  regime: BlockBoardRegime;
  commonAcceleration: number | null;
  boardAcceleration: number;
  blockAcceleration: number;
  groundFrictionMagnitude: number;
  blockBoardFrictionMagnitude: number;
  requiredBlockBoardFriction: number;
  maximumGroundFriction: number;
  maximumBlockBoardFriction: number;
  groundMotionCriticalForce: number;
  relativeSlipCriticalForce: number;
  relativeAcceleration: number;
  timeToEdge: number | null;
}

export interface BlockBoardFrame {
  time: number;
  phase: BlockBoardPhase;
  boardPosition: number;
  blockPosition: number;
  relativePosition: number;
  boardVelocity: number;
  blockVelocity: number;
  boardAcceleration: number;
  blockAcceleration: number;
  groundFrictionMagnitude: number;
  blockBoardFrictionMagnitude: number;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > EPSILON ? value : fallback;
}

function nonNegative(value: number, fallback = 0): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function normalizeBlockBoardParameters(input: BlockBoardParameters): BlockBoardParameters {
  const boardLength = Math.max(0.2, positive(input.boardLength, 6));
  const blockLength = Math.min(positive(input.blockLength, 1.2), boardLength - 0.1);
  const maximumOffset = Math.max(0, (boardLength - blockLength) / 2);
  const initialBlockOffset = Number.isFinite(input.initialBlockOffset) ? input.initialBlockOffset : 0;

  return {
    appliedForce: nonNegative(input.appliedForce),
    boardMass: positive(input.boardMass, 5),
    blockMass: positive(input.blockMass, 2),
    groundFrictionCoefficient: nonNegative(input.groundFrictionCoefficient),
    blockBoardFrictionCoefficient: nonNegative(input.blockBoardFrictionCoefficient),
    gravity: positive(input.gravity, 9.8),
    boardLength,
    blockLength,
    initialBlockOffset: Math.max(-maximumOffset, Math.min(maximumOffset, initialBlockOffset)),
  };
}

export function solveBlockBoard(input: BlockBoardParameters): BlockBoardSolution {
  const parameters = normalizeBlockBoardParameters(input);
  const {
    appliedForce,
    boardMass,
    blockMass,
    groundFrictionCoefficient,
    blockBoardFrictionCoefficient,
    gravity,
    boardLength,
    blockLength,
    initialBlockOffset,
  } = parameters;

  const totalMass = boardMass + blockMass;
  const maximumGroundFriction = groundFrictionCoefficient * totalMass * gravity;
  const maximumBlockBoardFriction = blockBoardFrictionCoefficient * blockMass * gravity;
  const groundMotionCriticalForce = maximumGroundFriction;
  const relativeSlipCriticalForce = (
    groundFrictionCoefficient + blockBoardFrictionCoefficient
  ) * totalMass * gravity;

  if (appliedForce <= maximumGroundFriction + EPSILON) {
    return {
      parameters,
      regime: 'stationary',
      commonAcceleration: 0,
      boardAcceleration: 0,
      blockAcceleration: 0,
      groundFrictionMagnitude: appliedForce,
      blockBoardFrictionMagnitude: 0,
      requiredBlockBoardFriction: 0,
      maximumGroundFriction,
      maximumBlockBoardFriction,
      groundMotionCriticalForce,
      relativeSlipCriticalForce,
      relativeAcceleration: 0,
      timeToEdge: null,
    };
  }

  const groundFrictionMagnitude = maximumGroundFriction;
  const commonAcceleration = (appliedForce - groundFrictionMagnitude) / totalMass;
  const requiredBlockBoardFriction = blockMass * commonAcceleration;
  const movesTogether = requiredBlockBoardFriction <= maximumBlockBoardFriction + EPSILON;

  if (movesTogether) {
    return {
      parameters,
      regime: 'together',
      commonAcceleration,
      boardAcceleration: commonAcceleration,
      blockAcceleration: commonAcceleration,
      groundFrictionMagnitude,
      blockBoardFrictionMagnitude: requiredBlockBoardFriction,
      requiredBlockBoardFriction,
      maximumGroundFriction,
      maximumBlockBoardFriction,
      groundMotionCriticalForce,
      relativeSlipCriticalForce,
      relativeAcceleration: 0,
      timeToEdge: null,
    };
  }

  const blockBoardFrictionMagnitude = maximumBlockBoardFriction;
  const blockAcceleration = blockBoardFrictionMagnitude / blockMass;
  const boardAcceleration = (
    appliedForce - groundFrictionMagnitude - blockBoardFrictionMagnitude
  ) / boardMass;
  const relativeAcceleration = blockAcceleration - boardAcceleration;
  const clearanceToLeftEdge = (boardLength - blockLength) / 2 + initialBlockOffset;
  const timeToEdge = relativeAcceleration < -EPSILON
    ? Math.sqrt((2 * clearanceToLeftEdge) / -relativeAcceleration)
    : null;

  return {
    parameters,
    regime: 'sliding',
    commonAcceleration: null,
    boardAcceleration,
    blockAcceleration,
    groundFrictionMagnitude,
    blockBoardFrictionMagnitude,
    requiredBlockBoardFriction,
    maximumGroundFriction,
    maximumBlockBoardFriction,
    groundMotionCriticalForce,
    relativeSlipCriticalForce,
    relativeAcceleration,
    timeToEdge,
  };
}

export function frameAtTime(solution: BlockBoardSolution, requestedTime: number): BlockBoardFrame {
  const safeTime = nonNegative(requestedTime);
  const time = solution.timeToEdge === null
    ? safeTime
    : Math.min(safeTime, solution.timeToEdge);
  const atEdge = solution.timeToEdge !== null && safeTime >= solution.timeToEdge - EPSILON;
  const boardPosition = 0.5 * solution.boardAcceleration * time * time;
  const blockPosition = solution.parameters.initialBlockOffset
    + 0.5 * solution.blockAcceleration * time * time;

  return {
    time,
    phase: atEdge ? 'at-edge' : solution.regime,
    boardPosition,
    blockPosition,
    relativePosition: blockPosition - boardPosition,
    boardVelocity: solution.boardAcceleration * time,
    blockVelocity: solution.blockAcceleration * time,
    boardAcceleration: solution.boardAcceleration,
    blockAcceleration: solution.blockAcceleration,
    groundFrictionMagnitude: solution.groundFrictionMagnitude,
    blockBoardFrictionMagnitude: solution.blockBoardFrictionMagnitude,
  };
}

export function recommendedDuration(solution: BlockBoardSolution, maximumDuration = 8): number {
  if (solution.timeToEdge === null) return maximumDuration;
  return Math.max(0.5, Math.min(maximumDuration, solution.timeToEdge));
}
