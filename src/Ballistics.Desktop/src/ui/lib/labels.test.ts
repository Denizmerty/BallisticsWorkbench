import { describe, expect, it } from 'vitest';
import type { Load } from '../types';
import { dragDescription, firearmLabel, projectileLabel } from './labels';

const load = (overrides: Partial<Load> = {}): Load =>
  ({
    name: 'Test',
    shortName: 'Test',
    dragModel: 'G1',
    firearmGroup: 'rifle',
    massKg: 0.01,
    muzzleVelocityMps: 800,
    ballisticCoefficient: 0.4,
    bcKind: 'test',
    sphereDiameterM: 0,
    materialDensityKgM3: 0,
    pelletCount: 1,
    zeroM: 0,
    mpbrM: 0,
    points: [],
    ...overrides,
  }) as Load;

describe('labels', () => {
  it('names the firearm group', () => {
    expect(firearmLabel(load({ firearmGroup: 'rifle' }))).toBe('Rifle');
    expect(firearmLabel(load({ firearmGroup: 'shotgun' }))).toBe('Shotgun');
  });

  it('describes single vs multi-pellet payloads', () => {
    expect(projectileLabel(load({ pelletCount: 1 }))).toBe('projectile');
    expect(projectileLabel(load({ pelletCount: 9 }))).toBe('pellet');
  });

  it('describes the drag model', () => {
    expect(dragDescription(load({ dragModel: 'G7' }))).toBe('G7 reference');
    expect(dragDescription(load({ dragModel: 'Sphere' }))).toBe('Reynolds–Mach sphere');
  });
});
