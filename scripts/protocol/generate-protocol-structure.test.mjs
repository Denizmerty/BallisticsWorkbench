import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateProtocolStructure } from './generate-protocol-structure.mjs';

const temporaryDirectories = [];

afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
});

describe('protocol structure generation', () => {
    it('generates native and TypeScript keys and detects drift', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'ballistics-protocol-'));
        temporaryDirectories.push(root);
        await mkdir(path.join(root, 'protocol'), { recursive: true });
        await mkdir(path.join(root, 'src/Ballistics.Cli'), { recursive: true });
        await mkdir(path.join(root, 'src/Ballistics.Desktop/shared'), { recursive: true });
        const source = JSON.parse(
            await readFile(path.resolve('protocol/ballistics-protocol.schema.json'), 'utf8'),
        );
        await writeFile(
            path.join(root, 'protocol/ballistics-protocol.schema.json'),
            JSON.stringify(source),
        );
        const generated = await generateProtocolStructure(root);
        expect(generated.structure.scenario).toContain('atmosphere');
        expect(generated.structure.uncertainty).toContain('correlations');
        await expect(generateProtocolStructure(root, true)).resolves.toMatchObject({ changed: [] });
        await writeFile(
            path.join(root, 'src/Ballistics.Cli/generated_protocol_structure.hpp'),
            'stale',
        );
        await expect(generateProtocolStructure(root, true)).rejects.toThrow('stale');
    });
});
