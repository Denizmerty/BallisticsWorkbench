import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { readProductMetadata } from '../scripts/product/product-metadata.mjs';
import { renderSourceEvidence } from './reference/generate-validation-evidence.mjs';

const validationDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(validationDirectory, '..');
const schemaValidator = new Ajv2020({ allErrors: true, strict: true });
schemaValidator.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);

function fail(message) {
    throw new Error(message);
}

function matchesGeneratedArtifact(reference, generated) {
    if (typeof reference === 'number' && typeof generated === 'number') {
        const scale = Math.max(1, Math.abs(reference), Math.abs(generated));
        return Math.abs(reference - generated) <= 1e-12 * scale;
    }

    if (Array.isArray(reference) || Array.isArray(generated)) {
        return (
            Array.isArray(reference) &&
            Array.isArray(generated) &&
            reference.length === generated.length &&
            reference.every((value, index) => matchesGeneratedArtifact(value, generated[index]))
        );
    }

    if (reference && generated && typeof reference === 'object' && typeof generated === 'object') {
        const referenceKeys = Object.keys(reference);
        const generatedKeys = Object.keys(generated);
        return (
            referenceKeys.length === generatedKeys.length &&
            referenceKeys.every((key, index) => {
                return (
                    key === generatedKeys[index] &&
                    matchesGeneratedArtifact(reference[key], generated[key])
                );
            })
        );
    }

    return Object.is(reference, generated);
}

async function readJson(relativePath) {
    const contents = await readFile(resolve(validationDirectory, relativePath), 'utf8');
    return JSON.parse(contents);
}

async function sha256(relativePath) {
    const contents = await readFile(resolve(validationDirectory, relativePath));
    return createHash('sha256').update(contents).digest('hex');
}

function validateArtifact(schema, artifact, label) {
    const validate = schemaValidator.compile(schema);
    if (!validate(artifact)) {
        fail(`${label} violates its schema: ${schemaValidator.errorsText(validate.errors)}`);
    }
}

async function readJsonIfPresent(path) {
    const contents = await readTextIfPresent(path);
    return contents === null ? null : JSON.parse(contents);
}

async function readTextIfPresent(path) {
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

const productMetadata = await readProductMetadata(repositoryDirectory);
const manifest = await readJson('manifest.json');
if (manifest.schemaVersion !== 1 || manifest.modelVersion !== productMetadata.modelVersion) {
    fail('validation/manifest.json has an unsupported schema or model version');
}

const artifactSchemas = {};
for (const [schemaName, schemaPath] of Object.entries(manifest.artifactSchemas ?? {})) {
    const schema = await readJson(schemaPath);
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || !schema.$id) {
        fail(`${schemaPath} is not a named JSON Schema Draft 2020-12 document`);
    }
    artifactSchemas[schemaName] = schema;
}
if (Object.keys(manifest.artifactSchemas ?? {}).length !== 12) {
    fail(
        'manifest must register all twelve source, scenario, fit, numerical, atmosphere, convergence, flight-matrix, and performance schemas',
    );
}

const evidenceLevelIds = new Set();
const evidenceLevelRanks = new Set();
for (const level of manifest.evidenceLevels ?? []) {
    if (
        !level.id ||
        evidenceLevelIds.has(level.id) ||
        !Number.isInteger(level.rank) ||
        evidenceLevelRanks.has(level.rank) ||
        !level.definition
    ) {
        fail(`invalid or duplicate evidence level: ${level.id}`);
    }
    evidenceLevelIds.add(level.id);
    evidenceLevelRanks.add(level.rank);
}
const expectedEvidenceLevels = [
    'inventory_only',
    'calibration_only',
    'manufacturer_conformance',
    'independent_model_conformance',
    'empirical_holdout',
];
if (
    JSON.stringify([...evidenceLevelIds]) !== JSON.stringify(expectedEvidenceLevels) ||
    JSON.stringify([...evidenceLevelRanks]) !== JSON.stringify([0, 1, 2, 3, 4])
) {
    fail('manifest evidence levels must retain the complete ordered five-level scale');
}

const reportArtifactIds = new Set();
const reportArtifactPaths = new Set();
for (const report of manifest.reportArtifacts ?? []) {
    if (
        !report.id ||
        reportArtifactIds.has(report.id) ||
        !report.path ||
        reportArtifactPaths.has(report.path) ||
        !artifactSchemas[report.schema] ||
        !report.title ||
        !report.classification ||
        !report.claimBoundary
    ) {
        fail(`invalid or duplicate report artifact registration: ${report.id}`);
    }
    if (
        !evidenceLevelIds.has(report.classification) &&
        report.classification !== 'performance_measurement'
    ) {
        fail(`${report.id} uses an unknown classification: ${report.classification}`);
    }
    reportArtifactIds.add(report.id);
    reportArtifactPaths.add(report.path);
}
if (reportArtifactIds.size !== 8) {
    fail('manifest must register all eight canonical numerical, fit, and performance reports');
}

const datasetIds = new Set();
for (const dataset of manifest.datasets ?? []) {
    if (!dataset.id || datasetIds.has(dataset.id))
        fail(`duplicate or missing dataset ID: ${dataset.id}`);
    datasetIds.add(dataset.id);
    const actualChecksum = await sha256(dataset.path);
    if (actualChecksum !== dataset.sha256) {
        fail(`${dataset.path} checksum is ${actualChecksum}, expected ${dataset.sha256}`);
    }
}

const g1Rows = (
    await readFile(resolve(validationDirectory, 'sources/g1-gnu-ballistics.csv'), 'utf8')
)
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(',').map(Number));
if (g1Rows.length !== 39 || g1Rows.at(-1)[0] !== 0) {
    fail('G1 drag-function source must contain all 39 effective bands and end at 0 ft/s');
}
for (let index = 0; index < g1Rows.length; index += 1) {
    const [threshold, coefficient, exponent] = g1Rows[index];
    if (
        !Number.isFinite(threshold) ||
        coefficient <= 0 ||
        exponent <= 0 ||
        (index > 0 && threshold >= g1Rows[index - 1][0])
    ) {
        fail(`invalid G1 source row ${index + 2}`);
    }
}

const inventory = await readJson('normalized/builtin-loads.json');
const expectedBuiltInIds = [
    'builtin:white-blackout-hv',
    'builtin:blackshock',
    'builtin:winchester-x123rs15',
    'builtin:hornady-amax-168',
    'builtin:federal-sp-150',
    'builtin:winchester-00-buck',
];
if (inventory.modelVersion !== manifest.modelVersion || inventory.loads?.length !== 6) {
    fail('built-in inventory must cover all six loads for the manifest model version');
}
const inventoryIds = inventory.loads.map((load) => load.id);
if (JSON.stringify(inventoryIds) !== JSON.stringify(expectedBuiltInIds)) {
    fail('built-in inventory IDs or ordering no longer match the production inventory');
}
for (const load of inventory.loads) {
    if (!load.provenance?.status || !load.provenance?.gap || !load.validation?.level) {
        fail(`${load.id} must state provenance status, the remaining gap, and evidence level`);
    }
    if (!evidenceLevelIds.has(load.validation.level)) {
        fail(`${load.id} uses an unknown evidence level: ${load.validation.level}`);
    }
    if (!load.implementation?.parameterStatus) {
        fail(`${load.id} must state how its drag parameters were obtained`);
    }
    for (const sourceId of load.provenance.sourceDatasetIds ?? []) {
        if (!datasetIds.has(sourceId)) {
            fail(`${load.id} references unknown source dataset ${sourceId}`);
        }
    }
}

const expectedFitDefinitions = [
    'fitting/builtin-white-blackout-hv.json',
    'fitting/builtin-blackshock.json',
    'fitting/builtin-federal-sp-150.json',
];
const fitDefinitions = [];
const fittedLoadIds = new Set();
for (const path of expectedFitDefinitions) {
    const definition = await readJson(path);
    validateArtifact(artifactSchemas.fit, definition, path);
    const parameters = definition.parameters;
    const load = inventory.loads.find((candidate) => candidate.id === parameters.loadId);
    if (!load || fittedLoadIds.has(load.id)) {
        fail(`${path} references an unknown or duplicate fitted built-in load`);
    }
    fittedLoadIds.add(load.id);
    if (
        load.validation.level !== 'calibration_only' ||
        load.implementation.dragModel !== definition.model ||
        load.implementation.massKg !== parameters.massKg ||
        load.implementation.muzzleVelocityMps !== parameters.muzzleVelocityMps ||
        load.implementation.ballisticCoefficient !== parameters.implementedBallisticCoefficient ||
        definition.method.version !== manifest.modelVersion
    ) {
        fail(`${path} does not match the normalized inventory or model identity`);
    }
    let previousDistanceM = -1;
    for (const observation of definition.observations) {
        if (
            observation.role !== 'calibration' ||
            observation.distanceM <= previousDistanceM ||
            !datasetIds.has(observation.sourceId) ||
            !load.provenance.sourceDatasetIds.includes(observation.sourceId)
        ) {
            fail(`${path} contains an invalid, unordered, held-out, or unlinked observation`);
        }
        previousDistanceM = observation.distanceM;
    }
    fitDefinitions.push(definition);
}
if (
    JSON.stringify([...fittedLoadIds].sort()) !==
    JSON.stringify(
        ['builtin:white-blackout-hv', 'builtin:blackshock', 'builtin:federal-sp-150'].sort(),
    )
) {
    fail('reproducible fit definitions must cover exactly the three calibration-only G1 built-ins');
}

const expectedManufacturerDatasets = new Map([
    ['manufacturer-hornady-80971-2022', { rows: 6, kind: 'manufacturer_table' }],
    ['manufacturer-federal-308a-2022', { rows: 6, kind: 'manufacturer_table' }],
    ['manufacturer-winchester-x123rs15-2026', { rows: 4, kind: 'manufacturer_table' }],
    ['manufacturer-winchester-xb1200-2019', { rows: 1, kind: 'metadata_only' }],
    ['manufacturer-winchester-buckshot-diameters-2022', { rows: 6, kind: 'metadata_only' }],
    [
        'manufacturer-attributed-bp-white-blackout-hv-2018',
        { rows: 2, kind: 'manufacturer_attributed_table', qualified: true },
    ],
    [
        'manufacturer-attributed-bp-blackshock-2018',
        { rows: 2, kind: 'manufacturer_attributed_table', qualified: true },
    ],
    [
        'secondary-bp-white-blackout-hv-caccia-magazine-2019',
        { rows: 1, kind: 'secondary_publication', qualified: true },
    ],
]);
for (const [id, expectation] of expectedManufacturerDatasets) {
    const dataset = manifest.datasets.find((item) => item.id === id);
    if (!dataset || dataset.kind !== expectation.kind) {
        fail(`${id} is missing or has the wrong evidence kind`);
    }
    if (expectation.qualified && !dataset.sourceQualification) {
        fail(`${id} must state why it is not a primary manufacturer publication`);
    }
    if (
        !dataset.source?.publisher ||
        !dataset.source?.locator ||
        !dataset.retrieved ||
        !dataset.normalization ||
        !dataset.uncertainty ||
        !dataset.redistribution?.status ||
        !dataset.redistribution?.note
    ) {
        fail(
            `${id} must retain publisher, locator, retrieval, normalization, uncertainty, and redistribution metadata`,
        );
    }
    const rows = (await readFile(resolve(validationDirectory, dataset.path), 'utf8'))
        .trim()
        .split(/\r?\n/);
    if (rows.length !== expectation.rows + 1) {
        fail(`${id} must contain exactly ${expectation.rows} data rows`);
    }
}

const atmosphereDataset = manifest.datasets.find(
    (item) => item.id === 'reference-atmosphere-cipm-2007',
);
if (
    !atmosphereDataset ||
    atmosphereDataset.kind !== 'atmosphere_reference' ||
    atmosphereDataset.path !== 'sources/atmosphere-cipm-2007.csv'
) {
    fail('the CIPM-2007 atmosphere reference dataset is missing or incorrectly registered');
}
const atmosphereRows = (
    await readFile(resolve(validationDirectory, atmosphereDataset.path), 'utf8')
)
    .trim()
    .split(/\r?\n/);
if (
    atmosphereRows.length !== 10 ||
    atmosphereRows[0] !==
        'temperature_c,station_pressure_hpa,relative_humidity_percent,co2_mole_fraction,density_kg_m3,compressibility_factor,water_vapor_mole_fraction'
) {
    fail('the CIPM-2007 atmosphere reference must contain its exact header and nine data rows');
}
for (const [index, row] of atmosphereRows.slice(1).entries()) {
    const values = row.split(',').map(Number);
    if (
        values.length !== 7 ||
        values.some((value) => !Number.isFinite(value)) ||
        values[0] < 15 ||
        values[0] > 27 ||
        values[1] < 600 ||
        values[1] > 1100 ||
        values[2] < 0 ||
        values[2] > 100 ||
        values[3] !== 0.0004 ||
        values[4] <= 0 ||
        values[5] <= 0 ||
        values[6] < 0
    ) {
        fail(`invalid CIPM-2007 atmosphere row ${index + 2}`);
    }
}
const regeneratedAtmosphere = execFileSync(
    process.execPath,
    ['validation/reference/generate-atmosphere-reference.mjs'],
    {
        cwd: repositoryDirectory,
        encoding: 'utf8',
    },
).replace(/\r\n/g, '\n');
const storedAtmosphere = (
    await readFile(resolve(validationDirectory, atmosphereDataset.path), 'utf8')
).replace(/\r\n/g, '\n');
if (regeneratedAtmosphere !== storedAtmosphere) {
    fail('atmosphere-cipm-2007.csv does not match its deterministic reference generator');
}

const viscosityDataset = manifest.datasets.find(
    (item) => item.id === 'reference-air-viscosity-naca-1135',
);
if (
    !viscosityDataset ||
    viscosityDataset.kind !== 'atmosphere_reference' ||
    viscosityDataset.path !== 'sources/air-viscosity-naca-1135.csv'
) {
    fail('the NACA 1135 viscosity reference dataset is missing or incorrectly registered');
}
const viscosityRows = (await readFile(resolve(validationDirectory, viscosityDataset.path), 'utf8'))
    .trim()
    .split(/\r?\n/);
if (viscosityRows.length !== 9 || viscosityRows[0] !== 'temperature_c,dynamic_viscosity_pa_s') {
    fail('the NACA 1135 viscosity reference must contain its exact header and eight data rows');
}
const regeneratedViscosity = execFileSync(
    process.execPath,
    ['validation/reference/generate-viscosity-reference.mjs'],
    {
        cwd: repositoryDirectory,
        encoding: 'utf8',
    },
).replace(/\r\n/g, '\n');
const storedViscosity = (
    await readFile(resolve(validationDirectory, viscosityDataset.path), 'utf8')
).replace(/\r\n/g, '\n');
if (regeneratedViscosity !== storedViscosity) {
    fail('air-viscosity-naca-1135.csv does not match its deterministic reference generator');
}
for (const [index, row] of viscosityRows.slice(1).entries()) {
    const values = row.split(',').map(Number);
    if (
        values.length !== 2 ||
        values.some((value) => !Number.isFinite(value)) ||
        values[0] < -60 ||
        values[0] > 60 ||
        values[1] <= 0
    ) {
        fail(`invalid NACA 1135 viscosity row ${index + 2}`);
    }
}

const soundSpeedDataset = manifest.datasets.find(
    (item) => item.id === 'reference-atmosphere-sound-speed-gavioso-2025',
);
if (
    !soundSpeedDataset ||
    soundSpeedDataset.kind !== 'atmosphere_reference' ||
    soundSpeedDataset.path !== 'sources/atmosphere-sound-speed-gavioso-2025.csv'
) {
    fail('the Gavioso 2025 sound-speed reference dataset is missing or incorrectly registered');
}
const soundSpeedRows = (
    await readFile(resolve(validationDirectory, soundSpeedDataset.path), 'utf8')
)
    .trim()
    .split(/\r?\n/);
if (
    soundSpeedRows.length !== 5 ||
    soundSpeedRows[0] !==
        'temperature_c,station_pressure_hpa,relative_humidity_percent,co2_mole_fraction,acoustic_frequency_hz,speed_of_sound_mps,standard_uncertainty_mps'
) {
    fail('the Gavioso 2025 sound-speed reference must contain its exact header and four data rows');
}
for (const [index, row] of soundSpeedRows.slice(1).entries()) {
    const values = row.split(',').map(Number);
    if (
        values.length !== 7 ||
        values.some((value) => !Number.isFinite(value)) ||
        values[0] < 0 ||
        values[0] > 50 ||
        values[1] !== 1013.25 ||
        values[2] < 0 ||
        values[2] > 100 ||
        values[3] !== 0.000368 ||
        (index < 3 ? values[4] !== 0 : values[4] !== 10000) ||
        values[5] <= 0 ||
        values[6] <= 0
    ) {
        fail(`invalid Gavioso 2025 sound-speed row ${index + 2}`);
    }
}

const scenario = await readJson('scenarios/g7-independent.json');
validateArtifact(artifactSchemas.scenario, scenario, 'scenarios/g7-independent.json');
if (scenario.schemaVersion !== 1 || scenario.scenarios?.length !== 3) {
    fail('independent G7 artifact must contain exactly three flight-regime scenarios');
}
const regimes = new Set(scenario.scenarios.map((item) => item.regime));
for (const regime of ['supersonic', 'transonic', 'subsonic']) {
    if (!regimes.has(regime)) fail(`independent G7 artifact is missing the ${regime} regime`);
}
if (scenario.aerodynamicChecks?.map((item) => item.mach).join(',') !== '0.9,1,1.2,2,3') {
    fail('independent G7 aerodynamic checks must cover Mach 0.9, 1.0, 1.2, 2.0, and 3.0');
}

const regenerated = JSON.parse(
    execFileSync(process.execPath, ['validation/reference/generate-g7-reference.mjs'], {
        cwd: repositoryDirectory,
        encoding: 'utf8',
    }),
);
if (!matchesGeneratedArtifact(scenario, regenerated)) {
    fail('g7-independent.json does not match its deterministic reference generator');
}

const flightMatrix = await readJson('scenarios/independent-flight-matrix.json');
validateArtifact(
    artifactSchemas.flightMatrix,
    flightMatrix,
    'scenarios/independent-flight-matrix.json',
);
if (
    flightMatrix.schemaVersion !== 1 ||
    flightMatrix.id !== 'independent-flight-matrix-rk4-v1' ||
    flightMatrix.modelVersion !== manifest.modelVersion ||
    flightMatrix.scenarios?.length !== 13 ||
    flightMatrix.zeroingCases?.length !== 1 ||
    flightMatrix.mpbrCases?.length !== 1
) {
    fail(
        'independent flight matrix must contain 13 trajectories, one zeroing case, and one MPBR case',
    );
}
const requiredMatrixCategories = [
    'environment',
    'wind_vector',
    'geometry',
    'low_velocity',
    'tabulated_drag',
    'sphere',
    'builtin_load',
];
const matrixCategories = new Set(flightMatrix.scenarios.map((item) => item.category));
for (const category of requiredMatrixCategories) {
    if (!matrixCategories.has(category)) {
        fail(`independent flight matrix is missing the ${category} category`);
    }
}
const matrixBuiltInIds = new Set(
    flightMatrix.scenarios
        .filter((item) => item.category === 'builtin_load')
        .map((item) => item.projectile?.id),
);
if (
    matrixBuiltInIds.size !== expectedBuiltInIds.length ||
    expectedBuiltInIds.some((id) => !matrixBuiltInIds.has(id))
) {
    fail('independent flight matrix must exercise every built-in load exactly once');
}
for (const item of flightMatrix.scenarios) {
    if (
        !item.id ||
        !requiredMatrixCategories.includes(item.category) ||
        item.samples?.length !== 5 ||
        item.samples.at(-1)?.distanceM !== item.maximumDistanceM
    ) {
        fail(`invalid independent flight-matrix scenario ${item.id ?? '<missing>'}`);
    }
}
const regeneratedFlightMatrix = JSON.parse(
    execFileSync(process.execPath, ['validation/reference/generate-flight-matrix.mjs'], {
        cwd: repositoryDirectory,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
    }),
);
if (!matchesGeneratedArtifact(flightMatrix, regeneratedFlightMatrix)) {
    fail('independent-flight-matrix.json does not match its deterministic reference generator');
}

const buildReports = new Map();
for (const definition of manifest.reportArtifacts) {
    const reportPath = resolve(repositoryDirectory, 'build/validation', definition.path);
    const report = await readJsonIfPresent(reportPath);
    if (!report) continue;
    validateArtifact(
        artifactSchemas[definition.schema],
        report,
        `build/validation/${definition.path}`,
    );
    if (
        report.modelVersion !== manifest.modelVersion ||
        report.engineVersion !== productMetadata.applicationVersion
    ) {
        fail(`${definition.path} does not match the application or model identity`);
    }
    if (typeof report.passed === 'boolean' && report.passed !== true) {
        fail(`${definition.path} records a failed validation result`);
    }
    buildReports.set(definition.id, report);
}

const flightMatrixReport = buildReports.get('independent-flight-matrix');
if (flightMatrixReport) {
    if (
        flightMatrixReport.referenceArtifact !== flightMatrix.id ||
        flightMatrixReport.modelVersion !== manifest.modelVersion ||
        flightMatrixReport.aggregate?.scenarioCount !== flightMatrix.scenarios.length ||
        flightMatrixReport.aggregate?.zeroingCaseCount !== flightMatrix.zeroingCases.length ||
        flightMatrixReport.aggregate?.mpbrCaseCount !== flightMatrix.mpbrCases.length
    ) {
        fail('flight-matrix report identity or case counts do not match its source artifact');
    }
}

const fitReport = buildReports.get('builtin-effective-bc-fits');
if (fitReport) {
    if (
        fitReport.passed !== true ||
        fitReport.modelVersion !== manifest.modelVersion ||
        JSON.stringify(fitReport.definitionIds) !==
            JSON.stringify(fitDefinitions.map((definition) => definition.id)) ||
        fitReport.fits.some((fit) => fit.evidenceLevel !== 'calibration_only')
    ) {
        fail(
            'built-in fit report failed or does not match its source definitions and model identity',
        );
    }
}
const generatedFitEvidence = await readTextIfPresent(
    resolve(repositoryDirectory, 'build/validation/builtin-effective-bc-fits.md'),
);
if (generatedFitEvidence !== null) {
    const sourceControlledFitEvidence = await readFile(
        resolve(repositoryDirectory, 'docs/generated/BUILTIN_FIT_EVIDENCE.md'),
        'utf8',
    );
    if (
        generatedFitEvidence.replace(/\r\n/g, '\n') !==
        sourceControlledFitEvidence.replace(/\r\n/g, '\n')
    ) {
        fail('generated built-in fit evidence documentation is stale');
    }
}
const sourceControlledEvidence = await readFile(
    resolve(repositoryDirectory, 'docs/generated/VALIDATION_EVIDENCE.md'),
    'utf8',
);
if (
    sourceControlledEvidence.replace(/\r\n/g, '\n') !==
    renderSourceEvidence(manifest, inventory).replace(/\r\n/g, '\n')
) {
    fail('generated validation evidence inventory is stale');
}

process.stdout.write(
    `Validated ${manifest.datasets.length} datasets, ${inventory.loads.length} built-in loads, ${fitDefinitions.length} reproducible effective-BC fits, ${scenario.scenarios.length} independent G7 scenarios, ${flightMatrix.scenarios.length} independent flight-matrix trajectories, ${flightMatrix.zeroingCases.length} zeroing case, ${flightMatrix.mpbrCases.length} MPBR case, ${atmosphereRows.length - 1} CIPM-2007 density cases, ${viscosityRows.length - 1} NACA 1135 viscosity cases, ${soundSpeedRows.length - 1} published sound-speed cases, ${manifest.reportArtifacts.length} canonical report registrations, and ${buildReports.size} present build reports.\n`,
);
