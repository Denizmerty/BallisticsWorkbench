import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
    createLicenseReport,
    generateNpmSbom,
    normalizeSbom,
    readVersionIdentity,
    sha256File,
} from './release-assets.mjs';

function option(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    if (index < 0) return fallback;
    if (!process.argv[index + 1]) throw new Error(`--${name} requires a value.`);
    return process.argv[index + 1];
}

const repositoryRoot = resolve(import.meta.dirname, '../..');
const output = resolve(option('output', 'build/supply-chain'));
const commit = option(
    'commit',
    process.env.GITHUB_SHA ?? '0000000000000000000000000000000000000000',
);
const generatedAt = option('generated-at', new Date().toISOString());
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Supply-chain commit must be a full SHA-1.');
const identity = await readVersionIdentity(repositoryRoot);
const sbom = normalizeSbom(generateNpmSbom(repositoryRoot), identity, { generatedAt, commit });
const licenses = createLicenseReport(sbom, identity, generatedAt);
await mkdir(output, { recursive: true });
const sbomPath = join(output, `ballistics-workbench-${identity.application}.cdx.json`);
const licensesPath = join(output, 'THIRD-PARTY-LICENSES.json');
await writeFile(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);
await writeFile(licensesPath, `${JSON.stringify(licenses, null, 2)}\n`);
process.stdout.write(
    `${sbom.components.length} dependency components. SBOM ${await sha256File(sbomPath)}. ` +
        `License inventory ${await sha256File(licensesPath)}.\n`,
);
