#include <cmath>
#include <cstdlib>
#include <iostream>
#include <string>

#include "ballistics.hpp"

namespace {

void expect_near(const std::string& label, double actual, double expected, double tolerance) {
  if (std::abs(actual - expected) > tolerance) {
    std::cerr << label << ": expected " << expected << ", got " << actual << '\n';
    std::exit(1);
  }
}

void expect_true(const std::string& label, bool condition) {
  if (!condition) {
    std::cerr << label << " failed\n";
    std::exit(1);
  }
}

}  // namespace

int main() {
  using namespace ballistics;

  const auto atmosphere = Atmosphere::create(15, 1013.25, 50, 0);

  expect_near("density", atmosphere.density_kg_m3, 1.221089389807009, 1e-12);
  expect_near("sound", atmosphere.speed_of_sound_mps, 340.83846067191473, 1e-10);
  expect_near("viscosity", atmosphere.dynamic_viscosity_pa_s, 1.7892858603596875e-5, 1e-15);

  const double expected_speed_100[] = {294.4126452116605, 287.82471287376137, 307.582569059057,
                                       761.0144413790775, 764.1591845711127,  211.88441132917924};

  const double expected_drop_100[] = {0.26597801883977995, 0.35457546671437823, 0.27087045737130483,
                                      0.07629548653537882, 0.07182604401974066, 0.5268220808230336};

  const double expected_speed_500[] = {46.62767660594853, 79.92420066634183,  80.6899372499263,
                                       540.2585405559449, 448.06427898255066, 46.06934161249834};

  const double expected_drop_500[] = {49.36844943802232, 37.0216021776391,  33.375602965856686,
                                      2.413733411587102, 2.619311433419594, 88.91242069049834};

  const auto& loads = built_in_projectiles();

  for (std::size_t i = 0; i < loads.size(); ++i) {
    const auto trajectory = integrate_trajectory(loads[i], atmosphere, 500);

    const auto point = trajectory.point_at(100);
    expect_near(loads[i].short_name + " speed", point.speed_mps, expected_speed_100[i], 2e-6);
    expect_near(loads[i].short_name + " drop", point.drop_m, expected_drop_100[i], 2e-8);

    const auto distant = trajectory.point_at(500);
    expect_near(loads[i].short_name + " 500m speed", distant.speed_mps, expected_speed_500[i],
                3e-4);
    expect_near(loads[i].short_name + " 500m drop", distant.drop_m, expected_drop_500[i], 3e-4);
  }

  const auto rifle = integrate_trajectory(loads[3], atmosphere, 500);
  const auto [zero, mpbr] = compute_mpbr(rifle, 0.20, 0.04);

  expect_near("rifle zero", zero, 233.0252551761276, 2e-6);
  expect_near("rifle mpbr", mpbr, 274.060967043279, 2e-6);

  struct Scenario {
    const char* name;
    double temperature;
    double pressure;
    double humidity;
    double wind;
    double density;
    double sound;
    double viscosity;
    double speeds[3];
    double drops[3];
    double times[3];
  };

  const Scenario scenarios[] = {{"cold dense",
                                 -20,
                                 1080,
                                 10,
                                 8,
                                 1.4861308513295794,
                                 318.96818750305005,
                                 1.6152672443407784e-5,
                                 {159.64381335569877, 735.7103414778775, 126.36738764464664},
                                 {1.079309658473966, 0.16899715846371835, 2.0945266601022183},
                                 {0.5550394423066425, 0.18998505470195184, 0.7560995315640359}},
                                {"hot high",
                                 40,
                                 700,
                                 90,
                                 -5,
                                 0.7508018322434107,
                                 361.28537039752183,
                                 1.907454712187927e-5,
                                 {313.2374378663546, 788.5432110083799, 227.63257795954956},
                                 {0.5896675905414436, 0.16113747675884038, 1.1344883214187609},
                                 {0.37947273192408293, 0.18347818892606094, 0.5228150829140547}}};

  const std::size_t scenario_loads[] = {0, 3, 5};

  for (const auto& scenario : scenarios) {
    const auto air = Atmosphere::create(scenario.temperature, scenario.pressure, scenario.humidity,
                                        scenario.wind);

    const std::string name_prefix = std::string(scenario.name);

    expect_near(name_prefix + " density", air.density_kg_m3, scenario.density, 2e-12);
    expect_near(name_prefix + " sound", air.speed_of_sound_mps, scenario.sound, 2e-10);
    expect_near(name_prefix + " viscosity", air.dynamic_viscosity_pa_s, scenario.viscosity, 2e-15);

    for (std::size_t i = 0; i < 3; ++i) {
      const auto multiplier = (scenario_loads[i] == 3) ? 1.03 : 0.97;
      const auto& load = loads[scenario_loads[i]];

      const auto trajectory = integrate_trajectory(load, air, 300, multiplier);
      const auto point = trajectory.point_at(150);
      const auto prefix = name_prefix + " " + load.short_name;

      expect_near(prefix + " speed", point.speed_mps, scenario.speeds[i], 3e-6);
      expect_near(prefix + " drop", point.drop_m, scenario.drops[i], 3e-8);
      expect_near(prefix + " time", point.time_s, scenario.times[i], 3e-9);

      expect_near(prefix + " energy identity", point.energy_j,
                  0.5 * load.mass_kg * point.speed_mps * point.speed_mps, 1e-9);

      expect_near(prefix + " momentum identity", point.momentum_kgms,
                  load.mass_kg * point.speed_mps, 1e-12);

      expect_true(prefix + " complete range", std::abs(trajectory.distances.back() - 300) < 1e-9);

      for (std::size_t j = 1; j < trajectory.distances.size(); ++j) {
        expect_true(prefix + " increasing distance",
                    trajectory.distances[j] > trajectory.distances[j - 1]);

        expect_true(prefix + " finite values", std::isfinite(trajectory.speeds[j]) &&
                                                   std::isfinite(trajectory.drops[j]) &&
                                                   std::isfinite(trajectory.times[j]));
      }
    }
  }

  expect_near("sea-level altitude pressure", altitude_to_pressure_hpa(0), 1013.25, 1e-12);

  for (const double altitude : {0.0, 500.0, 1500.0, 3000.0, 6000.0, 10000.0}) {
    expect_near("altitude pressure round trip",
                pressure_to_altitude_m(altitude_to_pressure_hpa(altitude)), altitude, 2e-9);
  }

  const auto sphere_diagnostics = aerodynamic_diagnostics(loads[5], 300, atmosphere);
  expect_true("sphere diagnostics available", sphere_diagnostics.has_sphere_data &&
                                                  sphere_diagnostics.cd > 0 &&
                                                  sphere_diagnostics.reynolds > 0);

  expect_true("G7 diagnostics omit sphere values",
              !aerodynamic_diagnostics(loads[3], 800, atmosphere).has_sphere_data);

  const auto spin_right =
      compute_spin_drift_m(loads[3], 0.5, 10, loads[3].muzzle_velocity_mps, atmosphere, 1);
  const auto spin_left =
      compute_spin_drift_m(loads[3], 0.5, 10, loads[3].muzzle_velocity_mps, atmosphere, -1);

  expect_near("spin direction symmetry", spin_right, -spin_left, 1e-15);

  // Crosswind wind drift (full 3D integration).
  {
    const auto calm = Atmosphere::create(15, 1013.25, 50, 0, 0);
    const auto calm_traj = integrate_trajectory(loads[3], calm, 500);
    expect_near("no crosswind means no drift at 100", calm_traj.point_at(100).wind_drift_m, 0.0,
                1e-15);
    expect_near("no crosswind means no drift at 500", calm_traj.point_at(500).wind_drift_m, 0.0,
                1e-15);

    const auto right = Atmosphere::create(15, 1013.25, 50, 0, 5);
    const auto left = Atmosphere::create(15, 1013.25, 50, 0, -5);
    const auto right_traj = integrate_trajectory(loads[3], right, 500);
    const auto left_traj = integrate_trajectory(loads[3], left, 500);

    const auto drift_300 = right_traj.point_at(300).wind_drift_m;
    expect_true("positive crosswind drifts right", drift_300 > 0.0);
    expect_near("crosswind sign symmetry", drift_300, -left_traj.point_at(300).wind_drift_m, 1e-12);

    // Drift grows monotonically downrange.
    expect_true("drift increases with range",
                right_traj.point_at(500).wind_drift_m > drift_300 &&
                    drift_300 > right_traj.point_at(100).wind_drift_m);

    // Small-angle crosswind is very nearly linear in wind speed.
    const auto right_ten = Atmosphere::create(15, 1013.25, 50, 0, 10);
    const auto drift_10 = integrate_trajectory(loads[3], right_ten, 500).point_at(300).wind_drift_m;
    expect_near("drift is linear in wind speed", drift_10, 2.0 * drift_300, 0.02 * drift_10);

    // Cross-check against the independent point-mass "lag time" model:
    // drift ~= crosswind * (time_of_flight - range / muzzle_velocity).
    const auto tof = right_traj.point_at(300).time_s;
    const auto lag_drift = 5.0 * (tof - 300.0 / loads[3].muzzle_velocity_mps);
    expect_true("integrated drift agrees with lag-time model",
                std::abs(drift_300 - lag_drift) / drift_300 < 0.15);
  }

  std::cout << "All C++ numerical regression tests passed.\n";
}