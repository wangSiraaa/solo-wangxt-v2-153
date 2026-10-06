import { sqrt } from 'mathjs';
import { distance, projectPathToTrack, sampleRoute } from './geometry';
import type {
  AnalysisResult,
  SampledPoint,
  SpeedLimitKind,
  SpeedProfile,
  SpeedSegment,
  StabilityResult,
  TrackProjection,
  TrackSurface,
  ValidationIssue,
  VehicleModel
} from './types';

const SPEED_EPSILON = 1e-7;

type LocalBinding = Extract<SpeedLimitKind, 'maxSpeed' | 'curvature' | 'endpoint'>;

interface NodeLimit {
  value: number;
  binding: SpeedLimitKind;
  sourceIndex: number;
}

function safeSqrt(value: number): number {
  return Number(sqrt(Math.max(0, value)));
}

export function segmentCurvatures(points: SampledPoint[], closed: boolean): number[] {
  const n = points.length;
  const count = closed ? n : Math.max(0, n - 1);
  const out: number[] = [];

  for (let i = 0; i < count; i++) {
    const next = (i + 1) % n;
    // Curvature is evaluated analytically on the editable spline and carried
    // into arc-length samples; use both segment ends so no bend is hidden.
    out.push(Math.max(points[i].analyticCurvature ?? 0, points[next].analyticCurvature ?? 0));
  }
  return out;
}

function nodeCurvatures(points: SampledPoint[], segmentKappa: number[], closed: boolean): number[] {
  const n = points.length;
  const out: number[] = new Array(n).fill(0);
  if (closed) {
    for (let i = 0; i < n; i++) {
      out[i] = Math.max(segmentKappa[(i - 1 + n) % n] ?? 0, segmentKappa[i % n] ?? 0);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const left = i > 0 ? segmentKappa[i - 1] : (segmentKappa[0] ?? 0);
      const right = i < n - 1 ? segmentKappa[i] : (segmentKappa[n - 2] ?? 0);
      out[i] = Math.max(left ?? 0, right ?? 0);
    }
  }
  return out;
}

function tighten(current: NodeLimit, candidate: number, binding: SpeedLimitKind, sourceIndex: number): boolean {
  if (Number.isFinite(candidate) && candidate + SPEED_EPSILON < current.value) {
    current.value = candidate;
    current.binding = binding;
    current.sourceIndex = sourceIndex;
    return true;
  }
  return false;
}

function validateVehicle(vehicle: VehicleModel): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(vehicle)) {
    if (!Number.isFinite(value) || value < 0) errors.push(`${key} 必须是非负有限数`);
  }
  if (vehicle.accel <= 0) errors.push('纵向加速度必须大于 0');
  if (vehicle.brake <= 0) errors.push('制动减速度必须大于 0');
  if (vehicle.lateralG <= 0) errors.push('横向加速度上限必须大于 0');
  if (vehicle.maxSpeed <= 0) errors.push('车辆最高速度必须大于 0');
  return errors;
}

function reachable(initial: number, target: number, accel: number, brake: number, distanceValue: number): boolean {
  const canAccelerateToTarget = target <= safeSqrt(initial * initial + 2 * accel * distanceValue) + SPEED_EPSILON;
  const canBrakeFromInitial = initial <= safeSqrt(target * target + 2 * brake * distanceValue) + SPEED_EPSILON;
  return canAccelerateToTarget && canBrakeFromInitial;
}

export function computeSpeedProfile(
  route: SampledPoint[],
  vehicle: VehicleModel,
  closed: boolean,
  segmentKappa?: number[]
): SpeedProfile | null {
  const vehicleErrors = validateVehicle(vehicle);
  if (vehicleErrors.length > 0 || route.length < 2) return null;

  const n = route.length;
  const edgeCount = closed ? n : n - 1;
  const distances = Array.from({ length: edgeCount }, (_, i) =>
    distance(route[i], route[(i + 1) % n])
  );
  const totalLength = distances.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(totalLength) || totalLength <= Number.EPSILON) return null;

  const kappa = segmentKappa ?? segmentCurvatures(route, closed);
  const nodeKappa = nodeCurvatures(route, kappa, closed);
  const curvatureSpeeds = nodeKappa.map((value) =>
    value > Number.EPSILON ? safeSqrt(vehicle.lateralG / value) : vehicle.maxSpeed
  );

  const initialLimits: NodeLimit[] = curvatureSpeeds.map((curvatureSpeed, i) => {
    if (curvatureSpeed + SPEED_EPSILON < vehicle.maxSpeed) {
      return { value: curvatureSpeed, binding: 'curvature', sourceIndex: i };
    }
    return { value: vehicle.maxSpeed, binding: 'maxSpeed', sourceIndex: i };
  });

  let startBinding: LocalBinding = 'maxSpeed';
  let endBinding: LocalBinding = 'maxSpeed';
  if (!closed) {
    if (vehicle.startSpeed > vehicle.maxSpeed || vehicle.endSpeed > vehicle.maxSpeed) return null;
    if (vehicle.startSpeed > curvatureSpeeds[0] + SPEED_EPSILON) startBinding = 'endpoint';
    if (vehicle.endSpeed > curvatureSpeeds[n - 1] + SPEED_EPSILON) endBinding = 'endpoint';
    if (!reachable(vehicle.startSpeed, vehicle.endSpeed, vehicle.accel, vehicle.brake, totalLength)) return null;

    initialLimits[0] = { value: vehicle.startSpeed, binding: 'endpoint', sourceIndex: 0 };
    initialLimits[n - 1] = { value: vehicle.endSpeed, binding: 'endpoint', sourceIndex: n - 1 };
  }
  void startBinding;
  void endBinding;

  const limits = initialLimits;
  let iterations = 0;
  let changed = true;
  const maxIterations = closed ? 200 : 20;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    if (closed) {
      for (let i = 0; i < n; i++) {
        const prev = (i - 1 + n) % n;
        const edge = prev;
        const candidate = safeSqrt(limits[prev].value ** 2 + 2 * vehicle.accel * distances[edge]);
        changed = tighten(limits[i], candidate, 'accelPropagation', prev) || changed;
      }
      for (let step = 0; step < n; step++) {
        const i = (n - 1 - step + n) % n;
        const next = (i + 1) % n;
        const candidate = safeSqrt(limits[next].value ** 2 + 2 * vehicle.brake * distances[i]);
        changed = tighten(limits[i], candidate, 'brakePropagation', next) || changed;
      }
    } else {
      for (let i = 1; i < n - 1; i++) {
        const candidate = safeSqrt(limits[i - 1].value ** 2 + 2 * vehicle.accel * distances[i - 1]);
        changed = tighten(limits[i], candidate, 'accelPropagation', i - 1) || changed;
      }
      for (let i = n - 2; i > 0; i--) {
        const candidate = safeSqrt(limits[i + 1].value ** 2 + 2 * vehicle.brake * distances[i]);
        changed = tighten(limits[i], candidate, 'brakePropagation', i + 1) || changed;
      }
    }
  }

  const segments: SpeedSegment[] = [];
  let totalTime = 0;
  let maxCurvature = 0;
  let minSpeed = Infinity;
  let maxReachedSpeed = 0;

  for (let i = 0; i < edgeCount; i++) {
    const next = (i + 1) % n;
    const p0 = route[i];
    const p1 = route[next];
    const u = limits[i].value;
    const v = limits[next].value;
    const d = distances[i];
    const longitudinalAccel = d > Number.EPSILON ? (v * v - u * u) / (2 * d) : 0;
    let segmentTime: number;
    if (Math.abs(v - u) < SPEED_EPSILON) {
      segmentTime = u > SPEED_EPSILON ? d / u : 0;
    } else {
      segmentTime = 2 * d / (u + v);
    }

    totalTime += segmentTime;
    minSpeed = Math.min(minSpeed, u, v);
    maxReachedSpeed = Math.max(maxReachedSpeed, u, v);
    maxCurvature = Math.max(maxCurvature, kappa[i] ?? 0);

    segments.push({
      index: i,
      s0: p0.s,
      s1: p1.s || (closed ? totalLength : p1.s),
      distance: d,
      x0: p0.x,
      y0: p0.y,
      x1: p1.x,
      y1: p1.y,
      curvature: kappa[i] ?? 0,
      curvatureSpeed: curvatureSpeeds[i],
      speed0: u,
      speed1: v,
      binding: limits[i].binding,
      bindingValue: u,
      sourceIndex: limits[i].sourceIndex,
      segmentTime,
      longitudinalAccel
    });
  }

  return {
    closed,
    totalTime,
    totalLength,
    maxCurvature,
    minSpeed: Number.isFinite(minSpeed) ? minSpeed : 0,
    maxReachedSpeed,
    iterations,
    segments
  };
}

function projectionIssues(projections: TrackProjection[]): ValidationIssue[] {
  return projections
    .filter((p) => p.clearance < -1e-5)
    .map((p) => ({
      code: 'route-outside' as const,
      message: `采样点 ${p.index} 超出赛道边界 ${Math.abs(p.clearance).toFixed(2)} m`,
      index: p.index
    }));
}

export function analyzeRoute(
  surface: TrackSurface,
  routePoints: Parameters<typeof sampleRoute>[0],
  vehicle: VehicleModel,
  samples: number,
  closed: boolean
): AnalysisResult {
  const issues: ValidationIssue[] = [];
  const warnings: string[] = [];
  const route = sampleRoute(routePoints, samples, closed);

  if (!Number.isFinite(surface.totalLength) || surface.totalLength <= Number.EPSILON || surface.points.length < 2) {
    issues.push({ code: 'degenerate-track', message: '赛道中心线长度为 0 或采样退化' });
  }
  const routeLength = route.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + distance(route[i - 1], p)),
    0
  );
  if (!Number.isFinite(routeLength) || routeLength <= Number.EPSILON || route.length < 2) {
    issues.push({ code: 'degenerate-route', message: '赛线路线长度为 0 或采样退化' });
  }

  const projections = projectPathToTrack(surface, route);
  issues.push(...projectionIssues(projections));

  for (const error of validateVehicle(vehicle)) {
    issues.push({ code: 'degenerate-track', message: error });
  }

  if (!closed && route.length >= 2) {
    const length = routeLength;
    const kappa = segmentCurvatures(route, false);
    const nodeKappa = nodeCurvatures(route, kappa, false);
    const startLimit = Math.min(vehicle.maxSpeed, safeSqrt(vehicle.lateralG / Math.max(Number.EPSILON, nodeKappa[0])));
    const endLimit = Math.min(vehicle.maxSpeed, safeSqrt(vehicle.lateralG / Math.max(Number.EPSILON, nodeKappa.at(-1) ?? 0)));
    if (vehicle.startSpeed > startLimit + 1e-5) {
      issues.push({ code: 'start-speed-infeasible', message: '起点速度超过最高速度或起点横向约束', index: 0 });
    }
    if (vehicle.endSpeed > endLimit + 1e-5) {
      issues.push({ code: 'end-speed-infeasible', message: '终点速度超过最高速度或终点横向约束', index: route.length - 1 });
    }
    if (!reachable(vehicle.startSpeed, vehicle.endSpeed, vehicle.accel, vehicle.brake, length)) {
      issues.push({
        code: 'end-speed-infeasible',
        message: '按给定加/减速度，无法在开放路线长度内从起点速度到达终点速度',
        index: route.length - 1
      });
    }
  }

  if (samples < 80) warnings.push('采样数较低，曲率和圈时可能偏粗糙');
  const profile = issues.some((issue) => issue.code.startsWith('degenerate') || issue.code === 'route-outside' || issue.code.includes('speed-infeasible'))
    ? null
    : computeSpeedProfile(route, vehicle, closed);

  if (!profile && issues.length === 0) {
    issues.push({ code: 'degenerate-route', message: '速度剖面计算失败' });
  }

  return { route, profile, projections, issues, warnings };
}

export function checkSamplingStability(
  surface: TrackSurface,
  routePoints: Parameters<typeof sampleRoute>[0],
  vehicle: VehicleModel,
  samples: number,
  closed: boolean,
  tolerance = 0.005
): StabilityResult {
  const refinedSamples = Math.max(160, Math.round(samples * 2));
  const base = analyzeRoute(surface, routePoints, vehicle, samples, closed);
  const refinedAnalysis = analyzeRoute(surface, routePoints, vehicle, refinedSamples, closed);
  const baseTime = base.profile?.totalTime ?? null;
  const refinedTime = refinedAnalysis.profile?.totalTime ?? null;
  const baseMax = base.profile?.maxReachedSpeed ?? null;
  const refinedMax = refinedAnalysis.profile?.maxReachedSpeed ?? null;

  const timeDifference = baseTime !== null && refinedTime !== null ? refinedTime - baseTime : null;
  const timeRelativeError = timeDifference !== null && refinedTime !== null && refinedTime !== 0 ? Math.abs(timeDifference / refinedTime) : null;
  const maxSpeedDifference = baseMax !== null && refinedMax !== null ? refinedMax - baseMax : null;
  const maxSpeedRelativeError = maxSpeedDifference !== null && refinedMax !== null && refinedMax !== 0 ? Math.abs(maxSpeedDifference / refinedMax) : null;

  const passes =
    refinedAnalysis.issues.length === 0 &&
    timeRelativeError !== null &&
    timeRelativeError <= tolerance &&
    maxSpeedRelativeError !== null &&
    maxSpeedRelativeError <= tolerance;

  return {
    baseSamples: samples,
    refinedSamples,
    baseTime,
    refinedTime,
    timeDifference,
    timeRelativeError,
    maxSpeedDifference,
    maxSpeedRelativeError,
    passes,
    tolerance,
    refinedAnalysis
  };
}
