import type { CustomDraft, Inputs } from '../types';

export function validateInputs(value: Inputs) {
  const errors: string[] = [];
  const within = (n: number, min: number, max: number, label: string) => {
    if (!Number.isFinite(n) || n < min || n > max)
      errors.push(`${label} must be between ${min} and ${max}.`);
  };
  within(value.distanceM, 0, 2000, 'Range (m)');
  within(value.temperatureC, -60, 60, 'Temperature (°C)');
  within(value.pressureHpa, 500, 1100, 'Station pressure (hPa)');
  within(value.humidityPercent, 0, 100, 'Humidity (%)');
  within(value.altitudeM, 0, 11000, 'Altitude (m)');
  within(value.headwindMps, -100, 100, 'Headwind (m/s)');
  within(value.vitalZoneM, 0.01, 2, 'Vital zone (m)');
  within(value.shotgunSightM, 0, 0.25, 'Shotgun sight height (m)');
  within(value.rifleSightM, 0, 0.25, 'Rifle sight height (m)');
  within(value.shotgunMvMultiplier, 0.75, 1.25, 'Shotgun velocity multiplier');
  within(value.rifleMvMultiplier, 0.75, 1.25, 'Rifle velocity multiplier');
  within(value.rifleTwistInches, 5, 30, 'Rifle twist (in/turn)');
  return errors;
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
