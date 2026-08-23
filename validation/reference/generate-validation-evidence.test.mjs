import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    parseArguments,
    readRegisteredReports,
    renderReportSummary,
    renderSourceEvidence,
} from './generate-validation-evidence.mjs';

const temporaryDirectories = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { recursive: true, force: true })),
    );
});

function sourceFixture() {
    return {
        manifest: {
            modelVersion: 'test-model',
            evidenceLevels: [
                { id: 'inventory_only', rank: 0, definition: 'Inventory record.' },
                { id: 'calibration_only', rank: 1, definition: 'Calibration record.' },
                {
                    id: 'manufacturer_conformance',
                    rank: 2,
                    definition: 'Manufacturer comparison.',
                },
            ],
            models: [
                {
                    id: 'model-a',
                    implementation: 'source.cpp',
                    description: 'Fixture model.',
                    declaredValidity: { mach: [0.2, 1.5] },
                    limitations: ['Fixture limit.'],
                },
            ],
            datasets: [
                {
                    id: 'source-a',
                    path: 'sources/a.csv',
                    kind: 'fixture',
                    sha256: 'abc',
                    source: {
                        title: 'Fixture source',
                        publisher: 'Example publisher',
                        publicationDate: '2026',
                        locator: 'https://example.test/a',
                        archivedLocator: null,
                    },
                    retrieved: '2026-08-01',
                    units: { velocity: 'm/s' },
                    normalization: 'Values are unchanged.',
                    uncertainty: 'One unit.',
                },
            ],
        },
        inventory: {
            modelVersion: 'test-model',
            loads: [
                {
                    id: 'load-a',
                    manufacturer: 'Example',
                    product: 'Load',
                    firearmGroup: 'rifle',
                    implementation: {
                        dragModel: 'G1',
                        massKg: 0.01,
                        muzzleVelocityMps: 800,
                        ballisticCoefficient: 0.4,
                        parameterStatus: 'fitted_to_same_table',
                    },
                    provenance: {
                        status: 'primary_source_identified',
                        sourceDatasetIds: ['source-a'],
                        primarySourceIdentified: true,
                        primarySourceArchived: false,
                        knownSourceFacts: 'A source exists.',
                        gap: 'No holdout.',
                    },
                    validation: {
                        level: 'calibration_only',
                        summary: 'Calibration evidence.',
                    },
                },
            ],
        },
    };
}

function reportDefinitions() {
    return [
        ['g7-independent-residuals', 'g7-independent-residuals.json'],
        ['independent-flight-matrix', 'flight-matrix-residuals.json'],
        ['manufacturer-table-conformance', 'manufacturer-conformance-residuals.json'],
        ['atmosphere-property-conformance', 'atmosphere-conformance-residuals.json'],
        ['adaptive-solver-convergence', 'adaptive-convergence.json'],
        ['builtin-effective-bc-fits', 'builtin-effective-bc-fits.json'],
        ['native-benchmarks', 'benchmark.json'],
        ['interaction-performance', 'interaction-performance.json'],
    ].map(([id, reportPath]) => ({
        id,
        path: reportPath,
        schema: `${id}-schema`,
        title: id.replaceAll('-', ' '),
        classification:
            id.includes('performance') || id === 'native-benchmarks'
                ? 'performance_measurement'
                : 'independent_model_conformance',
        claimBoundary: `Boundary for ${id}.`,
    }));
}

function baseReport(extra = {}) {
    return { engineVersion: 'test-engine', modelVersion: 'test-model', passed: true, ...extra };
}

function reportFixtures() {
    const residuals = {
        positionM: 0.0001,
        velocityMps: 0.002,
        timeS: 0.000003,
        groundSpeedMps: 0.002,
        airspeedMps: 0.002,
        mach: 0.000004,
        dragCoefficient: 0,
    };
    const reports = [
        baseReport({
            maximumResiduals: {
                velocityRelative: 0.000001,
                timeRelative: 0.000002,
                positionAbsoluteM: 0.000003,
            },
            scenarios: [
                {
                    id: 'g7-case',
                    regime: 'transonic',
                    passed: true,
                    maximumResiduals: {
                        velocityRelative: 0.000001,
                        timeRelative: 0.000002,
                        positionAbsoluteM: 0.000003,
                    },
                },
            ],
        }),
        baseReport({
            referenceArtifact: 'matrix-v1',
            evidenceLevel: 'independent_implementation_numerical_conformance',
            aggregate: {
                scenarioCount: 1,
                sampleCount: 5,
                zeroingCaseCount: 1,
                mpbrCaseCount: 1,
                ...residuals,
            },
            categories: ['environment'],
            scenarios: [
                {
                    id: 'matrix-case',
                    category: 'environment',
                    dragModel: 'G1',
                    sampleCount: 5,
                    termination: 'requested_distance',
                    passed: true,
                    maximumResiduals: residuals,
                },
            ],
            zeroingCases: [
                {
                    id: 'zero-case',
                    status: 'complete',
                    sampleCount: 6,
                    boreAngleResidualRad: 0.000001,
                    zeroResidualM: 0.000002,
                    pathResidualM: 0.000003,
                    timeResidualS: 0.000004,
                    velocityResidualMps: 0.000005,
                    passed: true,
                },
            ],
            mpbrCases: [
                {
                    id: 'mpbr-case',
                    status: 'complete',
                    zeroResidualM: 0.000001,
                    mpbrResidualM: 0.000002,
                    maximumPathResidualM: 0.000003,
                    passed: true,
                },
            ],
        }),
        baseReport({
            evidenceLevel: 'manufacturer_conformance',
            atmosphere: {
                temperatureC: 15,
                stationPressureHpa: 1013.25,
                relativeHumidityPercent: 0,
                status: 'assumed_not_published',
            },
            loads: [
                {
                    loadId: 'load-a',
                    sourceDatasetIds: ['source-a'],
                    sourceQualification: 'primary_manufacturer_publication',
                    parameterStatus: 'manufacturer_published',
                    toleranceVelocityRelative: 0.005,
                    maximumVelocityRelative: 0.001,
                    passed: true,
                    samples: [{ distanceM: 100 }],
                },
            ],
        }),
        baseReport({
            density: atmosphereProperty('density-source', 0.0004, 9),
            speedOfSound: atmosphereProperty('sound-source', 0.0008, 3),
            dynamicViscosity: atmosphereProperty('viscosity-source', 0.0003, 8),
        }),
        baseReport({
            evidenceLevel: 'numerical_self_convergence',
            referenceConfiguration: { relationshipToProduction: 'Tighter reference.' },
            productionBudget: { positionM: 0.001, velocityMps: 0.01, timeS: 0.0001 },
            displayResolution: { positionM: 0.01, velocityMps: 0.1, timeS: 0.001 },
            maximumProductionError: {
                positionM: 0.0001,
                velocityMps: 0.001,
                timeS: 0.00001,
            },
            maximumHalfToleranceChange: {
                positionM: 0.00005,
                velocityMps: 0.0005,
                timeS: 0.000005,
            },
            analyticStepRefinement: {
                model: 'constant Cd',
                distanceM: 500,
                passed: true,
                rows: [
                    {
                        maximumTimeStepS: 0.1,
                        acceptedSteps: 10,
                        speedErrorMps: 0.001,
                        timeErrorS: 0.000001,
                        observedSpeedOrder: 4,
                        observedTimeOrder: 4,
                    },
                ],
            },
            scenarios: [
                {
                    id: 'convergence-case',
                    maximumDistanceM: 1000,
                    comparisonSamples: 20,
                    productionBudgetPassed: true,
                    halfToleranceDisplayPassed: true,
                    tighterSolutionImproved: true,
                },
            ],
        }),
        baseReport({
            generator: 'fit-generator',
            protocolOperation: 'calibrateReferenceBc',
            evidenceLevel: 'calibration_only',
            fits: [
                {
                    loadId: 'load-a',
                    model: 'G1',
                    fitStatus: 'converged',
                    observationCount: 3,
                    residualDegreesOfFreedom: 2,
                    implementedBallisticCoefficient: 0.4,
                    fittedBallisticCoefficient: 0.4000001,
                    coefficientResidualAbsolute: 0.0000001,
                    confidence95Low: 0.39,
                    confidence95High: 0.41,
                    hasHoldout: false,
                    validationClaimAvailable: false,
                    passed: true,
                    calibrationRmseMps: 0.2,
                    weightedRmse: 0.5,
                    reducedChiSquare: 0.4,
                    sourceDatasetIds: ['source-a'],
                },
            ],
        }),
        baseReport({
            passed: undefined,
            platform: 'test-platform',
            compiler: 'test compiler',
            hardwareConcurrency: 8,
            clock: 'wall time',
            thresholdPolicy: 'report-only',
            benchmarks: [
                {
                    id: 'benchmark-a',
                    iterations: 3,
                    medianMs: 10,
                    p95Ms: 12,
                    minimumMs: 9,
                    maximumMs: 12,
                    guard: 1,
                    integrationDiagnosticsAvailable: true,
                    acceptedStepsPerIteration: 20,
                    rejectedStepsPerIteration: 3,
                    retainedSamplesPerIteration: 4001,
                    estimatedRetainedBytesPerIteration: 480120,
                    serializedSamplesPerIteration: 501,
                },
            ],
        }),
        baseReport({
            platform: 'test-platform',
            architecture: 'x64',
            host: { cpu: 'Fixture CPU', logicalProcessors: 8 },
            policy: 'Complete the request within the recorded budgets.',
            warmNative: {
                medianMs: 100,
                p95Ms: 120,
                budgetP95Ms: 200,
                passed: true,
            },
            coldProcess: {
                medianMs: 130,
                p95Ms: 150,
                budgetP95Ms: 250,
                passed: true,
                estimatedStartupAndSerializationMedianMs: 30,
                estimatedStartupAndSerializationP95Ms: 30,
            },
            persistentWorker: {
                decision: 'retain-process',
                reconsiderationOverheadMs: 50,
                rationale: 'Current overhead is below the threshold.',
            },
        }),
    ];
    const definitions = reportDefinitions();
    return {
        manifest: { modelVersion: 'test-model', reportArtifacts: definitions },
        reports: reports.map((report, index) => ({ definition: definitions[index], report })),
    };
}

function atmosphereProperty(sourceDatasetId, maximumRelative, sampleCount) {
    return {
        sourceDatasetId,
        referenceModel: 'Reference model',
        productionModel: 'Production model',
        declaredDomain: { temperatureC: [-20, 40] },
        toleranceRelative: 0.001,
        maximumRelative,
        passed: true,
        samples: Array.from({ length: sampleCount }, () => ({})),
    };
}

describe('source evidence rendering', () => {
    it('renders model fields, source metadata, evidence levels, and every open gap', () => {
        const { manifest, inventory } = sourceFixture();
        const text = renderSourceEvidence(manifest, inventory);
        expect(text).toContain('Declared Validity');
        expect(text).toContain('Fixture limit.');
        expect(text).toContain('Example publisher');
        expect(text).toContain('No holdout.');
        expect(text).toContain('1 of 1 built-in loads lack empirical holdout evidence');
        expect(text).toContain('`abc`');
    });

    it('is deterministic and rejects mismatched model versions', () => {
        const { manifest, inventory } = sourceFixture();
        expect(renderSourceEvidence(manifest, inventory)).toBe(
            renderSourceEvidence(manifest, inventory),
        );
        expect(() =>
            renderSourceEvidence(manifest, { ...inventory, modelVersion: 'other-model' }),
        ).toThrow(/different model versions/);
    });
});

describe('report summary rendering', () => {
    it('renders all eight registered report families and their claim boundaries', () => {
        const { manifest, reports } = reportFixtures();
        const text = renderReportSummary(manifest, reports);
        expect(text).toContain('7 checked packages passed');
        expect(text).toContain('1 report-only package was recorded');
        expect(text).toContain('Dynamic viscosity');
        expect(text).toContain('benchmark-a');
        expect(text).toContain('Claim boundaries');
        expect(text).toContain('95% interval');
        expect(text).toContain('Aggregate status: **PASS**');
    });

    it('fails the aggregate when a checked report fails', () => {
        const { manifest, reports } = reportFixtures();
        reports.at(-1).report.passed = false;
        expect(renderReportSummary(manifest, reports)).toContain('Aggregate status: **FAIL**');
    });

    it('rejects incomplete report sets and stale model identities', () => {
        const { manifest, reports } = reportFixtures();
        expect(() => renderReportSummary(manifest, reports.slice(1))).toThrow(/every registered/);
        reports[0].report.modelVersion = 'stale-model';
        expect(() => renderReportSummary(manifest, reports)).toThrow(/expected test-model/);
    });

    it('rejects a report bundle assembled from different engine versions', () => {
        const { manifest, reports } = reportFixtures();
        reports.at(-1).report.engineVersion = 'other-engine';
        expect(() => renderReportSummary(manifest, reports)).toThrow(/one engine version/);
    });
});

describe('validation evidence command', () => {
    it('has a useful zero-option default and validates option pairs', () => {
        const defaults = parseArguments([]);
        expect(defaults.sourceOutput).toMatch(/VALIDATION_EVIDENCE\.md$/);
        expect(defaults.reportOutput).toMatch(/VALIDATION_SUMMARY\.md$/);
        expect(parseArguments(['--check'])).toMatchObject({
            sourceOutput: defaults.sourceOutput,
            reportOutput: defaults.reportOutput,
            check: true,
        });
        expect(() => parseArguments(['--reports', 'reports'])).toThrow(/supplied together/);
        expect(() => parseArguments(['--unknown'])).toThrow(/Unknown/);
    });

    it('loads reports in manifest order and names a missing required report', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'ballistics-evidence-'));
        temporaryDirectories.push(directory);
        const definitions = reportDefinitions().slice(0, 2);
        await writeFile(
            path.join(directory, definitions[0].path),
            JSON.stringify(baseReport()),
            'utf8',
        );
        await expect(
            readRegisteredReports({ reportArtifacts: definitions }, directory),
        ).rejects.toThrow(definitions[1].path);
        await writeFile(
            path.join(directory, definitions[1].path),
            JSON.stringify(baseReport()),
            'utf8',
        );
        const loaded = await readRegisteredReports({ reportArtifacts: definitions }, directory);
        expect(loaded.map((item) => item.definition.id)).toEqual(
            definitions.map((item) => item.id),
        );
    });
});
