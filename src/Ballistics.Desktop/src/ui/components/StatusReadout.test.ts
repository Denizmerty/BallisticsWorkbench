import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StatusReadout } from './StatusReadout';
import { fixtureLoad } from './testFixtures';

function render(mode: 'atmosphere' | 'summary', selectedLoadId: string | null = null) {
    const first = fixtureLoad();
    const second = fixtureLoad({ id: 'custom:second', shortName: 'Second', source: 'custom' });
    return renderToStaticMarkup(
        createElement(StatusReadout, {
            loads: [first, second],
            mode,
            selectedLoadId,
            message: 'Deterministic status text.',
            onModeChange: vi.fn(),
            onSelectedLoadId: vi.fn(),
        }),
    );
}

describe('StatusReadout', () => {
    it('exposes every supported status mode from one focused owner', () => {
        const markup = render('summary');

        for (const label of [
            'Atmosphere &amp; integration',
            'Selected load summary',
            'Energy retained',
            'Mach &amp; flight regime',
            'Drag-coefficient diagnostics',
            'Windage (wind &amp; spin)',
            'Holdover &amp; sight path',
            'MPBR &amp; zero',
            'Trajectory events',
        ]) {
            expect(markup).toContain(label);
        }
    });

    it('disables load selection for the atmosphere-wide mode', () => {
        const markup = render('atmosphere');

        expect(markup).toMatch(/<select disabled=""><option/);
        expect(markup).toContain('Deterministic status text.');
    });

    it('uses the requested load when it exists and falls back to the first load otherwise', () => {
        expect(render('summary', 'custom:second')).toContain(
            '<option value="custom:second" selected="">Second</option>',
        );
        expect(render('summary', 'missing')).toContain(
            '<option value="builtin:fixture-rifle" selected="">Fixture</option>',
        );
    });
});
