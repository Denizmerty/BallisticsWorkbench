import { describe, expect, it } from 'vitest';
import { validateUiSmokeReport } from './packaged-ui-smoke.mjs';

const validReport = () => ({
    schemaVersion: 1,
    passed: true,
    rendererChecks: Array.from({ length: 8 }, (_, index) => ({
        name: `check-${index}`,
        passed: true,
        detail: 'passed',
    })),
    securityChecks: Array.from({ length: 6 }, (_, index) => ({
        name: `security-check-${index}`,
        passed: true,
        detail: 'passed',
    })),
    csv: {
        file: 'ballistics_range_table.csv',
        bytes: 4096,
        hasUtf8Bom: true,
        loadSections: 6,
    },
});

describe('packaged UI smoke report validation', () => {
    it('accepts a complete renderer and CSV report', () => {
        expect(validateUiSmokeReport(validReport()).csv.loadSections).toBe(6);
    });

    it.each([
        ['failed renderer check', (report) => (report.rendererChecks[2].passed = false)],
        ['failed security check', (report) => (report.securityChecks[2].passed = false)],
        ['missing CSV load', (report) => (report.csv.loadSections = 5)],
        ['missing UTF-8 BOM', (report) => (report.csv.hasUtf8Bom = false)],
        ['undersized CSV', (report) => (report.csv.bytes = 50)],
    ])('rejects %s', (_name, mutate) => {
        const report = validReport();
        mutate(report);
        expect(() => validateUiSmokeReport(report)).toThrow(/invalid|failed/);
    });
});
