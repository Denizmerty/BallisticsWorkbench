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
    available: boolean;
};

export function sightGeometry(
    load: Load,
    sightHeights: { shotgunSightM: number; rifleSightM: number },
    zeros: { shotgunZeroM: number; rifleZeroM: number },
): SightGeometry {
    const rifle = load.firearmGroup === 'rifle';
    const sightHeightM =
        load.sightHeightM ?? (rifle ? sightHeights.rifleSightM : sightHeights.shotgunSightM);
    const zeroM = load.sightZeroM ?? (rifle ? zeros.rifleZeroM : zeros.shotgunZeroM);
    const nativeDrop = load.dropAtSightZeroM;
    const sampledDrop = pointAt(load.points, zeroM)?.dropM;
    const available =
        load.zeroingStatus === 'complete' &&
        nativeDrop !== null &&
        (nativeDrop !== undefined || sampledDrop !== undefined);
    return { sightHeightM, zeroM, dropAtZeroM: nativeDrop ?? sampledDrop ?? 0, available };
}

/**
 * Compatibility path for results that predate native `pathM`. Current protocol results carry the
 * sight-relative path integrated at the solved bore elevation. `dropHereM` and `dropAtZeroM` are
 * legacy bore drops (positive downward).
 */
export function sightPathM(dropHereM: number, distanceM: number, geometry: SightGeometry): number {
    const { sightHeightM, zeroM, dropAtZeroM } = geometry;
    if (!geometry.available) return Number.NaN;
    if (zeroM <= 0) return -dropHereM;
    return -dropHereM - sightHeightM + (dropAtZeroM + sightHeightM) * (distanceM / zeroM);
}

/** Converts a native elevation come-up angle to minutes of angle. */
export function holdoverMoa(holdoverRad: number): number {
    return holdoverRad * MOA_PER_RAD;
}

/** Converts a native elevation come-up angle to milliradians. */
export function holdoverMil(holdoverRad: number): number {
    return holdoverRad * MIL_PER_RAD;
}

/** Convenience: path at a specific point given its already-known bore drop. */
export function sightPathAt(point: Point, geometry: SightGeometry): number {
    if (!geometry.available) return Number.NaN;
    return Number.isFinite(point.pathM)
        ? point.pathM
        : sightPathM(point.dropM, point.distanceM, geometry);
}
