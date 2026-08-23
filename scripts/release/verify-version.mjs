import { resolve } from 'node:path';
import { readVersionIdentity, verifyReleaseTag } from './release-assets.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const identity = await readVersionIdentity(repositoryRoot);
const tagIndex = process.argv.indexOf('--tag');
if (tagIndex >= 0) {
    if (!process.argv[tagIndex + 1]) throw new Error('--tag requires a value.');
    verifyReleaseTag(identity, process.argv[tagIndex + 1]);
}
process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
