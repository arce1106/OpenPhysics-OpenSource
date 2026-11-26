import { frameAtTime, solveBlockBoard, type BlockBoardParameters } from '../core/blockBoard';

interface BlockBoardSimulationProps {
  parameters: BlockBoardParameters;
  time: number;
  showForces: boolean;
  showTrace: boolean;
}

const VIEW_WIDTH = 960;
const BOARD_CENTER_X = 490;
const BOARD_Y = 260;
const BOARD_HEIGHT = 62;
const BLOCK_HEIGHT = 84;
const PIXELS_PER_METER = 90;

export function BlockBoardSimulation({
  parameters,
  time,
  showForces,
  showTrace,
}: BlockBoardSimulationProps) {
  const solution = solveBlockBoard(parameters);
  const frame = frameAtTime(solution, time);
  const boardWidth = solution.parameters.boardLength * PIXELS_PER_METER;
  const blockWidth = solution.parameters.blockLength * PIXELS_PER_METER;
  const blockCenterX = BOARD_CENTER_X + frame.relativePosition * PIXELS_PER_METER;
  const boardLeft = BOARD_CENTER_X - boardWidth / 2;
  const blockLeft = blockCenterX - blockWidth / 2;
  const groundShift = ((-frame.boardPosition * PIXELS_PER_METER) % 80 + 80) % 80;
  const appliedArrowLength = Math.min(150, 50 + solution.parameters.appliedForce * 2.2);
  const blockBoardFrictionArrowLength = Math.min(
    100,
    34 + solution.blockBoardFrictionMagnitude * 4,
  );
  const groundFrictionArrowLength = Math.min(
    130,
    34 + solution.groundFrictionMagnitude * 3,
  );
  const traceStartX = BOARD_CENTER_X + solution.parameters.initialBlockOffset * PIXELS_PER_METER;

  return (
    <div className="simulation-stage" aria-label="木板滑块二维动画">
      <div className="stage-heading">
        <div>
          <h1>水平地面上的木板—滑块</h1>
          <p>同时考虑木板与地面、滑块与木板两个接触面的摩擦作用。</p>
        </div>
        <div className="stage-legend" aria-label="图例">
          <span><i className="legend-line force" />作用力</span>
          <span><i className="legend-line velocity" />速度</span>
          <span><i className="legend-line trace" />相对轨迹</span>
        </div>
      </div>

      <svg className="simulation-canvas" viewBox={`0 0 ${VIEW_WIDTH} 420`} role="img">
        <defs>
          <marker id="arrow-red" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 Z" fill="#ef4444" />
          </marker>
          <marker id="arrow-blue" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 Z" fill="#2563eb" />
          </marker>
          <marker id="arrow-ground" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 Z" fill="#b45309" />
          </marker>
          <linearGradient id="board-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#dba66b" />
            <stop offset="1" stopColor="#c88745" />
          </linearGradient>
          <linearGradient id="block-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#4389d9" />
            <stop offset="1" stopColor="#2167b8" />
          </linearGradient>
          <filter id="soft-shadow" x="-20%" width="140%" y="-30%" height="170%">
            <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#1f2937" floodOpacity="0.16" />
          </filter>
        </defs>

        <g aria-hidden="true">
          <line x1="22" y1="323" x2="938" y2="323" stroke="#17202c" strokeWidth="3" />
          {Array.from({ length: 14 }, (_, index) => {
            const x = groundShift - 80 + index * 80;
            return <line key={index} x1={x} y1="324" x2={x} y2="340" stroke="#9aa6b2" strokeWidth="2" />;
          })}
        </g>

        {showTrace && (
          <g>
            <line
              x1={Math.min(traceStartX, blockCenterX)}
              y1="148"
              x2={Math.max(traceStartX, blockCenterX)}
              y2="148"
              stroke="#45a24b"
              strokeWidth="3"
              strokeDasharray="8 8"
            />
            <circle cx={traceStartX} cy="148" r="6" fill="#45a24b" />
          </g>
        )}

        <g filter="url(#soft-shadow)">
          <rect
            x={boardLeft}
            y={BOARD_Y}
            width={boardWidth}
            height={BOARD_HEIGHT}
            rx="4"
            fill="url(#board-fill)"
            stroke="#8c5428"
            strokeWidth="3"
          />
          <path
            d={`M${boardLeft + 20} ${BOARD_Y + 17} C${boardLeft + 110} ${BOARD_Y + 2}, ${boardLeft + 160} ${BOARD_Y + 30}, ${boardLeft + 250} ${BOARD_Y + 14}`}
            fill="none"
            stroke="#a86834"
            strokeWidth="2"
            opacity="0.55"
          />
          <path
            d={`M${boardLeft + 235} ${BOARD_Y + 43} C${boardLeft + 330} ${BOARD_Y + 27}, ${boardLeft + 390} ${BOARD_Y + 57}, ${boardLeft + boardWidth - 24} ${BOARD_Y + 39}`}
            fill="none"
            stroke="#a86834"
            strokeWidth="2"
            opacity="0.48"
          />
          <rect
            x={blockLeft}
            y={BOARD_Y - BLOCK_HEIGHT}
            width={blockWidth}
            height={BLOCK_HEIGHT}
            rx="4"
            fill="url(#block-fill)"
            stroke="#174d88"
            strokeWidth="3"
          />
        </g>

        <text x={BOARD_CENTER_X + boardWidth * 0.32} y={BOARD_Y + 43} className="object-label">M</text>
        <text x={blockCenterX} y={BOARD_Y - BLOCK_HEIGHT - 18} textAnchor="middle" className="object-label">m</text>

        {showForces && (
          <g>
            {solution.parameters.appliedForce > 1e-6 && (
              <>
                <line
                  data-force-vector="applied"
                  x1={boardLeft + boardWidth}
                  y1={BOARD_Y + 28}
                  x2={boardLeft + boardWidth + appliedArrowLength}
                  y2={BOARD_Y + 28}
                  stroke="#ef4444"
                  strokeWidth="4"
                  markerEnd="url(#arrow-red)"
                />
                <text x={boardLeft + boardWidth + appliedArrowLength - 16} y={BOARD_Y + 10} className="force-label">F</text>
              </>
            )}
            {solution.blockBoardFrictionMagnitude > 1e-6 && (
              <>
                <line
                  data-force-vector="block-friction"
                  x1={blockCenterX}
                  y1={BOARD_Y - 30}
                  x2={blockCenterX + blockBoardFrictionArrowLength}
                  y2={BOARD_Y - 30}
                  stroke="#ef4444"
                  strokeWidth="4"
                  markerEnd="url(#arrow-red)"
                />
                <text x={blockCenterX + blockBoardFrictionArrowLength - 4} y={BOARD_Y - 47} className="force-label">f₂</text>
                <line
                  data-force-vector="board-friction"
                  x1={blockCenterX}
                  y1={BOARD_Y + 18}
                  x2={blockCenterX - blockBoardFrictionArrowLength}
                  y2={BOARD_Y + 18}
                  stroke="#ef4444"
                  strokeWidth="4"
                  markerEnd="url(#arrow-red)"
                />
              </>
            )}
            {solution.groundFrictionMagnitude > 1e-6 && (
              <>
                <line
                  data-force-vector="ground-friction"
                  x1={BOARD_CENTER_X - 30}
                  y1={BOARD_Y + 49}
                  x2={BOARD_CENTER_X - 30 - groundFrictionArrowLength}
                  y2={BOARD_Y + 49}
                  stroke="#b45309"
                  strokeWidth="4"
                  markerEnd="url(#arrow-ground)"
                />
                <text
                  x={BOARD_CENTER_X - 46 - groundFrictionArrowLength}
                  y={BOARD_Y + 42}
                  className="force-label ground-force-label"
                >
                  f₁
                </text>
              </>
            )}
          </g>
        )}

        {frame.blockVelocity > 1e-3 && (
          <g opacity="0.88">
            <line
              data-velocity-vector="block"
              x1={blockCenterX}
              y1={BOARD_Y - BLOCK_HEIGHT - 48}
              x2={blockCenterX + Math.min(110, 25 + frame.blockVelocity * 14)}
              y2={BOARD_Y - BLOCK_HEIGHT - 48}
              stroke="#2563eb"
              strokeWidth="3"
              strokeDasharray="7 6"
              markerEnd="url(#arrow-blue)"
            />
          </g>
        )}

        <text x="32" y="386" className="canvas-caption">
          xₘ = {frame.blockPosition.toFixed(2)} m　 xₘ − xM = {frame.relativePosition.toFixed(2)} m
        </text>
        <text x="928" y="386" textAnchor="end" className="canvas-caption">
          t = {frame.time.toFixed(2)} s
        </text>
      </svg>
    </div>
  );
}
