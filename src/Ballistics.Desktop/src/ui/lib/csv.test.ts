import { describe, expect, it } from 'vitest';
import type { Inputs, Load, Point, Result } from '../types';
import { buildCsv } from './csv';

const point = (distanceM: number, speedMps: number): Point => ({
  distanceM,
  speedMps,
  energyJ: 0.5 * 0.01 * speedMps * speedMps,
  momentumKgms: 0.01 * speedMps,
  timeS: distanceM / speedMps,
  dropM: distanceM * distanceM * 1e-5,
  mach: speedMps / 340,
  spinDriftM: distanceM * 1e-4,
});

const rifle: Load = {
  name: 'Rifle load',
  shortName: 'Rifle',
  dragModel: 'G1',
  firearmGroup: 'rifle',
  massKg: 0.01,
  muzzleVelocityMps: 800,
  ballisticCoefficient: 0.475,
  bcKind: 'manufacturer G1 BC',
  sphereDiameterM: 0,
  materialDensityKgM3: 0,
  pelletCount: 1,
  zeroM: 200,
  mpbrM: 240,
  points: [point(0, 800), point(50, 700), point(100, 620)],
};

const inputs: Inputs = {
  distanceM: 100,
  temperatureC: 15,
  pressureHpa: 1013.25,
  humidityPercent: 50,
  altitudeM: 0,
  headwindMps: 0,
  vitalZoneM: 0.15,
  shotgunSightM: 0.025,
  rifleSightM: 0.04,
  shotgunMvMultiplier: 1,
  rifleMvMultiplier: 1,
  rifleTwistInches: 10,
  twistDirection: 1,
};

const result: Result = {
  atmosphere: { densityKgM3: 1.221, speedOfSoundMps: 340.3, viscosityPaS: 1.79e-5 },
  loads: [rifle],
};

describe('buildCsv', () => {
  it('starts with a UTF-8 BOM so Excel reads it as UTF-8', () => {
    expect(buildCsv(result, inputs, 50, false).startsWith('﻿')).toBe(true);
  });

  it('uses CRLF line endings', () => {
    expect(buildCsv(result, inputs, 50, false)).toContain('\r\n');
  });

  it('emits one data row per load per distance step', () => {
    const dataRows = buildCsv(result, inputs, 50, false)
      .split('\r\n')
      .filter((line) => line.startsWith('"0.0"') || /^"(50|100)\.0"/.test(line));
    // distances 0, 50, 100 → three rows for the single load
    expect(dataRows).toHaveLength(3);
  });

  it('quotes fields and escapes embedded quotes', () => {
    const quoted: Result = {
      ...result,
      loads: [{ ...rifle, name: 'Load "special"' }],
    };
    expect(buildCsv(quoted, inputs, 100, false)).toContain('"Load ""special"""');
  });

  it('switches units and headers in imperial mode', () => {
    const csv = buildCsv(result, inputs, 50, true);
    expect(csv).toContain('Distance (yd)');
    expect(csv).toContain('Velocity (ft/s)');
  });

  it('labels metric headers in metric mode', () => {
    const csv = buildCsv(result, inputs, 50, false);
    expect(csv).toContain('Distance (m)');
    expect(csv).toContain('Velocity (m/s)');
  });
});
