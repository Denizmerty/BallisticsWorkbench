import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkbenchStatusBar } from './WorkbenchStatusBar';
import { fixtureInputs, fixtureLoad, fixtureResult } from './testFixtures';

describe('WorkbenchStatusBar', () => {
    it('renders an explicit empty state without a result', () => {
        const markup = renderToStaticMarkup(
            createElement(WorkbenchStatusBar, {
                engineState: 'Calculating',
                engineClass: 'busy',
                result: null,
                load: undefined,
                inputs: fixtureInputs,
                units: 'metric',
                referenceDistanceM: 50,
            }),
        );

        expect(markup).toContain('aria-label="Workbench status"');
        expect(markup).toContain('class="ind busy"');
        expect(markup).toContain('Calculating');
        expect(markup).toContain('<b>N/A</b>');
    });

    it('shows atmosphere, selection, range, units, and engine/model identity', () => {
        const load = fixtureLoad();
        const result = fixtureResult([load]);
        const markup = renderToStaticMarkup(
            createElement(WorkbenchStatusBar, {
                engineState: 'Ready',
                engineClass: '',
                result,
                load,
                inputs: fixtureInputs,
                units: 'metric',
                referenceDistanceM: 50,
            }),
        );

        expect(markup).toContain('1.2210 kg/m³');
        expect(markup).toContain('340.3 m/s');
        expect(markup).toContain('<b>Fixture</b>');
        expect(markup).toContain('<b>50.0 m</b>');
        expect(markup).toContain('<b>100 m</b>');
        expect(markup).toContain(`Engine ${result.engineVersion}. Model ${result.modelVersion}`);
        expect(markup).toContain('<span class="seg-item">SI</span>');
    });

    it('converts both reference and configured ranges in imperial mode', () => {
        const load = fixtureLoad();
        const markup = renderToStaticMarkup(
            createElement(WorkbenchStatusBar, {
                engineState: 'Results stale',
                engineClass: 'err',
                result: fixtureResult([load]),
                load,
                inputs: fixtureInputs,
                units: 'imperial',
                referenceDistanceM: 50,
            }),
        );

        expect(markup).toContain('<b>54.7 yd</b>');
        expect(markup).toContain('<b>109 yd</b>');
        expect(markup).toContain('<span class="seg-item">US</span>');
    });
});
