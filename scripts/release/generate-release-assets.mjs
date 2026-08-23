import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
    buildReleaseAssets,
    generateNpmSbom,
    readVersionIdentity,
    verifyReleaseTag,
} from './release-assets.mjs';

function argumentsFrom(commandLine) {
    const result = { toolchains: [] };
    for (let index = 0; index < commandLine.length; index += 2) {
        const option = commandLine[index];
        const value = commandLine[index + 1];
        if (!option?.startsWith('--') || value === undefined) {
            throw new Error(
                `Every release option requires a value. Received ${option ?? '(none)'}.`,
            );
        }
        const key = option.slice(2);
        if (key === 'toolchain') result.toolchains.push(value);
        else if (result[key] !== undefined) throw new Error(`Duplicate release option --${key}.`);
        else result[key] = value;
    }
    return result;
}

const options = argumentsFrom(process.argv.slice(2));
const required = ['artifacts', 'output', 'tag', 'commit', 'repository', 'ref', 'generated-at'];
for (const key of required) {
    if (!options[key]) throw new Error(`Missing required --${key} option.`);
}
if (!options.toolchains.length) throw new Error('At least one --toolchain fragment is required.');

const repositoryRoot = resolve(import.meta.dirname, '../..');
const identity = await readVersionIdentity(repositoryRoot);
verifyReleaseTag(identity, options.tag);
const toolchains = await Promise.all(
    options.toolchains.map(async (path) => JSON.parse(await readFile(resolve(path), 'utf8'))),
);
const manifest = await buildReleaseAssets({
    repositoryRoot,
    artifactRoot: resolve(options.artifacts),
    outputDirectory: resolve(options.output),
    tag: options.tag,
    commit: options.commit,
    repository: options.repository,
    ref: options.ref,
    generatedAt: options['generated-at'],
    sbom: generateNpmSbom(repositoryRoot),
    toolchains,
});

process.stdout.write(
    `Prepared ${manifest.artifacts.length} release artifacts for ${manifest.release.tag} with ` +
        `${manifest.source.validationDatasets.length} reference-data checksums.\n`,
);
