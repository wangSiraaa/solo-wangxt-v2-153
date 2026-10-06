export interface Vec2 {
  x: number;
  y: number;
}

export interface TrackControlPoint extends Vec2 {
  id: string;
  width: number;
}

export interface RouteControlPoint extends Vec2 {
  id: string;
}

export interface VehicleModel {
  /** 纵向加速度 / m/s² */
  accel: number;
  /** 纵向制动减速度（正数）/ m/s² */
  brake: number;
  /** 横向加速度上限 / m/s² */
  lateralG: number;
  /** 车辆最高速度 / m/s */
  maxSpeed: number;
  /** 起点速度 / m/s，主要用于开放路线 */
  startSpeed: number;
  /** 终点速度 / m/s，开放路线为固定目标，闭合路线忽略 */
  endSpeed: number;
}

export type RouteKind = 'closed' | 'open';
export type EditLayer = 'track' | 'route';

export interface TractionProject {
  id: string;
  name: string;
  kind: RouteKind;
  samples: number;
  vehicle: VehicleModel;
  trackPoints: TrackControlPoint[];
  routePoints: RouteControlPoint[];
  updatedAt: number;
}

export interface SampledPoint extends Vec2 {
  s: number;
  width: number;
  curveSpan?: number;
  curveT?: number;
  analyticCurvature?: number;
}

export interface TrackSurface {
  points: SampledPoint[];
  closed: boolean;
  totalLength: number;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

export interface TrackProjection {
  index: number;
  s: number;
  centerX: number;
  centerY: number;
  tangentX: number;
  tangentY: number;
  normalX: number;
  normalY: number;
  lateral: number;
  halfWidth: number;
  clearance: number;
}

export type SpeedLimitKind =
  | 'endpoint'
  | 'maxSpeed'
  | 'curvature'
  | 'accelPropagation'
  | 'brakePropagation';

export interface SpeedSegment {
  index: number;
  s0: number;
  s1: number;
  distance: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  curvature: number;
  curvatureSpeed: number;
  speed0: number;
  speed1: number;
  binding: SpeedLimitKind;
  bindingValue: number;
  sourceIndex: number;
  segmentTime: number;
  longitudinalAccel: number;
}

export interface SpeedProfile {
  closed: boolean;
  totalTime: number;
  totalLength: number;
  maxCurvature: number;
  minSpeed: number;
  maxReachedSpeed: number;
  iterations: number;
  segments: SpeedSegment[];
}

export interface ValidationIssue {
  code:
    | 'route-outside'
    | 'start-speed-infeasible'
    | 'end-speed-infeasible'
    | 'degenerate-track'
    | 'degenerate-route';
  message: string;
  index?: number;
}

export interface AnalysisResult {
  route: SampledPoint[];
  profile: SpeedProfile | null;
  projections: TrackProjection[];
  issues: ValidationIssue[];
  warnings: string[];
}

export interface StabilityResult {
  baseSamples: number;
  refinedSamples: number;
  baseTime: number | null;
  refinedTime: number | null;
  timeDifference: number | null;
  timeRelativeError: number | null;
  maxSpeedDifference: number | null;
  maxSpeedRelativeError: number | null;
  passes: boolean;
  tolerance: number;
  refinedAnalysis: AnalysisResult;
}
