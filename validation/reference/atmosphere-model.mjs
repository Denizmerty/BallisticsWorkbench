const dryAirGasConstant = 287.058;
const waterVaporGasConstant = 461.495;
const viscosityReferencePaS = 1.716e-5;
const viscosityReferenceK = 273.15;
const sutherlandConstantK = 110.333;
const carbonDioxideMoleFraction = 400e-6;

export function saturationVaporPressurePa(temperatureC) {
    const temperatureK = temperatureC + 273.15;
    return Math.exp(
        1.2811805e-5 * temperatureK ** 2 -
            1.9509874e-2 * temperatureK +
            34.04926034 -
            6.3536311e3 / temperatureK,
    );
}

export function cramerSoundSpeedMps(temperatureC, stationPressureHpa, relativeHumidityPercent) {
    const pressurePa = stationPressureHpa * 100;
    const enhancement = 1.00062 + 3.14e-8 * pressurePa + 5.6e-7 * temperatureC ** 2;
    const waterVaporMoleFraction = Math.min(
        0.99,
        Math.max(
            0,
            (relativeHumidityPercent / 100) *
                enhancement *
                (saturationVaporPressurePa(temperatureC) / pressurePa),
        ),
    );
    return (
        331.5024 +
        0.603055 * temperatureC -
        0.000528 * temperatureC ** 2 +
        (51.471935 + 0.1495874 * temperatureC - 0.000782 * temperatureC ** 2) *
            waterVaporMoleFraction +
        (-1.82e-7 + 3.73e-8 * temperatureC - 2.93e-10 * temperatureC ** 2) * pressurePa +
        (-85.20931 - 0.228525 * temperatureC + 5.91e-5 * temperatureC ** 2) *
            carbonDioxideMoleFraction -
        2.835149 * waterVaporMoleFraction ** 2 -
        2.15e-13 * pressurePa ** 2 +
        29.179762 * carbonDioxideMoleFraction ** 2 +
        0.000486 * waterVaporMoleFraction * pressurePa * carbonDioxideMoleFraction
    );
}

export function declaredAtmosphere(input) {
    const temperatureK = input.temperatureC + 273.15;
    const pressurePa = input.stationPressureHpa * 100;
    const densitySaturationPressurePa =
        610.94 * Math.exp((17.625 * input.temperatureC) / (input.temperatureC + 243.04));
    const vaporPressurePa = Math.min(
        (input.relativeHumidityPercent / 100) * densitySaturationPressurePa,
        0.99 * pressurePa,
    );
    const densityKgM3 =
        (pressurePa - vaporPressurePa) / (dryAirGasConstant * temperatureK) +
        vaporPressurePa / (waterVaporGasConstant * temperatureK);
    const speedOfSoundMps = cramerSoundSpeedMps(
        input.temperatureC,
        input.stationPressureHpa,
        input.relativeHumidityPercent,
    );
    const dynamicViscosityPaS =
        viscosityReferencePaS *
        (temperatureK / viscosityReferenceK) ** 1.5 *
        ((viscosityReferenceK + sutherlandConstantK) / (temperatureK + sutherlandConstantK));
    return { ...input, densityKgM3, speedOfSoundMps, dynamicViscosityPaS };
}
