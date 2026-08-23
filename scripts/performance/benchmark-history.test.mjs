import { describe, expect, it } from 'vitest';
import {
    benchmarkRun,
    compareBenchmarkHistory,
    renderTrendMarkdown,
} from './benchmark-history.mjs';

const report = {
    schemaVersion: 1,
    engineVersion: '1.0.2',
    modelVersion: '2026.08.9',
    platform: 'windows',
    compiler: 'MSVC test',
    hardwareConcurrency: 8,
    benchmarks: [
        { id: 'short', medianMs: 5, p95Ms: 7 },
        { id: 'new-case', medianMs: 2, p95Ms: 3 },
    ],
};

const history = {
    schemaVersion: 1,
    runs: [
        {
            id: 'baseline',
            recordedAt: '2026-08-01T00:00:00Z',
            engineVersion: '1.0.1',
            modelVersion: '2026.08.8',
            platform: 'windows',
            compiler: 'MSVC test',
            hardwareConcurrency: 8,
            benchmarks: [{ id: 'short', medianMs: 4, p95Ms: 8 }],
        },
    ],
};

describe('native benchmark history', () => {
    it('compares only compatible machine/toolchain runs', () => {
        const trend = compareBenchmarkHistory(report, history);
        expect(trend.compatibleBaselineRunId).toBe('baseline');
        expect(trend.comparisons[0].medianChangePercent).toBe(25);
        expect(trend.comparisons[0].p95ChangePercent).toBe(-12.5);
        expect(trend.comparisons[1].baselineMedianMs).toBeNull();
    });

    it('renders a compact human-readable trend table', () => {
        const markdown = renderTrendMarkdown(compareBenchmarkHistory(report, history));
        expect(markdown).toContain('| short | 5.000 | 4.000 | +25.0% |');
        expect(markdown).toContain('| new-case | 2.000 | n/a | new |');
    });

    it('records only stable benchmark measurements', () => {
        const run = benchmarkRun(report, 'candidate', '2026-08-23T00:00:00Z');
        expect(run.benchmarks).toEqual([
            { id: 'short', medianMs: 5, p95Ms: 7 },
            { id: 'new-case', medianMs: 2, p95Ms: 3 },
        ]);
        expect(run).not.toHaveProperty('clock');
    });

    it('rejects duplicate benchmark identifiers', () => {
        expect(() =>
            compareBenchmarkHistory(
                { ...report, benchmarks: [report.benchmarks[0], report.benchmarks[0]] },
                history,
            ),
        ).toThrow(/unique/);
    });
});
