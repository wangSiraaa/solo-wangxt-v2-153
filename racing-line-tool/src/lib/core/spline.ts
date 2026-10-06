import { matrix, lusolve, type Matrix } from 'mathjs';
import type { Vec2 } from './types';

/**
 * 向心 Catmull-Rom 样条，以三次多项式段表示，支持解析求导。
 * 每段 P(u) = c0 + c1·u + c2·u² + c3·u³，u ∈ [0,1]。
 * 曲率 κ = (x'·y'' − y'·x'') / (x'² + y'²)^(3/2) 与参数化无关，
 * 因此几何形状不随求解采样间距变化 —— 这是加密稳定性的关键。
 */

export interface CubicSeg {
  cx: [number, number, number, number];
  cy: [number, number, number, number];
}

function catmullRomPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  // 向心参数化（alpha = 0.5）
  const eps = 1e-9;
  const d01 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)) + eps;
  const d12 = Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y)) + eps;
  const d23 = Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)) + eps;
  const t0 = 0;
  const t1 = t0 + d01;
  const t2 = t1 + d12;
  const t3 = t2 + d23;
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
    const w = (tt - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** Vandermonde 矩阵（u = 0, 1/3, 2/3, 1），用 mathjs 求解三次系数。 */
const VANDER = matrix([
  [1, 0, 0, 0],
  [1, 1 / 3, 1 / 9, 1 / 27],
  [1, 2 / 3, 4 / 9, 8 / 27],
  [1, 1, 1, 1]
]);

/** 由四点构造一段三次样条（系数通过 mathjs lusolve 解线性方程组）。 */
export function segmentCoeffs(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): CubicSeg {
  const us = [0, 1 / 3, 2 / 3, 1];
  const px = us.map((u) => catmullRomPoint(p0, p1, p2, p3, u).x);
  const py = us.map((u) => catmullRomPoint(p0, p1, p2, p3, u).y);
  // lusolve 返回列矩阵，需逐行取出标量
  const col = (b: number[]) =>
    ((lusolve(VANDER, matrix(b)) as Matrix).toArray() as number[][]).map((row) => row[0]);
  const cx = col(px);
  const cy = col(py);
  return { cx: cx as CubicSeg['cx'], cy: cy as CubicSeg['cy'] };
}

export function evalCubic(seg: CubicSeg, u: number): Vec2 {
  const { cx, cy } = seg;
  return {
    x: ((cx[3] * u + cx[2]) * u + cx[1]) * u + cx[0],
    y: ((cy[3] * u + cy[2]) * u + cy[1]) * u + cy[0]
  };
}

/** 一阶导数 dP/du。 */
export function evalCubicD1(seg: CubicSeg, u: number): Vec2 {
  const { cx, cy } = seg;
  return {
    x: (3 * cx[3] * u + 2 * cx[2]) * u + cx[1],
    y: (3 * cy[3] * u + 2 * cy[2]) * u + cy[1]
  };
}

/** 二阶导数 d²P/du²。 */
export function evalCubicD2(seg: CubicSeg, u: number): Vec2 {
  const { cx, cy } = seg;
  return { x: 6 * cx[3] * u + 2 * cx[2], y: 6 * cy[3] * u + 2 * cy[2] };
}

/** 对控制点序列插值（兼容用途：显示用稠密折线）。 */
export function sampleSpline(points: Vec2[], closed: boolean, segDiv = 16): Vec2[] {
  const n = points.length;
  if (n < 2) return points.slice();
  const out: Vec2[] = [];
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const i0 = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const i1 = i;
    const i2 = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const i3 = closed ? (i + 2) % n : Math.min(n - 1, i + 2);
    const seg = segmentCoeffs(points[i0], points[i1], points[i2], points[i3]);
    for (let j = 0; j < segDiv; j++) out.push(evalCubic(seg, j / segDiv));
  }
  if (!closed) out.push({ ...points[n - 1] });
  return out;
}
