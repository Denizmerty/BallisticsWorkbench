import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readProductMetadata } from '../product/product-metadata.mjs';
import {
    nativePresets,
    parseNativeBuildArguments,
    validatePresetDocument,
    verifyNativeStage,
} from './native-build.mjs';

const temporaryDirectories = [];
const repositoryRoot = resolve(import.meta.dirname, '../..');

async function temporaryDirectory() {
    const directory = await mkdtemp(join(tmpdir(), 'ballistics-native-build-test-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
});

describe('native CMake orchestration', () => {
    it('keeps configure, build, and test presets aligned', async () => {
        const document = JSON.parse(
            await readFile(join(repositoryRoot, 'CMakePresets.json'), 'utf8'),
        );
        expect(() => validatePresetDocument(document)).not.toThrow();
        expect(Object.keys(nativePresets)).toEqual([
            'windows-msvc',
            'linux-gcc',
            'linux-clang',
            'linux-sanitizers',
            'macos-universal',
        ]);
    });

    it('keeps the CMake project connected to authoritative product metadata', async () => {
        const [metadata, cmake, template] = await Promise.all([
            readProductMetadata(repositoryRoot),
            readFile(join(repositoryRoot, 'CMakeLists.txt'), 'utf8'),
            readFile(join(repositoryRoot, 'cmake/product_identity.hpp.in'), 'utf8'),
        ]);
        expect(cmake).toContain('config/product-metadata.json');
        expect(cmake).not.toMatch(/project\(BallisticsWorkbench VERSION \d/);
        expect(template).toContain('@BALLISTICS_APPLICATION_VERSION@');
        expect(template).toContain('@BALLISTICS_MODEL_VERSION@');
        expect(metadata.protocolVersion).toBeGreaterThan(0);
    });

    it('parses bounded build controls and rejects unknown options', () => {
        const platformPreset =
            process.platform === 'win32'
                ? 'windows-msvc'
                : process.platform === 'darwin'
                  ? 'macos-universal'
                  : 'linux-clang';
        expect(
            parseNativeBuildArguments([
                '--preset',
                platformPreset,
                '--fresh',
                '--skip-tests',
                '--skip-install',
            ]),
        ).toEqual({ preset: platformPreset, fresh: true, tests: false, install: false });
        expect(() => parseNativeBuildArguments(['--unknown'])).toThrow(
            'Unknown native-build option',
        );
        expect(() => parseNativeBuildArguments(['--preset', 'imaginary'])).toThrow(
            'Unknown native',
        );
    });

    it('accepts only a complete canonical runtime stage', async () => {
        const root = await temporaryDirectory();
        const bin = join(root, 'build', 'stage', 'bin');
        const licenses = join(root, 'build', 'stage', 'share', 'licenses', 'BallisticsWorkbench');
        await mkdir(bin, { recursive: true });
        await mkdir(licenses, { recursive: true });
        await writeFile(
            join(bin, process.platform === 'win32' ? 'ballistics_cli.exe' : 'ballistics_cli'),
            Buffer.alloc(2048),
        );
        await writeFile(join(licenses, 'LICENSE'), 'license\n'.repeat(200));
        const stage = await verifyNativeStage(root);
        expect(stage.bytes).toBe(2048);
    });

    it('rejects missing or implausibly small staged files', async () => {
        const root = await temporaryDirectory();
        await expect(verifyNativeStage(root)).rejects.toThrow();
        const bin = join(root, 'build', 'stage', 'bin');
        const licenses = join(root, 'build', 'stage', 'share', 'licenses', 'BallisticsWorkbench');
        await mkdir(bin, { recursive: true });
        await mkdir(licenses, { recursive: true });
        await writeFile(
            join(bin, process.platform === 'win32' ? 'ballistics_cli.exe' : 'ballistics_cli'),
            'small',
        );
        await writeFile(join(licenses, 'LICENSE'), 'small');
        await expect(verifyNativeStage(root)).rejects.toThrow('invalid');
    });
});
