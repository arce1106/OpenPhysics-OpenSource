export type DemoKind = 'left-hand-rule' | 'magnetic-force' | 'lorentz-motion' | 'bounded-magnetic-field' | 'electromagnetic-induction' | 'ac-generator' | 'lc-oscillation' | 'sensor-divider';

export interface DemoOption {
  kind: DemoKind;
  title: string;
  subtitle: string;
  kpPrefixes: string[];
}

export interface FieldArrow {
  x: number;
  y: number;
}

export interface MagneticForceState {
  force: number;
  fieldDots: FieldArrow[];
}

export interface LeftHandRuleState {
  fieldLabel: string;
  motionLabel: string;
  forceLabel: string;
  forceSign: number;
  fieldShortLabel: string;
  motionShortLabel: string;
  equivalentCurrentLabel: string;
  observationTask: string;
  decisionSteps: string[];
  commonMistake: string;
  conclusion: string;
}

export interface LorentzMotionState {
  radius: number;
  omega: number;
  period: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface BoundedMagneticFieldState {
  radius: number;
  displayRadius: number;
  centerX: number;
  centerY: number;
  entryX: number;
  entryY: number;
  exitX: number;
  exitY: number;
  exitVx: number;
  exitVy: number;
  exitTheta: number;
  deflectionAngleDeg: number;
  boundary: 'right' | 'top' | 'bottom' | 'arc';
  bend: number;
}

export interface InductionState {
  flux: number;
  emf: number;
  current: number;
  magneticForce: number;
  heatPower: number;
  rodX: number;
}

export interface AcGeneratorState {
  angle: number;
  flux: number;
  emf: number;
  current: number;
}

export interface LcOscillationState {
  charge: number;
  current: number;
  electricEnergy: number;
  magneticEnergy: number;
}

export interface SensorDividerState {
  sensorResistance: number;
  outputVoltage: number;
  current: number;
}

export const ELECTIVE2_DEMOS: DemoOption[] = [
  {
    kind: 'left-hand-rule',
    title: '左手定则方向模型',
    subtitle: '用四指、掌心和拇指建立 B、I/v、F 的垂直关系',
    kpPrefixes: ['x2c1s1k02', 'x2c1s2k02', 'x2c1s2k03'],
  },
  {
    kind: 'magnetic-force',
    title: '安培力模型',
    subtitle: '看清 B、I、L 与安培力方向和大小的关系',
    kpPrefixes: ['x2c1s1', 'x2c1s2'],
  },
  {
    kind: 'lorentz-motion',
    title: '带电粒子磁场运动',
    subtitle: '用半径、周期和速度方向理解洛伦兹力只改变方向',
    kpPrefixes: ['x2c1s3k01', 'x2c1s3k02', 'x2c1s3k03', 'x2c1s3k04', 'x2c1s4'],
  },
  {
    kind: 'bounded-magnetic-field',
    title: '有界磁场偏转模型',
    subtitle: '用圆心、半径、弦长和偏转角分析入射与出射',
    kpPrefixes: ['x2c1s3k05'],
  },
  {
    kind: 'electromagnetic-induction',
    title: '电磁感应导轨模型',
    subtitle: '把磁通量变化、感应电动势、电流和安培力连起来',
    kpPrefixes: ['x2c2'],
  },
  {
    kind: 'ac-generator',
    title: '正弦交变电流模型',
    subtitle: '观察线圈转动时磁通量与感应电动势的相位关系',
    kpPrefixes: ['x2c3s1', 'x2c3s2', 'x2c3s3', 'x2c3s4'],
  },
  {
    kind: 'lc-oscillation',
    title: 'LC 电磁振荡模型',
    subtitle: '观察电场能和磁场能的周期性交替转化',
    kpPrefixes: ['x2c4'],
  },
  {
    kind: 'sensor-divider',
    title: '传感器分压模型',
    subtitle: '把物理量变化转化为电阻变化，再转化为电压信号',
    kpPrefixes: ['x2c5'],
  },
];

export function demosForKnowledgePoint(kpId: string): DemoOption[] {
  return ELECTIVE2_DEMOS.filter(demo => demo.kpPrefixes.some(prefix => kpId.startsWith(prefix)));
}

export function defaultDemoForKnowledgePoint(kpId: string): DemoOption | null {
  return demosForKnowledgePoint(kpId)[0] ?? null;
}

export function magneticForceState(params: { b: number; current: number; length: number }): MagneticForceState {
  const fieldDots: FieldArrow[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      fieldDots.push({ x: 52 + col * 38, y: 44 + row * 38 });
    }
  }
  return {
    force: params.b * params.current * params.length,
    fieldDots,
  };
}

export function leftHandRuleState(params: { fieldDirection: number; carrierSign: number }): LeftHandRuleState {
  const inward = params.fieldDirection > 0;
  const positiveCarrier = params.carrierSign > 0;
  const forceUp = params.fieldDirection * params.carrierSign > 0;
  return {
    fieldLabel: inward ? 'B：垂直纸面向里' : 'B：垂直纸面向外',
    motionLabel: positiveCarrier ? 'I / 正电荷速度：向右' : '负电荷速度：向右，等效电流向左',
    forceLabel: forceUp ? 'F：向上' : 'F：向下',
    forceSign: forceUp ? -1 : 1,
    fieldShortLabel: inward ? '磁场：向里 ×' : '磁场：向外 ·',
    motionShortLabel: positiveCarrier ? '运动/电流：向右' : '负电荷速度：向右',
    equivalentCurrentLabel: positiveCarrier ? '等效电流：向右' : '等效电流：向左',
    observationTask: positiveCarrier
      ? '先让磁场穿入手心，再让四指指向电流方向，观察拇指是否向上。'
      : '先不要直接用负电荷速度判定，先把负电荷向右运动换成等效电流向左。',
    decisionSteps: [
      inward ? '磁场 B 用叉号表示，方向垂直纸面向里。' : '磁场 B 用点号表示，方向垂直纸面向外。',
      positiveCarrier ? '四指指向电流 I，或正电荷速度 v。' : '负电荷向右运动时，先把它换成等效电流向左。',
      forceUp ? '拇指指向上方，所以受力 F 向上。' : '拇指指向下方，所以受力 F 向下。',
    ],
    commonMistake: positiveCarrier
      ? '常见错误：把磁场、运动方向和受力方向都画在纸面内，忘记 B 是垂直纸面的方向。'
      : '常见错误：负电荷不能直接按速度方向套左手定则，要先转成等效电流，或最后把正电荷受力方向反向。',
    conclusion: `在当前设定下，${positiveCarrier ? '正电荷/电流' : '负电荷'}向右，${inward ? '磁场向里' : '磁场向外'}，因此${forceUp ? '受力向上' : '受力向下'}。`,
  };
}

export function lorentzMotionState(params: { charge: number; mass: number; speed: number; b: number; t: number }): LorentzMotionState {
  const qAbs = Math.max(Math.abs(params.charge), 0.1);
  const bAbs = Math.max(Math.abs(params.b), 0.1);
  const radius = params.mass * params.speed / (qAbs * bAbs);
  const omega = qAbs * bAbs / Math.max(params.mass, 0.1);
  const direction = params.charge * params.b >= 0 ? 1 : -1;
  const angle = direction * omega * params.t;
  const displayRadius = Math.min(92, Math.max(34, radius * 18));
  return {
    radius,
    omega,
    period: 2 * Math.PI / omega,
    x: 170 + displayRadius * Math.cos(angle),
    y: 120 + displayRadius * Math.sin(angle),
    vx: -Math.sin(angle) * direction,
    vy: Math.cos(angle) * direction,
  };
}

export function boundedMagneticFieldState(params: {
  charge: number;
  mass: number;
  speed: number;
  b: number;
  entryYRatio: number;
}): BoundedMagneticFieldState {
  const qAbs = Math.max(Math.abs(params.charge), 0.1);
  const bAbs = Math.max(Math.abs(params.b), 0.1);
  const radius = params.mass * params.speed / (qAbs * bAbs);
  const displayRadius = Math.min(170, Math.max(38, radius * 24));
  const field = { left: 70, right: 306, top: 38, bottom: 198 };
  const entryX = field.left;
  const entryY = field.top + (field.bottom - field.top) * params.entryYRatio;
  const bend = params.charge * params.b >= 0 ? -1 : 1;
  const centerX = entryX;
  const centerY = entryY + bend * displayRadius;

  const candidates: Array<{ theta: number; boundary: BoundedMagneticFieldState["boundary"] }> = [];
  const rightRatio = (field.right - entryX) / displayRadius;
  if (rightRatio > 0 && rightRatio <= 1) {
    candidates.push({ theta: Math.asin(rightRatio), boundary: 'right' });
  }

  const yDistance = bend > 0 ? field.bottom - entryY : entryY - field.top;
  const yCos = 1 - yDistance / displayRadius;
  if (yDistance > 0 && yCos >= -1 && yCos <= 1) {
    candidates.push({ theta: Math.acos(yCos), boundary: bend > 0 ? 'bottom' : 'top' });
  }

  const selected = candidates
    .filter(item => item.theta > 0.02)
    .sort((a, b) => a.theta - b.theta)[0] ?? { theta: Math.min(Math.PI * 0.92, Math.max(0.35, Math.PI * 0.62)), boundary: 'arc' as const };
  const theta = selected.theta;
  const exitX = entryX + displayRadius * Math.sin(theta);
  const exitY = entryY + bend * displayRadius * (1 - Math.cos(theta));

  return {
    radius,
    displayRadius,
    centerX,
    centerY,
    entryX,
    entryY,
    exitX,
    exitY,
    exitVx: Math.cos(theta),
    exitVy: bend * Math.sin(theta),
    exitTheta: theta,
    deflectionAngleDeg: theta * 180 / Math.PI,
    boundary: selected.boundary,
    bend,
  };
}

export function inductionState(params: { b: number; length: number; speed: number; resistance: number; t: number }): InductionState {
  const areaWidth = 0.35 + (params.speed * params.t) % 2.8;
  const flux = params.b * params.length * areaWidth;
  const emf = params.b * params.length * params.speed;
  const current = emf / Math.max(params.resistance, 0.1);
  const magneticForce = params.b * params.length * current;
  return {
    flux,
    emf,
    current,
    magneticForce,
    heatPower: current * current * params.resistance,
    rodX: 78 + (areaWidth / 3.15) * 220,
  };
}

export function acGeneratorState(params: { turns: number; b: number; area: number; omega: number; resistance: number; t: number }): AcGeneratorState {
  const angle = params.omega * params.t;
  const flux = params.turns * params.b * params.area * Math.cos(angle);
  const emf = params.turns * params.b * params.area * params.omega * Math.sin(angle);
  return {
    angle,
    flux,
    emf,
    current: emf / Math.max(params.resistance, 0.1),
  };
}

export function lcOscillationState(params: { capacitance: number; inductance: number; qMax: number; t: number }): LcOscillationState {
  const omega = 1 / Math.sqrt(params.inductance * params.capacitance);
  const charge = params.qMax * Math.cos(omega * params.t);
  const current = -params.qMax * omega * Math.sin(omega * params.t);
  const electricEnergy = charge * charge / (2 * params.capacitance);
  const magneticEnergy = params.inductance * current * current / 2;
  return { charge, current, electricEnergy, magneticEnergy };
}

export function sensorDividerState(params: { baseResistance: number; sensitivity: number; input: number; fixedResistance: number; voltage: number }): SensorDividerState {
  const sensorResistance = Math.max(20, params.baseResistance * (1 + params.sensitivity * params.input));
  const current = params.voltage / (sensorResistance + params.fixedResistance);
  return {
    sensorResistance,
    outputVoltage: params.voltage * params.fixedResistance / (sensorResistance + params.fixedResistance),
    current,
  };
}
