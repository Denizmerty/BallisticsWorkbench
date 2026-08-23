import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../../shared/productIdentity';
import type { Inputs, Load, Point, Result } from '../types';
import { statusText, type StatusMode } from './statusText';
import { defaultInputs } from './workbenchDefaults';

const inputs: Inputs = {
    ...defaultInputs,
    distanceM: 300,
    temperatureC: 15,
    pressureHpa: 1013.25,
    pressureSource: 'stationPressure',
    pressureAltitudeM: 0,
    geometricAltitudeM: 0,
    altimeterSettingHpa: 1013.25,
    humidityPercent: 50,
    headwindMps: 0,
    crosswindMps: 4,
    vitalZoneM: 0.15,
    shotgunSightM: 0.025,
    rifleSightM: 0.04,
    shotgunZeroM: 50,
    rifleZeroM: 100,
    shotgunMvMultiplier: 1,
    rifleMvMultiplier: 1,
    rifleTwistInches: 10,
    twistDirection: 1,
};

function point(overrides: Partial<Point> = {}): Point {
    return {
        distanceM: 100,
        speedMps: 700,
        airspeedMps: 700,
        energyJ: 2400,
        momentumKgms: 7,
        timeS: 0.145,
        dropM: -0.08,
        pathM: 0,
        holdoverRad: 0.0008,
        mach: 2.05,
        spinDriftM: 0.01,
        windDriftM: -0.03,
        referenceCd: 0.27,
        reynolds: 410_000,
        ...overrides,
    };
}

function load(overrides: Partial<Load> = {}, targetOverrides: Partial<Point> = {}): Load {
    return {
        id: 'rifle:g7',
        name: 'Test G7 projectile',
        shortName: 'Test G7',
        dragModel: 'G7',
        firearmGroup: 'rifle',
        massKg: 0.01,
        muzzleVelocityMps: 820,
        ballisticCoefficient: 0.25,
        ballisticCoefficientBands: [],
        dragReferenceDiameterM: 0,
        machCdPoints: [],
        bcKind: 'constant',
        sphereDiameterM: 0,
        materialDensityKgM3: 0,
        pelletCount: 1,
        source: 'builtIn',
        requestedDistanceM: 300,
        coveredDistanceM: 300,
        trajectoryStatus: 'complete',
        solutionHorizonM: 2000,
        solverDiagnostics: {
            mode: 'adaptive_time',
            attemptedSteps: 100,
            acceptedSteps: 98,
            rejectedSteps: 2,
            minimumAcceptedTimeStepS: 0.0001,
            maximumAcceptedTimeStepS: 0.01,
            finalTimeStepS: 0.002,
            maximumErrorNorm: 0.4,
        },
        dragValidity: {
            status: 'within_domain',
            supportedMachMin: 0.5,
            supportedMachMax: 5,
            supportedReynoldsMin: null,
            supportedReynoldsMax: null,
            observedMachMin: 1.8,
            observedMachMax: 2.4,
            observedReynoldsMin: null,
            observedReynoldsMax: null,
        },
        mpbrStatus: 'complete',
        zeroM: 180,
        mpbrM: 220,
        sightHeightM: 0.04,
        sightZeroM: 100,
        boreElevationRad: 0.001,
        zeroErrorM: 0,
        zeroingStatus: 'complete',
        dropAtSightZeroM: -0.06,
        spinDriftStatus: 'available',
        effectiveTwistInches: 10,
        gyroscopicStability: 1.6,
        trajectoryEvents: {
            analyzedDistanceM: 500,
            zeroCrossingsStatus: 'complete',
            nearZeroM: 4.5,
            farZeroM: 100,
            maximumOrdinateStatus: 'complete',
            maximumOrdinateDistanceM: 55,
            maximumOrdinatePathM: 0.035,
            supersonicRangeStatus: 'complete',
            supersonicRangeM: 420,
            groundIntersectionStatus: 'horizon_limited',
            groundIntersectionM: null,
            machCrossings: [{ mach: 1.2, distanceM: 350, direction: 'decelerating' }],
        },
        uncertainty: null,
        buckshotPattern: null,
        points: [
            point({
                distanceM: 0,
                speedMps: 820,
                airspeedMps: 820,
                energyJ: 3362,
                momentumKgms: 8.2,
                timeS: 0,
                dropM: 0,
                mach: 2.4,
            }),
            point(targetOverrides),
            point({ distanceM: 300, speedMps: 580, energyJ: 1682, timeS: 0.45, mach: 1.7 }),
        ],
        ...overrides,
    };
}

function result(selectedLoad = load()): Result {
    return {
        protocolVersion: PROTOCOL_VERSION,
        engineVersion: '1.0.2',
        modelVersion: '2026.08',
        requestId: 'status-test',
        ok: true,
        issues: [],
        atmosphere: {
            densityKgM3: 1.225,
            speedOfSoundMps: 340.3,
            viscosityPaS: 0.0000181,
            densityModel: 'ideal_moist_air_mixture',
            speedOfSoundModel: 'cramer_1993_400_ppm_co2',
            viscosityModel: 'sutherland_110_333_k',
            densityWithinDeclaredDomain: true,
            soundSpeedWithinDeclaredDomain: true,
            viscosityWithinDeclaredDomain: true,
            altitudeBehavior: 'homogeneous_at_firing_point',
        },
        scenarioModel: {
            targetInclinationRad: 0,
            geometricAltitudeM: 0,
            localGravity: false,
            coriolis: false,
            latitudeDeg: 45,
            azimuthDeg: 0,
            windLayerCount: 0,
        },
        loads: [selectedLoad],
    };
}

function render(mode: StatusMode, selectedResult: Result | null = result(), imperial = false) {
    return statusText({
        result: selectedResult,
        mode,
        selectedLoadId: 'rifle:g7',
        referenceDistanceM: 100,
        inputs,
        imperial,
    });
}

describe('statusText', () => {
    it('reports the engine wait state without a result', () => {
        expect(render('summary', null)).toBe('Waiting for the C++ engine.');
    });

    it('reports complete atmosphere coverage and model provenance', () => {
        const text = render('atmosphere');

        expect(text).toContain('Density 1.2250 kg/m³');
        expect(text).toContain('Sutherland viscosity');
        expect(text).toContain('complete through 300 m');
    });

    it('reports partial trajectory coverage', () => {
        const partial = result(load({ trajectoryStatus: 'ground_impact' }));

        expect(render('atmosphere', partial)).toContain(
            '1 trajectory ended before the requested range',
        );
    });

    it('formats per-projectile and payload summary values', () => {
        const payload = result(load({ pelletCount: 9, firearmGroup: 'shotgun' }));
        const text = render('summary', payload);

        expect(text).toContain('Test G7 at 100.0 m: 700 m/s');
        expect(text).toContain('per pellet 2,400 J, 7.00 kg·m/s');
        expect(text).toContain('payload (9×): 21,600 J, 63.00 kg·m/s');
        expect(text).toContain('TOF 0.145 s');
    });

    it('formats imperial summary values through the shared conversions', () => {
        const text = render('summary', result(), true);

        expect(text).toContain('109.4 yd');
        expect(text).toContain('2,297 ft/s');
        expect(text).toContain('ft·lbf');
        expect(text).toContain('in');
    });

    it('reports retained energy against muzzle energy', () => {
        const text = render('retainedEnergy');

        expect(text).toContain('71.4% retained');
        expect(text).toContain('from 3,362 J');
    });

    it.each([
        [1.3, 'supersonic'],
        [1, 'transonic'],
        [0.7, 'subsonic'],
    ] as const)('labels Mach %s as %s', (mach, regime) => {
        const selected = result(load({}, { mach }));

        expect(render('mach', selected)).toContain(`Mach ${mach.toFixed(3)} (${regime})`);
    });

    it('explains why spin drift is unavailable', () => {
        const selected = result(
            load({ spinDriftStatus: 'missing_geometry' }, { spinDriftM: null }),
        );

        expect(render('windage', selected)).toContain('spin drift unavailable (missing geometry)');
    });

    it('reports wind, spin, total direction, and crosswind', () => {
        const text = render('windage');

        expect(text).toContain('wind drift -3.0 cm left');
        expect(text).toContain('spin drift 1.0 cm right');
        expect(text).toContain('total windage -2.0 cm left');
        expect(text).toContain('crosswind 4.0 m/s');
    });

    it('formats sight path and angular holdover', () => {
        const text = render('holdover');

        expect(text).toContain('(zero 100 m)');
        expect(text).toContain('sight line');
        expect(text).toContain('MOA');
        expect(text).toContain('mil');
    });

    it('explains unavailable sight-zero geometry', () => {
        const selected = result(load({ zeroingStatus: 'no_solution', boreElevationRad: null }));

        expect(render('holdover', selected)).toContain('sight-zero trajectory is unavailable');
    });

    it('formats exact trajectory events and unresolved statuses', () => {
        const text = render('events');

        expect(text).toContain('near zero 4.5 m');
        expect(text).toContain('maximum ordinate 3.50 cm at 55.0 m');
        expect(text).toContain('ground intersection horizon limited');
        expect(text).toContain('Mach 1.2 down at 350.0 m');
    });

    it('reports drag diagnostics and model-domain validity', () => {
        const text = render('sphere');

        expect(text).toContain('reference Cd 0.2700');
        expect(text).toContain('Re 410,000');
        expect(text).toContain('within declared Mach 0.5–5 domain');
    });

    it('reports physical diameter and extrapolation for custom Mach-Cd loads', () => {
        const baseline = load();
        const selected = result(
            load({
                dragModel: 'MachCd',
                dragReferenceDiameterM: 0.00782,
                dragValidity: {
                    ...load().dragValidity,
                    status: 'extrapolated',
                },
                points: baseline.points.map((sample) => ({
                    ...sample,
                    cd: 0.31,
                    referenceCd: undefined,
                })),
            }),
        );
        const text = render('sphere', selected);

        expect(text).toContain('Cd 0.3100');
        expect(text).toContain('diameter 7.820 mm');
        expect(text).toContain('outside declared model domain');
    });

    it('reports a missing drag diagnostic', () => {
        const selected = result(load({}, { cd: undefined, referenceCd: undefined }));

        expect(render('sphere', selected)).toContain(
            'does not expose a drag-coefficient diagnostic',
        );
    });

    it('reports completed and unavailable MPBR solutions', () => {
        expect(render('mpbr')).toContain('optimal zero 180 m · MPBR 220 m');

        const unavailable = result(
            load({ mpbrStatus: 'horizon_limited', zeroM: null, mpbrM: null }),
        );
        expect(render('mpbr', unavailable)).toBe('Test G7: MPBR unavailable (horizon limited).');
    });

    it('asks for a load when the result contains no trajectories', () => {
        const empty = { ...result(), loads: [] };

        expect(render('summary', empty)).toBe('Select an available load.');
    });
});
