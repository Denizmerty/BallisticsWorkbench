const temperaturesC = [-60, -40, -20, 0, 15, 20, 40, 60];

const rankinePerKelvin = 9 / 5;
const poundForceSecondPerSquareFootToPascalSecond = 47.88025898033584;

function naca1135SutherlandViscosity(temperatureC) {
    const temperatureRankine = (temperatureC + 273.15) * rankinePerKelvin;
    const viscosityImperial = (2.27e-8 * temperatureRankine ** 1.5) / (temperatureRankine + 198.6);
    return viscosityImperial * poundForceSecondPerSquareFootToPascalSecond;
}

const rows = temperaturesC.map((temperatureC) =>
    [temperatureC.toFixed(2), naca1135SutherlandViscosity(temperatureC).toFixed(15)].join(','),
);

process.stdout.write(['temperature_c,dynamic_viscosity_pa_s', ...rows, ''].join('\n'));
