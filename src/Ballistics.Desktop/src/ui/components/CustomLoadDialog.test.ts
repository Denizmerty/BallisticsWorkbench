import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CustomDraft, Inputs } from '../types';
import { defaultInputs } from '../lib/workbenchDefaults';
import { CustomLoadDialog } from './CustomLoadDialog';

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
    crosswindMps: 0,
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

const baseDraft: CustomDraft = {
    id: 'custom:test',
    name: 'Test load',
    drag: 'G7',
    group: 'rifle',
    massG: 10.886,
    mv: 823,
    bc: 0.475,
    bcMode: 'constant',
    bcBands: [
        { minimumVelocityMps: 0, ballisticCoefficient: 0.4 },
        { minimumVelocityMps: 400, ballisticCoefficient: 0.45 },
    ],
    machCdDiameterMm: 7.82,
    machCdPoints: [
        { mach: 0, dragCoefficient: 0.24 },
        { mach: 1, dragCoefficient: 0.42 },
    ],
    dragDataMetadata: {
        citation: 'Test data',
        sourceUrl: '',
        license: 'Test only',
        sourceChecksumSha256: '',
        domainMinimum: null,
        domainMaximum: null,
    },
    sphereMm: 8.382,
    density: 11340,
    count: 1,
    length: 1.2,
    diameter: 0.308,
    twist: 8,
};

function render(draft: CustomDraft, options: { imperial?: boolean; errors?: string[] } = {}) {
    return renderToStaticMarkup(
        createElement(CustomLoadDialog, {
            draft,
            inputs,
            imperial: options.imperial ?? false,
            errors: options.errors ?? [],
            editing: false,
            transferNotice: '',
            onChange: vi.fn(),
            onImportDragData: vi.fn(),
            onExportDragData: vi.fn(),
            onCancel: vi.fn(),
            onSave: vi.fn(),
        }),
    );
}

describe('CustomLoadDialog', () => {
    it('renders an accessible dialog with the reference-BC editor', () => {
        const markup = render(baseDraft);

        expect(markup).toContain('role="dialog"');
        expect(markup).toContain('aria-modal="true"');
        expect(markup).toContain('Custom projectile');
        expect(markup).toContain('Ballistic coefficient');
        expect(markup).toContain('Fit G1/G7 BC from measured velocities');
        expect(markup).toContain('Portable drag data');
        expect(markup).toContain('Source, license, and declared domain');
        expect(markup).toContain('Add custom load');
    });

    it('renders velocity-band controls and protects the zero band', () => {
        const markup = render({ ...baseDraft, bcMode: 'velocityBands' });

        expect(markup).toContain('Minimum velocity (m/s)');
        expect(markup).toContain('aria-label="BC band 1 minimum velocity"');
        expect(markup).toContain('Add BC band');
        expect(markup).toContain('disabled=""');
    });

    it('renders Mach-Cd knots and the endpoint extrapolation explanation', () => {
        const markup = render({ ...baseDraft, drag: 'MachCd' });

        expect(markup).toContain('Drag reference diameter (mm)');
        expect(markup).toContain('aria-label="Mach–Cd point 1 Mach"');
        expect(markup).toContain('Add Mach–Cd point');
        expect(markup).toContain('nearest endpoint Cd is used');
        expect(markup).not.toContain('Fit G1/G7 BC from measured velocities');
    });

    it('renders derived sphere mass and omits reference-BC inputs', () => {
        const markup = render({ ...baseDraft, drag: 'Sphere', group: 'shotgun' });

        expect(markup).toContain('Sphere diameter (mm)');
        expect(markup).toContain('Material density (kg/m³)');
        expect(markup).toContain('Derived mass per pellet:');
        expect(markup).toContain('Sphere mass is derived from diameter and density');
        expect(markup).not.toContain('Projectile mass');
        expect(markup).not.toContain('Ballistic coefficient');
        expect(markup).toMatch(/Export…<\/button>/);
    });

    it('converts visible values and labels to imperial units', () => {
        const markup = render({ ...baseDraft, drag: 'Sphere' }, { imperial: true });

        expect(markup).toContain('Muzzle velocity (ft/s)');
        expect(markup).toContain('Sphere diameter (in)');
        expect(markup).toContain('gr');
    });

    it('surfaces every validation error and disables saving', () => {
        const markup = render(baseDraft, {
            errors: ['Name is required.', 'Ballistic coefficient is out of range.'],
        });

        expect(markup).toContain('role="alert"');
        expect(markup).toContain('Name is required.');
        expect(markup).toContain('Ballistic coefficient is out of range.');
        expect(markup).toMatch(/class="primary" disabled=""/);
    });
});
