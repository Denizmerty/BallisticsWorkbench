import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProductMetadata } from '../../scripts/product/product-metadata.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import { format, resolveConfig } from 'prettier';

const validationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = resolve(validationDirectory, '..');
const productMetadata = await readProductMetadata(repositoryDirectory);
const definitionPaths = [
    'fitting/builtin-white-blackout-hv.json',
    'fitting/builtin-blackshock.json',
    'fitting/builtin-federal-sp-150.json',
];

function fail(message) {
    throw new Error(message);
}

function parseArguments(arguments_) {
    const defaultEngine =
        process.platform === 'win32' ? 'build/ballistics_cli.exe' : 'build/ballistics_cli';
    const options = {
        engine: resolve(repositoryDirectory, defaultEngine),
        output: resolve(repositoryDirectory, 'build/validation/builtin-effective-bc-fits.json'),
        markdown: resolve(repositoryDirectory, 'build/validation/builtin-effective-bc-fits.md'),
    };
    for (let index = 0; index < arguments_.length; index += 1) {
        const name = arguments_[index];
        if (!['--engine', '--output', '--markdown'].includes(name)) {
            fail(`unknown argument ${name}`);
        }
        const value = arguments_[index + 1];
        if (!value) fail(`${name} requires a path`);
        options[name.slice(2)] = resolve(repositoryDirectory, value);
        index += 1;
    }
    return options;
}

async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

function compileSchema(schema, label, strict = true) {
    const ajv = new Ajv2020({ allErrors: true, strict });
    const validate = ajv.compile(schema);
    return (value) => {
        if (!validate(value)) {
            fail(`${label} schema violation: ${ajv.errorsText(validate.errors)}`);
        }
    };
}

function sameNumber(first, second, relativeTolerance = 1e-12) {
    return (
        Math.abs(first - second) <=
        relativeTolerance * Math.max(1, Math.abs(first), Math.abs(second))
    );
}

function unique(values) {
    return [...new Set(values)];
}

function requestFromDefinition(definition) {
    const parameters = definition.parameters;
    const atmosphere = parameters.atmosphere;
    return {
        protocolVersion: productMetadata.protocolVersion,
        requestId: `validation-fit:${definition.id}`,
        operation: 'calibrateReferenceBc',
        atmosphere: {
            temperatureC: atmosphere.temperatureC,
            stationPressureHpa: atmosphere.stationPressureHpa,
            relativeHumidityPercent: atmosphere.relativeHumidityPercent,
            headwindMps: atmosphere.headwindMps,
            crosswindMps: atmosphere.crosswindMps,
        },
        projectile: {
            curve: definition.model,
            massKg: parameters.massKg,
            muzzleVelocityMps: parameters.muzzleVelocityMps,
            initialBallisticCoefficient: parameters.initialBallisticCoefficient,
        },
        fit: { kind: parameters.fitKind },
        observations: definition.observations.map((observation) => ({
            distanceM: observation.distanceM,
            velocityMps: observation.velocityMps,
            standardDeviationMps: observation.standardDeviationMps,
            role: observation.role,
        })),
    };
}

function runEngine(engine, request) {
    const result = spawnSync(engine, [], {
        input: `${JSON.stringify(request)}\n`,
        encoding: 'utf8',
        maxBuffer: productMetadata.limits.engineResponseBytes,
        windowsHide: true,
    });
    if (result.error) fail(`could not start ${engine}: ${result.error.message}`);
    if (result.status !== 0) {
        fail(`${basename(engine)} exited ${result.status}: ${result.stderr || result.stdout}`);
    }
    try {
        return JSON.parse(result.stdout);
    } catch (error) {
        fail(`${basename(engine)} returned invalid JSON: ${error.message}`);
    }
}

function verifyDefinition(definition, inventory, manifestDatasetIds) {
    const parameters = definition.parameters;
    const load = inventory.loads.find((candidate) => candidate.id === parameters.loadId);
    if (!load) fail(`${definition.id} references unknown load ${parameters.loadId}`);
    if (
        load.implementation.dragModel !== definition.model ||
        !sameNumber(load.implementation.massKg, parameters.massKg) ||
        !sameNumber(load.implementation.muzzleVelocityMps, parameters.muzzleVelocityMps) ||
        !sameNumber(
            load.implementation.ballisticCoefficient,
            parameters.implementedBallisticCoefficient,
        )
    ) {
        fail(`${definition.id} no longer matches the normalized built-in inventory`);
    }
    if (load.validation.level !== 'calibration_only') {
        fail(`${definition.id} must remain calibration_only in the normalized inventory`);
    }
    if (definition.method.version !== inventory.modelVersion) {
        fail(`${definition.id} method version does not match the inventory model version`);
    }
    for (const sourceId of definition.observations.map((item) => item.sourceId)) {
        if (!manifestDatasetIds.has(sourceId)) {
            fail(`${definition.id} references unknown source dataset ${sourceId}`);
        }
        if (!load.provenance.sourceDatasetIds.includes(sourceId)) {
            fail(`${definition.id} source ${sourceId} is not linked from ${load.id}`);
        }
    }
    const calibrationCount = definition.observations.filter(
        (item) => item.role === 'calibration',
    ).length;
    if (calibrationCount < 1 || definition.observations.some((item) => item.role === 'holdout')) {
        fail(
            `${definition.id} must contain calibration inputs only. No holdout is currently available`,
        );
    }
}

function resultFromResponse(definition, response) {
    const calibration = response.calibration;
    const parameters = definition.parameters;
    const calibrationCount = definition.observations.filter(
        (item) => item.role === 'calibration',
    ).length;
    const residualDegreesOfFreedom = Math.max(0, calibrationCount - 1);
    const expectedStatus =
        residualDegreesOfFreedom === 0 ? 'insufficient_information' : 'converged';
    const estimate = calibration.estimates[0];
    if (!estimate || calibration.estimates.length !== 1) {
        fail(`${definition.id} did not return exactly one coefficient estimate`);
    }
    if (calibration.residuals.length !== definition.observations.length) {
        fail(`${definition.id} response does not preserve every observation`);
    }
    for (let index = 0; index < definition.observations.length; index += 1) {
        const input = definition.observations[index];
        const output = calibration.residuals[index];
        if (
            !sameNumber(input.distanceM, output.distanceM) ||
            !sameNumber(input.velocityMps, output.measuredVelocityMps) ||
            !sameNumber(input.standardDeviationMps, output.standardDeviationMps) ||
            input.role !== output.role
        ) {
            fail(`${definition.id} response changed observation ${index + 1}`);
        }
    }

    const coefficientResidualAbsolute = Math.abs(
        estimate.ballisticCoefficient - parameters.implementedBallisticCoefficient,
    );
    const statusPassed = calibration.status === expectedStatus;
    const evidenceBoundaryPassed =
        calibration.hasHoldout === false && calibration.validationClaimAvailable === false;
    const confidencePassed =
        residualDegreesOfFreedom === 0
            ? estimate.confidence95Low === null && estimate.confidence95High === null
            : estimate.confidence95Low !== null && estimate.confidence95High !== null;
    const coefficientPassed =
        coefficientResidualAbsolute <= parameters.coefficientToleranceAbsolute;

    return {
        id: definition.id,
        loadId: parameters.loadId,
        model: definition.model,
        sourceDatasetIds: unique(definition.observations.map((item) => item.sourceId)),
        parameterStatus: parameters.parameterStatus,
        evidenceLevel: parameters.evidenceLevel,
        fitStatus: calibration.status,
        observationCount: definition.observations.length,
        calibrationCount,
        residualDegreesOfFreedom,
        implementedBallisticCoefficient: parameters.implementedBallisticCoefficient,
        fittedBallisticCoefficient: estimate.ballisticCoefficient,
        coefficientResidualAbsolute,
        coefficientToleranceAbsolute: parameters.coefficientToleranceAbsolute,
        calibrationRmseMps: calibration.calibrationRmseMps,
        weightedRmse: calibration.weightedRmse,
        reducedChiSquare: calibration.reducedChiSquare,
        confidence95Low: estimate.confidence95Low,
        confidence95High: estimate.confidence95High,
        hasHoldout: calibration.hasHoldout,
        validationClaimAvailable: calibration.validationClaimAvailable,
        atmosphereQualification: parameters.atmosphere.qualification,
        uncertaintyQualification: parameters.uncertaintyQualification,
        assumptions: parameters.assumptions,
        passed: statusPassed && evidenceBoundaryPassed && confidencePassed && coefficientPassed,
        residuals: calibration.residuals.map((residual, index) => ({
            sourceId: definition.observations[index].sourceId,
            ...residual,
        })),
    };
}

function formatNumber(value, digits) {
    return Number(value).toFixed(digits);
}

function markdownFromReport(report) {
    const lines = [
        '# Generated built-in effective-BC evidence',
        '',
        '> Generated by `validation/reference/run-builtin-fits.mjs` from the registered fit',
        '> definitions and the real native JSON calibration protocol. Do not edit by hand.',
        '',
        `Engine ${report.engineVersion}. Model ${report.modelVersion}. Evidence level ` +
            `\`${report.evidenceLevel}\`.`,
        '',
        '| Built-in load | Inputs | Residual dof | Implemented BC | Allowed BC difference | Fit status | Result |',
        '| --- | ---: | ---: | ---: | ---: | --- | --- |',
    ];
    for (const fit of report.fits) {
        lines.push(
            `| \`${fit.loadId}\` | ${fit.calibrationCount} | ${fit.residualDegreesOfFreedom} | ` +
                `${formatNumber(fit.implementedBallisticCoefficient, 9)} | ` +
                `${formatNumber(fit.coefficientToleranceAbsolute, 9)} | ` +
                `\`${fit.fitStatus}\` | ${fit.passed ? 'pass' : 'fail'} |`,
        );
    }
    lines.push(
        '',
        "Detailed fitted values and residuals remain in each platform's JSON report. Small",
        'floating-point differences are expected between compilers. The pass result uses the',
        'tolerance registered in each fit definition.',
        '',
        'All observations are calibration inputs from the same publication tables used to derive or',
        'assess the implemented coefficients. There are no physically separate holdouts, so this',
        'artifact is reproducibility evidence only and makes no independent validation claim.',
        '',
        'The BlackShock fit has one observation for one coefficient. It reproduces the coefficient but',
        'has zero residual degrees of freedom, no confidence interval, and an',
        '`insufficient_information` status by design.',
        '',
    );
    return lines.join('\n');
}

const options = parseArguments(process.argv.slice(2));
const [fitSchema, reportSchema, protocolSchema, inventory, manifest] = await Promise.all([
    readJson(resolve(validationDirectory, 'schemas/fit.schema.json')),
    readJson(resolve(validationDirectory, 'schemas/fit-report.schema.json')),
    readJson(resolve(repositoryDirectory, 'protocol/ballistics-protocol.schema.json')),
    readJson(resolve(validationDirectory, 'normalized/builtin-loads.json')),
    readJson(resolve(validationDirectory, 'manifest.json')),
]);
const definitions = await Promise.all(
    definitionPaths.map((path) => readJson(resolve(validationDirectory, path))),
);
const validateDefinition = compileSchema(fitSchema, 'fit definition');
const validateReport = compileSchema(reportSchema, 'fit report');
// The long-lived public protocol schema predates Ajv's strictTypes lint and omits
// redundant `type: object` declarations inside some conditional subschemas. Validation remains
// complete. Strict schema linting applies to the new fit contracts above.
const validateProtocol = compileSchema(protocolSchema, 'calibration protocol response', false);
const manifestDatasetIds = new Set(manifest.datasets.map((dataset) => dataset.id));

const definitionIds = new Set();
const loadIds = new Set();
const fits = [];
let engineVersion;
let modelVersion;
for (const definition of definitions) {
    validateDefinition(definition);
    if (definitionIds.has(definition.id)) fail(`duplicate fit definition ${definition.id}`);
    if (loadIds.has(definition.parameters.loadId)) {
        fail(`duplicate fitted load ${definition.parameters.loadId}`);
    }
    definitionIds.add(definition.id);
    loadIds.add(definition.parameters.loadId);
    verifyDefinition(definition, inventory, manifestDatasetIds);
    const request = requestFromDefinition(definition);
    const response = runEngine(options.engine, request);
    validateProtocol(response);
    if (
        response.ok !== true ||
        response.operation !== 'calibrateReferenceBc' ||
        response.requestId !== request.requestId
    ) {
        fail(`${definition.id} returned an inconsistent protocol envelope`);
    }
    engineVersion ??= response.engineVersion;
    modelVersion ??= response.modelVersion;
    if (response.engineVersion !== engineVersion || response.modelVersion !== modelVersion) {
        fail('fit responses disagree on engine or model identity');
    }
    fits.push(resultFromResponse(definition, response));
}

if (modelVersion !== inventory.modelVersion || modelVersion !== manifest.modelVersion) {
    fail('fit report model identity does not match the registered validation artifacts');
}
const report = {
    schemaVersion: 1,
    reportType: 'builtin_effective_bc_fits',
    engineVersion,
    modelVersion,
    platform: process.platform,
    generator: 'validation/reference/run-builtin-fits.mjs',
    protocolOperation: 'calibrateReferenceBc',
    evidenceLevel: 'calibration_only',
    passed: fits.every((fit) => fit.passed),
    definitionIds: definitions.map((definition) => definition.id),
    fits,
};
validateReport(report);
await mkdir(dirname(options.output), { recursive: true });
await mkdir(dirname(options.markdown), { recursive: true });
await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const prettierConfig = (await resolveConfig(options.markdown)) ?? {};
const markdown = await format(markdownFromReport(report), {
    ...prettierConfig,
    parser: 'markdown',
});
await writeFile(options.markdown, markdown, 'utf8');

for (const fit of fits) {
    process.stdout.write(
        `${fit.loadId}: ${fit.passed ? 'PASS' : 'FAIL'} fitted=${fit.fittedBallisticCoefficient} ` +
            `implemented=${fit.implementedBallisticCoefficient} rmse=${fit.calibrationRmseMps}\n`,
    );
}
process.stdout.write(`Fit report: ${options.output}\nFit evidence: ${options.markdown}\n`);
if (!report.passed) process.exitCode = 1;
