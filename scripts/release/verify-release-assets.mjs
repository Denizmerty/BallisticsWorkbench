import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { verifyReleaseAssets } from './release-assets.mjs';

const directoryIndex = process.argv.indexOf('--directory');
if (directoryIndex < 0 || !process.argv[directoryIndex + 1]) {
    throw new Error('Usage: node verify-release-assets.mjs --directory <release-directory>');
}
const repositoryRoot = resolve(import.meta.dirname, '../..');
const result = await verifyReleaseAssets(resolve(process.argv[directoryIndex + 1]));
const schema = JSON.parse(
    await readFile(resolve(repositoryRoot, 'release/release-manifest.schema.json'), 'utf8'),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date-time', {
    type: 'string',
    validate: (value) => !Number.isNaN(Date.parse(value)) && value.endsWith('Z'),
});
const validate = ajv.compile(schema);
if (!validate(result.manifest)) {
    throw new Error(`Release manifest violates its schema: ${ajv.errorsText(validate.errors)}`);
}
process.stdout.write(
    `Verified ${result.verifiedFiles.length} checksummed files for ${result.manifest.release.tag}.\n`,
);
