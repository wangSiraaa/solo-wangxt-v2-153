import { describe, it, expect } from 'vitest';
import { buildTrack } from '../src/lib/core/track';
import { CenterlineGeometry } from '../src/lib/core/geometry';
import { solveSpeed } from '../src/lib/core/solver';
import { buildSegmentReport } from '../src/lib/core/report';
import { straightIntoHairpin, closedLoop, DEFAULT_VEHICLE } from '../src/lib/core/samples';

describe('逐段圈时报告', () => {
  it('各段耗时之和 = 圈时（闭合与开放都成立）', () => {
    for (const spec of [straightIntoHairpin, closedLoop]) {
      const geom = new CenterlineGeometry(spec);
      const track = buildTrack(spec, 0.5);
      const kappa = Float64Array.from(track.pts.map((p) => p.kappa));
      const sol = solveSpeed(kappa, track.ds, track.closed, DEFAULT_VEHICLE);
      const report = buildSegmentReport(spec, geom, sol);
      const sum = report.reduce((a, r) => a + r.time, 0);
      expect(sum).toBeCloseTo(sol.lapTime, 6);
      // 段数 = 控制点段数
      expect(report.length).toBe(spec.closed ? spec.points.length : spec.points.length - 1);
    }
  });

  it('直道接急弯：存在制动主导的段，且急弯段内含曲率限制点', () => {
    const spec = straightIntoHairpin;
    const geom = new CenterlineGeometry(spec);
    const track = buildTrack(spec, 0.5);
    const kappa = Float64Array.from(track.pts.map((p) => p.kappa));
    const sol = solveSpeed(kappa, track.ds, track.closed, DEFAULT_VEHICLE);
    const report = buildSegmentReport(spec, geom, sol);
    const dominants = report.map((r) => r.dominant);
    expect(dominants).toContain('braking');
    // 曲率限制区较短，不一定占段内多数，但必须出现在某段中
    expect(report.some((r) => r.counts.curvature > 0)).toBe(true);
  });
});
