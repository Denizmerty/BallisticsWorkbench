import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Inputs, UncertaintySettings } from '../types';
import { defaultInputs } from '../lib/workbenchDefaults';
import { InputSidebar } from './InputSidebar';

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
    crosswindMps: 3,
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

const uncertainty: UncertaintySettings = {
    enabled: false,
    method: 'firstOrder',
    sampleCount: 1000,
    seed: 1113017667,
    correlations: [],
    shotgunMuzzleVelocityStandardDeviationMps: 3,
    rifleMuzzleVelocityStandardDeviationMps: 3,
    dragRelativeStandardDeviation: 0.03,
    temperatureStandardDeviationC: 1,
    stationPressureStandardDeviationHpa: 2,
    headwindStandardDeviationMps: 1,
    crosswindStandardDeviationMps: 1,
    shotgunZeroRangeStandardDeviationM: 1,
    rifleZeroRangeStandardDeviationM: 1,
};

function render(
    inputOverrides: Partial<Inputs> = {},
    uncertaintyOverrides: Partial<UncertaintySettings> = {},
    imperial = false,
) {
    return renderToStaticMarkup(
        createElement(InputSidebar, {
            inputs: { ...inputs, ...inputOverrides },
            uncertainty: { ...uncertainty, ...uncertaintyOverrides },
            imperial,
            densityAltitudeM: 420,
            shotgunLoads: [],
            setInputs: vi.fn(),
            setUncertainty: vi.fn(),
            onResetAtmosphere: vi.fn(),
            onResetAll: vi.fn(),
        }),
    );
}

describe('InputSidebar', () => {
    it('renders measured station-pressure controls and derived atmosphere values', () => {
        const markup = render();

        expect(markup).toContain('Environment');
        expect(markup).toContain('Measured station pressure');
        expect(markup).toContain('Station pressure');
        expect(markup).toContain('Resolved station pressure:');
        expect(markup).toContain('Density altitude:');
        expect(markup).toContain('420 m');
        expect(markup).not.toContain('Field elevation');
    });

    it('renders the pressure-altitude input only for that source', () => {
        const markup = render({ pressureSource: 'pressureAltitude', pressureAltitudeM: 850 });

        expect(markup).toContain('Pressure altitude');
        expect(markup).not.toContain('Station pressure</span>');
        expect(markup).not.toContain('Field elevation');
    });

    it('renders field elevation and altimeter setting together', () => {
        const markup = render({
            pressureSource: 'altimeterSetting',
            geometricAltitudeM: 250,
            altimeterSettingHpa: 1020,
        });

        expect(markup).toContain('Field elevation');
        expect(markup).toContain('Altimeter setting');
    });

    it('keeps detailed uncertainty fields hidden until enabled', () => {
        expect(render()).not.toContain('Shotgun MV SD');

        const enabled = render({}, { enabled: true });
        expect(enabled).toContain('Shotgun MV SD');
        expect(enabled).toContain('Rifle MV SD');
        expect(enabled).toContain('BC / drag SD');
        expect(enabled).toContain('Inputs are one-sigma values');
    });

    it('converts visible labels to US customary units', () => {
        const markup = render({}, { enabled: true }, true);

        expect(markup).toContain('US');
        expect(markup).toContain('yd');
        expect(markup).toContain('°F');
        expect(markup).toContain('inHg');
        expect(markup).toContain('mph');
        expect(markup).toContain('ft/s');
    });

    it('renders current validation errors and both reset actions', () => {
        const markup = render({ distanceM: -1, humidityPercent: 101 });

        expect(markup).toContain('Range (m) must be between 0 and 2000.');
        expect(markup).toContain('Humidity (%) must be between 0 and 100.');
        expect(markup).toContain('Reset atmosphere');
        expect(markup).toContain('Reset all');
    });
});
