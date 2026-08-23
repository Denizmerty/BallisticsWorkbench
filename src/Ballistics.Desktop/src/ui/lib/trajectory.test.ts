import { describe, expect, it } from 'vitest';
import type { Point, UncertaintyPoint } from '../types';
import { pointAt, uncertaintyAt } from './trajectory';

const point = (distanceM: number, overrides: Partial<Point> = {}): Point => ({
    distanceM,
    speedMps: distanceM,
    airspeedMps: distanceM,
    energyJ: distanceM * 10,
    momentumKgms: distanceM * 2,
    timeS: distanceM / 100,
    dropM: distanceM / 1000,
    pathM: distanceM / 2000,
    holdoverRad: distanceM > 0 ? Math.atan2(-(distanceM / 2000), distanceM) : 0,
    mach: distanceM / 340,
    spinDriftM: distanceM / 500,
    windDriftM: distanceM / 250,
    ...overrides,
});

const line: Point[] = [point(0), point(100), point(200)];

describe('pointAt', () => {
    it('returns undefined for an empty trajectory', () => {
        expect(pointAt([], 50)).toBeUndefined();
    });

    it('returns undefined below trajectory coverage', () => {
        expect(pointAt(line, -10)).toBeUndefined();
    });

    it('returns undefined above trajectory coverage', () => {
        expect(pointAt(line, 9999)).toBeUndefined();
    });

    it('returns exact grid points unchanged', () => {
        expect(pointAt(line, 100)!.speedMps).toBe(100);
    });

    it('interpolates linearly between grid points', () => {
        const p = pointAt(line, 150)!;
        expect(p.distanceM).toBe(150);
        expect(p.speedMps).toBeCloseTo(150, 10);
        expect(p.energyJ).toBeCloseTo(1500, 10);
        expect(p.timeS).toBeCloseTo(1.5, 10);
        expect(p.holdoverRad).toBeCloseTo(line[1].holdoverRad, 12);
    });

    it('omits cd/reynolds when the first point has none', () => {
        const p = pointAt(line, 150)!;
        expect(p.cd).toBeUndefined();
        expect(p.reynolds).toBeUndefined();
    });

    it('interpolates cd/reynolds when present', () => {
        const sphere: Point[] = [
            point(0, { cd: 0.4, reynolds: 100000 }),
            point(100, { cd: 0.5, reynolds: 200000 }),
        ];
        const p = pointAt(sphere, 50)!;
        expect(p.cd).toBeCloseTo(0.45, 10);
        expect(p.reynolds).toBeCloseTo(150000, 5);
    });

    it('preserves unavailable spin drift', () => {
        const unavailable: Point[] = [
            point(0, { spinDriftM: null }),
            point(100, { spinDriftM: null }),
        ];
        expect(pointAt(unavailable, 50)?.spinDriftM).toBeNull();
    });
});

const uncertainty = (distanceM: number, available = true): UncertaintyPoint => ({
    distanceM,
    available,
    speedStandardDeviationMps: distanceM / 10,
    energyStandardDeviationJ: distanceM,
    momentumStandardDeviationKgms: distanceM / 100,
    timeStandardDeviationS: distanceM / 10000,
    dropStandardDeviationM: distanceM / 1000,
    pathStandardDeviationM: distanceM / 2000,
    holdoverStandardDeviationRad: distanceM / 2_000_000,
    windDriftStandardDeviationM: distanceM / 4000,
});

describe('uncertaintyAt', () => {
    const samples = [uncertainty(0), uncertainty(100), uncertainty(200)];

    it('returns exact samples and rejects distances outside coverage', () => {
        expect(uncertaintyAt(samples, 100)).toEqual(samples[1]);
        expect(uncertaintyAt(samples, 201)).toBeUndefined();
    });

    it('interpolates standard deviations linearly', () => {
        const sample = uncertaintyAt(samples, 150)!;
        expect(sample.speedStandardDeviationMps).toBeCloseTo(15, 10);
        expect(sample.pathStandardDeviationM).toBeCloseTo(0.075, 10);
        expect(sample.holdoverStandardDeviationRad).toBeCloseTo(0.000075, 12);
        expect(sample.available).toBe(true);
    });

    it('does not mark an interval available when either endpoint failed', () => {
        expect(uncertaintyAt([uncertainty(0), uncertainty(100, false)], 50)?.available).toBe(false);
    });
});
