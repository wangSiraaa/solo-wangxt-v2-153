import type { CenterlineGeometry } from './geometry';
import type { ConstraintKind, SpeedSolution, TrackSpec } from './types';

export interface SegmentReport {
  index: number;
  sStart: number;
  sEnd: number;
  length: number;
  time: number;
  /** 覆盖采样点数最多的约束 */
  dominant: ConstraintKind;
  /** 各约束在该段内覆盖的采样点数 */
  counts: Record<ConstraintKind, number>;
}

/**
 * 逐段（控制点之间）汇总圈时与约束分布。
 * 段边界取几何体各样条段起点的精确弧长。
 */
export function buildSegmentReport(spec: TrackSpec, geom: CenterlineGeometry, sol: SpeedSolution): SegmentReport[] {
  const nCp = spec.points.length;
  const segCount = spec.closed ? nCp : nCp - 1;
  const bounds = geom.segmentStarts();
  const n = sol.v.length;
  const ds = sol.ds;
  const reports: SegmentReport[] = [];
  for (let seg = 0; seg < segCount; seg++) {
    const s0 = bounds[seg];
    const s1 = bounds[seg + 1];
    const counts: Record<ConstraintKind, number> = { curvature: 0, acceleration: 0, braking: 0, topSpeed: 0 };
    let time = 0;
    // 段 i→i+1 的耗时记在起点 i 所属的赛道段上
    for (let i = 0; i < sol.segTime.length; i++) {
      const s = (i * ds) % geom.length;
      const inSeg = s0 <= s1 ? s >= s0 && s < s1 : s >= s0 || s < s1; // 末段可能跨零
      if (!inSeg) continue;
      time += sol.segTime[i];
      counts[sol.constraint[i % n]]++;
    }
    const dominant = (Object.entries(counts) as [ConstraintKind, number][]).sort((a, b) => b[1] - a[1])[0][0];
    reports.push({ index: seg, sStart: s0, sEnd: s1, length: s1 >= s0 ? s1 - s0 : geom.length - s0 + s1, time, dominant, counts });
  }
  return reports;
}
