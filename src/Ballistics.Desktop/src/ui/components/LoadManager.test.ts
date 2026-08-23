import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoadManager } from './LoadManager';
import { fixtureLoad } from './testFixtures';

describe('LoadManager', () => {
    it('renders load identity, drag ownership, payload count, and active selection', () => {
        const rifle = fixtureLoad();
        const buckshot = fixtureLoad({
            id: 'builtin:buckshot',
            name: 'Buckshot fixture',
            shortName: '00 buck',
            dragModel: 'Sphere',
            firearmGroup: 'shotgun',
            pelletCount: 9,
            sphereDiameterM: 0.00838,
            bcKind: '',
        });
        const markup = renderToStaticMarkup(
            createElement(LoadManager, {
                loads: [rifle, buckshot],
                selectedLoadId: buckshot.id,
                warnings: [],
                onSelectedLoadId: vi.fn(),
            }),
        );

        expect(markup).toContain('aria-label="Loads"');
        expect(markup).toContain('Rifle · G1');
        expect(markup).toContain('Shotgun · Reynolds–Mach sphere · 9×');
        expect(markup).toMatch(/class="active"[^>]*><span>Shotgun/);
    });

    it('renders every structured warning in a labelled status region', () => {
        const markup = renderToStaticMarkup(
            createElement(LoadManager, {
                loads: [fixtureLoad()],
                selectedLoadId: null,
                warnings: [
                    {
                        code: 'drag.extrapolated',
                        field: 'loads[0].drag',
                        message: 'Drag model extrapolated.',
                        severity: 'warning',
                    },
                    {
                        code: 'trajectory.horizon',
                        field: 'loads[0].trajectory',
                        message: 'Result stopped at the solution horizon.',
                        severity: 'warning',
                    },
                ],
                onSelectedLoadId: vi.fn(),
            }),
        );

        expect(markup).toContain('role="status" aria-label="Engine warnings"');
        expect(markup).toContain('Drag model extrapolated.');
        expect(markup).toContain('Result stopped at the solution horizon.');
    });

    it('omits the warning region when the engine returned no warnings', () => {
        const markup = renderToStaticMarkup(
            createElement(LoadManager, {
                loads: [],
                selectedLoadId: null,
                warnings: [],
                onSelectedLoadId: vi.fn(),
            }),
        );

        expect(markup).not.toContain('engine-warnings');
    });
});
