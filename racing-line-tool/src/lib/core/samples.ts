import type { TrackSpec, VehicleParams } from './types';
import { cp } from './track';

/** 默认车辆参数（街车级别，便于看出三种约束的切换）。 */
export const DEFAULT_VEHICLE: VehicleParams = {
  aLatMax: 12,
  aAccel: 6,
  aBrake: 10,
  vMax: 80,
  frictionEllipse: true
};

/** 样例 1：长直接 180° 急弯（开放）——制动约束的典型场景。 */
export const straightIntoHairpin: TrackSpec = {
  name: '直道接急弯',
  closed: false,
  points: [
    cp(0, 0, 12),
    cp(120, 0, 12),
    cp(240, 0, 12),
    cp(340, 0, 12),
    cp(395, 4, 12),
    cp(418, 24, 12),
    cp(414, 52, 12),
    cp(390, 66, 12),
    cp(362, 58, 12),
    cp(348, 36, 12),
    cp(300, 30, 12),
    cp(200, 30, 12),
    cp(100, 30, 12),
    cp(0, 30, 12)
  ]
};

/** 样例 2：闭合环路（弯型各异）——闭合首尾的速度传播必须环绕收敛。 */
export const closedLoop: TrackSpec = {
  name: '闭合环路',
  closed: true,
  points: [
    cp(0, 0, 14),
    cp(110, -6, 14),
    cp(200, 8, 14),
    cp(252, 52, 14),
    cp(238, 112, 14),
    cp(186, 148, 14),
    cp(110, 152, 14),
    cp(48, 128, 14),
    cp(6, 84, 14),
    cp(-14, 38, 14)
  ]
};

/** 样例 3：宽窄变化赛道（闭合）——线路优化应利用宽段、在窄段贴弯心。 */
export const widthVarying: TrackSpec = {
  name: '宽窄变化',
  closed: true,
  points: [
    cp(0, 0, 22),
    cp(100, -4, 22),
    cp(185, 2, 16),
    cp(238, 26, 10),
    cp(268, 66, 8),
    cp(258, 116, 8),
    cp(216, 146, 10),
    cp(152, 156, 14),
    cp(88, 142, 16),
    cp(28, 108, 20),
    cp(-4, 56, 22)
  ]
};

export const SAMPLES: TrackSpec[] = [straightIntoHairpin, closedLoop, widthVarying];
