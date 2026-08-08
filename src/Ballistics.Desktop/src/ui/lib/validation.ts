import type { CustomDraft, Inputs } from '../types';

type Bound = { key: keyof Inputs; min: number; max: number; label: string };

// Canonical SI bounds shared by the whole-form validator and the per-field
// validator so both always agree on limits and messages.
const INPUT_BOUNDS: Bound[] = [
  { key: 'distanceM', min: 0, max: 2000, label: 'Range (m)' },
  { key: 'temperatureC', min: -60, max: 60, label: 'Temperature (°C)' },
  { key: 'pressureHpa', min: 500, max: 1100, label: 'Station pressure (hPa)' },
  { key: 'humidityPercent', min: 0, max: 100, label: 'Humidity (%)' },
  { key: 'altitudeM', min: 0, max: 11000, label: 'Altitude (m)' },
  { key: 'headwindMps', min: -100, max: 100, label: 'Headwind (m/s)' },
  { key: 'crosswindMps', min: -100, max: 100, label: 'Crosswind (m/s)' },
  { key: 'vitalZoneM', min: 0.01, max: 2, label: 'Vital zone (m)' },
  { key: 'shotgunSightM', min: 0, max: 0.25, label: 'Shotgun sight height (m)' },
  { key: 'rifleSightM', min: 0, max: 0.25, label: 'Rifle sight height (m)' },
  { key: 'shotgunZeroM', min: 5, max: 1000, label: 'Shotgun zero range (m)' },
  { key: 'rifleZeroM', min: 5, max: 1000, label: 'Rifle zero range (m)' },
  { key: 'shotgunMvMultiplier', min: 0.75, max: 1.25, label: 'Shotgun velocity multiplier' },
  { key: 'rifleMvMultiplier', min: 0.75, max: 1.25, label: 'Rifle velocity multiplier' },
  { key: 'rifleTwistInches', min: 5, max: 30, label: 'Rifle twist (in/turn)' },
];

const message = ({ min, max, label }: Bound) => `${label} must be between ${min} and ${max}.`;

const violated = (value: Inputs, bound: Bound) => {
  const n = value[bound.key] as number;
  return !Number.isFinite(n) || n < bound.min || n > bound.max;
};

export function validateInputs(value: Inputs) {
  return INPUT_BOUNDS.filter((bound) => violated(value, bound)).map(message);
}

/**
 * Per-field validation used to flag the exact inputs that are out of range so
 * the sidebar can highlight them individually rather than only listing errors.
 */
export function fieldErrors(value: Inputs): Partial<Record<keyof Inputs, string>> {
  const map: Partial<Record<keyof Inputs, string>> = {};
  for (const bound of INPUT_BOUNDS) {
    if (violated(value, bound)) map[bound.key] = message(bound);
  }
  return map;
}

export function validateCustomLoad(draft: CustomDraft) {
  const errors: string[] = [];
  const within = (value: number, min: number, max: number, label: string) => {
    if (!Number.isFinite(value) || value < min || value > max) {
      errors.push(`${label} must be between ${min} and ${max}.`);
    }
  };

  if (!draft.name.trim()) {
    errors.push('Name is required.');
  }
  if (!Number.isFinite(draft.mv) || draft.mv <= 0) {
    errors.push('Muzzle velocity must be positive.');
  }
  within(draft.count, 1, 1000, 'Payload count');
  if (!Number.isInteger(draft.count)) {
    errors.push('Payload count must be a whole number.');
  }

  if (draft.drag === 'Sphere') {
    within(draft.sphereMm, 1, 50, 'Sphere diameter (mm)');
    within(draft.density, 500, 25000, 'Material density (kg/m³)');
  } else {
    if (!Number.isFinite(draft.massG) || draft.massG <= 0) {
      errors.push('Projectile mass must be positive.');
    }
    if (!Number.isFinite(draft.bc) || draft.bc <= 0 || draft.bc > 2) {
      errors.push('Ballistic coefficient must be positive and at most 2.');
    }
  }

  if (draft.group === 'rifle') {
    if (
      !Number.isFinite(draft.length) ||
      !Number.isFinite(draft.diameter) ||
      !Number.isFinite(draft.twist) ||
      draft.length < 0 ||
      draft.diameter < 0 ||
      draft.twist < 0
    ) {
      errors.push('Optional rifle dimensions cannot be negative.');
    }
  }
  return errors;
}
