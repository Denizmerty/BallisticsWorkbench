const UNAVAILABLE_VALUE = 'N/A';

/**
 * Format a number for on-screen display with grouped thousands and a fixed
 * number of fractional digits. Non-finite values render as "N/A". CSV export
 * keeps values machine-parseable and ungrouped, so it does not use this helper.
 */
export function formatNumber(value: number, digits: number): string {
    if (!Number.isFinite(value)) return UNAVAILABLE_VALUE;
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
