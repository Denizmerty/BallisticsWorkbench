import { describe, expect, it } from 'vitest';
import type { CustomDraft, Inputs } from '../types';
import { validateCustomLoad, validateInputs } from './validation';

const validInputs: Inputs = {
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

const validDraft: CustomDraft = {
  name: 'Test load',
  drag: 'G1',
  group: 'rifle',
  massG: 10.886,
  mv: 823,
  bc: 0.475,
  sphereMm: 8.382,
  density: 11340,
  count: 1,
  length: 1.1,
  diameter: 0.308,
  twist: 0,
};

describe('validateInputs', () => {
  it('accepts a valid input set', () => {
    expect(validateInputs(validInputs)).toEqual([]);
  });

  it('rejects out-of-range values with a labelled message', () => {
    const errors = validateInputs({ ...validInputs, temperatureC: 999 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Temperature');
  });

  it('rejects non-finite values', () => {
    expect(validateInputs({ ...validInputs, pressureHpa: NaN })).toHaveLength(1);
  });

  it('reports every violated field', () => {
    const errors = validateInputs({ ...validInputs, humidityPercent: 200, headwindMps: 500 });
    expect(errors).toHaveLength(2);
  });
});

describe('validateCustomLoad', () => {
  it('accepts a valid rifle G1 draft', () => {
    expect(validateCustomLoad(validDraft)).toEqual([]);
  });

  it('requires a name', () => {
    expect(validateCustomLoad({ ...validDraft, name: '   ' })).toContain('Name is required.');
  });

  it('requires a positive muzzle velocity', () => {
    expect(validateCustomLoad({ ...validDraft, mv: 0 })).toContain(
      'Muzzle velocity must be positive.',
    );
  });

  it('requires an integer payload count', () => {
    expect(validateCustomLoad({ ...validDraft, count: 2.5 })).toContain(
      'Payload count must be a whole number.',
    );
  });

  it('validates BC bounds for non-sphere drag models', () => {
    expect(validateCustomLoad({ ...validDraft, bc: 3 })).toContain(
      'Ballistic coefficient must be positive and at most 2.',
    );
  });

  it('validates sphere geometry instead of mass/BC for sphere drag', () => {
    const errors = validateCustomLoad({ ...validDraft, drag: 'Sphere', sphereMm: 0, bc: 99 });
    expect(errors.some((e) => e.includes('Sphere diameter'))).toBe(true);
    expect(errors.some((e) => e.includes('Ballistic coefficient'))).toBe(false);
  });

  it('rejects negative rifle dimensions', () => {
    expect(validateCustomLoad({ ...validDraft, diameter: -1 })).toContain(
      'Optional rifle dimensions cannot be negative.',
    );
  });

  it('ignores rifle dimensions for shotgun drafts', () => {
    expect(validateCustomLoad({ ...validDraft, group: 'shotgun', diameter: -1 })).toEqual([]);
  });
});
