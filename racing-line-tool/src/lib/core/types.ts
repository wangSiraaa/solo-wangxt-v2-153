/** 二维平面点（赛道在水平面内，高度恒为 0）。 */
export interface Vec2 {
  x: number;
  y: number;
}

/** 赛道中心线控制点。width 为该点处赛道全宽（米）。 */
export interface TrackControlPoint {
  x: number;
  y: number;
  width: number;
}

/** 赛道定义（编辑器的持久化数据）。 */
export interface TrackSpec {
  name: string;
  closed: boolean;
  points: TrackControlPoint[];
}

/** 车辆（质点）参数 —— 简化加减速模型，仅供游戏调参。 */
export interface VehicleParams {
  /** 最大横向加速度 m/s²（决定弯道限速 v = sqrt(aLat / κ)） */
  aLatMax: number;
  /** 纵向加速能力 m/s² */
  aAccel: number;
  /** 制动减速度 m/s²（正值） */
  aBrake: number;
  /** 极速 m/s */
  vMax: number;
  /** 是否启用摩擦圆：横向占用越多，纵向可用越少 */
  frictionEllipse: boolean;
}

/** 沿中心线均匀弧长采样得到的点。 */
export interface SampledPoint {
  x: number;
  y: number;
  /** 单位法向（指向行进方向左侧） */
  nx: number;
  ny: number;
  /** 弧长坐标 */
  s: number;
  /** 有符号曲率（左弯为正） */
  kappa: number;
  /** 该处左/右半宽 */
  halfWidthL: number;
  halfWidthR: number;
}

export interface SampledTrack {
  pts: SampledPoint[];
  closed: boolean;
  /** 中心线总长 */
  length: number;
  /** 平均采样间距 */
  ds: number;
}

/** 赛车线：每个采样站上的横向偏移（沿法向，左正右负），必须位于边界内。 */
export interface RacingLine {
  offsets: number[];
}

/** 速度受限原因 —— 求解后每个采样点必居其一，不允许逐点独立给最高速度。 */
export type ConstraintKind = 'curvature' | 'acceleration' | 'braking' | 'topSpeed';

export interface SpeedSolution {
  /** 各采样点速度 m/s */
  v: Float64Array;
  /** 仅由曲率（及极速）决定的速度上限 */
  vCurve: Float64Array;
  /** 各点激活的约束 */
  constraint: ConstraintKind[];
  /** 第 i 段（i → i+1，闭合时末段回到 0）耗时 */
  segTime: Float64Array;
  lapTime: number;
  /** 求解使用的采样间距 */
  ds: number;
}

/** 工程文件（存入 IndexedDB）。 */
export interface Project {
  name: string;
  savedAt: number;
  track: TrackSpec;
  lineOffsets: number[] | null;
  vehicle: VehicleParams;
}
