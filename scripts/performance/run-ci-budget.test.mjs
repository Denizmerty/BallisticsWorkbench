import { describe, expect, it } from 'vitest';
import { parseArguments } from './run-ci-budget.mjs';

describe('CI performance-budget runner arguments', () => {
    it('uses stable hosted-runner defaults', () => {
        const options = parseArguments([
            '--benchmark-executable',
            'benchmark',
            '--benchmark',
            'benchmark.json',
            '--engine',
            'engine',
            '--output',
            'assessment.json',
        ]);
        expect(options.attempts).toBe(2);
        expect(options.iterations).toBe(5);
    });

    it('rejects undersampled or excessive retry configurations', () => {
        const required = [
            '--benchmark-executable',
            'benchmark',
            '--benchmark',
            'benchmark.json',
            '--engine',
            'engine',
            '--output',
            'assessment.json',
        ];
        expect(() => parseArguments([...required, '--iterations', '3'])).toThrow(/iterations/);
        expect(() => parseArguments([...required, '--attempts', '4'])).toThrow(/attempts/);
    });
});
