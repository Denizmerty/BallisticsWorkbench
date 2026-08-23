import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Load, Metric, UnitSystem } from '../types';
import { TrajectoryOverview } from './TrajectoryOverview';
import { fixtureInputs, fixtureLoad, fixtureUncertaintyPoint } from './testFixtures';

function render(
    load: Load = fixtureLoad(),
    options: { units?: UnitSystem; metric?: Metric; referenceDistanceM?: number } = {},
) {
    return renderToStaticMarkup(
        createElement(TrajectoryOverview, {
            load,
            loads: [load],
            inputs: fixtureInputs,
            units: options.units ?? 'metric',
            referenceDistanceM: options.referenceDistanceM ?? 100,
            metric: options.metric ?? 'energyJ',
            onMetricChange: vi.fn(),
            onReferenceDistanceChange: vi.fn(),
        }),
    );
}

describe('TrajectoryOverview', () => {
    it('renders the complete metric load, state, trajectory, event, and chart structure', () => {
        const markup = render();

        expect(markup).toContain('Fixture rifle load');
        expect(markup).toContain('Rifle · G1 reference · single projectile');
        expect(markup).toContain('<header>Load &amp; muzzle</header>');
        expect(markup).toContain('<header>State at 100 m</header>');
        expect(markup).toContain('<header>Trajectory at 100 m</header>');
        expect(markup).toContain('Trajectory events · 500 m horizon');
        expect(markup).toContain('Ballistic coefficient');
        expect(markup).toContain('0.47500');
        expect(markup).toContain('Near zero');
        expect(markup).toContain('25.0 m');
        expect(markup).toContain('1.2 ↓ @ 300.0 m');
        expect(markup).toContain('<h3>Trajectory</h3>');
    });

    it('renders pellet-specific sphere and payload semantics in imperial units', () => {
        const load = fixtureLoad({
            dragModel: 'Sphere',
            firearmGroup: 'shotgun',
            sphereDiameterM: 0.008382,
            pelletCount: 9,
            bcKind: '',
            name: 'Nine-pellet buckshot fixture',
        });
        const markup = render(load, { units: 'imperial' });

        expect(markup).toContain('Shotgun · Reynolds–Mach sphere · 9 pellets');
        expect(markup).toContain('<strong>9-pellet payload:</strong>');
        expect(markup).toContain('Mass / pellet');
        expect(markup).toContain('Sphere diameter');
        expect(markup).toContain('<em>in</em>');
        expect(markup).toContain('Payload energy (9×)');
        expect(markup).toContain('Payload momentum (9×)');
        expect(markup).toContain('109 yd');
    });

    it('renders tabulated-drag reference geometry independently from ballistic coefficients', () => {
        const load = fixtureLoad({
            dragModel: 'MachCd',
            ballisticCoefficient: 0,
            dragReferenceDiameterM: 0.00782,
            machCdPoints: [
                { mach: 0.8, dragCoefficient: 0.25 },
                { mach: 1.2, dragCoefficient: 0.36 },
            ],
        });
        const markup = render(load);

        expect(markup).toContain('Drag reference diameter');
        expect(markup).toContain('7.820');
        expect(markup).not.toContain('Ballistic coefficient');
    });

    it('shows 95% half-width rows only for available complete uncertainty samples', () => {
        const uncertain = fixtureLoad({
            uncertainty: {
                method: 'first_order_central_difference',
                confidenceLevel: 0.95,
                status: 'complete',
                activeInputCount: 2,
                completedInputCount: 2,
                points: [
                    fixtureUncertaintyPoint(0),
                    fixtureUncertaintyPoint(50),
                    fixtureUncertaintyPoint(100),
                ],
            },
        });

        const markup = render(uncertain);
        expect(markup).toContain('Velocity 95% half-width');
        expect(markup).toContain('Energy 95% half-width');
        expect(markup).toContain('Time 95% half-width');
        expect(markup).toContain('Drop 95% half-width');
        expect(markup).toContain('Wind 95% half-width');
        expect(markup).toContain('Path 95% half-width');

        const unavailable = fixtureLoad({
            uncertainty: {
                method: 'first_order_central_difference',
                confidenceLevel: 0.95,
                status: 'complete',
                activeInputCount: 2,
                completedInputCount: 2,
                points: [
                    { ...fixtureUncertaintyPoint(0), available: false },
                    { ...fixtureUncertaintyPoint(100), available: false },
                ],
            },
        });
        expect(render(unavailable)).not.toContain('95% half-width');
    });

    it('presents incomplete event states and an empty crossing set', () => {
        const load = fixtureLoad({
            trajectoryEvents: {
                analyzedDistanceM: 75,
                zeroCrossingsStatus: 'horizon_limited',
                nearZeroM: null,
                farZeroM: null,
                maximumOrdinateStatus: 'horizon_limited',
                maximumOrdinateDistanceM: null,
                maximumOrdinatePathM: null,
                supersonicRangeStatus: 'horizon_limited',
                supersonicRangeM: null,
                groundIntersectionStatus: 'horizon_limited',
                groundIntersectionM: null,
                machCrossings: [],
            },
        });
        const markup = render(load, { referenceDistanceM: 50, metric: 'holdoverMoa' });

        expect(markup).toContain('horizon limited');
        expect(markup).toContain('none in horizon');
        expect(markup).toContain('<option value="holdoverMoa" selected="">Holdover (MOA)</option>');
    });
});
