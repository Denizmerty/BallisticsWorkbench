import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const values = {};
for (let index = 2; index < process.argv.length; index += 2) {
    const option = process.argv[index];
    const value = process.argv[index + 1];
    if (!option?.startsWith('--') || value === undefined) {
        throw new Error(`Every toolchain option requires a value. Received ${option ?? '(none)'}.`);
    }
    const key = option.slice(2);
    if (values[key] !== undefined) throw new Error(`Duplicate --${key} option.`);
    values[key] = value;
}

const required = [
    'output',
    'platform',
    'runner',
    'architecture',
    'compiler',
    'cmake',
    'node',
    'npm',
    'electron',
    'electron-builder',
    'signed',
    'notarized',
];
for (const key of required) {
    if (!values[key]) throw new Error(`Missing required --${key} option.`);
}
const boolean = (value, key) => {
    if (value !== 'true' && value !== 'false') throw new Error(`--${key} must be true or false.`);
    return value === 'true';
};
const fragment = {
    platform: values.platform,
    runner: values.runner,
    architecture: values.architecture,
    compiler: values.compiler,
    cmake: values.cmake,
    node: values.node,
    npm: values.npm,
    electron: values.electron,
    electronBuilder: values['electron-builder'],
    signed: boolean(values.signed, 'signed'),
    notarized: boolean(values.notarized, 'notarized'),
    ...(values.notes ? { notes: values.notes } : {}),
};
const output = resolve(values.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(fragment, null, 2)}\n`);
process.stdout.write(`Wrote ${fragment.platform} toolchain fragment to ${output}.\n`);
