import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { declaredAtmosphere } from './atmosphere-model.mjs';

const gravityMps2 = 9.80665;
const referenceDensityKgM3 = 1.225;
const referenceSoundSpeedMps = 340.294;
const inchesToM = 0.0254;
const poundsToKg = 0.45359237;
const mpsToFps = 3.280839895013123;
const referenceAreaM2 = (Math.PI * inchesToM * inchesToM) / 4;
const referenceDragScale =
    (referenceDensityKgM3 * Math.PI * inchesToM * inchesToM) / (8 * poundsToKg);
const integrationStepS = 0.00002;

const sourcePath = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

async function readCsv(relative) {
    return (await readFile(sourcePath(relative), 'utf8'))
        .trim()
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.split(',').map(Number));
}

const g1Bands = (await readCsv('sources/g1-gnu-ballistics.csv')).map(
    ([minimumVelocityFps, coefficient, exponent]) => ({
        minimumVelocityFps,
        coefficient,
        exponent,
    }),
);
const g7Table = (await readCsv('sources/g7-py-ballisticcalc-2.2.10.csv')).map(
    ([mach, dragCoefficient]) => ({ mach, dragCoefficient }),
);
const inventory = JSON.parse(await readFile(sourcePath('normalized/builtin-loads.json'), 'utf8'));

function interpolateTable(x, table, xField, yField) {
    if (x <= table[0][xField]) return table[0][yField];
    if (x >= table.at(-1)[xField]) return table.at(-1)[yField];
    let low = 0;
    let high = table.length - 1;
    while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (table[middle][xField] <= x) low = middle;
        else high = middle;
    }
    const lower = table[low];
    const upper = table[high];
    const fraction = (x - lower[xField]) / (upper[xField] - lower[xField]);
    return lower[yField] + fraction * (upper[yField] - lower[yField]);
}

function atmosphereFrom(input) {
    return declaredAtmosphere(input);
}

function g1DragCoefficient(mach) {
    if (mach <= 0) return 0;
    const standardSpeedMps = mach * referenceSoundSpeedMps;
    const standardSpeedFps = standardSpeedMps * mpsToFps;
    const band = g1Bands.find((candidate) => standardSpeedFps >= candidate.minimumVelocityFps);
    if (!band) return 0;
    const retardationMps2 = band.coefficient * standardSpeedFps ** band.exponent * (1 / mpsToFps);
    return retardationMps2 / (referenceDragScale * standardSpeedMps * standardSpeedMps);
}

function g7DragCoefficient(mach) {
    return interpolateTable(mach, g7Table, 'mach', 'dragCoefficient');
}

function cubicBezier(values, u) {
    const q = 1 - u;
    return (
        values[0] * q ** 3 +
        3 * values[1] * u * q ** 2 +
        3 * values[2] * u ** 2 * q +
        values[3] * u ** 3
    );
}

function bezierYFromX(x, points) {
    const xs = points.map(([pointX]) => pointX);
    const ys = points.map(([, pointY]) => pointY);
    if (x <= xs[0]) return ys[0];
    if (x >= xs[3]) return ys[3];
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 80; iteration += 1) {
        const middle = (low + high) / 2;
        if (cubicBezier(xs, middle) < x) low = middle;
        else high = middle;
    }
    return cubicBezier(ys, (low + high) / 2);
}

function sphereDragVsReynolds(reynolds) {
    if (reynolds > 2e6) return 0.15;
    if (reynolds > 1.2e6) return 0.19 - 8e4 / reynolds;
    if (reynolds > 4.77e5) return -0.485 + 0.1 * Math.log10(reynolds);
    return (
        24 / reynolds +
        (2.6 * (reynolds / 5)) / (1 + (reynolds / 5) ** 1.52) +
        (0.411 * (reynolds / 263000) ** -7.94) / (1 + (reynolds / 263000) ** -8) +
        reynolds ** 0.8 / 461000
    );
}

function sphereDragCoefficient(mach, reynolds) {
    const correctedMach = Math.min(Math.max(mach, 0.2), 1.5);
    const shockPoints = [
        [0.1, 0],
        [0.95, 0],
        [0.55, 0.95],
        [1.5, 1],
    ];
    const maskPoints = [
        [0, 1.1],
        [0.85, 1.1],
        [0.57, 0.05],
        [1, 0],
    ];
    const shock = correctedMach >= 1.5 ? 1 : bezierYFromX(correctedMach, shockPoints);
    const mask = correctedMach > 1 ? 0 : bezierYFromX(correctedMach, maskPoints);
    const reynoldsScale = 0.78 + 0.22 * Math.atan(-12 * (correctedMach - 0.23));
    return shock + mask * sphereDragVsReynolds(Math.max(reynoldsScale * reynolds, 1e-12));
}

function dragCoefficient(projectile, airspeedMps, atmosphere) {
    const mach = airspeedMps / atmosphere.speedOfSoundMps;
    if (projectile.dragModel === 'G1') return g1DragCoefficient(mach);
    if (projectile.dragModel === 'G7') return g7DragCoefficient(mach);
    if (projectile.dragModel === 'tabulatedCd') {
        return interpolateTable(mach, projectile.machCdPoints, 'mach', 'dragCoefficient');
    }
    const reynolds =
        (atmosphere.densityKgM3 * airspeedMps * projectile.sphereDiameterM) /
        atmosphere.dynamicViscosityPaS;
    return sphereDragCoefficient(mach, reynolds);
}

function dragAcceleration(projectile, airspeedMps, atmosphere) {
    if (airspeedMps <= 0) return 0;
    const coefficient = dragCoefficient(projectile, airspeedMps, atmosphere);
    if (projectile.dragModel === 'G1' || projectile.dragModel === 'G7') {
        return (
            (0.5 * atmosphere.densityKgM3 * coefficient * referenceAreaM2 * airspeedMps ** 2) /
            (projectile.ballisticCoefficient * poundsToKg)
        );
    }
    const diameterM =
        projectile.dragModel === 'sphere'
            ? projectile.sphereDiameterM
            : projectile.dragReferenceDiameterM;
    const areaM2 = (Math.PI * diameterM * diameterM) / 4;
    return (
        (0.5 * atmosphere.densityKgM3 * coefficient * areaM2 * airspeedMps ** 2) / projectile.massKg
    );
}

function derivative(state, projectile, atmosphere) {
    const relativeX = state[3] + atmosphere.headwindMps;
    const relativeY = state[4];
    const relativeZ = state[5] - atmosphere.crosswindMps;
    const airspeedMps = Math.hypot(relativeX, relativeY, relativeZ);
    const retardationMps2 = dragAcceleration(projectile, airspeedMps, atmosphere);
    const dragScale = airspeedMps > 1e-12 ? -retardationMps2 / airspeedMps : 0;
    return [
        state[3],
        state[4],
        state[5],
        dragScale * relativeX,
        dragScale * relativeY - gravityMps2,
        dragScale * relativeZ,
    ];
}

function addScaled(state, derivativeValue, scale) {
    return state.map((value, index) => value + derivativeValue[index] * scale);
}

function rk4Step(state, stepS, projectile, atmosphere) {
    const k1 = derivative(state, projectile, atmosphere);
    const k2 = derivative(addScaled(state, k1, stepS / 2), projectile, atmosphere);
    const k3 = derivative(addScaled(state, k2, stepS / 2), projectile, atmosphere);
    const k4 = derivative(addScaled(state, k3, stepS), projectile, atmosphere);
    return state.map(
        (value, index) =>
            value + (stepS / 6) * (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]),
    );
}

function interpolateState(before, after, fraction) {
    return before.map((value, index) => value + fraction * (after[index] - value));
}

function sampleFromState(distanceM, timeS, state, projectile, atmosphere) {
    const relativeVelocity = {
        x: state[3] + atmosphere.headwindMps,
        y: state[4],
        z: state[5] - atmosphere.crosswindMps,
    };
    const groundSpeedMps = Math.hypot(state[3], state[4], state[5]);
    const airspeedMps = Math.hypot(relativeVelocity.x, relativeVelocity.y, relativeVelocity.z);
    return {
        distanceM,
        timeS,
        positionM: { x: distanceM, y: state[1], z: state[2] },
        groundVelocityMps: { x: state[3], y: state[4], z: state[5] },
        groundSpeedMps,
        airspeedMps,
        mach: airspeedMps / atmosphere.speedOfSoundMps,
        dragCoefficient: dragCoefficient(projectile, airspeedMps, atmosphere),
    };
}

function solveTrajectory(projectile, atmosphere, launch, sampleDistancesM) {
    const horizontalVelocityMps = projectile.muzzleVelocityMps * Math.cos(launch.elevationRad);
    let state = [
        0,
        0,
        0,
        horizontalVelocityMps * Math.cos(launch.azimuthRad),
        projectile.muzzleVelocityMps * Math.sin(launch.elevationRad),
        horizontalVelocityMps * Math.sin(launch.azimuthRad),
    ];
    let timeS = 0;
    const samples = [];
    for (const targetDistanceM of sampleDistancesM) {
        if (targetDistanceM === 0) {
            samples.push(sampleFromState(0, 0, state, projectile, atmosphere));
            continue;
        }
        while (state[0] < targetDistanceM) {
            const before = state;
            const beforeTimeS = timeS;
            state = rk4Step(state, integrationStepS, projectile, atmosphere);
            timeS += integrationStepS;
            if (!state.every(Number.isFinite) || state[3] <= 0 || timeS > 120) {
                throw new Error(`reference trajectory failed before ${targetDistanceM} m`);
            }
            if (state[0] >= targetDistanceM) {
                const fraction = (targetDistanceM - before[0]) / (state[0] - before[0]);
                const interpolated = interpolateState(before, state, fraction);
                samples.push(
                    sampleFromState(
                        targetDistanceM,
                        beforeTimeS + fraction * integrationStepS,
                        interpolated,
                        projectile,
                        atmosphere,
                    ),
                );
            }
        }
    }
    return samples;
}

function builtInProjectile(id) {
    const record = inventory.loads.find((candidate) => candidate.id === id);
    if (!record) throw new Error(`unknown built-in ${id}`);
    const implementation = record.implementation;
    return {
        id,
        massKg: implementation.massKg,
        muzzleVelocityMps: implementation.muzzleVelocityMps,
        dragModel: implementation.dragModel,
        ballisticCoefficient: implementation.ballisticCoefficient ?? 0,
        sphereDiameterM: implementation.sphereDiameterM ?? 0,
        materialDensityKgM3: implementation.materialDensityKgM3 ?? 0,
        dragReferenceDiameterM: 0,
        machCdPoints: [],
    };
}

const standardAtmosphere = {
    temperatureC: 15,
    stationPressureHpa: 1013.25,
    relativeHumidityPercent: 50,
    headwindMps: 0,
    crosswindMps: 0,
};

const hornadyG7 = {
    ...builtInProjectile('builtin:hornady-amax-168'),
    id: 'reference:hornady-g7-variant',
    dragModel: 'G7',
    ballisticCoefficient: 0.24,
};
const tabulatedProjectile = {
    id: 'reference:tabulated-transonic',
    massKg: 0.012,
    muzzleVelocityMps: 430,
    dragModel: 'tabulatedCd',
    ballisticCoefficient: 0,
    sphereDiameterM: 0,
    materialDensityKgM3: 0,
    dragReferenceDiameterM: 0.008,
    machCdPoints: [
        { mach: 0, dragCoefficient: 0.2 },
        { mach: 0.7, dragCoefficient: 0.22 },
        { mach: 0.9, dragCoefficient: 0.28 },
        { mach: 1, dragCoefficient: 0.4 },
        { mach: 1.2, dragCoefficient: 0.34 },
        { mach: 1.8, dragCoefficient: 0.25 },
    ],
};

const definitions = [
    {
        id: 'cold-dense-strong-headwind-g1',
        category: 'environment',
        projectile: builtInProjectile('builtin:federal-sp-150'),
        atmosphere: {
            temperatureC: -40,
            stationPressureHpa: 1080,
            relativeHumidityPercent: 20,
            headwindMps: 25,
            crosswindMps: -10,
        },
        launch: { elevationRad: 0.04, azimuthRad: 0.02 },
        sampleDistancesM: [100, 300, 600, 900, 1200],
    },
    {
        id: 'hot-thin-tailwind-g7',
        category: 'environment',
        projectile: hornadyG7,
        atmosphere: {
            temperatureC: 50,
            stationPressureHpa: 650,
            relativeHumidityPercent: 10,
            headwindMps: -18,
            crosswindMps: 0,
        },
        launch: { elevationRad: 0.03, azimuthRad: 0 },
        sampleDistancesM: [100, 400, 800, 1200, 1600],
    },
    {
        id: 'crosswind-opposed-azimuth-g1',
        category: 'wind_vector',
        projectile: builtInProjectile('builtin:hornady-amax-168'),
        atmosphere: { ...standardAtmosphere, crosswindMps: 20 },
        launch: { elevationRad: 0.03, azimuthRad: -0.04 },
        sampleDistancesM: [100, 250, 500, 750, 1000],
    },
    {
        id: 'steep-downward-g7',
        category: 'geometry',
        projectile: hornadyG7,
        atmosphere: { ...standardAtmosphere, headwindMps: 8, crosswindMps: -6 },
        launch: { elevationRad: -0.12, azimuthRad: 0.08 },
        sampleDistancesM: [50, 150, 300, 450, 600],
    },
    {
        id: 'low-velocity-subsonic-g7',
        category: 'low_velocity',
        projectile: { ...hornadyG7, muzzleVelocityMps: 280, ballisticCoefficient: 0.2 },
        atmosphere: { ...standardAtmosphere, temperatureC: 0 },
        launch: { elevationRad: 0.02, azimuthRad: 0 },
        sampleDistancesM: [50, 100, 200, 300, 400],
    },
    {
        id: 'tabulated-transonic-wind',
        category: 'tabulated_drag',
        projectile: tabulatedProjectile,
        atmosphere: { ...standardAtmosphere, headwindMps: 12, crosswindMps: 9 },
        launch: { elevationRad: 0.05, azimuthRad: -0.03 },
        sampleDistancesM: [50, 150, 250, 350, 500],
    },
    {
        id: 'sphere-buckshot-reference',
        category: 'sphere',
        projectile: builtInProjectile('builtin:winchester-00-buck'),
        atmosphere: { ...standardAtmosphere, temperatureC: 5, stationPressureHpa: 1000 },
        launch: { elevationRad: 0.02, azimuthRad: 0.01 },
        sampleDistancesM: [25, 50, 75, 100, 150],
    },
    ...inventory.loads.map((load, index) => ({
        id: `builtin-${index + 1}-${load.id.split(':').at(-1)}`,
        category: 'builtin_load',
        projectile: builtInProjectile(load.id),
        atmosphere: standardAtmosphere,
        launch: { elevationRad: index < 3 || index === 5 ? 0.03 : 0.05, azimuthRad: 0 },
        sampleDistancesM:
            index === 5
                ? [25, 50, 75, 100, 150]
                : index < 3
                  ? [25, 50, 100, 150, 200]
                  : [100, 300, 500, 750, 1000],
    })),
];

const trajectoryTolerances = {
    positionAbsoluteM: 0.0005,
    velocityAbsoluteMps: 0.005,
    timeAbsoluteS: 0.000015,
    scalarAbsolute: 0.005,
    dragCoefficientAbsolute: 0.000002,
};

function solveDefinition(definition) {
    const atmosphere = atmosphereFrom(definition.atmosphere);
    return {
        id: definition.id,
        category: definition.category,
        projectile: definition.projectile,
        atmosphere,
        launch: definition.launch,
        maximumDistanceM: definition.sampleDistancesM.at(-1),
        tolerances: trajectoryTolerances,
        samples: solveTrajectory(
            definition.projectile,
            atmosphere,
            definition.launch,
            definition.sampleDistancesM,
        ),
    };
}

function solveZeroingCase() {
    const projectile = builtInProjectile('builtin:hornady-amax-168');
    const atmosphere = atmosphereFrom(standardAtmosphere);
    const zeroRangeM = 100;
    const sightHeightM = 0.04;
    let low = -0.05;
    let high = 0.1;
    for (let iteration = 0; iteration < 60; iteration += 1) {
        const middle = (low + high) / 2;
        const sample = solveTrajectory(
            projectile,
            atmosphere,
            { elevationRad: middle, azimuthRad: 0 },
            [zeroRangeM],
        )[0];
        if (sample.positionM.y > sightHeightM) high = middle;
        else low = middle;
    }
    const boreElevationRad = (low + high) / 2;
    const samples = solveTrajectory(
        projectile,
        atmosphere,
        { elevationRad: boreElevationRad, azimuthRad: 0 },
        [25, 50, 100, 200, 400, 600],
    ).map((sample) => ({ ...sample, sightPathM: sample.positionM.y - sightHeightM }));
    return {
        id: 'hornady-100m-zero',
        projectile,
        atmosphere,
        zeroRangeM,
        sightHeightM,
        maximumDistanceM: 600,
        boreElevationRad,
        zeroResidualM: samples.find((sample) => sample.distanceM === zeroRangeM).sightPathM,
        tolerances: {
            boreAngleAbsoluteRad: 2e-7,
            pathAbsoluteM: 0.0005,
            timeAbsoluteS: 0.000005,
            velocityAbsoluteMps: 0.002,
        },
        samples,
    };
}

function solveMpbrCase() {
    const projectile = builtInProjectile('builtin:hornady-amax-168');
    const atmosphere = atmosphereFrom(standardAtmosphere);
    const sightHeightM = 0.04;
    const vitalZoneDiameterM = 0.2;
    const radiusM = vitalZoneDiameterM / 2;
    const maximumDistanceM = 800;
    const grid = Array.from({ length: maximumDistanceM * 4 + 1 }, (_, index) => index / 4);
    const evaluate = (elevationRad) => {
        const samples = solveTrajectory(
            projectile,
            atmosphere,
            { elevationRad, azimuthRad: 0 },
            grid,
        );
        const paths = samples.map((sample) => sample.positionM.y - sightHeightM);
        const maximumPathM = Math.max(...paths);
        let apex = paths.indexOf(maximumPathM);
        const crossing = (levelM) => {
            for (let index = Math.max(apex + 1, 1); index < samples.length; index += 1) {
                if (paths[index - 1] > levelM && paths[index] <= levelM) {
                    const fraction =
                        (paths[index - 1] - levelM) / (paths[index - 1] - paths[index]);
                    return (
                        samples[index - 1].distanceM +
                        fraction * (samples[index].distanceM - samples[index - 1].distanceM)
                    );
                }
            }
            return null;
        };
        return { maximumPathM, zeroM: crossing(0), mpbrM: crossing(-radiusM) };
    };
    let low = -0.01;
    let high = 0.05;
    for (let iteration = 0; iteration < 45; iteration += 1) {
        const middle = (low + high) / 2;
        if (evaluate(middle).maximumPathM > radiusM) high = middle;
        else low = middle;
    }
    const boreElevationRad = (low + high) / 2;
    const result = evaluate(boreElevationRad);
    if (result.zeroM === null || result.mpbrM === null) {
        throw new Error('reference MPBR crossings were not covered');
    }
    return {
        id: 'hornady-20cm-vital-zone',
        projectile,
        atmosphere,
        sightHeightM,
        vitalZoneDiameterM,
        maximumDistanceM,
        boreElevationRad,
        maximumPathM: result.maximumPathM,
        zeroM: result.zeroM,
        mpbrM: result.mpbrM,
        tolerances: {
            zeroAbsoluteM: 0.5,
            mpbrAbsoluteM: 0.5,
            maximumPathAbsoluteM: 0.0005,
        },
    };
}

const artifact = {
    schemaVersion: 1,
    id: 'independent-flight-matrix-rk4-v1',
    modelVersion: inventory.modelVersion,
    reference: {
        implementation: 'validation/reference/generate-flight-matrix.mjs',
        integrator: 'fixed-time classical RK4 over [x, y, z, vx, vy, vz]',
        stepS: integrationStepS,
        rangeInterpolation: 'linear interpolation across the fixed RK4 step',
        dragSources: [
            'validation/sources/g1-gnu-ballistics.csv',
            'validation/sources/g7-py-ballisticcalc-2.2.10.csv',
            'Morrison sphere correlation with Collins compressibility correction and bisection inversion',
        ],
        atmosphereModel: 'independent JavaScript transcription of the declared production formulas',
        generatedAt: '2026-08-18',
    },
    scenarios: definitions.map(solveDefinition),
    zeroingCases: [solveZeroingCase()],
    mpbrCases: [solveMpbrCase()],
};

const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
    const outputPath = process.argv[outputIndex + 1];
    if (!outputPath) throw new Error('--output requires a path');
    await writeFile(outputPath, serialized, 'utf8');
} else {
    process.stdout.write(serialized);
}
