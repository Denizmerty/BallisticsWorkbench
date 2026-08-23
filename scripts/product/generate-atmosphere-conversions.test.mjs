import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateAtmosphereConversions } from './generate-atmosphere-conversions.mjs';

const temporaryDirectories = [];

afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
});

describe('atmosphere conversion generation', () => {
    it('generates matching native and TypeScript implementations and detects drift', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'ballistics-atmosphere-'));
        temporaryDirectories.push(root);
        await mkdir(path.join(root, 'src/Ballistics.Core/include'), { recursive: true });
        await mkdir(path.join(root, 'src/Ballistics.Desktop/shared'), { recursive: true });
        await writeFile(path.join(root, '.clang-format'), await readFile('.clang-format'));

        await expect(generateAtmosphereConversions(root)).resolves.toMatchObject({
            changed: expect.arrayContaining([
                'src/Ballistics.Core/include/generated_atmosphere_conversions.hpp',
                'src/Ballistics.Desktop/shared/generatedAtmosphereConversions.ts',
            ]),
        });
        await expect(generateAtmosphereConversions(root, true)).resolves.toMatchObject({
            changed: [],
        });
        await writeFile(
            path.join(root, 'src/Ballistics.Desktop/shared/generatedAtmosphereConversions.ts'),
            'stale',
        );
        await expect(generateAtmosphereConversions(root, true)).rejects.toThrow('stale');
    });
});
