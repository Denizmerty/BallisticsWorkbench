import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const nativePresets = Object.freeze({
    'windows-msvc': { platform: 'win32', binary: 'build', stage: 'build/stage' },
    'linux-gcc': { platform: 'linux', binary: 'build', stage: 'build/stage' },
    'linux-clang': { platform: 'linux', binary: 'build/clang', stage: 'build/clang-stage' },
    'linux-sanitizers': {
        platform: 'linux',
        binary: 'build/sanitizers',
        stage: 'build/sanitizers-stage',
    },
    'macos-universal': { platform: 'darwin', binary: 'build', stage: 'build/stage' },
});

const defaultPreset = () => {
    if (process.platform === 'win32') return 'windows-msvc';
    if (process.platform === 'darwin') return 'macos-universal';
    if (process.platform === 'linux') return 'linux-gcc';
    throw new Error(`No native build preset supports ${process.platform}.`);
};

export function parseNativeBuildArguments(commandLine) {
    const options = {
        preset: defaultPreset(),
        fresh: false,
        tests: true,
        install: true,
    };
    for (let index = 0; index < commandLine.length; index += 1) {
        const argument = commandLine[index];
        if (argument === '--fresh') options.fresh = true;
        else if (argument === '--skip-tests') options.tests = false;
        else if (argument === '--skip-install') options.install = false;
        else if (argument === '--preset') {
            const preset = commandLine[index + 1];
            if (!preset) throw new Error('--preset requires a value.');
            options.preset = preset;
            index += 1;
        } else throw new Error(`Unknown native-build option: ${argument}.`);
    }
    const definition = nativePresets[options.preset];
    if (!definition) throw new Error(`Unknown native build preset: ${options.preset}.`);
    if (definition.platform !== process.platform) {
        throw new Error(`Preset ${options.preset} cannot run on ${process.platform}.`);
    }
    return options;
}

export function validatePresetDocument(document) {
    if (document.version !== 5) throw new Error('CMakePresets.json must use schema version 5.');
    for (const collection of ['configurePresets', 'buildPresets', 'testPresets']) {
        if (!Array.isArray(document[collection]))
            throw new Error(`${collection} must be an array.`);
        const names = new Set(document[collection].map((preset) => preset.name));
        for (const name of Object.keys(nativePresets)) {
            if (!names.has(name)) throw new Error(`${collection} is missing ${name}.`);
        }
    }
    const configure = new Map(document.configurePresets.map((preset) => [preset.name, preset]));
    if (configure.get('release-base')?.cacheVariables?.BALLISTICS_WARNINGS_AS_ERRORS !== true) {
        throw new Error('Release presets must enable warnings as errors.');
    }
    if (configure.get('linux-sanitizers')?.cacheVariables?.BALLISTICS_ENABLE_SANITIZERS !== true) {
        throw new Error('The sanitizer preset must enable ASan and UBSan.');
    }
}

export async function verifyNativeStage(repositoryRoot, platform = process.platform) {
    const root = resolve(repositoryRoot);
    const executable = platform === 'win32' ? 'ballistics_cli.exe' : 'ballistics_cli';
    const executablePath = join(root, 'build', 'stage', 'bin', executable);
    const licensePath = join(
        root,
        'build',
        'stage',
        'share',
        'licenses',
        'BallisticsWorkbench',
        'LICENSE',
    );
    const [executableInformation, licenseInformation] = await Promise.all([
        stat(executablePath),
        stat(licensePath),
    ]);
    if (!executableInformation.isFile() || executableInformation.size < 1024) {
        throw new Error(`Canonical native executable is invalid: ${executablePath}.`);
    }
    if (!licenseInformation.isFile() || licenseInformation.size < 1000) {
        throw new Error(`Canonical staged license is invalid: ${licensePath}.`);
    }
    return { executablePath, licensePath, bytes: executableInformation.size };
}

function visualStudioEnvironment(environment) {
    const programFiles = environment['ProgramFiles(x86)'];
    if (!programFiles) throw new Error('ProgramFiles(x86) is unavailable.');
    const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!existsSync(vswhere)) throw new Error('Visual Studio Installer could not be found.');
    const installation = execFileSync(
        vswhere,
        ['-latest', '-products', '*', '-property', 'installationPath'],
        { encoding: 'utf8' },
    ).trim();
    if (!installation) throw new Error('A Visual Studio C++ installation could not be found.');
    const developerShell = join(installation, 'Common7', 'Tools', 'Launch-VsDevShell.ps1');
    if (!existsSync(developerShell))
        throw new Error('Visual Studio developer shell was not found.');
    const powershell = join(
        environment.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
    );
    const output = execFileSync(
        powershell,
        [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `& '${developerShell.replaceAll("'", "''")}' -Arch amd64 -HostArch amd64 -SkipAutomaticLocation; Get-ChildItem Env: | ForEach-Object { Write-Output \"$($_.Name)=$($_.Value)\" }`,
        ],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    );
    const result = { ...environment };
    for (const line of output.split(/\r?\n/)) {
        const separator = line.indexOf('=');
        if (separator > 0) result[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return result;
}

function run(command, arguments_, { cwd, environment }) {
    process.stdout.write(`> ${command} ${arguments_.join(' ')}\n`);
    const result = spawnSync(command, arguments_, {
        cwd,
        env: environment,
        stdio: 'inherit',
        windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

export async function runNativeBuild(repositoryRoot, options) {
    const root = resolve(repositoryRoot);
    const definition = nativePresets[options.preset];
    const environment =
        process.platform === 'win32' ? visualStudioEnvironment(process.env) : process.env;
    run(process.execPath, ['scripts/product/product-metadata.mjs', '--check'], {
        cwd: root,
        environment,
    });
    run(process.execPath, ['scripts/protocol/generate-protocol-structure.mjs', '--check'], {
        cwd: root,
        environment,
    });
    run(process.execPath, ['scripts/product/generate-atmosphere-conversions.mjs', '--check'], {
        cwd: root,
        environment,
    });
    const configureArguments = ['--preset', options.preset];
    if (options.fresh) configureArguments.push('--fresh');
    run('cmake', configureArguments, { cwd: root, environment });
    run('cmake', ['--build', '--preset', options.preset], { cwd: root, environment });
    if (options.tests) run('ctest', ['--preset', options.preset], { cwd: root, environment });
    if (options.install) {
        run('cmake', ['--install', definition.binary, '--component', 'Runtime'], {
            cwd: root,
            environment,
        });
        if (definition.stage === 'build/stage') await verifyNativeStage(root);
    }
}

async function main() {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const presetDocument = JSON.parse(
        await readFile(join(repositoryRoot, 'CMakePresets.json'), 'utf8'),
    );
    validatePresetDocument(presetDocument);
    const options = parseNativeBuildArguments(process.argv.slice(2));
    await runNativeBuild(repositoryRoot, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
