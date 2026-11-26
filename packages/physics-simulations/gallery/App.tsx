import { useMemo, useState } from 'react';
import {
  recommendedDuration,
  solveBlockBoard,
  type BlockBoardParameters,
  type BlockBoardSolution,
} from '../core/blockBoard';
import { BlockBoardSimulation } from '../react/BlockBoardSimulation';
import { useSimulationClock } from '../react/useSimulationClock';
import { horizontalGroundBlockBoardScenario } from '../scenarios/blockBoard';
import { simulationCatalog } from '../scenarios/catalog';
import { RangeField } from './components/RangeField';

function phaseCopy(solution: BlockBoardSolution, atEdge: boolean) {
  if (atEdge) {
    return {
      title: '到达木板边缘',
      detail: '本演示在滑块到达左边缘时停止，暂不处理离板后的竖直下落。',
    };
  }
  if (solution.regime === 'stationary') {
    return {
      title: '保持静止',
      detail: '外力没有超过木板与地面之间的最大摩擦力，木板和滑块都不运动。',
    };
  }
  if (solution.regime === 'together') {
    return {
      title: '一起运动',
      detail: '静摩擦力足够，滑块与木板保持相对静止并具有相同加速度。',
    };
  }
  return {
    title: '发生相对滑动',
    detail: '所需静摩擦力超过最大值，滑块相对木板向左运动。',
  };
}

function equationCopy(solution: BlockBoardSolution) {
  if (solution.regime === 'stationary') {
    return (
      <>
        <p><i>aM</i> = <i>aₘ</i> = 0</p>
        <p><i>f₁</i> = <i>F</i> = {solution.groundFrictionMagnitude.toFixed(2)} N</p>
        <p className="condition"><i>F</i> ≤ μ₁(<i>M</i> + <i>m</i>)<i>g</i> = {solution.groundMotionCriticalForce.toFixed(2)} N</p>
      </>
    );
  }
  if (solution.regime === 'together') {
    return (
      <>
        <p><i>a</i> = (<i>F</i> − <i>f₁</i>) / (<i>M</i> + <i>m</i>) = {solution.boardAcceleration.toFixed(2)} m/s²</p>
        <p><i>f₂</i> = <i>ma</i> = {solution.blockBoardFrictionMagnitude.toFixed(2)} N</p>
        <p className="condition">{solution.requiredBlockBoardFriction.toFixed(2)} N ≤ μ₂<i>mg</i> = {solution.maximumBlockBoardFriction.toFixed(2)} N</p>
      </>
    );
  }
  return (
    <>
      <p><i>aₘ</i> = μ₂<i>g</i> = {solution.blockAcceleration.toFixed(2)} m/s²</p>
      <p><i>aM</i> = (<i>F</i> − <i>f₁</i> − μ₂<i>mg</i>) / <i>M</i> = {solution.boardAcceleration.toFixed(2)} m/s²</p>
      <p className="condition"><i>F</i> &gt; (μ₁ + μ₂)(<i>M</i> + <i>m</i>)<i>g</i> = {solution.relativeSlipCriticalForce.toFixed(2)} N</p>
    </>
  );
}

function AtomMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="3.5" fill="currentColor" />
      <ellipse cx="24" cy="24" rx="20" ry="8" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <ellipse cx="24" cy="24" rx="20" ry="8" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(60 24 24)" />
      <ellipse cx="24" cy="24" rx="20" ry="8" fill="none" stroke="currentColor" strokeWidth="2.2" transform="rotate(120 24 24)" />
    </svg>
  );
}

export default function App() {
  const [parameters, setParameters] = useState<BlockBoardParameters>(
    horizontalGroundBlockBoardScenario.defaultParameters,
  );
  const [showForces, setShowForces] = useState(true);
  const [showTrace, setShowTrace] = useState(false);
  const solution = useMemo(() => solveBlockBoard(parameters), [parameters]);
  const duration = recommendedDuration(solution, horizontalGroundBlockBoardScenario.maximumDuration);
  const clock = useSimulationClock(duration);
  const atEdge = solution.timeToEdge !== null && clock.time >= solution.timeToEdge - 1e-6;
  const currentPhase = phaseCopy(solution, atEdge);
  const recordingMode = new URLSearchParams(window.location.search).get('mode') === 'recording';

  const updateParameter = <K extends keyof BlockBoardParameters>(key: K, value: BlockBoardParameters[K]) => {
    setParameters(current => ({ ...current, [key]: value }));
    clock.reset();
  };

  const restoreDefaults = () => {
    setParameters(horizontalGroundBlockBoardScenario.defaultParameters);
    setShowForces(true);
    setShowTrace(false);
    clock.reset();
  };

  return (
    <div className={`lab-shell${recordingMode ? ' recording-mode' : ''}`}>
      <header className="lab-header">
        <div className="brand">
          <AtomMark />
          <strong>OpenPhysics · 动画实验室</strong>
        </div>
        <span>{recordingMode ? '录屏模式' : '独立预览'}</span>
      </header>

      <aside className="catalog-panel">
        <h2>动画目录</h2>
        <nav aria-label="动画目录">
          {simulationCatalog.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              className={entry.status === 'available' ? 'catalog-item active' : 'catalog-item'}
              disabled={entry.status !== 'available'}
            >
              <span className="catalog-index">{index + 1}</span>
              <span>{entry.shortTitle}</span>
              {entry.status !== 'available' && <span className="lock" aria-label="待开发">待开发</span>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="stage-panel">
        <BlockBoardSimulation
          parameters={solution.parameters}
          time={clock.time}
          showForces={showForces}
          showTrace={showTrace}
        />
      </main>

      <aside className="controls-panel">
        <h2>参数设置</h2>
        <RangeField label="作用力" symbol="F" unit="N" value={parameters.appliedForce} min={0} max={60} step={1} onChange={value => updateParameter('appliedForce', value)} />
        <RangeField label="木板质量" symbol="M" unit="kg" value={parameters.boardMass} min={1} max={20} step={0.5} onChange={value => updateParameter('boardMass', value)} />
        <RangeField label="滑块质量" symbol="m" unit="kg" value={parameters.blockMass} min={0.5} max={10} step={0.5} onChange={value => updateParameter('blockMass', value)} />
        <RangeField label="木板与地面摩擦因数" symbol="μ₁" value={parameters.groundFrictionCoefficient} min={0} max={0.8} step={0.02} onChange={value => updateParameter('groundFrictionCoefficient', value)} />
        <RangeField label="滑块与木板摩擦因数" symbol="μ₂" value={parameters.blockBoardFrictionCoefficient} min={0} max={0.8} step={0.02} onChange={value => updateParameter('blockBoardFrictionCoefficient', value)} />
        <p className="model-assumption">简化假设：每个接触面的最大静摩擦力等于滑动摩擦力。</p>

        <div className="display-options">
          <label><input type="checkbox" checked={showForces} onChange={event => setShowForces(event.target.checked)} />显示受力</label>
          <label><input type="checkbox" checked={showTrace} onChange={event => setShowTrace(event.target.checked)} />显示轨迹</label>
        </div>

        <button className="primary-button" type="button" onClick={clock.toggle}>
          <span aria-hidden="true">{clock.isPlaying ? 'Ⅱ' : '▶'}</span>
          {clock.isPlaying ? '暂停' : '播放'}
        </button>
        <button className="secondary-button" type="button" onClick={restoreDefaults}>↻　重置</button>
      </aside>

      <section className="analysis-panel">
        <div className="phase-column">
          <h2>当前阶段</h2>
          <strong><span className="status-dot" />{currentPhase.title}</strong>
          <p>{currentPhase.detail}</p>
          <ol className="phase-track" aria-label="运动阶段">
            <li className={solution.regime === 'stationary' ? 'active' : ''}>保持静止</li>
            <li className={solution.regime === 'together' ? 'active' : ''}>一起运动</li>
            <li className={solution.regime === 'sliding' && !atEdge ? 'active' : ''}>相对滑动</li>
            <li className={atEdge ? 'active' : ''}>到达边缘</li>
          </ol>
        </div>
        <div className="equation-column">
          <h2>受力与运动方程</h2>
          {equationCopy(solution)}
        </div>
        <div className="timeline-column">
          <div className="timeline-heading">
            <h2>时间轴</h2>
            <span>t = {clock.time.toFixed(2)} s</span>
          </div>
          <input
            className="timeline"
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={clock.time}
            onChange={event => clock.seek(Number(event.target.value))}
          />
          <div className="timeline-actions">
            <button type="button" onClick={clock.toggle} aria-label={clock.isPlaying ? '暂停' : '播放'}>{clock.isPlaying ? 'Ⅱ' : '▶'}</button>
            <button type="button" onClick={clock.reset} aria-label="回到起点">↺</button>
            <select value={clock.speed} onChange={event => clock.setSpeed(Number(event.target.value))} aria-label="播放速度">
              <option value={0.5}>0.5 ×</option>
              <option value={1}>1.0 ×</option>
              <option value={1.5}>1.5 ×</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
