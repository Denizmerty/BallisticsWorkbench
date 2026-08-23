import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFuzzArguments } from './run-protocol-fuzz.mjs';

const requiredArguments = [
    '--executable',
    'build/fuzzer',
    '--corpus',
    'tests/corpus',
    '--dictionary',
    'tests/protocol.dict',
    '--artifacts',
    'build/fuzz-artifacts',
];

describe('protocol fuzz runner arguments', () => {
    it('normalizes required paths and applies the default time budget', () => {
        const options = parseFuzzArguments(requiredArguments);
        expect(options.executable).toBe(path.resolve('build/fuzzer'));
        expect(options.corpus).toBe(path.resolve('tests/corpus'));
        expect(options.dictionary).toBe(path.resolve('tests/protocol.dict'));
        expect(options.artifacts).toBe(path.resolve('build/fuzz-artifacts'));
        expect(options.seconds).toBe(60);
    });

    it('accepts an explicit bounded time budget', () => {
        expect(parseFuzzArguments([...requiredArguments, '--seconds', '300']).seconds).toBe(300);
    });

    it.each([
        ['missing option value', requiredArguments.slice(0, -1)],
        ['zero time budget', [...requiredArguments, '--seconds', '0']],
        ['excessive time budget', [...requiredArguments, '--seconds', '3601']],
        ['unknown option', [...requiredArguments, '--unexpected']],
    ])('rejects %s', (_name, arguments_) => {
        expect(() => parseFuzzArguments(arguments_)).toThrow();
    });
});
