import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderSourceEvidence } from './evidence-markdown.mjs';
import { renderReportSummary } from './report-summary.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const defaultSourceOutput = path.join(repositoryRoot, 'docs/generated/VALIDATION_EVIDENCE.md');
const defaultReportDirectory = path.join(repositoryRoot, 'build/validation');
const defaultReportOutput = path.join(defaultReportDirectory, 'VALIDATION_SUMMARY.md');

export { renderReportSummary, renderSourceEvidence };

async function readJson(file) {
    return JSON.parse(await readFile(file, 'utf8'));
}

export async function readEvidenceSources(root = repositoryRoot) {
    const [manifest, inventory] = await Promise.all([
        readJson(path.join(root, 'validation/manifest.json')),
        readJson(path.join(root, 'validation/normalized/builtin-loads.json')),
    ]);
    return { manifest, inventory };
}

export async function readRegisteredReports(manifest, reportDirectory) {
    if (!Array.isArray(manifest.reportArtifacts) || manifest.reportArtifacts.length === 0) {
        throw new Error('The validation manifest does not register any report artifacts.');
    }
    const ids = new Set();
    const paths = new Set();
    return Promise.all(
        manifest.reportArtifacts.map(async (definition) => {
            if (!definition.id || ids.has(definition.id)) {
                throw new Error(`Duplicate or missing validation report ID: ${definition.id}`);
            }
            if (!definition.path || paths.has(definition.path)) {
                throw new Error(`Duplicate or missing validation report path: ${definition.path}`);
            }
            ids.add(definition.id);
            paths.add(definition.path);
            const reportPath = path.join(reportDirectory, definition.path);
            try {
                return { definition, report: await readJson(reportPath) };
            } catch (error) {
                if (error?.code === 'ENOENT') {
                    throw new Error(
                        `Required validation report is missing: ${definition.path} in ${reportDirectory}`,
                    );
                }
                throw error;
            }
        }),
    );
}

function readOptionValue(arguments_, index, option) {
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a path.`);
    return value;
}

export function parseArguments(arguments_) {
    if (arguments_.length === 0) {
        return {
            sourceOutput: defaultSourceOutput,
            reports: defaultReportDirectory,
            reportOutput: defaultReportOutput,
            check: false,
        };
    }

    const options = { check: false };
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === '--source-output') {
            options.sourceOutput = path.resolve(readOptionValue(arguments_, index, argument));
            index += 1;
        } else if (argument === '--reports') {
            options.reports = path.resolve(readOptionValue(arguments_, index, argument));
            index += 1;
        } else if (argument === '--report-output') {
            options.reportOutput = path.resolve(readOptionValue(arguments_, index, argument));
            index += 1;
        } else if (argument === '--check') {
            options.check = true;
        } else {
            throw new Error(`Unknown validation-evidence option: ${argument}`);
        }
    }
    if (options.check && !options.sourceOutput && !options.reports && !options.reportOutput) {
        options.sourceOutput = defaultSourceOutput;
        options.reports = defaultReportDirectory;
        options.reportOutput = defaultReportOutput;
    }
    if (Boolean(options.reports) !== Boolean(options.reportOutput)) {
        throw new Error('--reports and --report-output must be supplied together.');
    }
    if (!options.sourceOutput && !options.reportOutput) {
        throw new Error(
            'Specify --source-output, --report-output, or use the command with no options.',
        );
    }
    return options;
}

async function writeOrCheck(file, contents, check) {
    if (!check) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, contents, 'utf8');
        return;
    }

    let stored;
    try {
        stored = await readFile(file, 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT')
            throw new Error(`Generated evidence file is missing: ${file}`);
        throw error;
    }
    if (stored.replaceAll('\r\n', '\n') !== contents.replaceAll('\r\n', '\n')) {
        throw new Error(`Generated evidence file is stale: ${file}`);
    }
}

export async function generateEvidence(options, root = repositoryRoot) {
    const { manifest, inventory } = await readEvidenceSources(root);
    const generated = [];
    if (options.sourceOutput) {
        await writeOrCheck(
            options.sourceOutput,
            renderSourceEvidence(manifest, inventory),
            options.check,
        );
        generated.push(options.sourceOutput);
    }
    if (options.reports && options.reportOutput) {
        const reports = await readRegisteredReports(manifest, options.reports);
        await writeOrCheck(
            options.reportOutput,
            renderReportSummary(manifest, reports),
            options.check,
        );
        generated.push(options.reportOutput);
    }
    return generated;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const generated = await generateEvidence(options);
    const action = options.check ? 'Checked' : 'Generated';
    process.stdout.write(`${action} ${generated.join(', ')}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
