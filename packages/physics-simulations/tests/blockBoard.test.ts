import { describe, expect, it } from 'vitest';
import {
  frameAtTime,
  normalizeBlockBoardParameters,
  recommendedDuration,
  solveBlockBoard,
  type BlockBoardParameters,
} from '../core/blockBoard';
import { horizontalGroundBlockBoardScenario } from '../scenarios/blockBoard';

function parameters(overrides: Partial<BlockBoardParameters> = {}): BlockBoardParameters {
  return { ...horizontalGroundBlockBoardScenario.defaultParameters, ...overrides };
}

describe('block-board physics', () => {
  it('keeps both objects stationary while ground friction can balance the force', () => {
    const solution = solveBlockBoard(parameters({ appliedForce: 4 }));

    expect(solution.regime).toBe('stationary');
    expect(solution.groundFrictionMagnitude).toBe(4);
    expect(solution.blockBoardFrictionMagnitude).toBe(0);
    expect(solution.boardAcceleration).toBe(0);
    expect(solution.blockAcceleration).toBe(0);
  });

  it('keeps the block and board together after ground friction is overcome', () => {
    const solution = solveBlockBoard(parameters({ appliedForce: 10 }));
    const groundFriction = 0.08 * 7 * 9.8;
    const commonAcceleration = (10 - groundFriction) / 7;

    expect(solution.regime).toBe('together');
    expect(solution.groundFrictionMagnitude).toBeCloseTo(groundFriction);
    expect(solution.boardAcceleration).toBeCloseTo(commonAcceleration);
    expect(solution.blockAcceleration).toBeCloseTo(commonAcceleration);
    expect(solution.blockBoardFrictionMagnitude).toBeCloseTo(2 * commonAcceleration);
    expect(solution.relativeAcceleration).toBe(0);
  });

  it('uses the interface friction limit after relative sliding begins', () => {
    const solution = solveBlockBoard(parameters({ appliedForce: 30 }));
    const groundFriction = 0.08 * 7 * 9.8;
    const blockBoardFriction = 0.3 * 2 * 9.8;

    expect(solution.regime).toBe('sliding');
    expect(solution.groundFrictionMagnitude).toBeCloseTo(groundFriction);
    expect(solution.blockBoardFrictionMagnitude).toBeCloseTo(blockBoardFriction);
    expect(solution.blockAcceleration).toBeCloseTo(0.3 * 9.8);
    expect(solution.boardAcceleration).toBeCloseTo((30 - groundFriction - blockBoardFriction) / 5);
    expect(solution.relativeAcceleration).toBeLessThan(0);
  });

  it('treats the ground-friction limit as the inclusive stationary boundary', () => {
    const base = parameters();
    const criticalForce = base.groundFrictionCoefficient * base.gravity * (base.boardMass + base.blockMass);

    expect(solveBlockBoard(parameters({ appliedForce: criticalForce })).regime).toBe('stationary');
    expect(solveBlockBoard(parameters({ appliedForce: criticalForce + 0.01 })).regime).toBe('together');
  });

  it('treats the block-board friction limit as the inclusive no-slip boundary', () => {
    const base = parameters();
    const criticalForce = (base.groundFrictionCoefficient + base.blockBoardFrictionCoefficient)
      * base.gravity
      * (base.boardMass + base.blockMass);

    expect(solveBlockBoard(parameters({ appliedForce: criticalForce })).regime).toBe('together');
    expect(solveBlockBoard(parameters({ appliedForce: criticalForce + 0.01 })).regime).toBe('sliding');
  });

  it('stops the horizontal model exactly when the block reaches the board edge', () => {
    const solution = solveBlockBoard(parameters({ appliedForce: 30 }));
    expect(solution.timeToEdge).not.toBeNull();

    const frame = frameAtTime(solution, (solution.timeToEdge ?? 0) + 3);
    const expectedRelativePosition = -(solution.parameters.boardLength - solution.parameters.blockLength) / 2;

    expect(frame.phase).toBe('at-edge');
    expect(frame.relativePosition).toBeCloseTo(expectedRelativePosition);
    expect(frame.time).toBeCloseTo(solution.timeToEdge ?? 0);
  });

  it('normalizes unsafe masses, lengths, offsets, and friction coefficients', () => {
    const normalized = normalizeBlockBoardParameters(parameters({
      boardMass: 0,
      blockMass: -2,
      boardLength: 0.05,
      initialBlockOffset: Number.NaN,
      groundFrictionCoefficient: -0.2,
      blockBoardFrictionCoefficient: Number.NaN,
    }));

    expect(normalized.boardMass).toBeGreaterThan(0);
    expect(normalized.blockMass).toBeGreaterThan(0);
    expect(normalized.boardLength).toBeGreaterThan(normalized.blockLength);
    expect(normalized.initialBlockOffset).toBe(0);
    expect(normalized.groundFrictionCoefficient).toBe(0);
    expect(normalized.blockBoardFrictionCoefficient).toBe(0);
  });

  it('limits a long-running sliding scenario without claiming the block reached the edge', () => {
    const solution = solveBlockBoard(parameters({
      appliedForce: 27,
      boardLength: 20,
    }));
    const duration = recommendedDuration(solution, 1);
    const frame = frameAtTime(solution, duration);

    expect(solution.timeToEdge).toBeGreaterThan(duration);
    expect(frame.phase).toBe('sliding');
  });

  it('preserves the horizontal external-force balance while sliding', () => {
    const solution = solveBlockBoard(parameters({ appliedForce: 30 }));
    const left = solution.parameters.appliedForce - solution.groundFrictionMagnitude;
    const right = solution.parameters.boardMass * solution.boardAcceleration
      + solution.parameters.blockMass * solution.blockAcceleration;

    expect(right).toBeCloseTo(left);
  });
});
