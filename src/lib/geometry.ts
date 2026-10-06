import { add, cross, dot, multiply, norm, subtract, type MathType } from 'mathjs';
import type { RouteControlPoint, SampledPoint, TrackControlPoint, TrackProjection, TrackSurface, Vec2 } from './types';

type V = [number, number];
type V3 = [number, number, number];

const toVec = (p: Vec2): V => [p.x, p.y];
const num = (value: MathType): number => Number(value);

export const addV = (a: Vec2, b: Vec2): Vec2 => {
  const v = add(toVec(a), toVec(b)) as unknown as V;
  return { x: v[0], y: v[1] };
};

export const subV = (a: Vec2, b: Vec2): Vec2 => {
  const v = subtract(toVec(a), toVec(b)) as unknown as V;
  return { x: v[0], y: v[1] };
};

export const scaleV = (a: Vec2, scalar: number): Vec2 => {
  const v = multiply(toVec(a), scalar) as unknown as V;
  return { x: v[0], y: v[1] };
};

export const distance = (a: Vec2, b: Vec2): number =>
  num(norm(subtract(toVec(a), toVec(b))));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  // Centripetal Catmull-Rom (alpha = 0.5). It avoids the loops/overshoot that
  // uniform Catmull-Rom creates through sharp, sparsely edited hairpins.
  const knot = (a: Vec2, b: Vec2, previous: number): number => previous + Math.sqrt(Math.max(0, distance(a, b)));
  // Knots are kept absolute; t is the normalized location on [t1, t2].
  const t1 = knot(p0, p1, 0);
  const t2 = knot(p1, p2, t1);
  const t3 = knot(p2, p3, t2);
  const tt = t1 + (t2 - t1) * t;

  const basis = (a: Vec2, b: Vec2, ta: number, tb: number, at: number): Vec2 => {
    const span = tb - ta;
    if (Math.abs(span) < Number.EPSILON) return b;
    const f = (tb - at) / span;
    const g = (at - ta) / span;
    return { x: f * a.x + g * b.x, y: f * a.y + g * b.y };
  };

  const a1 = basis(p0, p1, 0, t1, tt);
  const a2 = basis(p1, p2, t1, t2, tt);
  const a3 = basis(p2, p3, t2, t3, tt);
  // Second-level de Boor blends span [t0,t2] and [t1,t3].
  const b1 = basis(a1, a2, 0, t2, tt);
  const b2 = basis(a2, a3, t1, t3, tt);
  return basis(b1, b2, t1, t2, tt);
}

interface RawSample extends Vec2 {
  width: number;
  curveSpan?: number;
  curveT?: number;
  analyticCurvature?: number;
}

function controlAt<T extends Vec2>(points: T[], index: number, closed: boolean): T {
  const n = points.length;
  if (closed) return points[((index % n) + n) % n];
  return points[Math.max(0, Math.min(n - 1, index))];
}

function rawTrackSamples(points: TrackControlPoint[], samples: number, closed: boolean): RawSample[] {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y, width: p.width }));
  const intervals = closed ? points.length : points.length - 1;
  const out: RawSample[] = [];
  const steps = Math.max(32, Math.ceil(samples / intervals));
  const limit = closed ? intervals : intervals - 1;

  for (let i = 0; i < limit; i++) {
    const p0 = controlAt(points, i - 1, closed);
    const p1 = points[i];
    const p2 = controlAt(points, i + 1, closed);
    const p3 = controlAt(points, i + 2, closed);
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const p = catmullRom(p0, p1, p2, p3, t);
      out.push({ ...p, width: lerp(p1.width, p2.width, t), curveSpan: i, curveT: t });
    }
  }

  if (!closed) {
    const last = points[points.length - 1];
    out.push({ x: last.x, y: last.y, width: last.width });
  }
  return out;
}

function rawRouteSamples(points: RouteControlPoint[], samples: number, closed: boolean): RawSample[] {
  if (points.length < 2) return points.map(({ x, y }) => ({ x, y, width: 0 }));
  const intervals = closed ? points.length : points.length - 1;
  const out: RawSample[] = [];
  const steps = Math.max(32, Math.ceil(samples / intervals));
  const limit = closed ? intervals : intervals - 1;

  for (let i = 0; i < limit; i++) {
    const p0 = controlAt(points, i - 1, closed);
    const p1 = points[i];
    const p2 = controlAt(points, i + 1, closed);
    const p3 = controlAt(points, i + 2, closed);
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      out.push({
        ...catmullRom(p0, p1, p2, p3, t),
        width: 0,
        curveSpan: i,
        curveT: t,
        analyticCurvature: catmullCurvature(points, i, t, closed)
      });
    }
  }

  if (!closed) {
    const last = points[points.length - 1];
    out.push({
      x: last.x,
      y: last.y,
      width: 0,
      curveSpan: intervals - 1,
      curveT: 1,
      analyticCurvature: catmullCurvature(points, intervals - 1, 1, closed)
    });
  }
  return out;
}

export function resamplePolyline(raw: RawSample[], samples: number, closed: boolean): SampledPoint[] {
  if (raw.length < 2) return raw.map((p) => ({ ...p, s: 0 }));

  const cumulative: number[] = [0];
  for (let i = 1; i < raw.length; i++) cumulative.push(cumulative[i - 1] + distance(raw[i - 1], raw[i]));
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total <= Number.EPSILON) {
    return raw.slice(0, 1).map((p) => ({ ...p, s: 0 }));
  }

  const interval = closed ? total / samples : total / Math.max(1, samples - 1);
  const out: SampledPoint[] = [];
  let segment = 0;

  for (let k = 0; k < samples; k++) {
    const target = closed ? k * interval : Math.min(total, k * interval);
    while (segment < raw.length - 2 && cumulative[segment + 1] < target) segment++;
    const s0 = cumulative[segment];
    const s1 = cumulative[segment + 1];
    const t = s1 === s0 ? 0 : (target - s0) / (s1 - s0);
    const a = raw[segment];
    const b = raw[segment + 1];
    out.push({
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      width: lerp(a.width, b.width, t),
      curveSpan: a.curveSpan,
      curveT: a.curveT !== undefined && b.curveT !== undefined && a.curveSpan === b.curveSpan
        ? lerp(a.curveT, b.curveT, t)
        : a.curveT,
      analyticCurvature: lerp(a.analyticCurvature ?? 0, b.analyticCurvature ?? 0, t),
      s: target
    });
  }

  if (!closed) {
    const last = raw[raw.length - 1];
    out.push({
      x: last.x,
      y: last.y,
      width: last.width,
      curveSpan: last.curveSpan,
      curveT: last.curveT,
      analyticCurvature: last.analyticCurvature,
      s: total
    });
  }
  return out;
}

export function buildTrackSurface(points: TrackControlPoint[], samples: number, closed: boolean): TrackSurface {
  const requested = closed ? samples : samples + 1;
  const raw = rawTrackSamples(points, requested, closed);
  const sampled = resamplePolyline(raw, requested, closed);
  let totalLength = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const edgeCount = closed ? sampled.length : Math.max(0, sampled.length - 1);
  for (let i = 0; i < edgeCount; i++) {
    totalLength += distance(sampled[i], sampled[(i + 1) % sampled.length]);
  }
  for (const p of sampled) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  return { points: sampled, closed, totalLength, bounds: { minX, maxX, minY, maxY } };
}

export function sampleRoute(points: RouteControlPoint[], samples: number, closed: boolean): SampledPoint[] {
  const requested = closed ? samples : samples + 1;
  const raw = rawRouteSamples(points, requested, closed).map((p) => ({ ...p, width: 0 }));
  const sampled = resamplePolyline(raw, requested, closed);
  return sampled.map((p) => ({ ...p, width: 0 }));
}

export function catmullCurvature(points: Vec2[], span: number, t: number, closed: boolean): number {
  const p0 = !closed && span === 0 ? scaleV(subV(scaleV(points[0], 2), points[1]), 1) : controlAt(points, span - 1, closed);
  const p1 = points[span];
  const p2 = controlAt(points, span + 1, closed);
  const p3 = !closed && span >= points.length - 2
    ? scaleV(subV(scaleV(points[points.length - 1], 2), points[points.length - 2]), 1)
    : controlAt(points, span + 2, closed);
  const h = 1e-4;
  const at = (value: number) => catmullRom(p0, p1, p2, p3, value);
  let d1: Vec2;
  let d2: Vec2;

  if (t <= h) {
    const f0 = at(0);
    const f1 = at(h);
    const f2 = at(2 * h);
    d1 = { x: (-3 * f0.x + 4 * f1.x - f2.x) / (2 * h), y: (-3 * f0.y + 4 * f1.y - f2.y) / (2 * h) };
    d2 = { x: (f0.x - 2 * f1.x + f2.x) / (h * h), y: (f0.y - 2 * f1.y + f2.y) / (h * h) };
  } else if (t >= 1 - h) {
    const f0 = at(1 - 2 * h);
    const f1 = at(1 - h);
    const f2 = at(1);
    d1 = { x: (f0.x - 4 * f1.x + 3 * f2.x) / (2 * h), y: (f0.y - 4 * f1.y + 3 * f2.y) / (2 * h) };
    d2 = { x: (f0.x - 2 * f1.x + f2.x) / (h * h), y: (f0.y - 2 * f1.y + f2.y) / (h * h) };
  } else {
    const fm = at(t - h);
    const f0 = at(t);
    const fp = at(t + h);
    d1 = { x: (fp.x - fm.x) / (2 * h), y: (fp.y - fm.y) / (2 * h) };
    d2 = { x: (fp.x - 2 * f0.x + fm.x) / (h * h), y: (fp.y - 2 * f0.y + fm.y) / (h * h) };
  }

  const speed = Math.hypot(d1.x, d1.y);
  if (speed <= Number.EPSILON) return 0;
  return Math.abs(d1.x * d2.y - d1.y * d2.x) / speed ** 3;
}

interface EdgeProjection extends TrackProjection {
  edge: number;
  distance: number;
  feasible: boolean;
}

function projectToEdge(surface: TrackSurface, point: Vec2, index: number): EdgeProjection | null {
  const a = surface.points[index];
  const b = surface.points[(index + 1) % surface.points.length];
  const edge = subV(b, a);
  const edgeLength = Math.hypot(edge.x, edge.y);
  if (edgeLength <= Number.EPSILON) return null;

  const tangent = scaleV(edge, 1 / edgeLength);
  const normal = { x: -tangent.y, y: tangent.x };
  let t = num(dot(toVec(subV(point, a)), [tangent.x, tangent.y])) / edgeLength;
  if (!surface.closed) t = Math.max(0, Math.min(1, t));

  const center = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  const halfWidth = lerp(a.width, b.width, t) / 2;
  let s = lerp(a.s, b.s, t);
  if (surface.closed && index === surface.points.length - 1) {
    s = lerp(a.s, surface.totalLength, t);
  }

  const delta = subV(point, center);
  const lateral = num(dot(toVec(delta), [normal.x, normal.y]));
  const pointDistance = Math.hypot(delta.x, delta.y);
  return {
    edge: index,
    index,
    s,
    centerX: center.x,
    centerY: center.y,
    tangentX: tangent.x,
    tangentY: tangent.y,
    normalX: normal.x,
    normalY: normal.y,
    lateral,
    distance: pointDistance,
    feasible: pointDistance <= halfWidth + 1e-6,
    halfWidth,
    clearance: halfWidth - pointDistance
  };
}

export function projectPathToTrack(surface: TrackSurface, points: Vec2[]): TrackProjection[] {
  const edgeCount = surface.closed ? surface.points.length : surface.points.length - 1;
  if (edgeCount <= 0 || points.length === 0) return [];

  // Route and track are resampled at the same requested count, so expected edge
  // indices track each other. The generous window handles differing lengths but
  // avoids jumping onto a spatially close, non-monotonic section of a hairpin.
  const window = Math.max(12, Math.ceil(edgeCount / 6));
  const result: EdgeProjection[] = [];
  let previousEdge = 0;
  let initialized = false;

  for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
    let fallback: EdgeProjection | null = null;
    let best: EdgeProjection | null = null;

    if (!initialized) {
      for (let edge = 0; edge < edgeCount; edge++) {
        const candidate = projectToEdge(surface, points[pointIndex], edge);
        if (!candidate) continue;
        if (candidate.feasible && (!best || candidate.distance < best.distance)) best = candidate;
        if (!fallback || candidate.distance < fallback.distance) fallback = candidate;
      }
    } else {
      const firstEdge = surface.closed ? previousEdge - 1 : Math.max(0, previousEdge - 1);
      const lastEdge = surface.closed ? previousEdge + window : Math.min(edgeCount - 1, previousEdge + window);
      for (let offset = firstEdge; offset <= lastEdge; offset++) {
        const edge = surface.closed ? ((offset % edgeCount) + edgeCount) % edgeCount : offset;
        const candidate = projectToEdge(surface, points[pointIndex], edge);
        if (!candidate) continue;
        if (candidate.feasible && (!best || candidate.distance < best.distance)) best = candidate;
        if (!fallback || candidate.distance < fallback.distance) fallback = candidate;
      }
    }
    const selected = best ?? fallback;
    if (!selected) return [];
    result.push(selected);
    previousEdge = selected.edge;
    initialized = true;
  }

  return result;
}

export function signedCurvature(prev: Vec2, current: Vec2, next: Vec2): number {
  const a = subV(current, prev);
  const b = subV(next, current);
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la < Number.EPSILON || lb < Number.EPSILON) return 0;
  const c3 = cross([a.x, a.y, 0] as V3, [b.x, b.y, 0] as V3) as unknown as V3;
  const c = c3[2];
  const chord = distance(prev, next);
  if (chord <= Number.EPSILON) return 0;
  // Menger curvature: 4*area / (|a||b|*|prev-next|), area = cross/2.
  return 2 * c / (la * lb * chord);
}
