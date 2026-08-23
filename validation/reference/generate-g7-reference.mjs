import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { declaredAtmosphere } from './atmosphere-model.mjs';

const gravityMps2 = 9.80665;
const inchesToM = 0.0254;
const poundsToKg = 0.45359237;

const atmosphereInput = {
    temperatureC: 15,
    stationPressureHpa: 1013.25,
    relativeHumidityPercent: 0,
    headwindMps: 0,
    crosswindMps: 0,
};

const resolvedAtmosphere = declaredAtmosphere(atmosphereInput);
const densityKgM3 = resolvedAtmosphere.densityKgM3;
const speedOfSoundMps = resolvedAtmosphere.speedOfSoundMps;
const referenceAreaM2 = (Math.PI * inchesToM * inchesToM) / 4;
const integrationStepM = 0.002;

const dragTablePath = fileURLToPath(
    new URL('../sources/g7-py-ballisticcalc-2.2.10.csv', import.meta.url),
);
const dragTable = (await readFile(dragTablePath, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
        const [mach, dragCoefficient] = line.split(',').map(Number);
        return { mach, dragCoefficient };
    });

function dragCoefficientAt(mach) {
    if (mach <= dragTable[0].mach) return dragTable[0].dragCoefficient;
    if (mach >= dragTable.at(-1).mach) return dragTable.at(-1).dragCoefficient;

    let low = 0;
    let high = dragTable.length - 1;
    while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (dragTable[middle].mach <= mach) low = middle;
        else high = middle;
    }

    const lower = dragTable[low];
    const upper = dragTable[high];
    const fraction = (mach - lower.mach) / (upper.mach - lower.mach);
    return lower.dragCoefficient + fraction * (upper.dragCoefficient - lower.dragCoefficient);
}

function dragAcceleration(speedMps, ballisticCoefficient) {
    const dragCoefficient = dragCoefficientAt(speedMps / speedOfSoundMps);
    const referenceMassKg = ballisticCoefficient * poundsToKg;
    return (
        (0.5 * densityKgM3 * dragCoefficient * referenceAreaM2 * speedMps * speedMps) /
        referenceMassKg
    );
}

// This reference evolves vertical position, horizontal/vertical velocity, and time against
// downrange distance. It uses a fixed-distance classical RK4 method, separate from the
// production solver's adaptive time-domain Dormand-Prince method.
function derivative(state, ballisticCoefficient) {
    const [, velocityXMps, velocityYMps] = state;
    const speedMps = Math.hypot(velocityXMps, velocityYMps);
    const retardationMps2 = dragAcceleration(speedMps, ballisticCoefficient);
    return [
        velocityYMps / velocityXMps,
        -retardationMps2 / speedMps,
        ((-retardationMps2 * velocityYMps) / speedMps - gravityMps2) / velocityXMps,
        1 / velocityXMps,
    ];
}

function addScaled(state, delta, scale) {
    return state.map((value, index) => value + delta[index] * scale);
}

function rk4Step(state, distanceStepM, ballisticCoefficient) {
    const k1 = derivative(state, ballisticCoefficient);
    const k2 = derivative(addScaled(state, k1, distanceStepM / 2), ballisticCoefficient);
    const k3 = derivative(addScaled(state, k2, distanceStepM / 2), ballisticCoefficient);
    const k4 = derivative(addScaled(state, k3, distanceStepM), ballisticCoefficient);

    return state.map(
        (value, index) =>
            value + (distanceStepM / 6) * (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]),
    );
}

function solveScenario(definition) {
    let distanceM = 0;
    let state = [0, definition.muzzleVelocityMps, 0, 0];
    const samples = [];

    for (const sampleDistanceM of definition.sampleDistancesM) {
        while (distanceM < sampleDistanceM) {
            const distanceStepM = Math.min(integrationStepM, sampleDistanceM - distanceM);
            state = rk4Step(state, distanceStepM, definition.ballisticCoefficient);
            distanceM += distanceStepM;
        }
        const [verticalPositionM, velocityXMps, velocityYMps, timeS] = state;
        samples.push({
            distanceM: sampleDistanceM,
            speedMps: Math.hypot(velocityXMps, velocityYMps),
            timeS,
            verticalPositionM,
        });
    }

    return {
        id: definition.id,
        regime: definition.regime,
        muzzleVelocityMps: definition.muzzleVelocityMps,
        ballisticCoefficient: definition.ballisticCoefficient,
        maximumDistanceM: definition.sampleDistancesM.at(-1),
        tolerances: {
            velocityRelative: 0.001,
            timeRelative: 0.001,
            positionAbsoluteM: 0.0005,
        },
        samples,
    };
}

const scenarioDefinitions = [
    {
        id: 'g7-supersonic',
        regime: 'supersonic',
        muzzleVelocityMps: 900,
        ballisticCoefficient: 0.3,
        sampleDistancesM: [100, 200, 300, 400, 500],
    },
    {
        id: 'g7-transonic',
        regime: 'transonic',
        muzzleVelocityMps: 450,
        ballisticCoefficient: 0.12,
        sampleDistancesM: [50, 100, 150, 200, 250],
    },
    {
        id: 'g7-subsonic',
        regime: 'subsonic',
        muzzleVelocityMps: 300,
        ballisticCoefficient: 0.2,
        sampleDistancesM: [50, 100, 150, 200],
    },
];

const aerodynamicChecks = [0.9, 1.0, 1.2, 2.0, 3.0].map((mach) => {
    const ballisticCoefficient = 0.25;
    const speedMps = mach * speedOfSoundMps;
    return {
        mach,
        dragCoefficient: dragCoefficientAt(mach),
        ballisticCoefficient,
        accelerationMps2: dragAcceleration(speedMps, ballisticCoefficient),
    };
});

const artifact = {
    schemaVersion: 1,
    id: 'g7-independent-rk4-v1',
    reference: {
        implementation: 'validation/reference/generate-g7-reference.mjs',
        dragData: 'validation/sources/g7-py-ballisticcalc-2.2.10.csv',
        integrator: 'fixed-distance classical RK4 over [y, vx, vy, time]',
        stepM: integrationStepM,
        generatedAt: '2026-08-15',
    },
    atmosphere: atmosphereInput,
    aerodynamicChecks,
    scenarios: scenarioDefinitions.map(solveScenario),
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
