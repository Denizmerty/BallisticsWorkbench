import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { releaseIdentity, synchronizeProductMetadata } from '../product/product-metadata.mjs';

const distributableExtensions = new Set(['.appimage', '.dmg', '.exe', '.gz', '.msi', '.zip']);
const sha256Pattern = /^[0-9a-f]{64}$/;
const fullCommitPattern = /^[0-9a-f]{40}$/;

const normalizedPath = (value) => value.split(sep).join('/');
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function sha256File(path) {
    return createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
}

export function generateNpmSbom(repositoryRoot) {
    const arguments_ = ['sbom', '--sbom-format', 'cyclonedx', '--package-lock-only'];
    const options = {
        cwd: resolve(repositoryRoot),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    };
    if (process.env.npm_execpath) {
        return JSON.parse(
            execFileSync(process.execPath, [process.env.npm_execpath, ...arguments_], options),
        );
    }
    if (process.platform === 'win32') {
        return JSON.parse(
            execFileSync(
                process.env.ComSpec ?? 'cmd.exe',
                ['/d', '/s', '/c', 'npm', ...arguments_],
                options,
            ),
        );
    }
    return JSON.parse(execFileSync('npm', arguments_, options));
}

export async function readVersionIdentity(repositoryRoot) {
    const result = await synchronizeProductMetadata(repositoryRoot);
    if (result.changed.length) {
        throw new Error(
            `Generated identity consumers are stale: ${result.changed.join(', ')}. ` +
                'Run npm run identity:generate.',
        );
    }
    return releaseIdentity(result.metadata);
}

export function verifyReleaseTag(identity, tag) {
    const expected = `v${identity.application}`;
    if (tag !== expected) {
        throw new Error(`Release tag ${tag} does not match the synchronized version ${expected}.`);
    }
}

async function walk(directory, root, files) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink())
            throw new Error(`Release input may not contain symlinks: ${path}`);
        if (entry.isDirectory()) await walk(path, root, files);
        else if (entry.isFile() && distributableExtensions.has(extname(entry.name).toLowerCase())) {
            files.push({ path, relativePath: normalizedPath(relative(root, path)) });
        }
    }
}

export async function collectReleaseArtifacts(artifactRoot) {
    const root = resolve(artifactRoot);
    const files = [];
    await walk(root, root, files);
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    if (!files.length) throw new Error(`No release artifacts were found under ${root}.`);
    const names = new Set();
    for (const file of files) {
        const name = basename(file.path);
        if (names.has(name)) throw new Error(`Release artifact filenames must be unique: ${name}.`);
        names.add(name);
    }
    return files;
}

function artifactClassification(file) {
    const extension = extname(file.relativePath).toLowerCase();
    const path = file.relativePath.toLowerCase();
    if (extension === '.exe' || extension === '.msi') {
        return { kind: 'windows-installer', platform: 'windows' };
    }
    if (extension === '.dmg') return { kind: 'macos-disk-image', platform: 'macos' };
    if (extension === '.appimage' || path.includes('linux')) {
        return { kind: 'linux-package', platform: 'linux' };
    }
    const platform = path.includes('windows')
        ? 'windows'
        : path.includes('macos')
          ? 'macos'
          : 'portable';
    return { kind: 'archive', platform };
}

function toolchainFor(toolchains, platform) {
    const result = toolchains.find((toolchain) => toolchain.platform === platform);
    if (!result) throw new Error(`No ${platform} toolchain fragment was supplied.`);
    return result;
}

export function normalizeSbom(sbom, identity, { generatedAt, commit }) {
    if (sbom?.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components) || !sbom.metadata) {
        throw new Error('npm did not produce a valid CycloneDX SBOM.');
    }
    const digest = createHash('sha256').update(`${identity.application}:${commit}`).digest('hex');
    const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
    sbom.serialNumber = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    sbom.metadata.timestamp = generatedAt;
    sbom.metadata.component.version = identity.application;
    sbom.metadata.component.type = 'application';
    sbom.metadata.component.properties = [
        ...(sbom.metadata.component.properties ?? []).filter(
            (property) => !property.name.startsWith('ballistics-workbench:'),
        ),
        { name: 'ballistics-workbench:engine-version', value: identity.engine },
        { name: 'ballistics-workbench:model-version', value: identity.model },
        { name: 'ballistics-workbench:protocol-version', value: String(identity.protocol) },
        { name: 'ballistics-workbench:source-commit', value: commit },
    ];
    return sbom;
}

export function createLicenseReport(sbom, identity, generatedAt) {
    const components = (sbom.components ?? [])
        .map((component) => ({
            name: component.name,
            version: component.version,
            purl: component.purl ?? null,
            scope: component.scope ?? null,
            licenses: (component.licenses ?? []).map(
                (entry) =>
                    entry.license?.id ?? entry.license?.name ?? entry.expression ?? 'UNKNOWN',
            ),
        }))
        .sort((left, right) =>
            `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
        );
    return {
        schemaVersion: 1,
        application: `ballistics-workbench@${identity.application}`,
        generatedAt,
        policy: 'Inventory only. Review the corresponding license text for each component.',
        components,
    };
}

async function ensureEmptyDirectory(directory) {
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory);
    if (entries.length) {
        throw new Error(`Release output directory must be empty: ${directory}.`);
    }
}

function validateToolchain(toolchain) {
    const strings = [
        'platform',
        'runner',
        'architecture',
        'compiler',
        'cmake',
        'node',
        'npm',
        'electron',
        'electronBuilder',
    ];
    for (const key of strings) {
        if (typeof toolchain[key] !== 'string' || !toolchain[key].trim()) {
            throw new Error(`Toolchain field ${key} must be a non-empty string.`);
        }
    }
    if (typeof toolchain.signed !== 'boolean' || typeof toolchain.notarized !== 'boolean') {
        throw new Error('Toolchain signed/notarized fields must be booleans.');
    }
    if (toolchain.notarized && (!toolchain.signed || toolchain.platform !== 'macos')) {
        throw new Error('Only a signed macOS artifact may be marked notarized.');
    }
}

export async function buildReleaseAssets({
    repositoryRoot,
    artifactRoot,
    outputDirectory,
    tag,
    commit,
    repository,
    ref,
    generatedAt,
    sbom,
    toolchains,
}) {
    const root = resolve(repositoryRoot);
    const output = resolve(outputDirectory);
    const identity = await readVersionIdentity(root);
    verifyReleaseTag(identity, tag);
    if (!fullCommitPattern.test(commit))
        throw new Error('Release commit must be a full lowercase SHA-1.');
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository))
        throw new Error('Repository must use owner/name form.');
    if (Number.isNaN(Date.parse(generatedAt)) || !generatedAt.endsWith('Z')) {
        throw new Error('generatedAt must be an ISO-8601 UTC timestamp.');
    }
    toolchains.forEach(validateToolchain);
    await ensureEmptyDirectory(output);

    const inputArtifacts = await collectReleaseArtifacts(artifactRoot);
    const artifacts = [];
    for (const input of inputArtifacts) {
        const classification = artifactClassification(input);
        const toolchain = toolchainFor(toolchains, classification.platform);
        const file = basename(input.path);
        const destination = join(output, file);
        await copyFile(input.path, destination);
        const information = await stat(destination);
        artifacts.push({
            file,
            ...classification,
            bytes: information.size,
            sha256: await sha256File(destination),
            signed: toolchain.signed,
            notarized: classification.platform === 'macos' && toolchain.notarized,
        });
    }

    const normalizedSbom = normalizeSbom(sbom, identity, { generatedAt, commit });
    const sbomFile = `ballistics-workbench-${identity.application}.cdx.json`;
    await writeFile(join(output, sbomFile), jsonText(normalizedSbom));
    const licenseReport = createLicenseReport(normalizedSbom, identity, generatedAt);
    const licenseFile = 'THIRD-PARTY-LICENSES.json';
    await writeFile(join(output, licenseFile), jsonText(licenseReport));

    const validationManifestPath = join(root, 'validation/manifest.json');
    const validationManifest = JSON.parse(await readFile(validationManifestPath, 'utf8'));
    const manifest = {
        schemaVersion: 1,
        release: {
            version: identity.application,
            tag,
            commit,
            repository,
            ref,
            generatedAt,
        },
        identities: identity,
        source: {
            packageLockSha256: await sha256File(join(root, 'package-lock.json')),
            validationManifestSha256: await sha256File(validationManifestPath),
            validationDatasets: (validationManifest.datasets ?? [])
                .map(({ id, path, sha256 }) => ({ id, path, sha256 }))
                .sort((left, right) => left.id.localeCompare(right.id)),
        },
        artifacts: artifacts.sort((left, right) => left.file.localeCompare(right.file)),
        toolchains: [...toolchains].sort((left, right) =>
            left.platform.localeCompare(right.platform),
        ),
        supplyChain: {
            sbom: {
                file: sbomFile,
                sha256: await sha256File(join(output, sbomFile)),
                format: `CycloneDX ${normalizedSbom.specVersion}`,
            },
            licenseReport: {
                file: licenseFile,
                sha256: await sha256File(join(output, licenseFile)),
                format: 'Ballistics Workbench dependency-license inventory v1',
            },
            checksums: 'SHA256SUMS.txt',
        },
    };
    const manifestFile = 'release-manifest.json';
    await writeFile(join(output, manifestFile), jsonText(manifest));

    const checksumFiles = [
        ...artifacts.map((artifact) => artifact.file),
        sbomFile,
        licenseFile,
        manifestFile,
    ].sort();
    const checksums = [];
    for (const file of checksumFiles) {
        checksums.push(`${await sha256File(join(output, file))}  ${file}`);
    }
    await writeFile(join(output, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
    return manifest;
}

export async function verifyReleaseAssets(directory) {
    const root = resolve(directory);
    const sums = (await readFile(join(root, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/);
    const verified = new Map();
    for (const [index, line] of sums.entries()) {
        const parsed = line.match(/^([0-9a-f]{64})  ([^/\\]+)$/);
        if (!parsed) throw new Error(`Invalid SHA256SUMS line ${index + 1}.`);
        const [, expected, file] = parsed;
        if (verified.has(file)) throw new Error(`Duplicate checksum entry for ${file}.`);
        const actual = await sha256File(join(root, file));
        if (actual !== expected) throw new Error(`Checksum mismatch for ${file}.`);
        verified.set(file, actual);
    }
    const manifest = JSON.parse(await readFile(join(root, 'release-manifest.json'), 'utf8'));
    if (
        manifest.schemaVersion !== 1 ||
        manifest.release?.version !== manifest.identities?.application
    ) {
        throw new Error('Release manifest identity is invalid.');
    }
    if (!verified.has('release-manifest.json')) {
        throw new Error('SHA256SUMS does not protect release-manifest.json.');
    }
    const expectedFiles = new Set([
        'release-manifest.json',
        ...(manifest.artifacts ?? []).map((artifact) => artifact.file),
        manifest.supplyChain?.sbom?.file,
        manifest.supplyChain?.licenseReport?.file,
    ]);
    if (
        expectedFiles.has(undefined) ||
        verified.size !== expectedFiles.size ||
        [...verified.keys()].some((file) => !expectedFiles.has(file))
    ) {
        throw new Error('SHA256SUMS and the release manifest do not describe the same file set.');
    }
    for (const artifact of manifest.artifacts ?? []) {
        if (verified.get(artifact.file) !== artifact.sha256) {
            throw new Error(`Manifest checksum mismatch for ${artifact.file}.`);
        }
    }
    for (const supporting of [manifest.supplyChain?.sbom, manifest.supplyChain?.licenseReport]) {
        if (!supporting || verified.get(supporting.file) !== supporting.sha256) {
            throw new Error(`Manifest supporting-artifact checksum mismatch.`);
        }
    }
    if (!sha256Pattern.test(manifest.source?.packageLockSha256 ?? '')) {
        throw new Error('Release manifest package-lock checksum is invalid.');
    }
    return { manifest, verifiedFiles: [...verified.keys()].sort() };
}
