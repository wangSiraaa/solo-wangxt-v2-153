import type { TractionProject, TrackControlPoint, RouteControlPoint, VehicleModel } from './types';

export const defaultVehicle: VehicleModel = {
  accel: 8,
  brake: 14,
  lateralG: 18,
  maxSpeed: 60,
  startSpeed: 0,
  endSpeed: 0
};

const id = (() => {
  let n = 0;
  return (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(n++).toString(36)}`;
})();

export function makeTrackPoint(x: number, y: number, width: number): TrackControlPoint {
  return { id: id('tp'), x, y, width };
}

export function makeRoutePoint(x: number, y: number): RouteControlPoint {
  return { id: id('rp'), x, y };
}

function project(name: string): TractionProject {
  return {
    id: `${name}-${Date.now().toString(36)}`,
    name,
    kind: 'closed',
    samples: 480,
    vehicle: { ...defaultVehicle },
    trackPoints: [],
    routePoints: [],
    updatedAt: Date.now()
  };
}

export function straightHairpinProject(): TractionProject {
  const value = project('直道接急弯');
  value.kind = 'open';
  value.samples = 380;
  value.vehicle.startSpeed = 0;
  value.vehicle.endSpeed = 0;
  // Semicircular centerline, radius 30, connected by long entry/exit straights.
  value.trackPoints = [
    [-150, 0, 38], [-120, 0, 38], [-90, 0, 38], [-60, 0, 38], [-35, 1, 38],
    [-21, 8, 38], [-10, 22, 38], [-4, 34, 38], [4, 40, 38], [18, 38, 38],
    [27, 27, 38], [31, 14, 38], [45, 4, 38], [75, 0, 38], [110, 0, 38], [150, 0, 38]
  ].map(([x, y, width]) => makeTrackPoint(x, y, width));

  // Entry on right side, tight inside apex, exit on right side of travel.
  value.routePoints = [
    [-150, -8], [-115, -8], [-80, -8], [-50, -7], [-38, -4],
    [-15, 2], [-6, 12], [-1, 20], [5, 22], [12, 20],
    [20, 13], [29, 4], [48, -6], [80, -8], [115, -8], [150, -8]
  ].map(([x, y]) => makeRoutePoint(x, y));
  return value;
}

export function closedLoopProject(): TractionProject {
  const value = project('闭合首尾环道');
  value.kind = 'closed';
  value.trackPoints = [
    [-140, -80, 30], [-40, -100, 30], [70, -90, 30], [145, -35, 30],
    [150, 55, 30], [70, 105, 30], [-40, 95, 30], [-130, 45, 30]
  ].map(([x, y, width]) => makeTrackPoint(x, y, width));

  value.routePoints = [
    [-140, -91], [-35, -111], [75, -101], [154, -38],
    [154, 62], [66, 116], [-45, 106], [-140, 52]
  ].map(([x, y]) => makeRoutePoint(x, y));
  return value;
}

export function varyingWidthProject(): TractionProject {
  const value = project('宽窄变化连续弯');
  value.kind = 'open';
  value.vehicle.startSpeed = 18;
  value.vehicle.endSpeed = 18;
  value.trackPoints = [
    [-170, 0, 46], [-130, 0, 46], [-95, 2, 40], [-60, 12, 32],
    [-25, 30, 28], [10, 45, 26], [50, 42, 30], [90, 30, 38],
    [125, 15, 44], [170, 10, 46]
  ].map(([x, y, width]) => makeTrackPoint(x, y, width));

  value.routePoints = [
    [-170, -5], [-130, -5], [-95, -2], [-60, 7], [-25, 22],
    [10, 35], [50, 35], [90, 25], [125, 12], [170, 8]
  ].map(([x, y]) => makeRoutePoint(x, y));
  return value;
}

export const presetFactories = {
  straightHairpin: straightHairpinProject,
  closedLoop: closedLoopProject,
  varyingWidth: varyingWidthProject
};

export type PresetName = keyof typeof presetFactories;
