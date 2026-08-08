import type { Load, Point } from '../types';
import { MIL_PER_RAD, MOA_PER_RAD } from './units';
import { pointAt } from './trajectory';

/**
 * Sight geometry for one load: bore-to-sight offset and the sight-in zero range for its firearm
 * profile, plus the bore drop at that zero. This is everything needed to place the trajectory
 * relative to the line of sight.
 */
export type SightGeometry = {
  sightHeightM: number;
  zeroM: number;
  dropAtZeroM: number;
};

export function sightGeometry(
  load: Load,
  sightHeights: { shotgunSightM: number; rifleSightM: number },
  zeros: { shotgunZeroM: number; rifleZeroM: number },
): SightGeometry {
  const rifle = load.firearmGroup === 'rifle';
  const sightHeightM = rifle ? sightHeights.rifleSightM : sightHeights.shotgunSightM;
  const zeroM = rifle ? zeros.rifleZeroM : zeros.shotgunZeroM;
  return { sightHeightM, zeroM, dropAtZeroM: pointAt(load.points, zeroM)?.dropM ?? 0 };
}

/**
 * Bullet path relative to the line of sight (positive above, negative below), using the same
 * small-angle superposition as the native maximum-point-blank-range routine. `dropHereM` and
 * `dropAtZeroM` are bore drops (positive downward).
 */
export function sightPathM(dropHereM: number, distanceM: number, geometry: SightGeometry): number {
  const { sightHeightM, zeroM, dropAtZeroM } = geometry;
  if (zeroM <= 0) return -dropHereM;
  return -dropHereM - sightHeightM + (dropAtZeroM + sightHeightM) * (distanceM / zeroM);
}

/** Elevation come-up in minutes of angle (positive means hold/dial up). */
export function holdoverMoa(pathM: number, distanceM: number): number {
  return distanceM > 0 ? (-pathM / distanceM) * MOA_PER_RAD : 0;
}

/** Elevation come-up in milliradians (positive means hold/dial up). */
export function holdoverMil(pathM: number, distanceM: number): number {
  return distanceM > 0 ? (-pathM / distanceM) * MIL_PER_RAD : 0;
}

/** Convenience: path at a specific point given its already-known bore drop. */
export function sightPathAt(point: Point, geometry: SightGeometry): number {
  return sightPathM(point.dropM, point.distanceM, geometry);
}
