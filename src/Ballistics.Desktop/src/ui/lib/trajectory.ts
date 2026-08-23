import type { MonteCarloUncertaintyPoint, Point, UncertaintyPoint } from '../types';

const CONFIDENCE_95_MULTIPLIER = 1.959963984540054;

function equivalentStandardDeviation(low95: number, high95: number): number {
    return Math.max(0, high95 - low95) / (2 * CONFIDENCE_95_MULTIPLIER);
}

function displayUncertaintyPoint(
    point: UncertaintyPoint | MonteCarloUncertaintyPoint,
): UncertaintyPoint {
    if (!('speedMps' in point)) return point;
    return {
        distanceM: point.distanceM,
        available: point.available,
        speedStandardDeviationMps: equivalentStandardDeviation(
            point.speedMps.low95,
            point.speedMps.high95,
        ),
        energyStandardDeviationJ: equivalentStandardDeviation(
            point.energyJ.low95,
            point.energyJ.high95,
        ),
        momentumStandardDeviationKgms: equivalentStandardDeviation(
            point.momentumKgms.low95,
            point.momentumKgms.high95,
        ),
        timeStandardDeviationS: equivalentStandardDeviation(point.timeS.low95, point.timeS.high95),
        dropStandardDeviationM: equivalentStandardDeviation(point.dropM.low95, point.dropM.high95),
        pathStandardDeviationM: equivalentStandardDeviation(point.pathM.low95, point.pathM.high95),
        holdoverStandardDeviationRad: equivalentStandardDeviation(
            point.holdoverRad.low95,
            point.holdoverRad.high95,
        ),
        windDriftStandardDeviationM: equivalentStandardDeviation(
            point.windDriftM.low95,
            point.windDriftM.high95,
        ),
    };
}

export function pointAt(points: Point[], distance: number): Point | undefined {
    if (!points.length || !Number.isFinite(distance)) return undefined;
    const first = points[0],
        last = points.at(-1)!;
    if (distance < first.distanceM || distance > last.distanceM) return undefined;
    if (distance === first.distanceM) return first;
    if (distance === last.distanceM) return last;

    let low = 1,
        high = points.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (points[middle].distanceM < distance) low = middle + 1;
        else high = middle;
    }
    const hi = low,
        a = points[hi - 1],
        b = points[hi],
        f = (distance - a.distanceM) / (b.distanceM - a.distanceM);
    const n = (key: keyof Point) =>
        Number(a[key] ?? 0) + f * (Number(b[key] ?? 0) - Number(a[key] ?? 0));
    const optional = (key: keyof Point) =>
        a[key] === undefined || b[key] === undefined ? undefined : n(key);
    const nullable = (key: keyof Point) => (a[key] === null || b[key] === null ? null : n(key));
    return {
        distanceM: distance,
        speedMps: n('speedMps'),
        airspeedMps: n('airspeedMps'),
        energyJ: n('energyJ'),
        momentumKgms: n('momentumKgms'),
        timeS: n('timeS'),
        dropM: n('dropM'),
        pathM: n('pathM'),
        holdoverRad: n('holdoverRad'),
        mach: n('mach'),
        spinDriftM: nullable('spinDriftM'),
        windDriftM: n('windDriftM'),
        cd: optional('cd'),
        referenceCd: optional('referenceCd'),
        reynolds: optional('reynolds'),
    };
}

export function uncertaintyAt(
    points: UncertaintyPoint[] | MonteCarloUncertaintyPoint[],
    distance: number,
): UncertaintyPoint | undefined {
    if (!points.length || !Number.isFinite(distance)) return undefined;
    const first = displayUncertaintyPoint(points[0]),
        last = displayUncertaintyPoint(points.at(-1)!);
    if (distance < first.distanceM || distance > last.distanceM) return undefined;
    if (distance === first.distanceM) return first;
    if (distance === last.distanceM) return last;

    let low = 1,
        high = points.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (points[middle].distanceM < distance) low = middle + 1;
        else high = middle;
    }
    const a = displayUncertaintyPoint(points[low - 1]),
        b = displayUncertaintyPoint(points[low]),
        factor = (distance - a.distanceM) / (b.distanceM - a.distanceM);
    const interpolate = (key: keyof UncertaintyPoint) =>
        Number(a[key]) + factor * (Number(b[key]) - Number(a[key]));
    return {
        distanceM: distance,
        available: a.available && b.available,
        speedStandardDeviationMps: interpolate('speedStandardDeviationMps'),
        energyStandardDeviationJ: interpolate('energyStandardDeviationJ'),
        momentumStandardDeviationKgms: interpolate('momentumStandardDeviationKgms'),
        timeStandardDeviationS: interpolate('timeStandardDeviationS'),
        dropStandardDeviationM: interpolate('dropStandardDeviationM'),
        pathStandardDeviationM: interpolate('pathStandardDeviationM'),
        holdoverStandardDeviationRad: interpolate('holdoverStandardDeviationRad'),
        windDriftStandardDeviationM: interpolate('windDriftStandardDeviationM'),
    };
}
