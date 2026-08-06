import { describe, expect, it } from 'vitest';
import { altitudeToPressure, pressureToAltitude } from './atmosphere';

// These reference values are produced by ballistics::altitude_to_pressure_hpa and
// ballistics::pressure_to_altitude_m in the C++ core (Ballistics.Core). The two
// implementations share the ICAO standard-atmosphere formula and MUST stay in
// lockstep; this suite fails if the TypeScript copy drifts from the C++ engine.
const relClose = (actual: number, expected: number, rel = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)));

describe('altitudeToPressure — parity with C++ core', () => {
  const cases: [number, number][] = [
    [0, 1013.25],
    [500, 954.6094201448667],
    [1000, 898.7476493918435],
    [1500, 845.5628082684034],
    [2500, 746.8294471701664],
    [3000, 701.0901048906298],
    [5000, 540.2052508922242],
    [8000, 356.00483218291515],
    [11000, 226.32676011429288],
  ];
  it.each(cases)('altitude %d m → %f hPa', (altitude, pressure) => {
    relClose(altitudeToPressure(altitude), pressure);
  });

  it('clamps altitude below sea level to the sea-level pressure', () => {
    expect(altitudeToPressure(-1000)).toBe(1013.25);
  });

  it('clamps altitude above 11 km to the 11 km pressure', () => {
    relClose(altitudeToPressure(20000), 226.32676011429288);
  });
});

describe('pressureToAltitude — parity with C++ core', () => {
  const cases: [number, number][] = [
    [1013.25, 0],
    [900, 988.5184002303411],
    [800, 1949.0235497100805],
    [700, 3012.2350069293493],
    [500, 5574.531437541877],
    [300, 9164.103830404816],
    [226, 11009.161259582243],
  ];
  it.each(cases)('pressure %f hPa → altitude %f m', (pressure, altitude) => {
    relClose(pressureToAltitude(pressure), altitude);
  });
});

describe('altitude/pressure round trip', () => {
  it.each([0, 500, 1500, 3000, 6000, 10000])('round trips %d m', (altitude) => {
    relClose(pressureToAltitude(altitudeToPressure(altitude)), altitude, 1e-6);
  });
});
