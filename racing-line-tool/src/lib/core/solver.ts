import { matrix, map, sqrt as mSqrt, dotDivide, abs as mAbs, type Matrix, type MathCollection } from 'mathjs';
import type { ConstraintKind, SpeedSolution, VehicleParams } from './types';

const KAPPA_EPS = 1e-6; // 直道曲率下限，避免除零
const CONV_TOL = 1e-6; // 速度不动点收敛容差 m/s
const MAX_SWEEPS = 500;

/**
 * 曲率限速：v ≤ sqrt(aLatMax / |κ|)，再受极速封顶。
 * 用 mathjs 逐元素计算。
 */
export function curvatureSpeedLimit(kappa: Float64Array, params: VehicleParams): { vCurve: Float64Array; uncapped: Float64Array } {
  const kAbs = mAbs(matrix(Array.from(kappa))) as Matrix;
  const kSafe = map(kAbs, (k) => Math.max(k, KAPPA_EPS)) as Matrix;
  const vRaw = map(dotDivide(params.aLatMax, kSafe) as MathCollection, (x) => mSqrt(x) as number) as Matrix;
  const uncapped = Float64Array.from(vRaw.toArray() as number[]);
  const vCapped = map(vRaw, (x) => Math.min(x, params.vMax)) as Matrix; // 逐元素与极速取小
  return { vCurve: Float64Array.from(vCapped.toArray() as number[]), uncapped };
}

/** 摩擦圆修正：横向占用越多，纵向可用加/减速越少。 */
function longAccel(base: number, v: number, kappa: number, aLatMax: number, ellipse: boolean): number {
  if (!ellipse) return base;
  const usage = Math.min(1, (v * v * Math.abs(kappa)) / aLatMax);
  return base * Math.sqrt(Math.max(0, 1 - usage * usage));
}

/**
 * 质点速度求解：
 *  1. 曲率给出每点上限 vCurve（不允许超过）；
 *  2. 前向传播加速约束 v[i+1]² ≤ v[i]² + 2·aAcc·ds；
 *  3. 后向传播制动约束 v[i]² ≤ v[i+1]² + 2·aBrake·ds；
 *  往返扫描至不动点（单调下降有下界，必收敛）。
 * 闭合赛道环绕传播，开放赛道两端由曲率上限自然约束。
 */
export function solveSpeed(kappa: Float64Array, ds: number, closed: boolean, params: VehicleParams): SpeedSolution {
  const n = kappa.length;
  const { vCurve, uncapped } = curvatureSpeedLimit(kappa, params);
  const v = Float64Array.from(vCurve);

  const idx = (i: number) => (closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i)));
  const lastSeg = closed ? n : n - 1; // 段数：闭合 n 段，开放 n-1 段

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let maxDelta = 0;
    // 前向：加速能力限制
    for (let i = 0; i < lastSeg; i++) {
      const j = idx(i + 1);
      const a = longAccel(params.aAccel, v[i], kappa[i], params.aLatMax, params.frictionEllipse);
      const reach = mSqrt(v[i] * v[i] + 2 * a * ds) as number;
      if (v[j] > reach) {
        maxDelta = Math.max(maxDelta, v[j] - reach);
        v[j] = reach;
      }
    }
    // 后向：制动能力限制
    for (let i = lastSeg - 1; i >= 0; i--) {
      const j = idx(i + 1);
      const a = longAccel(params.aBrake, v[j], kappa[j], params.aLatMax, params.frictionEllipse);
      const reach = mSqrt(v[j] * v[j] + 2 * a * ds) as number;
      if (v[i] > reach) {
        maxDelta = Math.max(maxDelta, v[i] - reach);
        v[i] = reach;
      }
    }
    if (maxDelta < CONV_TOL) break;
  }

  // 分段耗时：匀加速假设下 dt = 2·ds / (v_i + v_{i+1})
  const segTime = new Float64Array(lastSeg);
  let lapTime = 0;
  for (let i = 0; i < lastSeg; i++) {
    const j = idx(i + 1);
    const dt = (2 * ds) / (v[i] + v[j]);
    segTime[i] = dt;
    lapTime += dt;
  }

  // 约束标注：每点必居其一，优先级 极速 > 曲率 > 加速 > 制动
  const constraint: ConstraintKind[] = new Array(n);
  const tol = (x: number) => 1e-3 * Math.max(1, x);
  for (let i = 0; i < n; i++) {
    if (v[i] >= params.vMax - tol(params.vMax) && uncapped[i] > params.vMax + tol(params.vMax)) {
      constraint[i] = 'topSpeed';
    } else if (v[i] >= vCurve[i] - tol(vCurve[i])) {
      constraint[i] = 'curvature';
    } else {
      const p = idx(i - 1);
      const a = longAccel(params.aAccel, v[p], kappa[p], params.aLatMax, params.frictionEllipse);
      const fwdReach = Math.sqrt(v[p] * v[p] + 2 * a * ds);
      constraint[i] = v[i] >= fwdReach - tol(v[i]) ? 'acceleration' : 'braking';
    }
  }

  return { v, vCurve, constraint, segTime, lapTime, ds };
}
