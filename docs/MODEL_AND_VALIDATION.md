# Model and Validation

## Scope

Ballistics Workbench calculates point-mass external trajectories for G1, G7, and spherical
projectiles. It reports velocity, energy, momentum, flight time, vertical displacement, Mach
number, maximum point-blank range, optimized zero, and an empirical rifle spin-drift estimate.

The engine integrates each trajectory numerically. It does not interpolate a precomputed range
card.

## Atmosphere

The atmosphere model derives moist-air density, dynamic viscosity, and local speed of sound from:

- temperature;
- station pressure;
- relative humidity; and
- headwind or tailwind.

Pressure and altitude controls are synchronized using the ICAO troposphere relationship. Wind is
applied through air-relative projectile velocity.

## Drag models

### G1

The G1 implementation uses the piecewise Ingalls/Mayevski retardation law. The built-in shotgun
slugs and .308 Winchester loads use G1 ballistic coefficients.

### G7

The G7 implementation uses a Mach-indexed reference drag-coefficient table with linear
interpolation. G7 is available for custom projectiles; none of the built-in loads uses it.

### Sphere

Spherical projectiles use Morrison's Reynolds-dependent smooth-sphere drag correlation with a
Collins transonic correction fitted to Miller–Bailey sphere-drag data. Drag coefficient and
Reynolds number are reported for spherical loads at each range point.

The built-in 00-buck load models an isolated 0.330-inch pure-lead pellet. Pellet deformation,
pellet-to-pellet interaction, buffering, and pattern spread are outside the model.

## Trajectory integration

The engine advances a shared point-mass state with fourth-order Runge–Kutta integration in
horizontal distance. Gravity and aerodynamic deceleration are evaluated within each integration
step. Kinetic energy and momentum are derived from the integrated velocity.

For multi-projectile payloads, the reported payload energy and momentum are scalar arithmetic
totals:

```text
payload value = one-projectile value × payload count
```

The total does not imply that separate pellets travel or transfer energy as one solid projectile.

## Maximum point-blank range

The maximum point-blank range calculation includes:

- the selected vital-zone diameter;
- bore-to-sight offset for the applicable firearm profile;
- gravity; and
- aerodynamic drag.

The optimized zero is selected so that the calculated trajectory remains within one-half of the
vital-zone diameter for the greatest possible distance.

## Spin drift

Rifle spin drift uses a Miller stability estimate with velocity and air-density corrections,
followed by the Litz empirical time-of-flight relationship. Twist rate and direction belong to the
rifle profile. A custom rifle projectile may supply its own twist-rate override.

Positive drift indicates rightward displacement for right-hand twist. The result is an empirical
estimate, not a six-degree-of-freedom calculation.

## Built-in load data

| Load                  |                Mass | Muzzle velocity | Drag data         | Notes                                          |
| --------------------- | ------------------: | --------------: | ----------------- | ---------------------------------------------- |
| White Blackout HV     |                28 g |         575 m/s | G1 BC 0.054522843 | Effective BC fitted to 33 m and 50 m data      |
| BlackShock            |                32 g |         455 m/s | G1 BC 0.070985785 | Effective BC fitted to 33 m data               |
| Winchester X123RS15   |                1 oz |      1,760 ft/s | G1 BC 0.068       | Manufacturer-published BC                      |
| Hornady A-MAX         |              168 gr |      2,700 ft/s | G1 BC 0.475       | Manufacturer BC; 24-inch test barrel           |
| Federal Power-Shok SP |              150 gr |      2,820 ft/s | G1 BC 0.313       | Effective BC fitted to published velocity data |
| Winchester 00 buck    | 53.96 gr per pellet |      1,325 ft/s | Sphere            | Nine nominal 0.330-inch lead pellets           |

The native regression suite covers atmospheric properties, drag behavior, reference velocity
points, maximum point-blank range, spin drift, and sphere diagnostics. Sphere integration has also
been compared with an independent adaptive-RK4 implementation under matched dry-air conditions.

## Limitations

The calculation is a point-mass engineering model rather than CFD or a six-degree-of-freedom
simulation. It does not explicitly solve:

- launch yaw or aerodynamic jump;
- choke interaction or projectile deformation;
- pellet-to-pellet aerodynamic interaction or pattern spread;
- true crosswind drift or Coriolis effect; or
- dynamic instability.

Slug coefficients are fitted from limited measurements, and uncertainty increases outside the
measured range and during transonic flight. Always confirm calculated results with real-world
chronographing and zeroing.
