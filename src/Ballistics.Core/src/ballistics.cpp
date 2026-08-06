#include "ballistics.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace ballistics {
namespace {

constexpr double r_dry = 287.058;
constexpr double r_vapor = 461.495;
constexpr double gamma_air = 1.4;
constexpr double rho_std = 1.225;
constexpr double a_std = 340.294;
constexpr double mps_to_fps = 3.280839895013123;
constexpr double lb_to_kg = 0.45359237;
constexpr double mu_ref = 1.716e-5;
constexpr double temp_ref = 273.15;
constexpr double sutherland_c = 110.333;
constexpr double icao_t0 = 288.15;
constexpr double icao_p0 = 1013.25;
constexpr double icao_lapse = 0.0065;
constexpr double icao_exp = gravity_mps2 * 0.0289644 / (8.31447 * icao_lapse);
constexpr double pi = 3.1415926535897932384626433832795;
constexpr double k_cd_ref = rho_std * (pi / 4.0) * inches_to_m * inches_to_m / (2.0 * lb_to_kg);

struct G1Band {
  double threshold;
  double coefficient;
  double exponent;
};

constexpr std::array<G1Band, 40> g1_table{
    {{4230, 1.477404177730177e-4, 1.9565}, {3680, 1.920339268755614e-4, 1.925},
     {3450, 2.894751026819746e-4, 1.875},  {3295, 4.349905111115636e-4, 1.825},
     {3130, 6.520421871892662e-4, 1.775},  {2960, 9.748073985e-4, 1.725},
     {2830, 1.453721560286e-3, 1.675},     {2680, 2.162887202930376e-3, 1.625},
     {2460, 3.209559783129881e-3, 1.575},  {2225, 3.904368218691249e-3, 1.55},
     {2015, 3.222942271262614e-3, 1.575},  {1890, 2.203329542809e-3, 1.625},
     {1810, 1.511001028891904e-3, 1.675},  {1730, 8.609957592468259e-4, 1.75},
     {1595, 4.086146797305117e-4, 1.85},   {1520, 1.954473210037398e-4, 1.95},
     {1420, 5.431896266462351e-5, 2.125},  {1360, 8.847742581674416e-6, 2.375},
     {1315, 1.456922328720298e-6, 2.625},  {1280, 2.419485191895565e-7, 2.875},
     {1220, 1.657956321067612e-8, 3.25},   {1185, 4.745469537371e-10, 3.75},
     {1150, 1.379746590025088e-11, 4.25},  {1100, 4.070157961147882e-13, 4.75},
     {1060, 2.938236954847331e-14, 5.125}, {1025, 1.228597370014e-14, 5.25},
     {980, 2.916938264100495e-14, 5.125},  {945, 3.855099424807451e-13, 4.75},
     {905, 3.953721585280791e-12, 4.5},    {860, 1.051728804013e-10, 4.0},
     {810, 1.485749033551948e-9, 3.75},    {780, 1.041162981722437e-8, 3.5},
     {750, 1.231911859621178e-7, 3.0},     {700, 4.600998799e-7, 2.875},
     {640, 3.209559783129881e-6, 2.5},     {600, 7.566129470914212e-6, 2.375},
     {550, 1.490005193169e-5, 2.25},       {250, 1.241662783e-4, 1.875},
     {0, 1.477404177730177e-4, 1.9565},    {-1, 0, 0}}};

double interpolate(double x, const std::vector<std::pair<double, double>>& table) {
  if (x <= table.front().first) {
    return table.front().second;
  }
  if (x >= table.back().first) {
    return table.back().second;
  }

  auto hi = std::upper_bound(table.begin(), table.end(), x,
                             [](double value, const auto& item) { return value < item.first; });

  auto lo = hi - 1;
  return lo->second + (x - lo->first) / (hi->first - lo->first) * (hi->second - lo->second);
}

const std::vector<std::pair<double, double>>& g7_table() {
  static const std::vector<std::pair<double, double>> table{
      {0.0, 0.1198},   {0.05, 0.1197},  {0.1, 0.1196},   {0.15, 0.1194},  {0.2, 0.1193},
      {0.25, 0.1194},  {0.3, 0.1194},   {0.35, 0.1194},  {0.4, 0.1193},   {0.45, 0.1193},
      {0.5, 0.1194},   {0.55, 0.1193},  {0.6, 0.1194},   {0.65, 0.1197},  {0.7, 0.1202},
      {0.75, 0.1207},  {0.8, 0.1215},   {0.825, 0.1226}, {0.85, 0.1242},  {0.875, 0.1266},
      {0.9, 0.1306},   {0.925, 0.1368}, {0.95, 0.1464},  {0.975, 0.1660}, {1.0, 0.2054},
      {1.025, 0.2993}, {1.05, 0.3803},  {1.075, 0.4015}, {1.1, 0.4043},   {1.125, 0.4034},
      {1.15, 0.4014},  {1.2, 0.3967},   {1.25, 0.3915},  {1.3, 0.3860},   {1.35, 0.3810},
      {1.4, 0.3763},   {1.45, 0.3718},  {1.5, 0.3676},   {1.55, 0.3637},  {1.6, 0.3600},
      {1.65, 0.3566},  {1.7, 0.3533},   {1.75, 0.3501},  {1.8, 0.3471},   {1.85, 0.3442},
      {1.9, 0.3414},   {1.95, 0.3387},  {2.0, 0.3362},   {2.05, 0.3337},  {2.1, 0.3313},
      {2.15, 0.3290},  {2.2, 0.3268},   {2.25, 0.3246},  {2.3, 0.3224},   {2.35, 0.3203},
      {2.4, 0.3183},   {2.45, 0.3163},  {2.5, 0.3143},   {2.55, 0.3124},  {2.6, 0.3105},
      {2.65, 0.3086},  {2.7, 0.3067},   {2.75, 0.3049},  {2.8, 0.3032},   {2.85, 0.3015},
      {2.9, 0.2998},   {2.95, 0.2981},  {3.0, 0.2965},   {3.1, 0.2932},   {3.2, 0.2901},
      {3.3, 0.2870},   {3.4, 0.2840},   {3.5, 0.2812},   {3.6, 0.2784},   {3.7, 0.2758},
      {3.8, 0.2732},   {3.9, 0.2708},   {4.0, 0.2684},   {4.2, 0.2638},   {4.4, 0.2596},
      {4.6, 0.2557},   {4.8, 0.2522},   {5.0, 0.2490}};
  return table;
}

double cubic_bezier(const std::array<double, 4>& v, double u) {
  const auto q = 1.0 - u;
  return v[0] * q * q * q + 3 * v[1] * u * q * q + 3 * v[2] * u * u * q + v[3] * u * u * u;
}

double bezier_y_from_x(double x, const std::array<std::pair<double, double>, 4>& points) {
  std::array<double, 4> xs{};
  std::array<double, 4> ys{};

  for (std::size_t i = 0; i < 4; ++i) {
    xs[i] = points[i].first;
    ys[i] = points[i].second;
  }

  if (x <= xs[0]) {
    return ys[0];
  }
  if (x >= xs[3]) {
    return ys[3];
  }

  double low = 0.0;
  double high = 1.0;

  for (int i = 0; i < 70; ++i) {
    const auto u = (low + high) / 2.0;
    if (cubic_bezier(xs, u) < x) {
      low = u;
    } else {
      high = u;
    }
  }

  return cubic_bezier(ys, (low + high) / 2.0);
}

std::array<double, 3> sphere_aerodynamics(double speed, double diameter,
                                          const Atmosphere& atmosphere) {
  if (speed <= 0 || diameter <= 0) {
    return {0.0, 0.0, 0.0};
  }

  const auto mach = speed / atmosphere.speed_of_sound_mps;
  const auto reynolds =
      atmosphere.density_kg_m3 * speed * diameter / atmosphere.dynamic_viscosity_pa_s;
  const auto corrected = std::clamp(mach, 0.2, 1.5);

  constexpr std::array<std::pair<double, double>, 4> kp{
      {{0.1, 0.0}, {0.95, 0.0}, {0.55, 0.95}, {1.5, 1.0}}};

  constexpr std::array<std::pair<double, double>, 4> tp{
      {{0.0, 1.1}, {0.85, 1.1}, {0.57, 0.05}, {1.0, 0.0}}};

  const auto shock = corrected >= 1.5 ? 1.0 : bezier_y_from_x(corrected, kp);
  const auto mask = corrected > 1.0 ? 0.0 : bezier_y_from_x(corrected, tp);
  const auto scale = 0.78 + 0.22 * std::atan(-12.0 * (corrected - 0.23));

  return {shock + mask * sphere_drag_vs_reynolds(std::max(scale * reynolds, 1e-12)), reynolds,
          mach};
}

double g1_retardation(double speed_fps, double bc) {
  if (speed_fps <= 0) {
    return 0.0;
  }

  for (const auto& band : g1_table) {
    if (speed_fps >= band.threshold) {
      return band.coefficient * std::pow(speed_fps, band.exponent) / bc;
    }
  }

  return 0.0;
}

using State = std::array<double, 4>;

State derivative(const State& s, const Projectile& p, const Atmosphere& a) {
  const auto vx_safe = std::max(s[2], 1e-6);
  const auto rx = s[2] + a.headwind_mps;
  const auto ry = s[3];
  const auto relative = std::hypot(rx, ry);

  const auto retard = drag_retardation_mps2(relative, p, a);
  const auto ax = relative > 1e-9 ? -retard * rx / relative : 0.0;
  const auto ay = relative > 1e-9 ? -retard * ry / relative - gravity_mps2 : -gravity_mps2;

  return {1.0 / vx_safe, s[3] / vx_safe, ax / vx_safe, ay / vx_safe};
}

State rk4(const State& s, double dx, const Projectile& p, const Atmosphere& a) {
  const auto k1 = derivative(s, p, a);

  State s2{};
  for (int i = 0; i < 4; ++i) {
    s2[i] = s[i] + 0.5 * dx * k1[i];
  }

  const auto k2 = derivative(s2, p, a);

  State s3{};
  for (int i = 0; i < 4; ++i) {
    s3[i] = s[i] + 0.5 * dx * k2[i];
  }

  const auto k3 = derivative(s3, p, a);

  State s4{};
  for (int i = 0; i < 4; ++i) {
    s4[i] = s[i] + dx * k3[i];
  }

  const auto k4 = derivative(s4, p, a);

  State out{};
  for (int i = 0; i < 4; ++i) {
    out[i] = s[i] + dx * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]) / 6.0;
  }

  return out;
}

}  // namespace

double Projectile::payload_mass_kg() const {
  return mass_kg * std::max(1, pellet_count);
}

double altitude_to_pressure_hpa(double altitude_m) {
  const auto h = std::clamp(altitude_m, 0.0, 11000.0);
  return icao_p0 * std::pow(1.0 - icao_lapse * h / icao_t0, icao_exp);
}

double pressure_to_altitude_m(double pressure_hpa) {
  const auto p = std::clamp(pressure_hpa, 226.0, icao_p0);
  return icao_t0 / icao_lapse * (1.0 - std::pow(p / icao_p0, 1.0 / icao_exp));
}

Atmosphere Atmosphere::create(double temp_c, double pressure_hpa, double humidity, double wind) {
  if (temp_c < -60.0 || temp_c > 60.0) {
    throw std::invalid_argument("temperature out of range");
  }
  if (pressure_hpa < 500.0 || pressure_hpa > 1100.0) {
    throw std::invalid_argument("pressure out of range");
  }
  if (humidity < 0.0 || humidity > 100.0) {
    throw std::invalid_argument("humidity out of range");
  }
  if (wind < -100.0 || wind > 100.0) {
    throw std::invalid_argument("wind out of range");
  }

  const auto temp_k = temp_c + 273.15;
  const auto pressure_pa = pressure_hpa * 100.0;

  const auto saturation = 610.94 * std::exp(17.625 * temp_c / (temp_c + 243.04));
  const auto vapor = std::clamp(humidity / 100.0 * saturation, 0.0, 0.99 * pressure_pa);

  const auto density = (pressure_pa - vapor) / (r_dry * temp_k) + vapor / (r_vapor * temp_k);
  const auto effective_r = pressure_pa / (density * temp_k);
  const auto sound = std::sqrt(gamma_air * effective_r * temp_k);

  const auto viscosity = mu_ref * std::pow(temp_k / temp_ref, 1.5) * (temp_ref + sutherland_c) /
                         (temp_k + sutherland_c);

  return {temp_c, pressure_hpa, humidity, wind, density, sound, viscosity};
}

double sphere_drag_vs_reynolds(double re) {
  if (!std::isfinite(re) || re <= 0.0) {
    throw std::invalid_argument("Reynolds number must be positive");
  }
  if (re > 2e6) {
    return 0.15;
  }
  if (re > 1.2e6) {
    return 0.19 - 8e4 / re;
  }
  if (re > 4.77e5) {
    return -0.485 + 0.1 * std::log10(re);
  }

  return 24.0 / re + (2.6 * (re / 5.0)) / (1.0 + std::pow(re / 5.0, 1.52)) +
         (0.411 * std::pow(re / 263000.0, -7.94) / (1.0 + std::pow(re / 263000.0, -8.0))) +
         std::pow(re, 0.8) / 461000.0;
}

double drag_retardation_mps2(double speed, const Projectile& p, const Atmosphere& a) {
  if (speed <= 0.0) {
    return 0.0;
  }

  if (p.drag_model == DragModel::sphere) {
    if (p.sphere_diameter_m <= 0.0 || p.mass_kg <= 0.0) {
      throw std::invalid_argument("invalid sphere");
    }

    const auto cd = sphere_aerodynamics(speed, p.sphere_diameter_m, a)[0];
    const auto area = pi * p.sphere_diameter_m * p.sphere_diameter_m / 4.0;

    return 0.5 * a.density_kg_m3 * cd * area * speed * speed / p.mass_kg;
  }

  if (p.drag_model == DragModel::g7) {
    const auto cd = interpolate(speed / a.speed_of_sound_mps, g7_table());
    return k_cd_ref * cd * speed * speed * (a.density_kg_m3 / rho_std) / p.ballistic_coefficient;
  }

  const auto equiv = speed * a_std / a.speed_of_sound_mps;
  const auto ref = g1_retardation(equiv * mps_to_fps, p.ballistic_coefficient);

  return ref * fps_to_mps * (a.density_kg_m3 / rho_std) *
         std::pow(a.speed_of_sound_mps / a_std, 2.0);
}

AerodynamicDiagnostics aerodynamic_diagnostics(const Projectile& p, double speed,
                                               const Atmosphere& a) {
  if (p.drag_model == DragModel::sphere) {
    const auto values = sphere_aerodynamics(speed, p.sphere_diameter_m, a);
    return {values[0], values[1], values[2], true};
  }

  return {0.0, 0.0, speed > 0.0 ? speed / a.speed_of_sound_mps : 0.0, false};
}

BallisticPoint Trajectory::point_at(double distance) const {
  if (distances.empty()) {
    throw std::runtime_error("empty trajectory");
  }

  const auto x = std::clamp(distance, distances.front(), distances.back());
  auto it = std::lower_bound(distances.begin(), distances.end(), x);

  if (it == distances.begin()) {
    return {distances[0], speeds[0], energies[0], momenta[0], times[0], drops[0]};
  }

  auto i = static_cast<std::size_t>(it - distances.begin());
  if (i >= distances.size()) {
    i = distances.size() - 1;
  }

  const auto f = (x - distances[i - 1]) / (distances[i] - distances[i - 1]);
  const auto lerp = [&](const auto& v) { return v[i - 1] + f * (v[i] - v[i - 1]); };
  const auto speed = lerp(speeds);

  return {x, speed, 0.5 * mass_kg * speed * speed, mass_kg * speed, lerp(times), lerp(drops)};
}

Trajectory integrate_trajectory(const Projectile& p, const Atmosphere& a, double max_distance,
                                double multiplier, double dx) {
  if (multiplier < 0.5 || multiplier > 1.5) {
    throw std::invalid_argument("velocity multiplier out of range");
  }
  if (dx <= 0.0) {
    throw std::invalid_argument("step must be positive");
  }

  max_distance = std::max(0.0, max_distance);
  const auto v0 = p.muzzle_velocity_mps * multiplier;

  State state{0.0, 0.0, v0, 0.0};
  double distance = 0.0;

  Trajectory t{{0.0}, {v0}, {0.5 * p.mass_kg * v0 * v0}, {p.mass_kg * v0}, {0.0}, {0.0}, p.mass_kg};

  while (distance < max_distance) {
    const auto step = std::min(dx, max_distance - distance);
    state = rk4(state, step, p, a);
    distance += step;

    if (!std::all_of(state.begin(), state.end(), [](double v) { return std::isfinite(v); }) ||
        state[2] <= 1.0) {
      break;
    }

    const auto speed = std::hypot(state[2], state[3]);

    t.distances.push_back(distance);
    t.speeds.push_back(speed);
    t.energies.push_back(0.5 * p.mass_kg * speed * speed);
    t.momenta.push_back(p.mass_kg * speed);
    t.times.push_back(state[0]);
    t.drops.push_back(-state[1]);
  }

  return t;
}

std::pair<double, double> compute_mpbr(const Trajectory& t, double vital, double sight) {
  const auto radius = vital / 2.0;

  if (radius <= 0.0 || t.distances.empty() || t.distances.back() < 5.0) {
    return {0.0, 0.0};
  }

  const auto height = [&](std::size_t i, double zero, double drop_zero) {
    return -t.drops[i] - sight + (drop_zero + sight) * t.distances[i] / zero;
  };

  const auto ordinate = [&](double zero) {
    const auto dz = t.point_at(zero).drop_m;
    auto best = -sight;
    for (std::size_t i = 0; i < t.distances.size() && t.distances[i] <= zero * 1.5 + 50.0; ++i) {
      best = std::max(best, height(i, zero, dz));
    }
    return best;
  };

  double lo = 5.0;
  double hi = std::min(t.distances.back() * 0.9, 1500.0);

  for (int i = 0; i < 60; ++i) {
    const auto mid = (lo + hi) / 2.0;
    if (ordinate(mid) > radius) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const auto zero = (lo + hi) / 2.0;
  const auto dz = t.point_at(zero).drop_m;

  auto mpbr = zero;
  auto previous = height(0, zero, dz);
  bool found = false;

  for (std::size_t i = 1; i < t.distances.size(); ++i) {
    const auto current = height(i, zero, dz);

    if (t.distances[i] > zero && current < -radius) {
      if (previous != current) {
        mpbr = t.distances[i - 1] +
               (previous + radius) / (previous - current) * (t.distances[i] - t.distances[i - 1]);
      } else {
        mpbr = t.distances[i - 1];
      }
      found = true;
      break;
    }

    previous = current;
  }

  if (!found) {
    mpbr = t.distances.back();
  }

  return {zero, mpbr};
}

double compute_spin_drift_m(const Projectile& p, double tof, double twist, double muzzle,
                            const Atmosphere& a, int sign) {
  const auto d = p.bullet_diameter_inches;
  const auto bl = p.bullet_length_inches;

  if (p.firearm_group != FirearmGroup::rifle || d <= 0.0 || twist <= 0.0 || bl <= 0.0 ||
      tof <= 0.0) {
    return 0.0;
  }

  const auto tcal = twist / d;
  const auto lcal = bl / d;
  const auto mass_gr = p.mass_kg / grains_to_kg;

  const auto base = 30.0 * mass_gr / (tcal * tcal * d * d * d * lcal * (1.0 + lcal * lcal));
  const auto velocity = std::pow(std::max(muzzle * mps_to_fps / 2800.0, 0.05), 1.0 / 3.0);
  const auto sg = base * velocity * rho_std / std::max(a.density_kg_m3, 0.1);

  const auto drift = 1.25 * (sg + 1.2) * std::pow(tof, 1.83);

  return (sign < 0 ? -1.0 : 1.0) * drift * inches_to_m;
}

const std::vector<Projectile>& built_in_projectiles() {
  static const std::vector<Projectile> loads{
      {"B&P White Blackout HV 12/70, 28 g", "White Blackout HV", 0.028, 575.0, 0.054522843,
       "effective BC fitted to 33 m and 50 m data"},
      {"B&P BlackShock 12/70, 32 g", "BlackShock", 0.032, 455.0, 0.070985785,
       "effective BC fitted to 33 m data"},
      {"Winchester Super-X X123RS15 12/76, 1 oz", "Winchester X123RS15", 0.028349523125,
       1760.0 * fps_to_mps, 0.068, "manufacturer-published G1 BC"},
      {"Hornady BLACK .308 Win A-MAX, 168 gr (80971)", "Hornady A-MAX 168 gr", 168.0 * grains_to_kg,
       2700.0 * fps_to_mps, 0.475, "manufacturer G1 BC; 24-inch test barrel", DragModel::g1,
       FirearmGroup::rifle, 0, 1.24, 0.308},
      {"Federal Power-Shok .308 Win SP, 150 gr (308A)", "Federal SP 150 gr", 150.0 * grains_to_kg,
       2820.0 * fps_to_mps, 0.313, "effective G1 BC fitted to official table; 24-inch test barrel",
       DragModel::g1, FirearmGroup::rifle, 0, 1.13, 0.308},
      {"Winchester Super-X 12/70, 9-pellet 00 Buck, 1,325 ft/s", "Winchester 9-pellet 00",
       11340.0 * pi * std::pow(0.330 * inches_to_m, 3.0) / 6.0, 1325.0 * fps_to_mps, 0.0,
       "Morrison sphere model", DragModel::sphere, FirearmGroup::shotgun, 0, 0.0, 0.0,
       0.330 * inches_to_m, 11340, 9}};

  return loads;
}

}  // namespace ballistics