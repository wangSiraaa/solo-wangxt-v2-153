import { segmentCoeffs, evalCubic, evalCubicD1, evalCubicD2, type CubicSeg } from './spline';
import type { TrackSpec } from './types';

export interface GeomSample {
  x: number;
  y: number;
  /** 单位切向（行进方向） */
  tx: number;
  ty: number;
  /** 单位法向（左侧） */
  nx: number;
  ny: number;
  /** 有符号曲率（解析公式，与采样间距无关） */
  kappa: number;
  halfWidthL: number;
  halfWidthR: number;
}

/** 每段弧长表子步数（仅用于 s ↔ 参数 u 的映射，不影响曲率解析值）。 */
const ARC_SUBSTEPS = 64;

/**
 * 中心线几何：解析样条 + 弧长参数化。
 * 任意 s 处的位置 / 切法向 / 曲率 / 半宽都是同一个连续函数的取值，
 * 求解网格加密时几何不变，圈时才能收敛。
 */
export class CenterlineGeometry {
  readonly closed: boolean;
  readonly length: number;
  private segs: CubicSeg[] = [];
  /** 控制点宽度（段 i 连接控制点 i 与 i+1，段内线性插值） */
  private cpWidths: number[] = [];
  /** 段起点弧长 */
  private segStart: number[] = [];
  /** 每段子步累积弧长（ARC_SUBSTEPS+1 个） */
  private subCum: number[][] = [];

  constructor(spec: TrackSpec) {
    const pts = spec.points;
    const n = pts.length;
    if (n < (spec.closed ? 3 : 2)) throw new Error('控制点数量不足');
    this.closed = spec.closed;
    this.cpWidths = pts.map((p) => p.width);
    const segCount = this.closed ? n : n - 1;

    let s = 0;
    for (let i = 0; i < segCount; i++) {
      const i0 = this.closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const i1 = i;
      const i2 = this.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      const i3 = this.closed ? (i + 2) % n : Math.min(n - 1, i + 2);
      const seg = segmentCoeffs(pts[i0], pts[i1], pts[i2], pts[i3]);
      this.segs.push(seg);
      this.segStart.push(s);
      const cum: number[] = [0];
      let prev = evalCubic(seg, 0);
      for (let k = 1; k <= ARC_SUBSTEPS; k++) {
        const p = evalCubic(seg, k / ARC_SUBSTEPS);
        s += Math.hypot(p.x - prev.x, p.y - prev.y);
        cum.push(s - this.segStart[i]);
        prev = p;
      }
      this.subCum.push(cum);
    }
    this.length = s;
  }

  /** 各样条段起点（即各控制点）的弧长，末元素为总长。 */
  segmentStarts(): number[] {
    return [...this.segStart, this.length];
  }

  /** 归一化弧长（闭合回绕，开放钳制）。 */
  private normalizeS(s: number): number {
    if (this.closed) {
      const L = this.length;
      return ((s % L) + L) % L;
    }
    return Math.min(this.length, Math.max(0, s));
  }

  /** 在弧长 s 处求值。 */
  eval(s: number): GeomSample {
    const sn = this.normalizeS(s);
    // 二分查找所在段
    let lo = 0;
    let hi = this.segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segStart[mid] <= sn) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const local = sn - this.segStart[i];
    // 段内子步定位 + 线性插值参数 u
    const cum = this.subCum[i];
    let k = 0;
    while (k < ARC_SUBSTEPS - 1 && cum[k + 1] < local) k++;
    const span = cum[k + 1] - cum[k];
    const frac = span > 0 ? (local - cum[k]) / span : 0;
    const u = Math.min(1, Math.max(0, (k + frac) / ARC_SUBSTEPS));

    const seg = this.segs[i];
    const p = evalCubic(seg, u);
    const d1 = evalCubicD1(seg, u);
    const d2 = evalCubicD2(seg, u);
    const sp = Math.hypot(d1.x, d1.y) || 1;
    const tx = d1.x / sp;
    const ty = d1.y / sp;
    // 参数化无关的曲率公式
    const kappa = (d1.x * d2.y - d1.y * d2.x) / (sp * sp * sp);
    const nCp = this.cpWidths.length;
    const w0 = this.cpWidths[i % nCp];
    const w1 = this.cpWidths[(i + 1) % nCp];
    const w = w0 + (w1 - w0) * u;
    return {
      x: p.x,
      y: p.y,
      tx,
      ty,
      nx: -ty,
      ny: tx,
      kappa,
      halfWidthL: w / 2,
      halfWidthR: w / 2
    };
  }
}
