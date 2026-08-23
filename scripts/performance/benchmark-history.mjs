import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function finiteNonnegative(value, label) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be nonnegative.`);
    return value;
}

export function validateBenchmarkReport(report) {
    if (
        report?.schemaVersion !== 1 ||
        typeof report.engineVersion !== 'string' ||
        typeof report.modelVersion !== 'string' ||
        typeof report.platform !== 'string' ||
        typeof report.compiler !== 'string' ||
        !Number.isInteger(report.hardwareConcurrency) ||
        report.hardwareConcurrency < 1 ||
        !Array.isArray(report.benchmarks) ||
        report.benchmarks.length === 0
    ) {
        throw new Error('Benchmark report has an unsupported structure.');
    }
    const identifiers = new Set();
    for (const entry of report.benchmarks) {
        if (typeof entry?.id !== 'string' || !entry.id || identifiers.has(entry.id)) {
            throw new Error('Benchmark identifiers must be nonempty and unique.');
        }
        identifiers.add(entry.id);
        finiteNonnegative(entry.medianMs, `${entry.id} medianMs`);
        finiteNonnegative(entry.p95Ms, `${entry.id} p95Ms`);
    }
    return report;
}

export function validateHistory(history) {
    if (history?.schemaVersion !== 1 || !Array.isArray(history.runs)) {
        throw new Error('Benchmark history has an unsupported structure.');
    }
    const runIds = new Set();
    for (const run of history.runs) {
        if (
            typeof run?.id !== 'string' ||
            !run.id ||
            runIds.has(run.id) ||
            typeof run.recordedAt !== 'string' ||
            typeof run.platform !== 'string' ||
            typeof run.compiler !== 'string' ||
            !Number.isInteger(run.hardwareConcurrency) ||
            !Array.isArray(run.benchmarks)
        ) {
            throw new Error('Benchmark history contains an invalid or duplicate run.');
        }
        runIds.add(run.id);
    }
    return history;
}

function compatibleRun(run, report) {
    return (
        run.platform === report.platform &&
        run.compiler === report.compiler &&
        run.hardwareConcurrency === report.hardwareConcurrency
    );
}

function percentageChange(current, previous) {
    return previous === 0 ? null : ((current - previous) / previous) * 100;
}

export function compareBenchmarkHistory(reportInput, historyInput) {
    const report = validateBenchmarkReport(reportInput);
    const history = validateHistory(historyInput);
    const baseline = [...history.runs].reverse().find((run) => compatibleRun(run, report)) ?? null;
    const baselineEntries = new Map((baseline?.benchmarks ?? []).map((entry) => [entry.id, entry]));
    const comparisons = report.benchmarks.map((entry) => {
        const previous = baselineEntries.get(entry.id) ?? null;
        return {
            id: entry.id,
            medianMs: entry.medianMs,
            p95Ms: entry.p95Ms,
            baselineMedianMs: previous?.medianMs ?? null,
            baselineP95Ms: previous?.p95Ms ?? null,
            medianChangePercent: previous
                ? percentageChange(entry.medianMs, previous.medianMs)
                : null,
            p95ChangePercent: previous ? percentageChange(entry.p95Ms, previous.p95Ms) : null,
        };
    });
    return {
        schemaVersion: 1,
        engineVersion: report.engineVersion,
        modelVersion: report.modelVersion,
        platform: report.platform,
        compiler: report.compiler,
        hardwareConcurrency: report.hardwareConcurrency,
        policy: 'Historical timing is descriptive. Correctness and the separate interaction budget remain the release gates.',
        compatibleBaselineRunId: baseline?.id ?? null,
        comparisons,
    };
}

export function benchmarkRun(reportInput, id, recordedAt) {
    const report = validateBenchmarkReport(reportInput);
    if (typeof id !== 'string' || !id) throw new Error('A nonempty history run ID is required.');
    if (!Number.isFinite(Date.parse(recordedAt))) throw new Error('recordedAt must be ISO-8601.');
    return {
        id,
        recordedAt,
        engineVersion: report.engineVersion,
        modelVersion: report.modelVersion,
        platform: report.platform,
        compiler: report.compiler,
        hardwareConcurrency: report.hardwareConcurrency,
        benchmarks: report.benchmarks.map(({ id: benchmarkId, medianMs, p95Ms }) => ({
            id: benchmarkId,
            medianMs,
            p95Ms,
        })),
    };
}

export function renderTrendMarkdown(trend) {
    const formatNumber = (value) => (value === null ? 'n/a' : value.toFixed(3));
    const formatChange = (value) =>
        value === null ? 'new' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    const lines = [
        '# Native benchmark trend',
        '',
        `Platform: ${trend.platform}; compiler: ${trend.compiler}; logical processors: ${trend.hardwareConcurrency}.`,
        '',
        `Compatible baseline: ${trend.compatibleBaselineRunId ?? 'none'}.`,
        '',
        '| Workload | Median ms | Baseline | Change | p95 ms | Baseline | Change |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];
    for (const entry of trend.comparisons) {
        lines.push(
            `| ${entry.id} | ${formatNumber(entry.medianMs)} | ${formatNumber(entry.baselineMedianMs)} | ${formatChange(entry.medianChangePercent)} | ${formatNumber(entry.p95Ms)} | ${formatNumber(entry.baselineP95Ms)} | ${formatChange(entry.p95ChangePercent)} |`,
        );
    }
    lines.push('', trend.policy, '');
    return lines.join('\n');
}

function parseArguments(arguments_) {
    const options = {};
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === '--benchmark') options.benchmark = arguments_[++index];
        else if (argument === '--history') options.history = arguments_[++index];
        else if (argument === '--output') options.output = arguments_[++index];
        else if (argument === '--markdown') options.markdown = arguments_[++index];
        else if (argument === '--record') options.record = arguments_[++index];
        else if (argument === '--recorded-at') options.recordedAt = arguments_[++index];
        else throw new Error(`Unknown benchmark-history option: ${argument}`);
    }
    if (!options.benchmark || !options.history || !options.output || !options.markdown) {
        throw new Error(
            'Usage: benchmark-history --benchmark FILE --history FILE --output FILE --markdown FILE [--record ID --recorded-at ISO]',
        );
    }
    if (Boolean(options.record) !== Boolean(options.recordedAt)) {
        throw new Error('--record and --recorded-at must be supplied together.');
    }
    return {
        ...options,
        benchmark: path.resolve(options.benchmark),
        history: path.resolve(options.history),
        output: path.resolve(options.output),
        markdown: path.resolve(options.markdown),
    };
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const [report, history] = await Promise.all([
        readFile(options.benchmark, 'utf8').then(JSON.parse),
        readFile(options.history, 'utf8').then(JSON.parse),
    ]);
    const trend = compareBenchmarkHistory(report, history);
    await Promise.all([
        writeFile(options.output, `${JSON.stringify(trend, null, 2)}\n`, 'utf8'),
        writeFile(options.markdown, renderTrendMarkdown(trend), 'utf8'),
    ]);
    if (options.record) {
        history.runs.push(benchmarkRun(report, options.record, options.recordedAt));
        validateHistory(history);
        await writeFile(options.history, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(
        `Compared ${trend.comparisons.length} benchmarks with ${trend.compatibleBaselineRunId ?? 'no compatible baseline'}.\n`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
