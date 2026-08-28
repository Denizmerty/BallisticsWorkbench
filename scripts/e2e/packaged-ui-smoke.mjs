import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArguments(arguments_) {
    const options = {};
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === '--executable') options.executable = arguments_[++index];
        else if (argument === '--output') options.output = arguments_[++index];
        else if (argument === '--disable-sandbox') options.disableSandbox = true;
        else throw new Error(`Unknown packaged UI smoke option: ${argument}`);
    }
    if (!options.executable || !options.output) {
        throw new Error('Usage: packaged-ui-smoke --executable PATH --output DIRECTORY');
    }
    return {
        executable: path.resolve(options.executable),
        output: path.resolve(options.output),
        disableSandbox: options.disableSandbox === true,
    };
}

export function validateUiSmokeReport(report) {
    if (
        report?.schemaVersion !== 1 ||
        report.passed !== true ||
        !Array.isArray(report.rendererChecks) ||
        report.rendererChecks.length < 8 ||
        report.rendererChecks.some(
            (check) =>
                typeof check?.name !== 'string' ||
                check.passed !== true ||
                typeof check.detail !== 'string',
        ) ||
        !Array.isArray(report.securityChecks) ||
        report.securityChecks.length < 6 ||
        report.securityChecks.some(
            (check) =>
                typeof check?.name !== 'string' ||
                check.passed !== true ||
                typeof check.detail !== 'string',
        ) ||
        report.csv?.file !== 'ballistics_range_table.csv' ||
        !Number.isInteger(report.csv?.bytes) ||
        report.csv.bytes <= 1_000 ||
        report.csv.hasUtf8Bom !== true ||
        report.csv.loadSections !== 6
    ) {
        throw new Error('Packaged UI smoke report is invalid or records a failed check.');
    }
    return report;
}

async function launch(executable, output, disableSandbox) {
    await new Promise((resolve, reject) => {
        const electronArguments = [
            ...(disableSandbox ? ['--no-sandbox'] : []),
            '--ui-smoke-test',
            `--ui-smoke-output=${output}`,
        ];
        const child = spawn(executable, electronArguments, {
            stdio: 'inherit',
            windowsHide: true,
        });
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error('Packaged UI smoke test timed out after 90 seconds.'));
        }, 90_000);
        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on('exit', (code, signal) => {
            clearTimeout(timeout);
            if (code === 0) resolve();
            else reject(new Error(`Packaged UI smoke exited with ${code ?? signal ?? 'unknown'}.`));
        });
    });
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    await rm(options.output, { recursive: true, force: true });
    await mkdir(options.output, { recursive: true });
    await launch(options.executable, options.output, options.disableSandbox);
    const report = validateUiSmokeReport(
        JSON.parse(await readFile(path.join(options.output, 'ui-smoke-report.json'), 'utf8')),
    );
    process.stdout.write(
        `Packaged UI smoke passed ${report.rendererChecks.length} renderer interactions and ` +
            `${report.securityChecks.length} security checks. Validated ` +
            `${report.csv.loadSections} CSV load sections (${report.csv.bytes} bytes).\n`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
