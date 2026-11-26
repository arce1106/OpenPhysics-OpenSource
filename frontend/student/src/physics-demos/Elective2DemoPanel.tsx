import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveAssetUrl } from '../api/baseUrl';
import { api } from '../api/client';
import LatexSpan from '../components/LatexSpan';
import {
  ELECTIVE2_DEMOS,
  type DemoKind,
  type DemoOption,
  acGeneratorState,
  boundedMagneticFieldState,
  defaultDemoForKnowledgePoint,
  inductionState,
  leftHandRuleState,
  lcOscillationState,
  lorentzMotionState,
  magneticForceState,
  sensorDividerState,
} from './elective2Models';
import type { PhysicsSimulation } from '../types';

interface Props {
  kpId: string;
  kpName: string;
}

type Params = Record<string, number>;
type ModelView = 'demo' | 'video' | 'tips';

const DEFAULT_PARAMS: Record<DemoKind, Params> = {
  'left-hand-rule': { fieldDirection: 1, carrierSign: 1 },
  'magnetic-force': { b: 0.8, current: 2.4, length: 0.6 },
  'lorentz-motion': { charge: 1, mass: 1, speed: 4, b: 0.8 },
  'bounded-magnetic-field': { charge: 1, mass: 1, speed: 4.2, b: 0.8, entryYRatio: 0.5 },
  'electromagnetic-induction': { b: 0.7, length: 0.8, speed: 1.2, resistance: 2.4 },
  'ac-generator': { turns: 20, b: 0.5, area: 0.08, omega: 2.4, resistance: 8 },
  'lc-oscillation': { capacitance: 1, inductance: 1, qMax: 1.2 },
  'sensor-divider': { baseResistance: 300, sensitivity: 0.9, input: 0.4, fixedResistance: 300, voltage: 6 },
};

const EQUATIONS: Record<DemoKind, string[]> = {
  'left-hand-rule': ['\\vec F=I\\vec L\\times\\vec B', '\\vec F=q\\vec v\\times\\vec B'],
  'magnetic-force': ['F=BIL'],
  'lorentz-motion': ['qvB=\\frac{mv^2}{r}', 'r=\\frac{mv}{qB}', 'T=\\frac{2\\pi m}{qB}'],
  'bounded-magnetic-field': ['r=\\frac{mv}{qB}', 'sin\\theta=\\frac{弦长}{r}', 't=\\frac{\\theta}{2\\pi}T'],
  'electromagnetic-induction': ['E=BLv', 'I=\\frac{E}{R}', 'F_A=BIL'],
  'ac-generator': ['\\Phi=NBScos\\omega t', 'e=NBS\\omega sin\\omega t'],
  'lc-oscillation': ['T=2\\pi\\sqrt{LC}', 'E_C+E_L=\\text{恒量}'],
  'sensor-divider': ['U_{out}=U\\frac{R_0}{R_s+R_0}'],
};

const PARAM_LABELS: Record<DemoKind, Record<string, { label: string; min: number; max: number; step: number; unit?: string }>> = {
  'left-hand-rule': {
    fieldDirection: { label: '磁场方向 B', min: -1, max: 1, step: 2 },
    carrierSign: { label: '电荷/电流约定', min: -1, max: 1, step: 2 },
  },
  'magnetic-force': {
    b: { label: '磁感应强度 B', min: 0.1, max: 1.6, step: 0.1, unit: 'T' },
    current: { label: '电流 I', min: 0.4, max: 5, step: 0.1, unit: 'A' },
    length: { label: '有效长度 L', min: 0.2, max: 1.2, step: 0.05, unit: 'm' },
  },
  'lorentz-motion': {
    charge: { label: '电荷量 q', min: -2, max: 2, step: 0.5, unit: 'q0' },
    mass: { label: '质量 m', min: 0.5, max: 3, step: 0.1, unit: 'm0' },
    speed: { label: '速度 v', min: 1, max: 8, step: 0.2, unit: 'm/s' },
    b: { label: '磁感应强度 B', min: 0.2, max: 1.8, step: 0.1, unit: 'T' },
  },
  'bounded-magnetic-field': {
    charge: { label: '电荷量 q', min: -2, max: 2, step: 0.5, unit: 'q0' },
    mass: { label: '质量 m', min: 0.5, max: 3, step: 0.1, unit: 'm0' },
    speed: { label: '入射速度 v', min: 1, max: 8, step: 0.2, unit: 'm/s' },
    b: { label: '磁感应强度 B', min: 0.2, max: 1.8, step: 0.1, unit: 'T' },
    entryYRatio: { label: '入射位置', min: 0.12, max: 0.88, step: 0.02 },
  },
  'electromagnetic-induction': {
    b: { label: '磁感应强度 B', min: 0.1, max: 1.5, step: 0.1, unit: 'T' },
    length: { label: '导体棒长度 L', min: 0.3, max: 1.4, step: 0.1, unit: 'm' },
    speed: { label: '速度 v', min: 0.2, max: 3, step: 0.1, unit: 'm/s' },
    resistance: { label: '总电阻 R', min: 0.5, max: 8, step: 0.1, unit: 'Ω' },
  },
  'ac-generator': {
    turns: { label: '匝数 N', min: 5, max: 80, step: 5 },
    b: { label: '磁感应强度 B', min: 0.1, max: 1.4, step: 0.1, unit: 'T' },
    area: { label: '线圈面积 S', min: 0.02, max: 0.18, step: 0.01, unit: 'm²' },
    omega: { label: '角速度 ω', min: 0.5, max: 6, step: 0.1, unit: 'rad/s' },
    resistance: { label: '外电阻 R', min: 1, max: 20, step: 0.5, unit: 'Ω' },
  },
  'lc-oscillation': {
    capacitance: { label: '电容 C', min: 0.4, max: 3, step: 0.1, unit: 'C0' },
    inductance: { label: '电感 L', min: 0.4, max: 3, step: 0.1, unit: 'L0' },
    qMax: { label: '最大电荷量 Qm', min: 0.4, max: 2.4, step: 0.1, unit: 'Q0' },
  },
  'sensor-divider': {
    baseResistance: { label: '基准电阻 Rs', min: 100, max: 1000, step: 20, unit: 'Ω' },
    sensitivity: { label: '灵敏度 k', min: -0.9, max: 1.8, step: 0.1 },
    input: { label: '输入物理量 x', min: 0, max: 1, step: 0.05 },
    fixedResistance: { label: '定值电阻 R0', min: 100, max: 1000, step: 20, unit: 'Ω' },
    voltage: { label: '电源电压 U', min: 3, max: 12, step: 0.5, unit: 'V' },
  },
};

function formatNumber(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits).replace(/\.?0+$/, '') : '-';
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, label?: string) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 9 * Math.cos(angle - Math.PI / 6), y2 - 9 * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - 9 * Math.cos(angle + Math.PI / 6), y2 - 9 * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  if (label) {
    ctx.font = '12px sans-serif';
    ctx.fillText(label, x2 + 8, y2 - 6);
  }
}

function drawFieldDots(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#dce8ef';
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const x = 40 + col * 36;
      const y = 34 + row * 34;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7b8794';
      ctx.beginPath();
      ctx.arc(x, y, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dce8ef';
    }
  }
}

function drawSineGraph(ctx: CanvasRenderingContext2D, values: number[], color: string, yBase: number, amp: number) {
  ctx.strokeStyle = '#d9e2ec';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(28, yBase);
  ctx.lineTo(332, yBase);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = 28 + (i / (values.length - 1)) * 304;
    const y = yBase - v * amp;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawCrossOrDot(ctx: CanvasRenderingContext2D, x: number, y: number, inward: boolean) {
  ctx.strokeStyle = '#7b8794';
  ctx.fillStyle = '#7b8794';
  ctx.lineWidth = 2;
  if (inward) {
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 5);
    ctx.lineTo(x + 5, y + 5);
    ctx.moveTo(x + 5, y - 5);
    ctx.lineTo(x - 5, y + 5);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundedPanel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, stroke = '#d9e3e8') {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 10);
  ctx.fill();
  ctx.stroke();
}

function renderBackendBoundedMagneticField(ctx: CanvasRenderingContext2D, simulation: PhysicsSimulation, time: number) {
  const params = simulation.params || {};
  const field = params.field_bounds || { left: 70, right: 306, top: 38, bottom: 198 };
  const series = simulation.series || [];
  ctx.clearRect(0, 0, 360, 240);
  ctx.fillStyle = '#fbfcfd';
  ctx.fillRect(0, 0, 360, 240);
  ctx.fillStyle = '#eef6f8';
  ctx.fillRect(field.left, field.top, field.right - field.left, field.bottom - field.top);
  ctx.strokeStyle = '#9fb3c8';
  ctx.lineWidth = 2;
  ctx.strokeRect(field.left, field.top, field.right - field.left, field.bottom - field.top);
  ctx.fillStyle = '#7b8794';
  ctx.font = '12px sans-serif';

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const x = 100 + col * 34;
      const y = 84 + row * 30;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eef6f8';
      ctx.beginPath();
      ctx.arc(x, y, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7b8794';
    }
  }

  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#bcccdc';
  ctx.beginPath();
  ctx.moveTo(params.center_x, params.center_y);
  ctx.lineTo(params.entry_x, params.entry_y);
  ctx.moveTo(params.center_x, params.center_y);
  ctx.lineTo(params.exit_x, params.exit_y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#14919b';
  ctx.lineWidth = 4;
  ctx.beginPath();
  series.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  const duration = Math.max(params.flight_time || 1, 0.001);
  const progress = ((time % duration) / duration) * (series.length - 1);
  const particle = series[Math.max(0, Math.min(series.length - 1, Math.round(progress)))] || series[0];
  if (!particle) return;
  ctx.fillStyle = '#d64545';
  ctx.beginPath();
  ctx.arc(params.center_x, params.center_y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#14919b';
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, 7, 0, Math.PI * 2);
  ctx.fill();
  arrow(ctx, 28, params.entry_y, params.entry_x + 42, params.entry_y, '#f59f00', 'v0');
  const lastPoint = series[series.length - 1];
  arrow(ctx, params.exit_x, params.exit_y, params.exit_x + (lastPoint?.vx || 1) * 42, params.exit_y + (lastPoint?.vy || 0) * 42, '#f59f00', 'v出');

  const boundaryName = params.boundary === 'right' ? '右边界' : params.boundary === 'top' ? '上边界' : params.boundary === 'bottom' ? '下边界' : '场内圆弧';
  ctx.fillStyle = '#52606d';
  ctx.font = '13px sans-serif';
  ctx.fillText(`r=${formatNumber(params.radius)}  偏转角=${formatNumber(params.deflection_angle_deg, 0)}°  出射：${boundaryName}`, 42, 222);
}

function renderDemo(ctx: CanvasRenderingContext2D, kind: DemoKind, params: Params, time: number, backendSimulation?: PhysicsSimulation | null) {
  ctx.clearRect(0, 0, 360, 240);
  ctx.fillStyle = '#fbfcfd';
  ctx.fillRect(0, 0, 360, 240);
  ctx.strokeStyle = '#e6edf2';
  ctx.strokeRect(0.5, 0.5, 359, 239);

  if (kind === 'left-hand-rule') {
    const state = leftHandRuleState(params as any);
    const inward = params.fieldDirection > 0;
    roundedPanel(ctx, 18, 20, 324, 176, '#f8fbfc');
    ctx.fillStyle = '#52606d';
    ctx.font = '13px sans-serif';
    ctx.fillText('二维投影：把三维方向压到纸面上看', 34, 42);

    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        drawCrossOrDot(ctx, 54 + col * 38, 66 + row * 30, inward);
      }
    }

    ctx.strokeStyle = '#243b53';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(74, 126);
    ctx.lineTo(254, 126);
    ctx.stroke();
    const motionRight = params.carrierSign > 0;
    arrow(ctx, motionRight ? 92 : 236, 126, motionRight ? 174 : 154, 126, '#14919b', motionRight ? 'I / v+' : 'I等效');
    arrow(ctx, 174, 126, 174, 126 + state.forceSign * 64, '#d64545', 'F');

    roundedPanel(ctx, 250, 54, 74, 82, '#fff');
    ctx.fillStyle = '#243b53';
    ctx.font = '12px sans-serif';
    ctx.fillText('左手', 274, 74);
    ctx.strokeStyle = '#14919b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(272, 118);
    ctx.lineTo(304, 94);
    ctx.moveTo(272, 118);
    ctx.lineTo(304, 118);
    ctx.moveTo(272, 118);
    ctx.lineTo(300, 130);
    ctx.stroke();
    arrow(ctx, 272, 118, 272, 88, '#d64545', '拇指F');

    roundedPanel(ctx, 30, 202, 300, 28, '#fff');
    ctx.fillStyle = '#52606d';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${state.fieldShortLabel}  →  ${state.equivalentCurrentLabel}  →  ${state.forceLabel}`, 42, 220);
    return;
  }

  if (kind === 'magnetic-force') {
    const state = magneticForceState(params as any);
    drawFieldDots(ctx);
    ctx.strokeStyle = '#243b53';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(75, 128);
    ctx.lineTo(285, 128);
    ctx.stroke();
    arrow(ctx, 92, 128, 170, 128, '#14919b', 'I');
    arrow(ctx, 180, 128, 180, 54, '#d64545', 'F');
    ctx.fillStyle = '#52606d';
    ctx.font = '13px sans-serif';
    ctx.fillText(`F = ${formatNumber(state.force)} N`, 132, 210);
    return;
  }

  if (kind === 'lorentz-motion') {
    drawFieldDots(ctx);
    const state = lorentzMotionState({ ...(params as any), t: time });
    ctx.strokeStyle = '#bcccdc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(170, 120, Math.hypot(state.x - 170, state.y - 120), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#14919b';
    ctx.beginPath();
    ctx.arc(state.x, state.y, 9, 0, Math.PI * 2);
    ctx.fill();
    arrow(ctx, state.x, state.y, state.x + state.vx * 42, state.y + state.vy * 42, '#f59f00', 'v');
    arrow(ctx, state.x, state.y, 170, 120, '#d64545', 'F');
    ctx.fillStyle = '#52606d';
    ctx.font = '13px sans-serif';
    ctx.fillText(`r = ${formatNumber(state.radius)}，T = ${formatNumber(state.period)} s`, 88, 214);
    return;
  }

  if (kind === 'bounded-magnetic-field') {
    if (backendSimulation?.model_id === 'bounded_magnetic_field') {
      renderBackendBoundedMagneticField(ctx, backendSimulation, time);
      return;
    }
    const state = boundedMagneticFieldState(params as any);
    const field = { left: 70, right: 306, top: 38, bottom: 198 };
    ctx.fillStyle = '#eef6f8';
    ctx.fillRect(field.left, field.top, field.right - field.left, field.bottom - field.top);
    ctx.strokeStyle = '#9fb3c8';
    ctx.lineWidth = 2;
    ctx.strokeRect(field.left, field.top, field.right - field.left, field.bottom - field.top);
    ctx.fillStyle = '#7b8794';
    ctx.font = '12px sans-serif';
    ctx.fillText('有界匀强磁场', 78, 58);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const x = 100 + col * 34;
        const y = 84 + row * 30;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#eef6f8';
        ctx.beginPath();
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7b8794';
      }
    }

    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#bcccdc';
    ctx.beginPath();
    ctx.moveTo(state.centerX, state.centerY);
    ctx.lineTo(state.entryX, state.entryY);
    ctx.moveTo(state.centerX, state.centerY);
    ctx.lineTo(state.exitX, state.exitY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#14919b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(
      state.centerX,
      state.centerY,
      state.displayRadius,
      -Math.PI / 2 * state.bend,
      -Math.PI / 2 * state.bend + state.bend * state.exitTheta,
      state.bend < 0,
    );
    ctx.stroke();

    ctx.fillStyle = '#d64545';
    ctx.beginPath();
    ctx.arc(state.centerX, state.centerY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14919b';
    ctx.beginPath();
    ctx.arc(state.exitX, state.exitY, 7, 0, Math.PI * 2);
    ctx.fill();
    arrow(ctx, 28, state.entryY, state.entryX + 42, state.entryY, '#f59f00', 'v0');
    arrow(ctx, state.exitX, state.exitY, state.exitX + state.exitVx * 42, state.exitY + state.exitVy * 42, '#f59f00', 'v出');

    ctx.fillStyle = '#52606d';
    ctx.font = '13px sans-serif';
    const boundaryName = state.boundary === 'right' ? '右边界' : state.boundary === 'top' ? '上边界' : state.boundary === 'bottom' ? '下边界' : '场内圆弧';
    ctx.fillText(`r=${formatNumber(state.radius)}  偏转角=${formatNumber(state.deflectionAngleDeg, 0)}°  出射：${boundaryName}`, 42, 222);
    return;
  }

  if (kind === 'electromagnetic-induction') {
    drawFieldDots(ctx);
    const state = inductionState({ ...(params as any), t: time });
    ctx.strokeStyle = '#243b53';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(70, 62);
    ctx.lineTo(305, 62);
    ctx.moveTo(70, 172);
    ctx.lineTo(305, 172);
    ctx.stroke();
    ctx.strokeStyle = '#14919b';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(state.rodX, 60);
    ctx.lineTo(state.rodX, 174);
    ctx.stroke();
    arrow(ctx, state.rodX + 8, 116, state.rodX + 54, 116, '#f59f00', 'v');
    arrow(ctx, state.rodX - 8, 132, state.rodX - 54, 132, '#d64545', 'F');
    ctx.fillStyle = '#52606d';
    ctx.font = '13px sans-serif';
    ctx.fillText(`E=${formatNumber(state.emf)} V  I=${formatNumber(state.current)} A  P热=${formatNumber(state.heatPower)} W`, 48, 214);
    return;
  }

  if (kind === 'ac-generator') {
    const state = acGeneratorState({ ...(params as any), t: time });
    drawFieldDots(ctx);
    ctx.save();
    ctx.translate(100, 92);
    ctx.rotate(state.angle);
    ctx.strokeStyle = '#14919b';
    ctx.lineWidth = 4;
    ctx.strokeRect(-42, -26, 84, 52);
    ctx.restore();
    drawSineGraph(ctx, Array.from({ length: 120 }, (_, i) => Math.sin(time * 2.4 - (1 - i / 119) * Math.PI * 2)), '#d64545', 168, 38);
    ctx.fillStyle = '#52606d';
    ctx.font = '13px sans-serif';
    ctx.fillText(`Φ=${formatNumber(state.flux)} Wb  e=${formatNumber(state.emf)} V`, 48, 214);
    return;
  }

  if (kind === 'lc-oscillation') {
    const state = lcOscillationState({ ...(params as any), t: time });
    ctx.strokeStyle = '#243b53';
    ctx.lineWidth = 4;
    ctx.strokeRect(66, 72, 48, 74);
    ctx.beginPath();
    ctx.moveTo(170, 80);
    for (let i = 0; i < 6; i += 1) {
      ctx.arc(180 + i * 14, 80, 7, Math.PI, 0, i % 2 === 0);
    }
    ctx.stroke();
    ctx.fillStyle = '#d64545';
    ctx.fillRect(66, 72, 48, Math.min(74, Math.abs(state.charge) * 42));
    const total = Math.max(state.electricEnergy + state.magneticEnergy, 0.001);
    ctx.fillStyle = '#f59f00';
    ctx.fillRect(70, 190, (state.electricEnergy / total) * 220, 12);
    ctx.fillStyle = '#14919b';
    ctx.fillRect(70 + (state.electricEnergy / total) * 220, 190, (state.magneticEnergy / total) * 220, 12);
    ctx.fillStyle = '#52606d';
    ctx.font = '13px sans-serif';
    ctx.fillText(`q=${formatNumber(state.charge)}  i=${formatNumber(state.current)}`, 110, 214);
    return;
  }

  const state = sensorDividerState(params as any);
  ctx.strokeStyle = '#243b53';
  ctx.lineWidth = 4;
  ctx.strokeRect(74, 66, 66, 36);
  ctx.strokeRect(220, 66, 66, 36);
  ctx.beginPath();
  ctx.moveTo(40, 84);
  ctx.lineTo(74, 84);
  ctx.moveTo(140, 84);
  ctx.lineTo(220, 84);
  ctx.moveTo(286, 84);
  ctx.lineTo(322, 84);
  ctx.stroke();
  const fillWidth = Math.min(66, Math.max(4, (state.sensorResistance / 1000) * 66));
  ctx.fillStyle = '#14919b';
  ctx.fillRect(74, 66, fillWidth, 36);
  ctx.fillStyle = '#52606d';
  ctx.font = '13px sans-serif';
  ctx.fillText(`Rs=${formatNumber(state.sensorResistance, 0)} Ω`, 76, 132);
  ctx.fillText(`Uout=${formatNumber(state.outputVoltage)} V`, 205, 132);
  arrow(ctx, 180, 112, 180, 160, '#d64545', '输出信号');
}

const PARAM_VALUE_LABELS: Partial<Record<DemoKind, Record<string, Record<string, string>>>> = {
  'left-hand-rule': {
    fieldDirection: {
      '1': '向里 ×',
      '-1': '向外 ·',
    },
    carrierSign: {
      '1': '正电荷/电流向右',
      '-1': '负电荷向右',
    },
  },
};

function formatParamValue(kind: DemoKind, key: string, value: number, step: number, unit?: string) {
  const label = PARAM_VALUE_LABELS[kind]?.[key]?.[String(value)];
  if (label) return label;
  return `${formatNumber(value, step < 1 ? 2 : 0)}${unit ? ` ${unit}` : ''}`;
}

function LeftHandTeacherPanel({ params, modelPackage }: { params: Params; modelPackage: PhysicsSimulation | null }) {
  const state = leftHandRuleState(params as any);
  const hasVideo = Boolean(modelPackage?.views?.three_d_video?.url);
  return (
    <div className="physics-teacher-panel">
      <section className="physics-teacher-section physics-teacher-focus">
        <h4>观察任务</h4>
        <p>{state.observationTask}</p>
      </section>
      <section className="physics-teacher-section">
        <h4>方向链</h4>
        <div className="physics-vector-chain">
          <span>{state.fieldShortLabel}</span>
          <b>→</b>
          <span>{state.equivalentCurrentLabel}</span>
          <b>→</b>
          <span>{state.forceLabel}</span>
        </div>
      </section>
      <section className="physics-teacher-section">
        <h4>三步判定</h4>
        <ol className="physics-teacher-steps">
          {state.decisionSteps.map(step => <li key={step}>{step}</li>)}
        </ol>
      </section>
      <section className="physics-teacher-section physics-teacher-warning">
        <h4>易错点</h4>
        <p>{state.commonMistake}</p>
      </section>
      {hasVideo && (
        <section className="physics-teacher-section">
          <h4>三维补充</h4>
          <p>切到“三维讲解”，看手、磁场、电流和受力在空间中的相互垂直关系。</p>
        </section>
      )}
    </div>
  );
}

export default function Elective2DemoPanel({ kpId, kpName }: Props) {
  const matched = useMemo(() => defaultDemoForKnowledgePoint(kpId), [kpId]);
  const [selected, setSelected] = useState<DemoOption>(matched ?? ELECTIVE2_DEMOS[0]);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS[(matched ?? ELECTIVE2_DEMOS[0]).kind]);
  const [playing, setPlaying] = useState(true);
  const [backendSimulation, setBackendSimulation] = useState<PhysicsSimulation | null>(null);
  const [modelView, setModelView] = useState<ModelView>('demo');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const next = matched ?? ELECTIVE2_DEMOS[0];
    setSelected(next);
    setParams(DEFAULT_PARAMS[next.kind]);
    setModelView('demo');
    timeRef.current = 0;
  }, [matched, kpId]);

  useEffect(() => {
    let alive = true;
    setBackendSimulation(null);
    if (!['left-hand-rule', 'bounded-magnetic-field'].includes(selected.kind)) return () => { alive = false; };
    api.getLearnSimulation(kpId)
      .then(result => {
        if (alive) setBackendSimulation(result.simulation);
      })
      .catch(() => {
        if (alive) setBackendSimulation(null);
      });
    return () => { alive = false; };
  }, [kpId, selected.kind]);

  useEffect(() => {
    if (modelView !== 'demo') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 360 * dpr;
    canvas.height = 240 * dpr;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      if (playing) timeRef.current += dt;
      renderDemo(ctx, selected.kind, params, timeRef.current, backendSimulation);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [backendSimulation, modelView, params, playing, selected.kind]);

  const controls = PARAM_LABELS[selected.kind];
  const modelPackage = backendSimulation?.model_id === 'left_hand_rule' ? backendSimulation : null;
  const threeDVideo = modelPackage?.views?.three_d_video;
  const aiContext = modelPackage?.ai_context;
  const formulas = modelPackage?.formulas?.length ? modelPackage.formulas : EQUATIONS[selected.kind];

  return (
    <div className="physics-demo-panel">
      <div className="physics-demo-header">
        <div>
          <div className="physics-demo-title">{selected.title}</div>
          <div className="physics-demo-subtitle">
            <span>{selected.subtitle}</span>
            <span>当前知识点：{kpName}</span>
          </div>
        </div>
        <select
          value={selected.kind}
          onChange={(event) => {
            const next = ELECTIVE2_DEMOS.find(demo => demo.kind === event.target.value) ?? selected;
            setSelected(next);
            setParams(DEFAULT_PARAMS[next.kind]);
            setModelView('demo');
            timeRef.current = 0;
          }}
          className="physics-demo-select"
        >
          {ELECTIVE2_DEMOS.map(demo => (
            <option key={demo.kind} value={demo.kind}>{demo.title}</option>
          ))}
        </select>
      </div>

      {modelPackage && (
        <div className="physics-model-tabs">
          <button type="button" className={modelView === 'demo' ? 'active' : ''} onClick={() => setModelView('demo')}>模型演示</button>
          <button type="button" className={modelView === 'video' ? 'active' : ''} onClick={() => setModelView('video')}>三维讲解</button>
          <button type="button" className={modelView === 'tips' ? 'active' : ''} onClick={() => setModelView('tips')}>关键提醒</button>
        </div>
      )}

      <div className="physics-demo-formula-strip">
        {formulas.map(eq => (
          <span key={eq}><LatexSpan text={`$${eq}$`} /></span>
        ))}
      </div>

      {modelView === 'video' && modelPackage ? (
        <div className="physics-demo-video-panel">
          {threeDVideo?.url ? (
            <video controls preload="metadata" src={resolveAssetUrl(threeDVideo.url)} />
          ) : (
            <div className="physics-demo-video-empty">三维讲解视频待生成</div>
          )}
          <div className="physics-demo-video-meta">
            <div>{modelPackage.title}</div>
            <span>Manim 三维标准动画</span>
          </div>
        </div>
      ) : modelView === 'tips' && modelPackage ? (
        <div className="physics-model-tips">
          <div className="physics-model-summary"><LatexSpan text={aiContext?.teacher_summary || ''} /></div>
          <div className="physics-model-vector-grid">
            {modelPackage.vectors && Object.entries(modelPackage.vectors).map(([key, vector]) => (
              <div key={key} className="physics-model-vector">
                <span style={{ background: vector.color }} />
                <b><LatexSpan text={`$${vector.symbol}$`} /></b>
                <div><LatexSpan text={vector.label} /></div>
                <small><LatexSpan text={vector.teaching_role || ''} /></small>
              </div>
            ))}
          </div>
          {aiContext?.common_mistakes?.length ? (
            <ul className="physics-model-mistakes">
              {aiContext.common_mistakes.map(item => <li key={item}><LatexSpan text={item} /></li>)}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="physics-demo-grid">
        <div className="physics-demo-canvas-wrap">
          <canvas ref={canvasRef} className="physics-demo-canvas" />
          <div className="physics-demo-actions">
            <button type="button" onClick={() => setPlaying(value => !value)}>{playing ? '暂停' : '播放'}</button>
            <button type="button" onClick={() => { timeRef.current = 0; }}>重播</button>
          </div>
        </div>

        <div className="physics-demo-side">
          {selected.kind === 'left-hand-rule' && (
            <LeftHandTeacherPanel params={params} modelPackage={modelPackage} />
          )}
          <div className="physics-demo-controls">
            {Object.entries(controls).map(([key, cfg]) => (
              <label key={key}>
                <span>{cfg.label}</span>
                <b>{formatParamValue(selected.kind, key, params[key], cfg.step, cfg.unit)}</b>
                <input
                  type="range"
                  min={cfg.min}
                  max={cfg.max}
                  step={cfg.step}
                  value={params[key]}
                  onChange={(event) => setParams(prev => ({ ...prev, [key]: Number(event.target.value) }))}
                />
              </label>
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
