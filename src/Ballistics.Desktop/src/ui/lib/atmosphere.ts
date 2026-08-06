// Mirrors ballistics::altitude_to_pressure_hpa / pressure_to_altitude_m in
// Ballistics.Core. The exponent is derived from the same physical constants as
// the C++ icao_exp (gravity · molar mass / (gas constant · lapse rate)) so the
// UI helper stays in lockstep with the numerical engine. The parity test in
// atmosphere.test.ts pins both directions to the C++ output.
const ICAO_T0 = 288.15;
const ICAO_LAPSE = 0.0065;
const ICAO_EXP = (9.80665 * 0.0289644) / (8.31447 * ICAO_LAPSE);

export const altitudeToPressure = (altitudeM: number) =>
  1013.25 *
  Math.pow(1 - (ICAO_LAPSE * Math.max(0, Math.min(11000, altitudeM))) / ICAO_T0, ICAO_EXP);

export const pressureToAltitude = (pressureHpa: number) =>
  (ICAO_T0 / ICAO_LAPSE) *
  (1 - Math.pow(Math.max(226, Math.min(1013.25, pressureHpa)) / 1013.25, 1 / ICAO_EXP));
