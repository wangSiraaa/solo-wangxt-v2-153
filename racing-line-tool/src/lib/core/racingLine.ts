import { computeCurvature } from './curvature';
import type { CenterlineGeometry } from './geometry';
import type { Vec2 } from './types';

/**
 * 赛车线：在固定数量的控制站上给出横向偏移（沿法向，左正右负），
 * 站间用周期 Catmull-Rom 平滑插值，因此线路是确定的连续曲线；
 * 线路几何在固定细网格上建表，求解网格加密时几何不变。
 */

/** 偏移控制站数量（按归一化弧长均布）。 */
export const LINE_STATIONS = 256;
/** 线路几何建表间距（米），固定不变。 */
export const LINE_GEOM_DS = 0.25;
/** 车身边际：线路与赛道边界保留的距离（米）。 */
export const LINE_MARGIN = 0.75;

export interface LineGeometry {
  closed: boolean;
  length: number;
  dsGeom: number;
  pts: Vec2[];
  kappa: Float64Array;
}

/** 站点 i 的归一化弧长 τ ∈ [0,1)。 */
export function stationTau(i: number, closed: boolean): number {
  return closed ? i / LINE_STATIONS : i / (LINE_STATIONS - 1);
}

/** 一维周期/非周期 Catmull-Rom 插值偏移函数 o(τ)。 */
export function offsetAt(offsets: number[], tau: number, closed: boolean): number {
  const M = offsets.length;
  if (M === 0) return 0;
  if (closed) {
    const x = ((tau % 1) + 1) % 1 * M;
    const i1 = Math.floor(x) % M;
    const t = x - Math.floor(x);
    const i0 = (i1 - 1 + M) % M;
    const i2 = (i1 + 1) % M;
    const i3 = (i1 + 2) % M;
    return cr1(offsets[i0], offsets[i1], offsets[i2], offsets[i3], t);
  }
  const x = Math.min(1, Math.max(0, tau)) * (M - 1);
  const i1 = Math.min(M - 2, Math.floor(x));
  const t = x - i1;
  const i0 = Math.max(0, i1 - 1);
  const i2 = Math.min(M - 1, i1 + 1);
  const i3 = Math.min(M - 1, i1 + 2);
  return cr1(offsets[i0], offsets[i1], offsets[i2], offsets[i3], t);
}

function cr1(p0: number, p1: number, p2: number, p3: number, t: number): number {
  // 均匀参数化 Catmull-Rom
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
  );
}

/** 站点 i 处的偏移合法区间（含车身边际）。 */
export function offsetBoundsAt(center: CenterlineGeometry, i: number): [number, number] {
  const g = center.eval(stationTau(i, center.closed) * center.length);
  return [-(g.halfWidthR - LINE_MARGIN), g.halfWidthL - LINE_MARGIN];
}

/** 将全部站点偏移钳制到边界内 —— 线路必须位于赛道边界内。 */
export function clampOffsets(center: CenterlineGeometry, offsets: number[]): number[] {
  return offsets.map((o, i) => {
    const [lo, hi] = offsetBoundsAt(center, i);
    return Math.min(hi, Math.max(lo, o));
  });
}

/** 线路是否全程位于边界内（站点处检查，含数值容差）。 */
export function lineWithinBounds(center: CenterlineGeometry, offsets: number[], tol = 1e-6): boolean {
  for (let i = 0; i < offsets.length; i++) {
    const [lo, hi] = offsetBoundsAt(center, i);
    if (offsets[i] < lo - tol || offsets[i] > hi + tol) return false;
  }
  return true;
}

/** 在固定细网格上构建线路几何（位置 + 曲率表）。 */
export function buildLineGeometry(center: CenterlineGeometry, offsets: number[]): LineGeometry {
  const L = center.length;
  const n = Math.max(8, Math.round(L / LINE_GEOM_DS));
  const dsGeom = L / n;
  const count = center.closed ? n : n + 1;
  const pts: Vec2[] = [];
  for (let k = 0; k < count; k++) {
    const s = k * dsGeom;
    const g = center.eval(s);
    const o = offsetAt(offsets, s / L, center.closed);
    pts.push({ x: g.x + g.nx * o, y: g.y + g.ny * o });
  }
  const kappa = computeCurvature(pts, dsGeom, center.closed);
  return { closed: center.closed, length: L, dsGeom, pts, kappa };
}

/**
 * 在求解网格上采样线路曲率：从固定几何表线性插值，
 * 网格加密时 κ(s) 不变，圈时收敛。
 */
export function sampleLineKappa(line: LineGeometry, targetDs: number): { kappa: Float64Array; ds: number } {
  const n = Math.max(line.closed ? 8 : 2, Math.round(line.length / targetDs));
  const ds = line.length / n;
  const count = line.closed ? n : n + 1;
  const kappa = new Float64Array(count);
  const tableN = line.pts.length;
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    const x = s / line.dsGeom;
    const k0 = Math.floor(x);
    const frac = x - k0;
    const a = line.closed ? k0 % tableN : Math.min(tableN - 1, k0);
    const b = line.closed ? (k0 + 1) % tableN : Math.min(tableN - 1, k0 + 1);
    kappa[i] = line.kappa[a] * (1 - frac) + line.kappa[b] * frac;
  }
  return { kappa, ds };
}

/**
 * 在边界走廊内优化赛车线：对站点偏移做拉普拉斯平滑（降低曲率），
 * 每步钳制到走廊内。
 */
export function optimizeLine(center: CenterlineGeometry, iterations = 400, relax = 0.5): number[] {
  const M = LINE_STATIONS;
  let offsets = new Array<number>(M).fill(0);
  const idx = (i: number) => (center.closed ? ((i % M) + M) % M : Math.min(M - 1, Math.max(0, i)));
  for (let it = 0; it < iterations; it++) {
    const next = offsets.slice();
    for (let i = 0; i < M; i++) {
      if (!center.closed && (i === 0 || i === M - 1)) continue; // 开放赛道端点固定
      const avg = 0.5 * (offsets[idx(i - 1)] + offsets[idx(i + 1)]);
      next[i] = offsets[i] + relax * (avg - offsets[i]);
    }
    offsets = clampOffsets(center, next);
  }
  return offsets;
}
