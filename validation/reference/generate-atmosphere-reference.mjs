const gasConstant = 8.314472;
const molarMassDryAir = 28.96546e-3;
const molarMassWater = 18.01528e-3;

const cases = [
    [15, 600, 0],
    [15, 1013.25, 0],
    [15, 1013.25, 50],
    [15, 1013.25, 100],
    [20, 850, 50],
    [20, 1100, 100],
    [27, 600, 0],
    [27, 600, 100],
    [27, 1100, 50],
];

function saturationVaporPressurePa(temperatureK) {
    const A = 1.2378847e-5;
    const B = -1.9121316e-2;
    const C = 33.93711047;
    const D = -6.3431645e3;
    return Math.exp(A * temperatureK ** 2 + B * temperatureK + C + D / temperatureK);
}

function enhancementFactor(temperatureC, pressurePa) {
    const alpha = 1.00062;
    const beta = 3.14e-8;
    const gamma = 5.6e-7;
    return alpha + beta * pressurePa + gamma * temperatureC ** 2;
}

function compressibilityFactor(temperatureC, temperatureK, pressurePa, vaporMoleFraction) {
    const a0 = 1.58123e-6;
    const a1 = -2.9331e-8;
    const a2 = 1.1043e-10;
    const b0 = 5.707e-6;
    const b1 = -2.051e-8;
    const c0 = 1.9898e-4;
    const c1 = -2.376e-6;
    const d = 1.83e-11;
    const e = -0.765e-8;
    const firstOrder =
        a0 +
        a1 * temperatureC +
        a2 * temperatureC ** 2 +
        (b0 + b1 * temperatureC) * vaporMoleFraction +
        (c0 + c1 * temperatureC) * vaporMoleFraction ** 2;
    const secondOrder = d + e * vaporMoleFraction ** 2;
    return (
        1 -
        (pressurePa / temperatureK) * firstOrder +
        (pressurePa ** 2 / temperatureK ** 2) * secondOrder
    );
}

function cipmDensity(temperatureC, stationPressureHpa, relativeHumidityPercent) {
    const temperatureK = temperatureC + 273.15;
    const pressurePa = stationPressureHpa * 100;
    const relativeHumidity = relativeHumidityPercent / 100;
    const vaporMoleFraction =
        (relativeHumidity *
            enhancementFactor(temperatureC, pressurePa) *
            saturationVaporPressurePa(temperatureK)) /
        pressurePa;
    const compressibility = compressibilityFactor(
        temperatureC,
        temperatureK,
        pressurePa,
        vaporMoleFraction,
    );
    const density =
        ((pressurePa * molarMassDryAir) / (compressibility * gasConstant * temperatureK)) *
        (1 - vaporMoleFraction * (1 - molarMassWater / molarMassDryAir));
    return { density, compressibility, vaporMoleFraction };
}

const rows = cases.map(([temperatureC, stationPressureHpa, relativeHumidityPercent]) => {
    const result = cipmDensity(temperatureC, stationPressureHpa, relativeHumidityPercent);
    return [
        temperatureC.toFixed(2),
        stationPressureHpa.toFixed(2),
        relativeHumidityPercent.toFixed(2),
        '0.000400000000',
        result.density.toFixed(12),
        result.compressibility.toFixed(12),
        result.vaporMoleFraction.toFixed(12),
    ].join(',');
});

process.stdout.write(
    [
        'temperature_c,station_pressure_hpa,relative_humidity_percent,co2_mole_fraction,density_kg_m3,compressibility_factor,water_vapor_mole_fraction',
        ...rows,
        '',
    ].join('\n'),
);
