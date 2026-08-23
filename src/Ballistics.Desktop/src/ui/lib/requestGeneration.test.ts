import { describe, expect, it } from 'vitest';
import { RequestGeneration } from './requestGeneration';

describe('RequestGeneration', () => {
    it('prevents an older completion from replacing the newest result', async () => {
        const gate = new RequestGeneration();
        let displayed = '';
        let resolveOld!: (value: string) => void;
        let resolveNew!: (value: string) => void;
        const oldPromise = new Promise<string>((resolve) => (resolveOld = resolve));
        const newPromise = new Promise<string>((resolve) => (resolveNew = resolve));

        const commit = async (generation: number, promise: Promise<string>) => {
            const value = await promise;
            if (gate.isCurrent(generation)) displayed = value;
        };

        const oldGeneration = gate.begin();
        const oldCompletion = commit(oldGeneration, oldPromise);
        const newGeneration = gate.begin();
        const newCompletion = commit(newGeneration, newPromise);

        resolveNew('new');
        await newCompletion;
        resolveOld('old');
        await oldCompletion;

        expect(displayed).toBe('new');
    });
});
