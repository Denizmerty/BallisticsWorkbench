import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const output = resolve(repositoryRoot, 'dist-electron');
if (dirname(output) !== repositoryRoot || basename(output) !== 'dist-electron') {
    throw new Error(`Refusing to clean unexpected desktop output path: ${output}.`);
}
await rm(output, { recursive: true, force: true });
process.stdout.write(`Cleaned generated Electron output: ${output}.\n`);
