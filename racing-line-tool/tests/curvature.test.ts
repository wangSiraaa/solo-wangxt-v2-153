import { describe, it, expect } from 'vitest';
import { computeCurvature } from '../src/lib/core/curvature';
import { buildTrack, cp } from '../src/lib/core/track';

describe('曲率计算', () => {
  it('直线曲率 ≈ 0', () => {
    const track = buildTrack({ name: 't', closed: false, points: [cp(0, 0, 10), cp(100, 0, 10), cp(200, 0, 10)] }, 1);
    for (const p of track.pts) expect(Math.abs(p.kappa)).toBeLessThan(1e-9);
  });

  it('解析曲率：样条圆 ≈ 1/R', () => {
    // 32 个圆周控制点，中心线几何的解析曲率应紧贴 1/R
    const R = 50;
    const pts = Array.from({ length: 32 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      return cp(R * Math.cos(a), R * Math.sin(a), 10);
    });
    const track = buildTrack({ name: 'c', closed: true, points: pts }, 0.5);
    for (const p of track.pts) {
      expect(Math.abs(Math.abs(p.kappa) - 1 / R)).toBeLessThan(1e-3);
    }
  });

  it('有限差分曲率（mathjs）：精确圆折线 ≈ 1/R', () => {
    // computeCurvature 用于线路几何建表（固定细网格），本身也要正确
    const R = 50;
    const n = 2000;
    const ds = (2 * Math.PI * R) / n;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { x: R * Math.cos(a), y: R * Math.sin(a) };
    });
    const kappa = computeCurvature(pts, ds, true);
    for (const k of kappa) {
      expect(Math.abs(Math.abs(k) - 1 / R)).toBeLessThan(1e-4);
    }
  });

  it('弯越急曲率越大（发夹半径明显小于 20 m）', () => {
    const hairpin = buildTrack(
      {
        name: 'h',
        closed: false,
        points: [cp(0, 0, 12), cp(100, 0, 12), cp(120, 2, 12), cp(126, 14, 12), cp(116, 24, 12), cp(104, 18, 12), cp(100, 8, 12), cp(60, 6, 12), cp(0, 6, 12)]
      },
      0.5
    );
    const maxK = Math.max(...hairpin.pts.map((p) => Math.abs(p.kappa)));
    expect(maxK).toBeGreaterThan(1 / 20);
  });
});
