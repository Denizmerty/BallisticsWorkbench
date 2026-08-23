import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
const unknown = process.argv.slice(2).filter((argument) => argument !== '--check');
if (unknown.length) throw new Error(`Unknown formatting options: ${unknown.join(', ')}.`);

async function sourceFiles(directory, extensions, result = []) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await sourceFiles(path, extensions, result);
        else if (entry.isFile() && extensions.has(extname(entry.name))) result.push(path);
    }
    return result;
}

function visualStudioClangFormat() {
    const programFiles = process.env['ProgramFiles(x86)'];
    if (!programFiles) return undefined;
    const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!existsSync(vswhere)) return undefined;
    const installation = execFileSync(
        vswhere,
        ['-latest', '-products', '*', '-property', 'installationPath'],
        { encoding: 'utf8' },
    ).trim();
    const candidate = join(installation, 'VC', 'Tools', 'Llvm', 'x64', 'bin', 'clang-format.exe');
    return existsSync(candidate) ? candidate : undefined;
}

function locateClangFormat() {
    for (const command of ['clang-format', 'clang-format.exe']) {
        const probe = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
        if (!probe.error && probe.status === 0) return command;
    }
    const visualStudio = visualStudioClangFormat();
    if (visualStudio) return visualStudio;
    throw new Error(
        'clang-format was not found on PATH or in the latest Visual Studio installation.',
    );
}

function run(command, arguments_) {
    const result = spawnSync(command, arguments_, {
        cwd: repositoryRoot,
        stdio: 'inherit',
        windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

async function formatSupplementalText(path) {
    const current = await readFile(path, 'utf8');
    const lines = current.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    while (lines.at(-1) === '') lines.pop();
    const lfText = `${lines.map((line) => line.trimEnd()).join('\n')}\n`;
    const formatted = extname(path) === '.cmd' ? lfText.replaceAll('\n', '\r\n') : lfText;

    if (current === formatted) return;
    if (check) {
        throw new Error(`Supplemental text formatting is required: ${path}`);
    }
    await writeFile(path, formatted, 'utf8');
}

const clangFormat = locateClangFormat();
const nativeFiles = [];
for (const directory of ['src', 'tests', 'benchmarks']) {
    await sourceFiles(
        join(repositoryRoot, directory),
        new Set(['.c', '.cc', '.cpp', '.h', '.hpp']),
        nativeFiles,
    );
}
nativeFiles.sort();
for (let offset = 0; offset < nativeFiles.length; offset += 100) {
    const files = nativeFiles.slice(offset, offset + 100);
    run(
        clangFormat,
        check
            ? ['--dry-run', '--Werror', '--style=file', ...files]
            : ['-i', '--style=file', ...files],
    );
}

const prettier = join(repositoryRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
if (!existsSync(prettier)) throw new Error('Prettier is not installed. Run npm ci first.');
const prettierPatterns = [
    '.github/**/*.{yml,yaml}',
    'src/Ballistics.Desktop/**/*.{ts,tsx,js,cjs,mjs,json,css,scss,html}',
    'scripts/**/*.{ts,tsx,js,cjs,mjs,json}',
    'validation/**/*.{ts,tsx,js,cjs,mjs,json,md,yml,yaml}',
    'protocol/**/*.{json,jsonc,yml,yaml,md}',
    'release/**/*.{json,jsonc,yml,yaml,md}',
    'tests/protocol/**/*.{json,jsonc,yml,yaml}',
    'config/**/*.{json,jsonc,yml,yaml}',
    'docs/**/*.md',
    '*.{ts,tsx,js,cjs,mjs,json,jsonc,yml,yaml,html,css,scss,md}',
];
run(process.execPath, [prettier, check ? '--check' : '--write', ...prettierPatterns]);

const supplementalFiles = [
    '.clang-format',
    '.clang-tidy',
    '.editorconfig',
    '.gitattributes',
    '.gitignore',
    '.prettierignore',
    'CMakeLists.txt',
    'LICENSE',
].map((path) => join(repositoryRoot, path));
for (const [directory, extensions] of [
    ['cmake', new Set(['.cmake', '.in'])],
    ['scripts', new Set(['.cmd', '.sh'])],
    ['tests', new Set(['.cmake'])],
]) {
    await sourceFiles(join(repositoryRoot, directory), extensions, supplementalFiles);
}
supplementalFiles.sort();
for (const path of supplementalFiles) await formatSupplementalText(path);

process.stdout.write(
    `${check ? 'Verified' : 'Formatted'} ${nativeFiles.length} native files and all configured ` +
        `Prettier paths. ${supplementalFiles.length} supplemental text files checked.\n`,
);
