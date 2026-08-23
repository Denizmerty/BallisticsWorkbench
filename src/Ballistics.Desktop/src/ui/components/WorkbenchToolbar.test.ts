import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkbenchToolbar, type Theme } from './WorkbenchToolbar';
import type { UnitSystem } from '../types';

function render(
    options: {
        units?: UnitSystem;
        theme?: Theme;
        source?: 'builtIn' | 'custom';
        hasLoad?: boolean;
        canExport?: boolean;
        copied?: boolean;
    } = {},
) {
    return renderToStaticMarkup(
        createElement(WorkbenchToolbar, {
            units: options.units ?? 'metric',
            theme: options.theme ?? 'light',
            selectedLoadSource: options.source,
            hasSelectedLoad: options.hasLoad ?? true,
            canExport: options.canExport ?? true,
            copied: options.copied ?? false,
            onOpenProfiles: vi.fn(),
            onNewLoad: vi.fn(),
            onEditLoad: vi.fn(),
            onRemoveLoad: vi.fn(),
            onCopySummary: vi.fn(),
            onExportCsv: vi.fn(),
            onUnitsChange: vi.fn(),
            onThemeChange: vi.fn(),
        }),
    );
}

describe('WorkbenchToolbar', () => {
    it('keeps custom-load mutation actions disabled for built-in loads', () => {
        const markup = render({ source: 'builtIn' });

        expect(markup).toMatch(/disabled="">Edit load…/);
        expect(markup).toMatch(/disabled="">Remove load/);
        expect(markup).toContain('Copy summary');
    });

    it('enables custom-load mutation actions for custom loads', () => {
        const markup = render({ source: 'custom' });

        expect(markup).not.toMatch(/disabled="">Edit load…/);
        expect(markup).not.toMatch(/disabled="">Remove load/);
    });

    it('disables result actions independently from editing actions', () => {
        const markup = render({ source: 'custom', hasLoad: false, canExport: false });

        expect(markup).toMatch(/disabled=""[^>]*title="Copy the selected load/);
        expect(markup).toMatch(/disabled="">Export CSV/);
        expect(markup).not.toMatch(/disabled="">Edit load…/);
    });

    it('reflects copied state and active metric/light choices', () => {
        const markup = render({ copied: true });

        expect(markup).toContain('>Copied</button>');
        expect(markup).toContain('class="active">Metric</button>');
        expect(markup).toContain('class="active">Light</button>');
    });

    it('reflects active imperial/dark choices', () => {
        const markup = render({ units: 'imperial', theme: 'dark' });

        expect(markup).toContain('class="active">Imperial</button>');
        expect(markup).toContain('class="active">Dark</button>');
    });

    it('exposes labelled segmented controls', () => {
        const markup = render();

        expect(markup).toContain('role="group" aria-label="Units"');
        expect(markup).toContain('role="group" aria-label="Theme"');
        expect(markup).toContain('title="Ctrl+Shift+P"');
    });
});
