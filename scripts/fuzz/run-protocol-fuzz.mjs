import { spawnSync } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseFuzzArguments(arguments_) {
    const options = { seconds: 60 };
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === '--executable') options.executable = arguments_[++index];
        else if (argument === '--corpus') options.corpus = arguments_[++index];
        else if (argument === '--dictionary') options.dictionary = arguments_[++index];
        else if (argument === '--artifacts') options.artifacts = arguments_[++index];
        else if (argument === '--seconds') options.seconds = Number(arguments_[++index]);
        else throw new Error(`Unknown protocol-fuzz option: ${argument}`);
    }
    if (
        !options.executable ||
        !options.corpus ||
        !options.dictionary ||
        !options.artifacts ||
        !Number.isInteger(options.seconds) ||
        options.seconds < 1 ||
        options.seconds > 3_600
    ) {
        throw new Error(
            'Usage: run-protocol-fuzz --executable PATH --corpus DIRECTORY ' +
                '--dictionary PATH --artifacts DIRECTORY [--seconds 60]',
        );
    }
    return {
        executable: path.resolve(options.executable),
        corpus: path.resolve(options.corpus),
        dictionary: path.resolve(options.dictionary),
        artifacts: path.resolve(options.artifacts),
        seconds: options.seconds,
    };
}

function run(executable, arguments_, timeout) {
    return spawnSync(executable, arguments_, {
        stdio: 'inherit',
        windowsHide: true,
        timeout,
    });
}

async function crashArtifacts(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
        .filter(
            (entry) => entry.isFile() && /^(crash|leak|oom|slow-unit|timeout)-/.test(entry.name),
        )
        .map((entry) => path.join(directory, entry.name))
        .sort();
}

async function main() {
    const options = parseFuzzArguments(process.argv.slice(2));
    await mkdir(options.artifacts, { recursive: true });
    const artifactPrefix = `${options.artifacts}${path.sep}`;
    const result = run(
        options.executable,
        [
            options.corpus,
            `-dict=${options.dictionary}`,
            `-artifact_prefix=${artifactPrefix}`,
            `-max_total_time=${options.seconds}`,
            '-timeout=10',
            '-rss_limit_mb=2048',
            '-max_len=1048576',
            '-print_final_stats=1',
        ],
        (options.seconds + 30) * 1_000,
    );
    if (result.error) throw result.error;
    if (result.status === 0) {
        process.stdout.write(`Protocol fuzzing completed its ${options.seconds}-second budget.\n`);
        return;
    }

    const crashes = await crashArtifacts(options.artifacts);
    const crash = crashes.at(-1);
    if (crash) {
        const minimized = path.join(options.artifacts, `minimized-${path.basename(crash)}`);
        process.stderr.write(`Minimizing retained failure ${path.basename(crash)}.\n`);
        run(
            options.executable,
            [crash, '-minimize_crash=1', '-runs=100000', `-exact_artifact_path=${minimized}`],
            120_000,
        );
    }
    process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
