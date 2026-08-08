const EM_DASH = '—';

/**
 * Format a number for on-screen display with grouped thousands and a fixed
 * number of fractional digits. Non-finite values render as an em dash so the
 * interface never shows "NaN" or "Infinity". CSV export deliberately does not
 * use this helper; exported values stay machine-parseable and ungrouped.
 */
export function formatNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) return EM_DASH;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Format a distance, choosing extra precision for very small values so short
 * ranges near the muzzle remain legible on the interactive chart.
 */
export function formatDistance(value: number, unit: string): string {
  return `${formatNumber(value, value >= 10 ? 1 : 2)} ${unit}`;
}
