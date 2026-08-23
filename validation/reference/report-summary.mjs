import { code, labelFor, markdownCell, scalar } from './evidence-markdown.mjs';

export function formatNumber(value, digits = 6) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return 'not recorded';
    }
    const number = Number(value);
    const magnitude = Math.abs(number);
    if (magnitude !== 0 && (magnitude < 0.001 || magnitude >= 100000)) {
        return number.toExponential(4).replace(/\.0+e/, 'e');
    }
    return number
        .toFixed(digits)
        .replace(/\.0+$/, '')
        .replace(/(\.\d*?)0+$/, '$1');
}

function status(value) {
    if (value === true) return 'PASS';
    if (value === false) return 'FAIL';
    return 'RECORDED';
}

function formatDomain(domain) {
    return Object.entries(domain ?? {})
        .map(([key, value]) => {
            const shown = Array.isArray(value)
                ? value.map((item) => formatNumber(item)).join(' to ')
                : scalar(value);
            return `${labelFor(key)} ${shown}`;
        })
        .join(', ');
}

function metricTable(record, units = {}) {
    const lines = ['| Metric | Value |', '| --- | ---: |'];
    for (const [key, value] of Object.entries(record ?? {})) {
        const unit = units[key] ? ` ${units[key]}` : '';
        lines.push(`| ${labelFor(key)} | ${formatNumber(value)}${unit} |`);
    }
    return lines;
}

function renderG7(report) {
    const maximum = report.maximumResiduals;
    return {
        keyResult:
            `${report.scenarios.length} regimes; maximum velocity residual ` +
            `${formatNumber(maximum.velocityRelative)}`,
        lines: [
            'Maximum residuals:',
            '',
            ...metricTable(maximum, { positionAbsoluteM: 'm' }),
            '',
            '| Scenario | Regime | Status | Velocity relative | Time relative | Position |',
            '| --- | --- | --- | ---: | ---: | ---: |',
            ...report.scenarios.map(
                (scenario) =>
                    `| ${code(scenario.id)} | ${scenario.regime} | ${status(scenario.passed)} | ` +
                    `${formatNumber(scenario.maximumResiduals.velocityRelative)} | ` +
                    `${formatNumber(scenario.maximumResiduals.timeRelative)} | ` +
                    `${formatNumber(scenario.maximumResiduals.positionAbsoluteM)} m |`,
            ),
            '',
        ],
    };
}

function renderFlightMatrix(report) {
    return {
        keyResult:
            `${report.aggregate.scenarioCount} trajectories and ` +
            `${report.aggregate.sampleCount} samples; maximum position residual ` +
            `${formatNumber(report.aggregate.positionM)} m`,
        lines: [
            `Reference artifact: ${code(report.referenceArtifact)}. Evidence level: ` +
                `${code(report.evidenceLevel)}.`,
            '',
            `Covered categories: ${report.categories.map(code).join(', ')}.`,
            '',
            'Aggregate residuals:',
            '',
            ...metricTable(report.aggregate, {
                positionM: 'm',
                velocityMps: 'm/s',
                timeS: 's',
                groundSpeedMps: 'm/s',
                airspeedMps: 'm/s',
            }),
            '',
            '| Scenario | Category | Drag | Samples | Termination | Status | Position | Velocity | Time |',
            '| --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: |',
            ...report.scenarios.map(
                (scenario) =>
                    `| ${code(scenario.id)} | ${code(scenario.category)} | ` +
                    `${code(scenario.dragModel)} | ${scenario.sampleCount} | ` +
                    `${code(scenario.termination)} | ${status(scenario.passed)} | ` +
                    `${formatNumber(scenario.maximumResiduals.positionM)} m | ` +
                    `${formatNumber(scenario.maximumResiduals.velocityMps)} m/s | ` +
                    `${formatNumber(scenario.maximumResiduals.timeS)} s |`,
            ),
            '',
            'Sight-zero cases:',
            '',
            '| Case | Solver status | Samples | Result | Bore angle | Zero | Path | Time | Velocity |',
            '| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
            ...report.zeroingCases.map(
                (item) =>
                    `| ${code(item.id)} | ${code(item.status)} | ${item.sampleCount} | ` +
                    `${status(item.passed)} | ${formatNumber(item.boreAngleResidualRad)} rad | ` +
                    `${formatNumber(item.zeroResidualM)} m | ${formatNumber(item.pathResidualM)} m | ` +
                    `${formatNumber(item.timeResidualS)} s | ` +
                    `${formatNumber(item.velocityResidualMps)} m/s |`,
            ),
            '',
            'MPBR cases:',
            '',
            '| Case | Solver status | Result | Zero | MPBR | Maximum path |',
            '| --- | --- | --- | ---: | ---: | ---: |',
            ...report.mpbrCases.map(
                (item) =>
                    `| ${code(item.id)} | ${code(item.status)} | ${status(item.passed)} | ` +
                    `${formatNumber(item.zeroResidualM)} m | ` +
                    `${formatNumber(item.mpbrResidualM)} m | ` +
                    `${formatNumber(item.maximumPathResidualM)} m |`,
            ),
            '',
        ],
    };
}

function renderManufacturer(report) {
    const maximum = Math.max(...report.loads.map((load) => load.maximumVelocityRelative));
    return {
        keyResult:
            `${report.loads.length} loads; maximum relative velocity residual ` +
            `${formatNumber(maximum)}`,
        lines: [
            `Evidence level: ${code(report.evidenceLevel)}. Atmosphere status: ` +
                `${code(report.atmosphere.status)}.`,
            '',
            `Comparison atmosphere: ${formatDomain(report.atmosphere)}.`,
            '',
            '| Load | Sources | Source qualification | Parameter status | Samples | Maximum residual | Tolerance | Status |',
            '| --- | --- | --- | --- | ---: | ---: | ---: | --- |',
            ...report.loads.map(
                (load) =>
                    `| ${code(load.loadId)} | ${load.sourceDatasetIds.map(code).join('<br>')} | ` +
                    `${code(load.sourceQualification)} | ${code(load.parameterStatus)} | ` +
                    `${load.samples.length} | ${formatNumber(load.maximumVelocityRelative)} | ` +
                    `${formatNumber(load.toleranceVelocityRelative)} | ${status(load.passed)} |`,
            ),
            '',
            'Every table sample remains in the JSON report with its distance, published velocity,',
            'predicted velocity, and relative residual.',
            '',
        ],
    };
}

const atmosphereProperties = [
    ['density', 'Density', 'kg/m³'],
    ['speedOfSound', 'Speed of sound', 'm/s'],
    ['dynamicViscosity', 'Dynamic viscosity', 'Pa s'],
];

function renderAtmosphere(report) {
    const lines = [
        '| Property | Dataset | Samples | Maximum relative | Tolerance | Status |',
        '| --- | --- | ---: | ---: | ---: | --- |',
    ];
    for (const [property, title] of atmosphereProperties) {
        const section = report[property];
        lines.push(
            `| ${title} | ${code(section.sourceDatasetId)} | ${section.samples.length} | ` +
                `${formatNumber(section.maximumRelative)} | ` +
                `${formatNumber(section.toleranceRelative)} | ${status(section.passed)} |`,
        );
    }
    lines.push('');

    for (const [property, title, unit] of atmosphereProperties) {
        const section = report[property];
        lines.push(
            `#### ${title}`,
            '',
            `Reference: ${section.referenceModel}. Production: ${section.productionModel}.`,
            '',
            `Declared comparison domain: ${formatDomain(section.declaredDomain)}.`,
            '',
            `The report retains ${section.samples.length} samples. Maximum relative residual: ` +
                `${formatNumber(section.maximumRelative)}. Tolerance: ` +
                `${formatNumber(section.toleranceRelative)}. Unit for the reported property: ${unit}.`,
            '',
        );
    }

    const highest = Math.max(
        ...atmosphereProperties.map(([property]) => report[property].maximumRelative),
    );
    return {
        keyResult: `${atmosphereProperties.length} properties; highest relative residual ${formatNumber(highest)}`,
        lines,
    };
}

function renderConvergence(report) {
    const analytic = report.analyticStepRefinement;
    return {
        keyResult:
            `${report.scenarios.length} solver scenarios; maximum position error ` +
            `${formatNumber(report.maximumProductionError.positionM)} m`,
        lines: [
            `Evidence level: ${code(report.evidenceLevel)}. Reference configuration: ` +
                `${report.referenceConfiguration.relationshipToProduction}.`,
            '',
            '| Metric | Production budget | Maximum production error | Half-tolerance change | Display resolution |',
            '| --- | ---: | ---: | ---: | ---: |',
            ...Object.keys(report.productionBudget).map(
                (key) =>
                    `| ${labelFor(key)} | ${formatNumber(report.productionBudget[key])} | ` +
                    `${formatNumber(report.maximumProductionError[key])} | ` +
                    `${formatNumber(report.maximumHalfToleranceChange[key])} | ` +
                    `${formatNumber(report.displayResolution[key])} |`,
            ),
            '',
            `Analytical refinement model: ${analytic.model}. Distance: ` +
                `${formatNumber(analytic.distanceM)} m. Status: ${status(analytic.passed)}.`,
            '',
            '| Maximum step | Accepted steps | Speed error | Time error | Speed order | Time order |',
            '| ---: | ---: | ---: | ---: | ---: | ---: |',
            ...analytic.rows.map(
                (row) =>
                    `| ${formatNumber(row.maximumTimeStepS)} s | ${row.acceptedSteps} | ` +
                    `${formatNumber(row.speedErrorMps)} m/s | ${formatNumber(row.timeErrorS)} s | ` +
                    `${formatNumber(row.observedSpeedOrder)} | ` +
                    `${formatNumber(row.observedTimeOrder)} |`,
            ),
            '',
            '| Scenario | Distance | Samples | Budget | Display | Improved |',
            '| --- | ---: | ---: | --- | --- | --- |',
            ...report.scenarios.map(
                (scenario) =>
                    `| ${code(scenario.id)} | ${formatNumber(scenario.maximumDistanceM)} m | ` +
                    `${scenario.comparisonSamples} | ${status(scenario.productionBudgetPassed)} | ` +
                    `${status(scenario.halfToleranceDisplayPassed)} | ` +
                    `${scenario.tighterSolutionImproved ? 'yes' : 'no'} |`,
            ),
            '',
        ],
    };
}

function interval(fit) {
    if (fit.confidence95Low === null || fit.confidence95High === null) return 'unavailable';
    return `${formatNumber(fit.confidence95Low)} to ${formatNumber(fit.confidence95High)}`;
}

function renderFits(report) {
    return {
        keyResult: `${report.fits.length} fits; ${report.fits.filter((fit) => fit.hasHoldout).length} holdouts`,
        lines: [
            `Generator: ${code(report.generator)}. Protocol operation: ` +
                `${code(report.protocolOperation)}. Evidence level: ${code(report.evidenceLevel)}.`,
            '',
            '| Load | Model | Fit status | Observations | Degrees of freedom | Implemented BC | Fitted BC | Absolute difference | 95% interval | Holdout | Claim available | Status |',
            '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |',
            ...report.fits.map(
                (fit) =>
                    `| ${code(fit.loadId)} | ${code(fit.model)} | ${code(fit.fitStatus)} | ` +
                    `${fit.observationCount} | ${fit.residualDegreesOfFreedom} | ` +
                    `${formatNumber(fit.implementedBallisticCoefficient)} | ` +
                    `${formatNumber(fit.fittedBallisticCoefficient)} | ` +
                    `${formatNumber(fit.coefficientResidualAbsolute)} | ${interval(fit)} | ` +
                    `${fit.hasHoldout ? 'yes' : 'no'} | ` +
                    `${fit.validationClaimAvailable ? 'yes' : 'no'} | ${status(fit.passed)} |`,
            ),
            '',
            '| Load | Calibration RMSE | Weighted RMSE | Reduced chi-square | Sources |',
            '| --- | ---: | ---: | ---: | --- |',
            ...report.fits.map(
                (fit) =>
                    `| ${code(fit.loadId)} | ${formatNumber(fit.calibrationRmseMps)} m/s | ` +
                    `${formatNumber(fit.weightedRmse)} | ${formatNumber(fit.reducedChiSquare)} | ` +
                    `${fit.sourceDatasetIds.map(code).join('<br>')} |`,
            ),
            '',
        ],
    };
}

function renderBenchmarks(report) {
    const slowest = report.benchmarks.reduce((left, right) =>
        left.p95Ms >= right.p95Ms ? left : right,
    );
    return {
        keyResult:
            `${report.benchmarks.length} benchmarks; highest p95 ` +
            `${formatNumber(slowest.p95Ms)} ms (${slowest.id})`,
        lines: [
            `Platform: ${code(report.platform)}. Compiler: ${report.compiler}. Hardware threads: ` +
                `${report.hardwareConcurrency}. Clock: ${report.clock}.`,
            '',
            `Threshold policy: ${report.thresholdPolicy}.`,
            '',
            '| Benchmark | Iterations | Minimum | Median | p95 | Maximum | Accepted steps | Rejected steps | Retained samples | Serialized samples | Retained bytes | Guard |',
            '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
            ...report.benchmarks.map(
                (benchmark) =>
                    `| ${code(benchmark.id)} | ${benchmark.iterations} | ` +
                    `${formatNumber(benchmark.minimumMs)} ms | ` +
                    `${formatNumber(benchmark.medianMs)} ms | ` +
                    `${formatNumber(benchmark.p95Ms)} ms | ` +
                    `${formatNumber(benchmark.maximumMs)} ms | ` +
                    `${benchmark.acceptedStepsPerIteration} | ` +
                    `${benchmark.rejectedStepsPerIteration} | ` +
                    `${benchmark.retainedSamplesPerIteration} | ` +
                    `${benchmark.serializedSamplesPerIteration} | ` +
                    `${benchmark.estimatedRetainedBytesPerIteration} | ` +
                    `${formatNumber(benchmark.guard)} |`,
            ),
            '',
        ],
    };
}

function renderInteraction(report) {
    return {
        keyResult:
            `warm p95 ${formatNumber(report.warmNative.p95Ms)} ms; cold p95 ` +
            `${formatNumber(report.coldProcess.p95Ms)} ms`,
        lines: [
            `Platform: ${code(report.platform)} ${code(report.architecture)}. CPU: ` +
                `${report.host.cpu.trim()}. Logical processors: ${report.host.logicalProcessors}.`,
            '',
            report.policy,
            '',
            '| Path | Median | p95 | p95 budget | Status |',
            '| --- | ---: | ---: | ---: | --- |',
            `| Warm native calculation | ${formatNumber(report.warmNative.medianMs)} ms | ` +
                `${formatNumber(report.warmNative.p95Ms)} ms | ` +
                `${formatNumber(report.warmNative.budgetP95Ms)} ms | ` +
                `${status(report.warmNative.passed)} |`,
            `| Cold process request | ${formatNumber(report.coldProcess.medianMs)} ms | ` +
                `${formatNumber(report.coldProcess.p95Ms)} ms | ` +
                `${formatNumber(report.coldProcess.budgetP95Ms)} ms | ` +
                `${status(report.coldProcess.passed)} |`,
            '',
            `Estimated startup and serialization overhead: median ` +
                `${formatNumber(report.coldProcess.estimatedStartupAndSerializationMedianMs)} ms, ` +
                `p95 ${formatNumber(report.coldProcess.estimatedStartupAndSerializationP95Ms)} ms.`,
            '',
            `Worker decision: ${code(report.persistentWorker.decision)}. Reconsideration threshold: ` +
                `${formatNumber(report.persistentWorker.reconsiderationOverheadMs)} ms.`,
            '',
            report.persistentWorker.rationale,
            '',
        ],
    };
}

const renderers = new Map([
    ['g7-independent-residuals', renderG7],
    ['independent-flight-matrix', renderFlightMatrix],
    ['manufacturer-table-conformance', renderManufacturer],
    ['atmosphere-property-conformance', renderAtmosphere],
    ['adaptive-solver-convergence', renderConvergence],
    ['builtin-effective-bc-fits', renderFits],
    ['native-benchmarks', renderBenchmarks],
    ['interaction-performance', renderInteraction],
]);

export function renderReportSummary(manifest, reports) {
    if (!Array.isArray(manifest?.reportArtifacts) || manifest.reportArtifacts.length === 0) {
        throw new Error('Validation manifest does not register report artifacts.');
    }
    if (!Array.isArray(reports) || reports.length !== manifest.reportArtifacts.length) {
        throw new Error('Validation summary requires every registered report artifact.');
    }

    const reportsById = new Map(reports.map((item) => [item.definition.id, item]));
    const rendered = manifest.reportArtifacts.map((definition) => {
        const item = reportsById.get(definition.id);
        if (!item) throw new Error(`Validation report ${definition.id} is missing.`);
        if (item.report.modelVersion !== manifest.modelVersion) {
            throw new Error(
                `${definition.path} uses model ${item.report.modelVersion}; expected ${manifest.modelVersion}.`,
            );
        }
        const renderer = renderers.get(definition.id);
        if (!renderer) throw new Error(`No summary renderer is registered for ${definition.id}.`);
        return { definition, report: item.report, rendered: renderer(item.report) };
    });

    const engineVersions = new Set(rendered.map(({ report }) => report.engineVersion));
    if (engineVersions.size !== 1 || engineVersions.has(undefined)) {
        throw new Error('Validation reports do not share one engine version.');
    }

    const checked = rendered.filter(({ report }) => typeof report.passed === 'boolean');
    const failed = checked.filter(({ report }) => report.passed === false);
    const recorded = rendered.length - checked.length;
    const aggregate = failed.length === 0 ? 'PASS' : 'FAIL';
    const lines = [
        '# Validation Run Summary',
        '',
        '> Generated from the report register in `validation/manifest.json` and the complete set of',
        '> machine-readable reports. The JSON files remain the numerical record.',
        '',
        `Engine version: ${code(rendered[0].report.engineVersion)}. Model version: ` +
            `${code(manifest.modelVersion)}. Aggregate status: **${aggregate}**.`,
        '',
        `${checked.length - failed.length} checked packages passed, ${failed.length} failed, and ` +
            `${recorded} report-only package${recorded === 1 ? ' was' : 's were'} recorded.`,
        '',
        '## Report coverage',
        '',
        '| Evidence package | File | Classification | Status | Key result |',
        '| --- | --- | --- | --- | --- |',
        ...rendered.map(
            ({ definition, report, rendered: result }) =>
                `| ${markdownCell(definition.title)} | ${code(definition.path)} | ` +
                `${code(definition.classification)} | ${status(report.passed)} | ` +
                `${markdownCell(result.keyResult)} |`,
        ),
        '',
        '## Claim boundaries',
        '',
        ...rendered.flatMap(({ definition }) => [
            `- **${definition.title}:** ${definition.claimBoundary}`,
        ]),
        '',
    ];

    for (const { definition, report, rendered: result } of rendered) {
        lines.push(
            `## ${definition.title}`,
            '',
            `File: ${code(definition.path)}. Status: **${status(report.passed)}**.`,
            '',
            ...result.lines,
        );
    }
    return `${lines.join('\n')}\n`;
}
