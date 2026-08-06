#pragma once

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace ballistics {

enum class DragModel { g1, g7, sphere };

enum class FirearmGroup { shotgun, rifle };

struct Projectile {
  std::string name;
  std::string short_name;
  double mass_kg{};
  double muzzle_velocity_mps{};
  double ballistic_coefficient{};
  std::string bc_kind;
  DragModel drag_model{DragModel::g1};
  FirearmGroup firearm_group{FirearmGroup::shotgun};
  double twist_rate_inches{};
  double bullet_length_inches{};
  double bullet_diameter_inches{};
  double sphere_diameter_m{};
  double material_density_kg_m3{};
  int pellet_count{1};
  bool is_custom{};

  [[nodiscard]] double payload_mass_kg() const;
};

struct Atmosphere {
  double temperature_c{};
  double station_pressure_hpa{};
  double relative_humidity_percent{};
  double headwind_mps{};
  double density_kg_m3{};
  double speed_of_sound_mps{};
  double dynamic_viscosity_pa_s{};

  [[nodiscard]] static Atmosphere create(double temperature_c, double station_pressure_hpa,
                                         double relative_humidity_percent, double headwind_mps);
};

struct BallisticPoint {
  double distance_m{};
  double speed_mps{};
  double energy_j{};
  double momentum_kgms{};
  double time_s{};
  double drop_m{};
};

struct AerodynamicDiagnostics {
  double cd{};
  double reynolds{};
  double mach{};
  bool has_sphere_data{};
};

struct Trajectory {
  std::vector<double> distances;
  std::vector<double> speeds;
  std::vector<double> energies;
  std::vector<double> momenta;
  std::vector<double> times;
  std::vector<double> drops;
  double mass_kg{};

  [[nodiscard]] BallisticPoint point_at(double distance_m) const;
};

inline constexpr double gravity_mps2 = 9.80665;
inline constexpr double fps_to_mps = 0.3048;
inline constexpr double inches_to_m = 0.0254;
inline constexpr double grains_to_kg = 0.00006479891;

[[nodiscard]] double altitude_to_pressure_hpa(double altitude_m);

[[nodiscard]] double pressure_to_altitude_m(double pressure_hpa);

[[nodiscard]] double sphere_drag_vs_reynolds(double reynolds);

[[nodiscard]] double drag_retardation_mps2(double relative_speed_mps, const Projectile& projectile,
                                           const Atmosphere& atmosphere);

[[nodiscard]] AerodynamicDiagnostics aerodynamic_diagnostics(const Projectile& projectile,
                                                             double speed_mps,
                                                             const Atmosphere& atmosphere);

[[nodiscard]] Trajectory integrate_trajectory(const Projectile& projectile,
                                              const Atmosphere& atmosphere,
                                              double maximum_distance_m,
                                              double muzzle_velocity_multiplier = 1.0,
                                              double dx_m = 0.25);

[[nodiscard]] std::pair<double, double> compute_mpbr(const Trajectory& trajectory,
                                                     double vital_zone_m,
                                                     double sight_height_m = 0.0);

[[nodiscard]] double compute_spin_drift_m(const Projectile& projectile, double time_of_flight_s,
                                          double twist_rate_inches, double muzzle_velocity_mps,
                                          const Atmosphere& atmosphere,
                                          int twist_direction_sign = 1);

[[nodiscard]] const std::vector<Projectile>& built_in_projectiles();

}  // namespace ballistics