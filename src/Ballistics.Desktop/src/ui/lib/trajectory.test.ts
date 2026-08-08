import { describe, expect, it } from 'vitest';
import type { Point } from '../types';
import { pointAt } from './trajectory';

const point = (distanceM: number, overrides: Partial<Point> = {}): Point => ({
  distanceM,
  speedMps: distanceM,
  energyJ: distanceM * 10,
  momentumKgms: distanceM * 2,
  timeS: distanceM / 100,
  dropM: distanceM / 1000,
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

  it('clamps to the first point below the range', () => {
    expect(pointAt(line, -10)).toBe(line[0]);
  });

  it('clamps to the last point above the range', () => {
    expect(pointAt(line, 9999)).toBe(line[2]);
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
});
