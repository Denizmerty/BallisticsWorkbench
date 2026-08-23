import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function parseArguments(arguments_) {
    const options = { buildDirectory: 'build' };
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === '--build-directory') options.buildDirectory = arguments_[++index];
        else throw new Error(`Unknown clang-tidy option: ${argument}`);
    }
    if (!options.buildDirectory) throw new Error('--build-directory requires a value.');
    return { buildDirectory: resolve(repositoryRoot, options.buildDirectory) };
}

function visualStudioClangTidy() {
    const programFiles = process.env['ProgramFiles(x86)'];
    if (!programFiles) return undefined;
    const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!existsSync(vswhere)) return undefined;
    const installation = execFileSync(
        vswhere,
        ['-latest', '-products', '*', '-property', 'installationPath'],
        { encoding: 'utf8' },
    ).trim();
    const candidate = join(installation, 'VC', 'Tools', 'Llvm', 'x64', 'bin', 'clang-tidy.exe');
    return existsSync(candidate) ? candidate : undefined;
}

function locateClangTidy() {
    for (const command of ['clang-tidy', 'clang-tidy.exe']) {
        const probe = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
        if (!probe.error && probe.status === 0) return command;
    }
    const visualStudio = visualStudioClangTidy();
    if (visualStudio) return visualStudio;
    throw new Error(
        'clang-tidy was not found on PATH or in the latest Visual Studio installation.',
    );
}

async function sourceFiles(directory, result = []) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) await sourceFiles(file, result);
        else if (entry.isFile() && ['.c', '.cc', '.cpp'].includes(extname(entry.name))) {
            result.push(file);
        }
    }
    return result;
}

const options = parseArguments(process.argv.slice(2));
const compileCommands = join(options.buildDirectory, 'compile_commands.json');
if (!existsSync(compileCommands)) {
    throw new Error(`Compile commands were not found: ${compileCommands}`);
}
const files = [];
for (const directory of ['src/Ballistics.Core', 'src/Ballistics.Cli', 'benchmarks']) {
    await sourceFiles(join(repositoryRoot, directory), files);
}
files.sort();
const executable = locateClangTidy();
const result = spawnSync(
    executable,
    [
        `-p=${options.buildDirectory}`,
        `--config-file=${join(repositoryRoot, '.clang-tidy')}`,
        '--warnings-as-errors=*',
        '--quiet',
        ...files,
    ],
    { cwd: repositoryRoot, stdio: 'inherit', windowsHide: true },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`clang-tidy exited with status ${result.status}.`);
process.stdout.write(`clang-tidy passed for ${files.length} first-party production sources.\n`);
