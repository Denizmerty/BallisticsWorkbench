import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const maximumInputBytes = 8 * 1024 * 1024;
const maximumEngineResponseBytes = 32 * 1024 * 1024;
const maximumScenarios = 128;

function object(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateBatchDocument(value) {
    if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.scenarios)) {
        throw new Error('Batch input must be a schema-version 1 object with a scenarios array.');
    }
    if (value.scenarios.length < 1 || value.scenarios.length > maximumScenarios) {
        throw new Error(`Batch input must contain between 1 and ${maximumScenarios} scenarios.`);
    }
    const ids = new Set();
    for (const [index, entry] of value.scenarios.entries()) {
        if (
            !object(entry) ||
            typeof entry.id !== 'string' ||
            !/^[A-Za-z0-9._:-]{1,96}$/.test(entry.id) ||
            !object(entry.request)
        ) {
            throw new Error(`Batch scenario ${index} has an invalid id or request.`);
        }
        if (ids.has(entry.id)) throw new Error(`Duplicate batch scenario id: ${entry.id}.`);
        ids.add(entry.id);
        if (
            !Number.isInteger(entry.request.protocolVersion) ||
            typeof entry.request.requestId !== 'string' ||
            !object(entry.request.scenario) ||
            !Array.isArray(entry.request.customLoads)
        ) {
            throw new Error(`Batch scenario ${entry.id} is not a calculation request.`);
        }
        if (entry.request.operation !== undefined) {
            throw new Error(`Batch scenario ${entry.id} must not use a calibration operation.`);
        }
    }
    return value;
}

function parseArguments(arguments_) {
    const options = {
        concurrency: Math.max(1, Math.min(4, os.availableParallelism?.() ?? os.cpus().length)),
        timeoutMs: 60_000,
        failFast: false,
    };
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === '--input') options.input = arguments_[++index];
        else if (argument === '--engine') options.engine = arguments_[++index];
        else if (argument === '--output') options.output = arguments_[++index];
        else if (argument === '--concurrency') options.concurrency = Number(arguments_[++index]);
        else if (argument === '--timeout-ms') options.timeoutMs = Number(arguments_[++index]);
        else if (argument === '--fail-fast') options.failFast = true;
        else throw new Error(`Unknown batch option: ${argument}.`);
    }
    if (!options.input || !options.engine || !options.output) {
        throw new Error('Usage: batch:run -- --input FILE --engine FILE --output FILE');
    }
    if (
        !Number.isInteger(options.concurrency) ||
        options.concurrency < 1 ||
        options.concurrency > 8
    ) {
        throw new Error('Batch concurrency must be an integer between 1 and 8.');
    }
    if (
        !Number.isInteger(options.timeoutMs) ||
        options.timeoutMs < 1_000 ||
        options.timeoutMs > 300_000
    ) {
        throw new Error('Per-scenario timeout must be between 1000 and 300000 milliseconds.');
    }
    return {
        ...options,
        input: path.resolve(options.input),
        engine: path.resolve(options.engine),
        output: path.resolve(options.output),
    };
}

function runEngine(executable, request, timeoutMs) {
    return new Promise((resolve) => {
        const started = performance.now();
        const child = spawn(executable, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const stdout = [];
        const stderr = [];
        let responseBytes = 0;
        let overflow = false;
        const timer = setTimeout(() => child.kill(), timeoutMs);
        child.stdout.on('data', (chunk) => {
            responseBytes += chunk.length;
            if (responseBytes > maximumEngineResponseBytes) {
                overflow = true;
                child.kill();
                return;
            }
            stdout.push(chunk);
        });
        child.stderr.on('data', (chunk) => stderr.push(chunk));
        child.on('error', (error) => {
            clearTimeout(timer);
            resolve({ ok: false, durationMs: performance.now() - started, error: error.message });
        });
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            const durationMs = performance.now() - started;
            if (overflow) {
                resolve({ ok: false, durationMs, error: 'Engine response exceeded 32 MiB.' });
                return;
            }
            const raw = Buffer.concat(stdout).toString('utf8');
            try {
                const result = JSON.parse(raw);
                resolve({
                    ok: code === 0 && result.ok === true,
                    durationMs,
                    exitCode: code,
                    signal,
                    result,
                    ...(stderr.length
                        ? { stderr: Buffer.concat(stderr).toString('utf8').slice(0, 4096) }
                        : {}),
                });
            } catch {
                resolve({
                    ok: false,
                    durationMs,
                    exitCode: code,
                    signal,
                    error: raw ? 'Engine returned invalid JSON.' : 'Engine returned no response.',
                    ...(stderr.length
                        ? { stderr: Buffer.concat(stderr).toString('utf8').slice(0, 4096) }
                        : {}),
                });
            }
        });
        child.stdin.end(JSON.stringify(request));
    });
}

function endpointMetrics(result) {
    if (!result?.ok || !Array.isArray(result.loads)) return [];
    return result.loads.map((load) => {
        const point = load.points?.at(-1);
        return {
            loadId: load.id,
            coveredDistanceM: load.coveredDistanceM,
            speedMps: point?.speedMps ?? null,
            energyJ: point?.energyJ ?? null,
            timeS: point?.timeS ?? null,
            dropM: point?.dropM ?? null,
            pathM: point?.pathM ?? null,
            windDriftM: point?.windDriftM ?? null,
        };
    });
}

export function buildSensitivitySummary(results) {
    const successful = results.filter((entry) => entry.ok && entry.result?.ok);
    if (!successful.length) return { baselineScenarioId: null, comparisons: [] };
    const baseline = successful[0];
    const baselineByLoad = new Map(
        endpointMetrics(baseline.result).map((measurement) => [measurement.loadId, measurement]),
    );
    const metrics = ['speedMps', 'energyJ', 'timeS', 'dropM', 'pathM', 'windDriftM'];
    return {
        baselineScenarioId: baseline.id,
        comparisons: successful.slice(1).flatMap((entry) =>
            endpointMetrics(entry.result).flatMap((measurement) => {
                const reference = baselineByLoad.get(measurement.loadId);
                if (!reference) return [];
                return [
                    {
                        scenarioId: entry.id,
                        loadId: measurement.loadId,
                        coveredDistanceM: measurement.coveredDistanceM,
                        deltas: Object.fromEntries(
                            metrics.map((metric) => [
                                metric,
                                Number.isFinite(measurement[metric]) &&
                                Number.isFinite(reference[metric])
                                    ? measurement[metric] - reference[metric]
                                    : null,
                            ]),
                        ),
                    },
                ];
            }),
        ),
    };
}

export async function executeBatch(document, options) {
    validateBatchDocument(document);
    const results = new Array(document.scenarios.length);
    let nextIndex = 0;
    let stopped = false;
    async function worker() {
        while (!stopped) {
            const index = nextIndex++;
            if (index >= document.scenarios.length) return;
            const scenario = document.scenarios[index];
            const execution = await runEngine(options.engine, scenario.request, options.timeoutMs);
            results[index] = { id: scenario.id, ...execution };
            if (options.failFast && !execution.ok) stopped = true;
        }
    }
    await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
    const completed = results.filter(Boolean);
    return {
        schemaVersion: 1,
        passed:
            completed.length === document.scenarios.length && completed.every((entry) => entry.ok),
        requestedScenarioCount: document.scenarios.length,
        completedScenarioCount: completed.length,
        failedScenarioCount: completed.filter((entry) => !entry.ok).length,
        results: completed,
        sensitivity: buildSensitivitySummary(completed),
    };
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const input = await readFile(options.input);
    if (input.length > maximumInputBytes) throw new Error('Batch input exceeds 8 MiB.');
    const document = validateBatchDocument(JSON.parse(input.toString('utf8')));
    const report = await executeBatch(document, options);
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
