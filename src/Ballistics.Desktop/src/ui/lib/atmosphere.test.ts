import { describe, expect, it } from 'vitest';
import {
    altimeterSettingToStationPressure,
    altitudeToPressure,
    densityToAltitude,
    pressureToAltitude,
    stationPressureToAltimeterSetting,
} from './atmosphere';

// These fixed reference values check the generated native/renderer ICAO conversions. Both
// implementations come from scripts/product/generate-atmosphere-conversions.mjs.
const relClose = (actual: number, expected: number, rel = 1e-9) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)));

describe('altitudeToPressure parity with C++ core', () => {
    const cases: [number, number][] = [
        [0, 1013.25],
        [500, 954.6094201448667],
        [1000, 898.7476493918435],
        [1500, 845.5628082684034],
        [2500, 746.8294471701664],
        [3000, 701.0901048906298],
        [5000, 540.2052508922242],
        [8000, 356.00483218291515],
        [11000, 226.32676011429288],
    ];
    it.each(cases)('altitude %d m → %f hPa', (altitude, pressure) => {
        relClose(altitudeToPressure(altitude), pressure);
    });

    it('supports standard-atmosphere pressure altitude below sea level', () => {
        relClose(altitudeToPressure(-1000), 1139.2884209588751);
    });

    it('clamps altitude above 11 km to the 11 km pressure', () => {
        relClose(altitudeToPressure(20000), 226.32676011429288);
    });
});

describe('pressureToAltitude parity with C++ core', () => {
    const cases: [number, number][] = [
        [1013.25, 0],
        [900, 988.5184002303411],
        [800, 1949.0235497100805],
        [700, 3012.2350069293493],
        [500, 5574.531437541877],
        [300, 9164.103830404816],
        [226, 11000],
    ];
    it.each(cases)('pressure %f hPa → altitude %f m', (pressure, altitude) => {
        relClose(pressureToAltitude(pressure), altitude);
    });
});

describe('altitude/pressure round trip', () => {
    it.each([-700, 0, 500, 1500, 3000, 6000, 10000])('round trips %d m', (altitude) => {
        relClose(pressureToAltitude(altitudeToPressure(altitude)), altitude, 1e-6);
    });
});

describe('explicit atmosphere semantics', () => {
    it('reduces an altimeter setting and field elevation to station pressure', () => {
        relClose(altimeterSettingToStationPressure(1013.25, 1500), 845.4724690949225);
        relClose(altimeterSettingToStationPressure(1000, 710), 918.5972730659638);
        relClose(stationPressureToAltimeterSetting(845.4724690949225, 1500), 1013.25);
    });

    it('maps standard-atmosphere density to density altitude', () => {
        relClose(densityToAltitude(1.2249781262066513), 0);
        relClose(densityToAltitude(1.0580519375349757), 1500);
    });
});
