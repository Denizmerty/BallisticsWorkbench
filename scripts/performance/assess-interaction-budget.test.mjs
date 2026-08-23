import { describe, expect, it } from 'vitest';
import { assessInteractionBudget, percentile } from './assess-interaction-budget.mjs';

const benchmark = (p95Ms = 50) => ({
    schemaVersion: 1,
    benchmarks: [
        {
            id: 'nine-loads-2000m-full-calculation',
            medianMs: 45,
            p95Ms,
            acceptedStepsPerIteration: 1200,
            rejectedStepsPerIteration: 25,
        },
    ],
});

const budget = {
    schemaVersion: 1,
    scenario: 'nine-loads-2000m-full-calculation',
    warmNativeP95Ms: 1750,
    coldProcessP95Ms: 2000,
    persistentWorkerReconsiderationOverheadMs: 250,
    minimumColdSamples: 3,
    policy: 'fixture policy',
};

describe('interaction performance assessment', () => {
    it('uses nearest-rank percentiles', () => {
        expect(percentile([5, 1, 4, 2, 3], 0.5)).toBe(3);
        expect(percentile([5, 1, 4, 2, 3], 0.95)).toBe(5);
    });

    it('retains per-request processes while both budgets and the worker threshold pass', () => {
        const result = assessInteractionBudget(benchmark(), [120, 125, 130], budget);
        expect(result.passed).toBe(true);
        expect(result.persistentWorker.decision).toBe('retain-per-request-process');
        expect(result.warmNative.acceptedStepsPerIteration).toBe(1200);
    });

    it('fails a warm native regression independently from cold startup', () => {
        const result = assessInteractionBudget(benchmark(1800), [1820, 1825, 1830], budget);
        expect(result.passed).toBe(false);
        expect(result.warmNative.passed).toBe(false);
        expect(result.coldProcess.passed).toBe(true);
    });

    it('records the two-baseline worker reconsideration decision before architecture changes', () => {
        const result = assessInteractionBudget(benchmark(), [780, 790, 800], {
            ...budget,
            persistentWorkerReconsiderationOverheadMs: 100,
        });
        expect(result.passed).toBe(true);
        expect(result.persistentWorker.decision).toMatch(/^reconsider/);
    });

    it('rejects undersampled cold-process reports', () => {
        expect(() => assessInteractionBudget(benchmark(), [120, 125], budget)).toThrow(/Too few/);
    });
});
