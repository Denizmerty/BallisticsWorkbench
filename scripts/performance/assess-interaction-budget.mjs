import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

function parseArguments(arguments_) {
    const options = { iterations: 5 };
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === '--benchmark') options.benchmark = arguments_[++index];
        else if (argument === '--engine') options.engine = arguments_[++index];
        else if (argument === '--output') options.output = arguments_[++index];
        else if (argument === '--iterations') options.iterations = Number(arguments_[++index]);
        else throw new Error(`Unknown interaction-budget option: ${argument}`);
    }
    if (!options.benchmark || !options.engine || !options.output) {
        throw new Error(
            'Usage: assess-interaction-budget --benchmark FILE --engine FILE --output FILE',
        );
    }
    if (
        !Number.isInteger(options.iterations) ||
        options.iterations < 3 ||
        options.iterations > 30
    ) {
        throw new Error('Cold-process iterations must be an integer between 3 and 30.');
    }
    return {
        ...options,
        benchmark: path.resolve(options.benchmark),
        engine: path.resolve(options.engine),
        output: path.resolve(options.output),
    };
}

export function percentile(values, fraction) {
    if (!values.length) throw new Error('Cannot calculate a percentile without samples.');
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.ceil(fraction * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function assessInteractionBudget(benchmark, coldDurationsMs, budget) {
    if (benchmark?.schemaVersion !== 1 || !Array.isArray(benchmark.benchmarks)) {
        throw new Error('Native benchmark report has an unsupported structure.');
    }
    if (
        budget?.schemaVersion !== 1 ||
        !Number.isFinite(budget.warmNativeP95Ms) ||
        !Number.isFinite(budget.coldProcessP95Ms) ||
        !Number.isFinite(budget.persistentWorkerReconsiderationOverheadMs) ||
        !Number.isInteger(budget.minimumColdSamples) ||
        typeof budget.policy !== 'string'
    ) {
        throw new Error('Performance budget configuration is invalid.');
    }
    if (coldDurationsMs.length < budget.minimumColdSamples) {
        throw new Error('Too few cold-process samples were supplied for the configured policy.');
    }
    const native = benchmark.benchmarks.find((entry) => entry.id === budget.scenario);
    if (!native || !Number.isFinite(native.p95Ms) || !Number.isFinite(native.medianMs)) {
        throw new Error(`Native benchmark is missing ${budget.scenario}.`);
    }
    const coldMedianMs = percentile(coldDurationsMs, 0.5);
    const coldP95Ms = percentile(coldDurationsMs, 0.95);
    const warmPassed = native.p95Ms <= budget.warmNativeP95Ms;
    const coldPassed = coldP95Ms <= budget.coldProcessP95Ms;
    const processOverheadP95Ms = Math.max(0, coldP95Ms - native.p95Ms);
    const workerDecision =
        processOverheadP95Ms <= budget.persistentWorkerReconsiderationOverheadMs
            ? 'retain-per-request-process'
            : 'reconsider-persistent-worker-after-second-baseline';
    return {
        passed: warmPassed && coldPassed,
        warmNative: {
            scenario: budget.scenario,
            medianMs: native.medianMs,
            p95Ms: native.p95Ms,
            budgetP95Ms: budget.warmNativeP95Ms,
            passed: warmPassed,
            acceptedStepsPerIteration: native.acceptedStepsPerIteration ?? null,
            rejectedStepsPerIteration: native.rejectedStepsPerIteration ?? null,
        },
        coldProcess: {
            samplesMs: coldDurationsMs,
            medianMs: coldMedianMs,
            p95Ms: coldP95Ms,
            budgetP95Ms: budget.coldProcessP95Ms,
            passed: coldPassed,
            estimatedStartupAndSerializationMedianMs: Math.max(0, coldMedianMs - native.medianMs),
            estimatedStartupAndSerializationP95Ms: processOverheadP95Ms,
        },
        persistentWorker: {
            decision: workerDecision,
            reconsiderationOverheadMs: budget.persistentWorkerReconsiderationOverheadMs,
            rationale:
                workerDecision === 'retain-per-request-process'
                    ? 'Cold-process p95 remains below the predeclared reconsideration threshold. Cancellation and fault isolation currently outweigh unmeasured worker complexity.'
                    : 'Cold-process p95 exceeded the reconsideration threshold. Confirm on a second representative release baseline before changing IPC architecture.',
        },
    };
}

async function runEngine(executable, request) {
    const started = performance.now();
    const output = await new Promise((resolve, reject) => {
        const child = spawn(executable, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const stdout = [];
        const stderr = [];
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error('Cold-process benchmark timed out after 30 seconds.'));
        }, 30_000);
        child.stdout.on('data', (chunk) => stdout.push(chunk));
        child.stderr.on('data', (chunk) => stderr.push(chunk));
        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on('exit', (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
            else {
                reject(
                    new Error(
                        `Native engine exited with ${code}: ${Buffer.concat(stderr).toString('utf8')}`,
                    ),
                );
            }
        });
        child.stdin.end(`${JSON.stringify(request)}\n`, 'utf8');
    });
    const response = JSON.parse(output);
    if (response.ok !== true || response.loads?.length !== 9) {
        throw new Error('Cold-process benchmark did not return all nine expected loads.');
    }
    return performance.now() - started;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const repositoryRoot = path.resolve(import.meta.dirname, '../..');
    const [benchmark, budget, fixture] = await Promise.all([
        readFile(options.benchmark, 'utf8').then(JSON.parse),
        readFile(path.join(repositoryRoot, 'config/performance-budget.json'), 'utf8').then(
            JSON.parse,
        ),
        readFile(
            path.join(repositoryRoot, 'tests/protocol/valid-multiple-loads.json'),
            'utf8',
        ).then(JSON.parse),
    ]);
    fixture.requestId = 'interaction-budget-nine-loads-2000m';
    fixture.scenario.displayDistanceM = 2000;
    fixture.scenario.solutionHorizonM = 2000;
    delete fixture.scenario.uncertainty;
    const coldDurationsMs = [];
    for (let index = 0; index < options.iterations; index += 1) {
        coldDurationsMs.push(await runEngine(options.engine, fixture));
    }
    const assessment = assessInteractionBudget(benchmark, coldDurationsMs, budget);
    const report = {
        schemaVersion: 1,
        engineVersion: benchmark.engineVersion,
        modelVersion: benchmark.modelVersion,
        platform: process.platform,
        architecture: process.arch,
        host: {
            cpu: os.cpus()[0]?.model ?? 'unknown',
            logicalProcessors: os.cpus().length,
            totalMemoryBytes: os.totalmem(),
        },
        policy: budget.policy,
        ...assessment,
    };
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(
        `Interaction budget ${report.passed ? 'passed' : 'failed'}: warm p95 ` +
            `${report.warmNative.p95Ms.toFixed(2)} ms, cold p95 ` +
            `${report.coldProcess.p95Ms.toFixed(2)} ms. ${report.persistentWorker.decision}.\n`,
    );
    if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
