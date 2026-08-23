import { describe, expect, it } from 'vitest';
import { formatDistance, formatNumber } from './format';

describe('formatNumber', () => {
    it('groups thousands and keeps the requested precision', () => {
        expect(formatNumber(2700, 0)).toBe('2,700');
        expect(formatNumber(1234567.89, 1)).toBe('1,234,567.9');
    });

    it('pads fractional digits', () => {
        expect(formatNumber(5, 2)).toBe('5.00');
        expect(formatNumber(0.5, 3)).toBe('0.500');
    });

    it('renders non-finite values as an em dash', () => {
        expect(formatNumber(NaN, 1)).toBe('N/A');
        expect(formatNumber(Infinity, 0)).toBe('N/A');
    });
});

describe('formatDistance', () => {
    it('uses one decimal for ordinary ranges', () => {
        expect(formatDistance(125, 'm')).toBe('125.0 m');
    });

    it('uses two decimals near the muzzle', () => {
        expect(formatDistance(4.5, 'yd')).toBe('4.50 yd');
    });
});
