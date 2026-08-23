import { describe, expect, it } from 'vitest';
import { buildSensitivitySummary, validateBatchDocument } from './run-scenarios.mjs';

const request = (requestId = 'batch-1') => ({
    protocolVersion: 2,
    requestId,
    scenario: {},
    customLoads: [],
});

describe('batch scenario runner', () => {
    it('accepts unique bounded calculation entries', () => {
        const value = { schemaVersion: 1, scenarios: [{ id: 'baseline', request: request() }] };
        expect(validateBatchDocument(value)).toBe(value);
    });

    it.each([
        { schemaVersion: 1, scenarios: [] },
        {
            schemaVersion: 1,
            scenarios: [
                { id: 'same', request: request('a') },
                { id: 'same', request: request('b') },
            ],
        },
        {
            schemaVersion: 1,
            scenarios: [{ id: 'calibration', request: { ...request(), operation: 'calibrate' } }],
        },
    ])('rejects an invalid batch document', (value) => {
        expect(() => validateBatchDocument(value)).toThrow();
    });

    it('computes endpoint deltas from the first successful scenario', () => {
        const result = (speedMps, pathM) => ({
            ok: true,
            loads: [
                {
                    id: 'builtin:test',
                    coveredDistanceM: 100,
                    points: [
                        {
                            speedMps,
                            energyJ: speedMps ** 2,
                            timeS: 1,
                            dropM: 0.1,
                            pathM,
                            windDriftM: 0,
                        },
                    ],
                },
            ],
        });
        const summary = buildSensitivitySummary([
            { id: 'baseline', ok: true, result: result(700, 0) },
            { id: 'hot', ok: true, result: result(710, 0.02) },
        ]);
        expect(summary.baselineScenarioId).toBe('baseline');
        expect(summary.comparisons[0].deltas.speedMps).toBe(10);
        expect(summary.comparisons[0].deltas.pathM).toBe(0.02);
    });
});
