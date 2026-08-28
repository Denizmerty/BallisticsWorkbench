import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseArguments(arguments_) {
    const options = { attempts: 2, iterations: 5 };
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === '--benchmark-executable') {
            options.benchmarkExecutable = arguments_[++index];
        } else if (argument === '--benchmark') {
            options.benchmark = arguments_[++index];
        } else if (argument === '--engine') {
            options.engine = arguments_[++index];
        } else if (argument === '--output') {
            options.output = arguments_[++index];
        } else if (argument === '--iterations') {
            options.iterations = Number(arguments_[++index]);
        } else if (argument === '--attempts') {
            options.attempts = Number(arguments_[++index]);
        } else {
            throw new Error(`Unknown CI performance-budget option: ${argument}`);
        }
    }
    if (!options.benchmarkExecutable || !options.benchmark || !options.engine || !options.output) {
        throw new Error(
            'Usage: run-ci-budget --benchmark-executable FILE --benchmark FILE --engine FILE --output FILE',
        );
    }
    if (
        !Number.isInteger(options.iterations) ||
        options.iterations < 5 ||
        options.iterations > 30
    ) {
        throw new Error('CI performance iterations must be an integer between 5 and 30.');
    }
    if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 3) {
        throw new Error('CI performance attempts must be an integer between 1 and 3.');
    }
    return {
        ...options,
        benchmarkExecutable: path.resolve(options.benchmarkExecutable),
        benchmark: path.resolve(options.benchmark),
        engine: path.resolve(options.engine),
        output: path.resolve(options.output),
    };
}

function run(command, arguments_) {
    const result = spawnSync(command, arguments_, {
        stdio: 'inherit',
        windowsHide: true,
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
}

export function runCiPerformanceBudget(
    options,
    repositoryRoot = path.resolve(import.meta.dirname, '../..'),
) {
    const assessmentScript = path.join(
        repositoryRoot,
        'scripts/performance/assess-interaction-budget.mjs',
    );
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
        process.stdout.write(`CI performance assessment attempt ${attempt}/${options.attempts}.\n`);
        const benchmarkStatus = run(options.benchmarkExecutable, [
            '--iterations',
            String(options.iterations),
            '--output',
            options.benchmark,
        ]);
        if (benchmarkStatus !== 0) {
            throw new Error(`Native benchmark exited with ${benchmarkStatus}.`);
        }
        const assessmentStatus = run(process.execPath, [
            assessmentScript,
            '--benchmark',
            options.benchmark,
            '--engine',
            options.engine,
            '--output',
            options.output,
            '--iterations',
            String(options.iterations),
        ]);
        if (assessmentStatus === 0) return;
        if (attempt < options.attempts) {
            process.stderr.write(
                'Performance assessment missed the hosted-runner ceiling; retrying once to filter transient contention.\n',
            );
        }
    }
    throw new Error(`Performance assessment failed ${options.attempts} consecutive attempts.`);
}

async function main() {
    runCiPerformanceBudget(parseArguments(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
