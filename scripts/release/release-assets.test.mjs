import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
    buildReleaseAssets,
    collectReleaseArtifacts,
    readVersionIdentity,
    verifyReleaseAssets,
    verifyReleaseTag,
} from './release-assets.mjs';
import { readProductMetadata, releaseIdentity } from '../product/product-metadata.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const productMetadata = await readProductMetadata(repositoryRoot);
const identity = releaseIdentity(productMetadata);
const version = identity.application;
const releaseTag = `v${version}`;
const commit = '0123456789abcdef0123456789abcdef01234567';
const generatedAt = '2026-08-18T12:00:00.000Z';
const temporaryDirectories = [];

async function temporaryDirectory() {
    const directory = await mkdtemp(join(tmpdir(), 'ballistics-release-test-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
});

const sbom = {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: 'urn:uuid:00000000-0000-4000-8000-000000000000',
    version: 1,
    metadata: {
        timestamp: generatedAt,
        component: {
            'bom-ref': `ballistics-workbench@${version}`,
            type: 'library',
            name: 'BallisticsWorkbench',
            version,
            properties: [],
        },
    },
    components: [
        {
            'bom-ref': 'react@19.2.8',
            type: 'library',
            name: 'react',
            version: '19.2.8',
            purl: 'pkg:npm/react@19.2.8',
            licenses: [{ license: { id: 'MIT' } }],
        },
    ],
    dependencies: [],
};

const toolchains = [
    {
        platform: 'windows',
        runner: 'windows-latest',
        architecture: 'x64',
        compiler: 'MSVC 19.51',
        cmake: '4.1.0',
        node: '22.18.0',
        npm: '11.5.2',
        electron: '43.3.0',
        electronBuilder: '26.15.3',
        signed: true,
        notarized: false,
    },
    {
        platform: 'macos',
        runner: 'macos-latest',
        architecture: 'arm64+x86_64',
        compiler: 'AppleClang 17',
        cmake: '4.1.0',
        node: '22.18.0',
        npm: '11.5.2',
        electron: '43.3.0',
        electronBuilder: '26.15.3',
        signed: true,
        notarized: true,
    },
    {
        platform: 'linux',
        runner: 'ubuntu-latest',
        architecture: 'x64',
        compiler: 'GCC 14',
        cmake: '4.1.0',
        node: '22.18.0',
        npm: '11.5.2',
        electron: '43.3.0',
        electronBuilder: '26.15.3',
        signed: false,
        notarized: false,
    },
];

describe('release identity', () => {
    it('requires every checked-in version source to agree', async () => {
        const actual = await readVersionIdentity(repositoryRoot);
        expect(actual).toEqual(identity);
        expect(() => verifyReleaseTag(actual, releaseTag)).not.toThrow();
        expect(() => verifyReleaseTag(actual, `${releaseTag}.wrong`)).toThrow('does not match');
    });
});

describe('release asset generation', () => {
    it('builds and verifies a strict checksummed release bundle', async () => {
        const root = await temporaryDirectory();
        const artifacts = join(root, 'artifacts');
        const output = join(root, 'output');
        await mkdir(join(artifacts, 'windows'), { recursive: true });
        await mkdir(join(artifacts, 'macos'), { recursive: true });
        await mkdir(join(artifacts, 'linux'), { recursive: true });
        await writeFile(
            join(artifacts, 'windows', `Ballistics-Workbench-${version}-Setup.exe`),
            'windows',
        );
        await writeFile(
            join(artifacts, 'macos', `Ballistics-Workbench-${version}-universal.dmg`),
            'macos-dmg',
        );
        await writeFile(
            join(artifacts, 'macos', `Ballistics-Workbench-${version}-universal-Installer.pkg`),
            'macos-pkg',
        );
        await writeFile(
            join(artifacts, 'linux', `Ballistics-Workbench-${version}-linux-x64.AppImage`),
            'linux',
        );

        const manifest = await buildReleaseAssets({
            repositoryRoot,
            artifactRoot: artifacts,
            outputDirectory: output,
            tag: releaseTag,
            commit,
            repository: 'Denizmerty/BallisticsWorkbench',
            ref: `refs/tags/${releaseTag}`,
            generatedAt,
            sbom: structuredClone(sbom),
            toolchains,
        });
        expect(manifest.artifacts).toHaveLength(4);
        expect(manifest.artifacts.find((item) => item.kind === 'macos-disk-image')).toMatchObject({
            signed: true,
            notarized: true,
        });
        expect(manifest.artifacts.find((item) => item.kind === 'macos-installer')).toMatchObject({
            platform: 'macos',
            signed: true,
            notarized: true,
        });
        expect(manifest.artifacts.find((item) => item.platform === 'linux')).toMatchObject({
            kind: 'linux-package',
            signed: false,
            notarized: false,
        });
        expect(manifest.source.validationDatasets.length).toBeGreaterThan(10);
        const verified = await verifyReleaseAssets(output);
        expect(verified.verifiedFiles).toContain('release-manifest.json');

        const schema = JSON.parse(
            await readFile(join(repositoryRoot, 'release/release-manifest.schema.json'), 'utf8'),
        );
        const ajv = new Ajv2020({ allErrors: true, strict: true });
        ajv.addFormat('date-time', { validate: (value) => !Number.isNaN(Date.parse(value)) });
        const validate = ajv.compile(schema);
        expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);

        const sums = await readFile(join(output, 'SHA256SUMS.txt'), 'utf8');
        expect(sums).toContain(`Ballistics-Workbench-${version}-Setup.exe`);
        expect(sums).toContain(`Ballistics-Workbench-${version}-universal-Installer.pkg`);
        expect(sums).toContain(`ballistics-workbench-${version}.cdx.json`);
        expect(sums).not.toContain('SHA256SUMS.txt');
    });

    it('detects artifact tampering after generation', async () => {
        const root = await temporaryDirectory();
        const artifacts = join(root, 'artifacts');
        const output = join(root, 'output');
        await mkdir(artifacts);
        const installer = join(artifacts, `Ballistics-Workbench-${version}-Setup.exe`);
        await writeFile(installer, 'original');
        await buildReleaseAssets({
            repositoryRoot,
            artifactRoot: artifacts,
            outputDirectory: output,
            tag: releaseTag,
            commit,
            repository: 'Denizmerty/BallisticsWorkbench',
            ref: `refs/tags/${releaseTag}`,
            generatedAt,
            sbom: structuredClone(sbom),
            toolchains: [toolchains[0]],
        });
        await writeFile(join(output, `Ballistics-Workbench-${version}-Setup.exe`), 'tampered');
        await expect(verifyReleaseAssets(output)).rejects.toThrow('Checksum mismatch');
    });

    it('rejects duplicate flattened filenames and empty artifact inputs', async () => {
        const root = await temporaryDirectory();
        await mkdir(join(root, 'one'), { recursive: true });
        await mkdir(join(root, 'two'), { recursive: true });
        await expect(collectReleaseArtifacts(root)).rejects.toThrow('No release artifacts');
        await writeFile(join(root, 'one', 'same.zip'), 'one');
        await writeFile(join(root, 'two', 'same.zip'), 'two');
        await expect(collectReleaseArtifacts(root)).rejects.toThrow('filenames must be unique');
    });
});
