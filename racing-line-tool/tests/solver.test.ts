import { describe, it, expect } from 'vitest';
import { buildTrack } from '../src/lib/core/track';
import { CenterlineGeometry } from '../src/lib/core/geometry';
import { solveSpeed } from '../src/lib/core/solver';
import { straightIntoHairpin, closedLoop, widthVarying, DEFAULT_VEHICLE } from '../src/lib/core/samples';
import {
  optimizeLine,
  clampOffsets,
  lineWithinBounds,
  buildLineGeometry,
  sampleLineKappa,
  LINE_STATIONS
} from '../src/lib/core/racingLine';
import type { TrackSpec, VehicleParams } from '../src/lib/core/types';

const V: VehicleParams = { ...DEFAULT_VEHICLE };

function solve(spec: TrackSpec, ds: number, veh = V) {
  const track = buildTrack(spec, ds);
  const kappa = Float64Array.from(track.pts.map((p) => p.kappa));
  return { track, sol: solveSpeed(kappa, track.ds, track.closed, veh) };
}

describe('速度求解器：直道接急弯', () => {
  const { track, sol } = solve(straightIntoHairpin, 0.5);

  it('任何点都不超过曲率限速', () => {
    for (let i = 0; i < sol.v.length; i++) {
      expect(sol.v[i]).toBeLessThanOrEqual(sol.vCurve[i] + 1e-6);
    }
  });

  it('解满足前后向传播约束（不能逐点独立给最高速度）', () => {
    const n = sol.v.length;
    for (let i = 0; i < n - 1; i++) {
      const fwd = Math.sqrt(sol.v[i] ** 2 + 2 * V.aAccel * track.ds);
      expect(sol.v[i + 1]).toBeLessThanOrEqual(fwd + 1e-4);
      const bwd = Math.sqrt(sol.v[i + 1] ** 2 + 2 * V.aBrake * track.ds);
      expect(sol.v[i]).toBeLessThanOrEqual(bwd + 1e-4);
    }
  });

  it('存在被传播约束压低的点（v 明显小于曲率上限）', () => {
    let count = 0;
    for (let i = 0; i < sol.v.length; i++) {
      if (sol.v[i] < sol.vCurve[i] - 1.0) count++;
    }
    expect(count).toBeGreaterThan(0);
  });

  it('直道达到极速并标注 topSpeed，弯前出现制动段，弯心为曲率限制', () => {
    expect(sol.constraint).toContain('topSpeed');
    expect(sol.constraint).toContain('braking');
    expect(sol.constraint).toContain('curvature');
    expect(Math.max(...sol.v)).toBeCloseTo(V.vMax, 3);
  });

  it('弯心速度 ≈ sqrt(aLat/κmax)', () => {
    const kappaAbs = track.pts.map((p) => Math.abs(p.kappa));
    const iApex = kappaAbs.indexOf(Math.max(...kappaAbs));
    const expectV = Math.sqrt(V.aLatMax / kappaAbs[iApex]);
    expect(sol.v[iApex]).toBeCloseTo(expectV, 0);
    expect(sol.constraint[iApex]).toBe('curvature');
  });

  it('分段耗时之和等于圈时', () => {
    let sum = 0;
    for (const t of sol.segTime) sum += t;
    expect(sum).toBeCloseTo(sol.lapTime, 9);
    expect(sol.lapTime).toBeGreaterThan(0);
  });
});

describe('速度求解器：闭合环路', () => {
  const { track, sol } = solve(closedLoop, 0.5);

  it('环绕传播收敛且满足约束（含首尾接缝）', () => {
    const n = sol.v.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const fwd = Math.sqrt(sol.v[i] ** 2 + 2 * V.aAccel * track.ds);
      expect(sol.v[j]).toBeLessThanOrEqual(fwd + 1e-4);
      const bwd = Math.sqrt(sol.v[j] ** 2 + 2 * V.aBrake * track.ds);
      expect(sol.v[i]).toBeLessThanOrEqual(bwd + 1e-4);
      expect(sol.v[i]).toBeLessThanOrEqual(sol.vCurve[i] + 1e-6);
    }
  });

  it('闭合赛道段数 = 采样点数，圈时为正', () => {
    expect(sol.segTime.length).toBe(sol.v.length);
    expect(sol.lapTime).toBeGreaterThan(0);
  });
});

describe('采样加密稳定性（几何与求解网格解耦）', () => {
  for (const [name, spec] of [
    ['直道接急弯', straightIntoHairpin],
    ['闭合环路', closedLoop],
    ['宽窄变化', widthVarying]
  ] as const) {
    it(`${name}：中心线 ds 2→1→0.5 圈时稳定（误差 <2%）`, () => {
      const t2 = solve(spec, 2).sol.lapTime;
      const t1 = solve(spec, 1).sol.lapTime;
      const t05 = solve(spec, 0.5).sol.lapTime;
      // 加密后结果须在规定误差内稳定（收敛不必严格单调）
      expect(Math.abs(t2 - t1) / t1).toBeLessThan(0.02);
      expect(Math.abs(t1 - t05) / t05).toBeLessThan(0.02);
    });
  }

  it('优化线路：ds 2→1→0.5 圈时稳定（误差 <2%）', () => {
    const center = new CenterlineGeometry(widthVarying);
    const offsets = optimizeLine(center, 400);
    const lineGeom = buildLineGeometry(center, offsets);
    const lap = (ds: number) => {
      const { kappa, ds: actual } = sampleLineKappa(lineGeom, ds);
      return solveSpeed(kappa, actual, lineGeom.closed, V).lapTime;
    };
    const t2 = lap(2);
    const t1 = lap(1);
    const t05 = lap(0.5);
    expect(Math.abs(t2 - t1) / t1).toBeLessThan(0.02);
    expect(Math.abs(t1 - t05) / t05).toBeLessThan(0.02);
  });
});

describe('赛车线', () => {
  const center = new CenterlineGeometry(widthVarying);

  it('优化线路全程位于边界内', () => {
    const offsets = optimizeLine(center, 400);
    expect(offsets.length).toBe(LINE_STATIONS);
    expect(lineWithinBounds(center, offsets)).toBe(true);
  });

  it('钳制函数能把越界偏移拉回边界内', () => {
    const crazy = Array.from({ length: LINE_STATIONS }, (_, i) => (i % 2 === 0 ? 1e6 : -1e6));
    const clamped = clampOffsets(center, crazy);
    expect(lineWithinBounds(center, clamped)).toBe(true);
  });

  it('优化线路圈时不劣于中心线，且峰值曲率不更高', () => {
    const offsets = optimizeLine(center, 400);
    const lineGeom = buildLineGeometry(center, offsets);
    const kLine = sampleLineKappa(lineGeom, 0.5);
    const tLine = solveSpeed(kLine.kappa, kLine.ds, lineGeom.closed, V).lapTime;

    const track = buildTrack(widthVarying, 0.5);
    const kCenter = Float64Array.from(track.pts.map((p) => p.kappa));
    const tCenter = solveSpeed(kCenter, track.ds, track.closed, V).lapTime;

    expect(tLine).toBeLessThanOrEqual(tCenter * 1.001);
    const maxK = (k: Float64Array) => Math.max(...Array.from(k).map(Math.abs));
    expect(maxK(Float64Array.from(kLine.kappa))).toBeLessThanOrEqual(maxK(kCenter) * 1.001);
  });
});
