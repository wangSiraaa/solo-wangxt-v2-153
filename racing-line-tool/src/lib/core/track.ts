import { CenterlineGeometry } from './geometry';
import type { SampledTrack, TrackControlPoint, TrackSpec, Vec2 } from './types';

/**
 * 由控制点构建均匀弧长采样的赛道。
 * 几何来自解析样条（CenterlineGeometry），采样间距只影响求解网格，
 * 不影响 κ(s) 本身 —— 加密求解网格时结果收敛。
 */
export function buildTrack(spec: TrackSpec, targetDs = 1.0): SampledTrack {
  const geom = new CenterlineGeometry(spec);
  return sampleTrack(geom, targetDs);
}

/** 在几何上按目标间距均匀采样。 */
export function sampleTrack(geom: CenterlineGeometry, targetDs: number): SampledTrack {
  const L = geom.length;
  const n = Math.max(geom.closed ? 8 : 2, Math.round(L / targetDs));
  const ds = L / n;
  const count = geom.closed ? n : n + 1;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const g = geom.eval(i * ds);
    pts.push({
      x: g.x,
      y: g.y,
      nx: g.nx,
      ny: g.ny,
      s: i * ds,
      kappa: g.kappa,
      halfWidthL: g.halfWidthL,
      halfWidthR: g.halfWidthR
    });
  }
  return { pts, closed: geom.closed, length: L, ds };
}

/** 赛道左/右边界折线（供 Three.js 渲染与越界检查）。 */
export function trackBoundaries(track: SampledTrack): { left: Vec2[]; right: Vec2[] } {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (const p of track.pts) {
    left.push({ x: p.x + p.nx * p.halfWidthL, y: p.y + p.ny * p.halfWidthL });
    right.push({ x: p.x - p.nx * p.halfWidthR, y: p.y - p.ny * p.halfWidthR });
  }
  return { left, right };
}

/** 控制点默认值辅助。 */
export function cp(x: number, y: number, width: number): TrackControlPoint {
  return { x, y, width };
}
