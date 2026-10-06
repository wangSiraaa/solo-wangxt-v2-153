import { describe, expect, it } from 'vitest';
import { buildTrackSurface, sampleRoute } from './geometry';
import { analyzeRoute, checkSamplingStability, computeSpeedProfile } from './speedProfile';
import { closedLoopProject, straightHairpinProject, varyingWidthProject } from './presets';
import type { TrackControlPoint, RouteControlPoint, VehicleModel } from './types';

const vehicle: VehicleModel = {
  accel: 8,
  brake: 14,
  lateralG: 18,
  maxSpeed: 60,
  startSpeed: 0,
  endSpeed: 0
};

function analyzeProject(project: ReturnType<typeof straightHairpinProject>, samples = project.samples) {
  const surface = buildTrackSurface(project.trackPoints, samples, project.kind === 'closed');
  return analyzeRoute(surface, project.routePoints, project.vehicle, samples, project.kind === 'closed');
}

describe('样例工程', () => {
  it('直道接急弯的路线在界内，并在弯前形成制动约束', () => {
    const project = straightHairpinProject();
    const result = analyzeProject(project);
    expect(result.issues).toEqual([]);
    expect(result.profile).not.toBeNull();
    expect(result.profile?.totalTime).toBeGreaterThan(0);

    const minSpeed = Math.min(...result.profile!.segments.map((s) => s.speed0));
    expect(minSpeed).toBeLessThan(35);
    expect(result.profile!.segments.some((s) => s.binding === 'brakePropagation')).toBe(true);
    expect(result.profile!.segments.some((s) => s.binding === 'curvature')).toBe(true);
    expect(result.profile!.segments.some((s) => s.binding === 'accelPropagation')).toBe(true);
  });

  it('闭合首尾使用周期性传播，而不是逐点独立限速', () => {
    const project = closedLoopProject();
    const result = analyzeProject(project);
    expect(result.issues).toEqual([]);
    expect(result.profile).not.toBeNull();
    expect(result.profile!.segments.length).toBe(project.samples);

    const first = result.profile!.segments[0];
    const last = result.profile!.segments.at(-1)!;
    expect(first.speed0).toBeCloseTo(last.speed1, 6);
    expect(
      result.profile!.segments.filter((s) =>
        ['accelPropagation', 'brakePropagation'].includes(s.binding)
      ).length
    ).toBeGreaterThan(project.samples * 0.3);
  });

  it('宽窄变化样例不会把窄段误判为出界', () => {
    const project = varyingWidthProject();
    const result = analyzeProject(project);
    expect(result.issues).toEqual([]);
    expect(result.profile?.totalTime).toBeGreaterThan(0);
    const minClearance = Math.min(...result.projections.map((p) => p.clearance));
    expect(minClearance).toBeGreaterThan(0);
  });
});

describe('速度传播模型', () => {
  it('直道上满足 v² = u² + 2as，而不是每点直接给最高速度', () => {
    const track: TrackControlPoint[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      x: i * 50,
      y: 0,
      width: 20
    }));
    const route: RouteControlPoint[] = track.map((p) => ({ id: `r${p.id}`, x: p.x, y: 0 }));
    const surface = buildTrackSurface(track, 121, false);
    const result = analyzeRoute(
      surface,
      route,
      { ...vehicle, startSpeed: 10, endSpeed: 10 },
      121,
      false
    );
    expect(result.issues).toEqual([]);
    const first = result.profile!.segments[0];
    const second = result.profile!.segments[1];
    const expected = Math.sqrt(100 + 2 * vehicle.accel * (first.distance + second.distance));
    expect(second.speed1).toBeCloseTo(expected, 6);
    expect(second.binding).toBe('accelPropagation');
  });

  it('路线超出赛道边界时拒绝生成速度剖面', () => {
    const project = straightHairpinProject();
    project.routePoints[3] = { ...project.routePoints[3], y: -50 };
    const result = analyzeProject(project);
    expect(result.issues.some((issue) => issue.code === 'route-outside')).toBe(true);
    expect(result.profile).toBeNull();
  });
});

describe('采样加密稳定性', () => {
  it('三个样例加密到双倍采样后圈时误差不超过 0.5%', () => {
    for (const factory of [straightHairpinProject, closedLoopProject, varyingWidthProject]) {
      const project = factory();
      const surface = buildTrackSurface(project.trackPoints, project.samples, project.kind === 'closed');
      const stability = checkSamplingStability(
        surface,
        project.routePoints,
        project.vehicle,
        project.samples,
        project.kind === 'closed',
        0.005
      );
      expect(stability.passes, `${project.name}: ${stability.timeRelativeError}`).toBe(true);
    }
  });

  it('速度剖面对近似圆保持稳定的曲率速度', () => {
    const radius = 25;
    const route = sampleRoute(
      Array.from({ length: 36 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        return {
          id: `r${i}`,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius
        };
      }),
      240,
      true
    );
    const profile = computeSpeedProfile(route, { ...vehicle, maxSpeed: 80 }, true);
    expect(profile).not.toBeNull();
    for (const segment of profile!.segments) {
      expect(segment.speed0).toBeGreaterThan(18);
      expect(segment.speed0).toBeLessThan(24);
    }
  });
});
