import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Result } from '../types';
import { Workspace, type WorkspaceTab } from './Workspace';
import { fixtureInputs, fixtureLoad, fixtureResult } from './testFixtures';

function render(tab: WorkspaceTab, result: Result | null = fixtureResult()) {
    const load = result?.loads[0];
    return renderToStaticMarkup(
        createElement(Workspace, {
            tab,
            result,
            load,
            selectedLoadId: load?.id ?? null,
            statusMode: 'summary',
            statusLoadId: load?.id ?? null,
            inputs: fixtureInputs,
            units: 'metric',
            referenceDistanceM: 100,
            metric: 'energyJ',
            tableStep: 25,
            compareSort: { key: 'shortName', ascending: true },
            error: '',
            onTabChange: vi.fn(),
            onSelectedLoadId: vi.fn(),
            onStatusModeChange: vi.fn(),
            onStatusLoadId: vi.fn(),
            onMetricChange: vi.fn(),
            onReferenceDistanceChange: vi.fn(),
            onTableStepChange: vi.fn(),
            onCompareSort: vi.fn(),
        }),
    );
}

describe('Workspace', () => {
    it('owns the four accessible workspace routes and marks the current route', () => {
        const markup = render('overview');

        expect(markup).toContain('aria-label="Workspace views"');
        expect(markup).toMatch(/class="active"[^>]*title="Overview \(1\)"/);
        expect(markup).toContain('title="Range table (2)"');
        expect(markup).toContain('title="All-load calculator (3)"');
        expect(markup).toContain('title="Help (4)"');
    });

    it('coordinates load warnings, status text, and overview content', () => {
        const load = fixtureLoad();
        const result = fixtureResult(
            [load],
            [
                {
                    code: 'trajectory.partial',
                    field: 'loads[0].trajectory',
                    message: 'Trajectory coverage is partial.',
                    severity: 'warning',
                },
            ],
        );
        const markup = render('overview', result);

        expect(markup).toContain('Trajectory coverage is partial.');
        expect(markup).toContain('Selected load summary');
        expect(markup).toContain('Fixture rifle load');
        expect(markup).toContain('<h3>Trajectory</h3>');
    });

    it('routes table and comparison views through their focused components', () => {
        const table = render('table');
        const comparison = render('compare');

        expect(table).toContain('Range table');
        expect(table).toContain('table-wrap');
        expect(comparison).toContain('ALL LOADS AT 100 METRES');
        expect(comparison).toContain('calculator-table');
    });

    it('renders help independently of result availability', () => {
        const markup = render('notes', null);

        expect(markup).toContain('class="panel notes"');
        expect(markup).toContain('Ballistics Workbench');
    });

    it('keeps local failures visible while calculation data is absent', () => {
        const markup = renderToStaticMarkup(
            createElement(Workspace, {
                tab: 'overview',
                result: null,
                load: undefined,
                selectedLoadId: null,
                statusMode: 'atmosphere',
                statusLoadId: null,
                inputs: fixtureInputs,
                units: 'metric',
                referenceDistanceM: 100,
                metric: 'energyJ',
                tableStep: 25,
                compareSort: { key: 'shortName', ascending: true },
                error: 'Native engine unavailable.',
                onTabChange: vi.fn(),
                onSelectedLoadId: vi.fn(),
                onStatusModeChange: vi.fn(),
                onStatusLoadId: vi.fn(),
                onMetricChange: vi.fn(),
                onReferenceDistanceChange: vi.fn(),
                onTableStepChange: vi.fn(),
                onCompareSort: vi.fn(),
            }),
        );

        expect(markup).toContain('<div class="error">Native engine unavailable.</div>');
        expect(markup).not.toContain('<h3>Trajectory</h3>');
    });
});
