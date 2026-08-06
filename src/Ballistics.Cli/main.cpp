#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>

#include "ballistics.hpp"

namespace {
double argument(int argc, char** argv, const std::string& name, double fallback) {
  for (int i = 1; i + 1 < argc; ++i) {
    if (argv[i] == name) {
      return std::stod(argv[i + 1]);
    }
  }
  return fallback;
}
std::string text_argument(int argc, char** argv, const std::string& name,
                          std::string fallback = {}) {
  for (int i = 1; i + 1 < argc; ++i) {
    if (argv[i] == name) {
      return argv[i + 1];
    }
  }
  return fallback;
}
std::string escaped(const std::string& value) {
  static const char* const hex = "0123456789abcdef";
  std::string out;
  for (const auto byte : value) {
    const auto c = static_cast<unsigned char>(byte);
    switch (c) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\b':
        out += "\\b";
        break;
      case '\f':
        out += "\\f";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (c < 0x20) {
          out += "\\u00";
          out += hex[(c >> 4) & 0xf];
          out += hex[c & 0xf];
        } else {
          out += static_cast<char>(c);
        }
        break;
    }
  }
  return out;
}
void require_range(double value, double minimum, double maximum, const char* label) {
  if (!std::isfinite(value) || value < minimum || value > maximum) {
    throw std::invalid_argument(std::string(label) + " must be between " + std::to_string(minimum) +
                                " and " + std::to_string(maximum));
  }
}
}  // namespace

int main(int argc, char** argv) {
  using namespace ballistics;
  try {
    const auto maximum = argument(argc, argv, "--distance", 100);
    const auto temperature = argument(argc, argv, "--temperature", 15);
    const auto pressure = argument(argc, argv, "--pressure", 1013.25);
    const auto humidity = argument(argc, argv, "--humidity", 50);
    const auto wind = argument(argc, argv, "--headwind", 0);
    const auto vital = argument(argc, argv, "--vital-zone", .15);
    const auto shotgun_sight = argument(argc, argv, "--shotgun-sight", .025);
    const auto rifle_sight = argument(argc, argv, "--rifle-sight", .04);
    const auto shotgun_mv = argument(argc, argv, "--shotgun-mv", 1.0);
    const auto rifle_mv = argument(argc, argv, "--rifle-mv", 1.0);
    const auto rifle_twist = argument(argc, argv, "--rifle-twist", 10.0);
    const auto twist_direction = argument(argc, argv, "--twist-direction", 1.0) < 0 ? -1 : 1;
    require_range(maximum, 0, 2000, "Distance (m)");
    require_range(temperature, -60, 60, "Temperature (C)");
    require_range(pressure, 500, 1100, "Station pressure (hPa)");
    require_range(humidity, 0, 100, "Humidity (%)");
    require_range(wind, -100, 100, "Headwind (m/s)");
    require_range(vital, .01, 2, "Vital zone (m)");
    require_range(shotgun_sight, 0, .25, "Shotgun sight height (m)");
    require_range(rifle_sight, 0, .25, "Rifle sight height (m)");
    require_range(shotgun_mv, .75, 1.25, "Shotgun velocity multiplier");
    require_range(rifle_mv, .75, 1.25, "Rifle velocity multiplier");
    require_range(rifle_twist, 5, 30, "Rifle twist (in/turn)");
    const auto atmosphere = Atmosphere::create(temperature, pressure, humidity, wind);

    std::cout << std::setprecision(15)
              << "{\"atmosphere\":{\"densityKgM3\":" << atmosphere.density_kg_m3
              << ",\"speedOfSoundMps\":" << atmosphere.speed_of_sound_mps
              << ",\"viscosityPaS\":" << atmosphere.dynamic_viscosity_pa_s << "},\"loads\":[";
    auto loads = built_in_projectiles();
    const auto custom_name = text_argument(argc, argv, "--custom-name");
    if (!custom_name.empty()) {
      const auto drag = text_argument(argc, argv, "--custom-drag", "G1");
      const auto group = text_argument(argc, argv, "--custom-group", "shotgun");
      auto diameter = argument(argc, argv, "--custom-sphere-diameter", 0.0);
      auto density = argument(argc, argv, "--custom-density", 11340.0);
      auto mass = argument(argc, argv, "--custom-mass", 0.01);
      const auto custom_mv = argument(argc, argv, "--custom-mv", 400);
      auto custom_bc = argument(argc, argv, "--custom-bc", .1);
      const auto custom_count = argument(argc, argv, "--custom-count", 1);
      const auto custom_twist = argument(argc, argv, "--custom-twist", 0);
      const auto custom_length = argument(argc, argv, "--custom-length", 0);
      const auto custom_diameter = argument(argc, argv, "--custom-diameter", 0);
      if (drag != "G1" && drag != "G7" && drag != "Sphere") {
        throw std::invalid_argument("Custom drag model must be G1, G7, or Sphere");
      }
      if (group != "rifle" && group != "shotgun") {
        throw std::invalid_argument("Custom firearm profile must be rifle or shotgun");
      }
      if (!std::isfinite(custom_mv) || custom_mv <= 0) {
        throw std::invalid_argument("Custom muzzle velocity must be positive");
      }
      require_range(custom_count, 1, 1000, "Custom payload count");
      if (std::floor(custom_count) != custom_count) {
        throw std::invalid_argument("Custom payload count must be an integer");
      }
      if (!std::isfinite(custom_twist) || !std::isfinite(custom_length) ||
          !std::isfinite(custom_diameter) || custom_twist < 0 || custom_length < 0 ||
          custom_diameter < 0) {
        throw std::invalid_argument("Custom optional dimensions cannot be negative");
      }
      std::string bc_kind;
      if (drag == "Sphere") {
        require_range(diameter, .001, .05, "Custom sphere diameter (m)");
        require_range(density, 500, 25000, "Custom material density (kg/m3)");
        mass = density * 3.14159265358979323846 * diameter * diameter * diameter / 6;
        custom_bc = 0;
        bc_kind = "Morrison sphere Cd(Re) plus Collins transonic correction";
      } else {
        if (!std::isfinite(mass) || mass <= 0) {
          throw std::invalid_argument("Custom projectile mass must be positive");
        }
        if (!std::isfinite(custom_bc) || custom_bc <= 0 || custom_bc > 2) {
          throw std::invalid_argument(
              "Custom ballistic coefficient must be positive and at most 2");
        }
        diameter = 0;
        density = 0;
        bc_kind = "user-entered " + drag + " BC";
      }
      loads.push_back({custom_name, custom_name, mass, custom_mv, custom_bc, bc_kind,
                       drag == "Sphere" ? DragModel::sphere
                       : drag == "G7"   ? DragModel::g7
                                        : DragModel::g1,
                       group == "rifle" ? FirearmGroup::rifle : FirearmGroup::shotgun, custom_twist,
                       custom_length, custom_diameter, diameter, density,
                       static_cast<int>(custom_count), true});
    }
    for (std::size_t li = 0; li < loads.size(); ++li) {
      const auto& load = loads[li];
      const auto multiplier = load.firearm_group == FirearmGroup::rifle ? rifle_mv : shotgun_mv;
      const auto trajectory = integrate_trajectory(load, atmosphere, maximum, multiplier);
      const auto sight = load.firearm_group == FirearmGroup::rifle ? rifle_sight : shotgun_sight;
      const auto [zero, mpbr] = compute_mpbr(trajectory, vital, sight);
      if (li) {
        std::cout << ',';
      }
      std::cout << "{\"name\":\"" << escaped(load.name) << "\",\"shortName\":\""
                << escaped(load.short_name) << "\",\"dragModel\":\""
                << (load.drag_model == DragModel::sphere ? "Sphere"
                    : load.drag_model == DragModel::g7   ? "G7"
                                                         : "G1")
                << "\",\"firearmGroup\":\""
                << (load.firearm_group == FirearmGroup::rifle ? "rifle" : "shotgun")
                << "\",\"massKg\":" << load.mass_kg
                << ",\"muzzleVelocityMps\":" << trajectory.speeds.front()
                << ",\"ballisticCoefficient\":" << load.ballistic_coefficient << ",\"bcKind\":\""
                << escaped(load.bc_kind) << "\""
                << ",\"sphereDiameterM\":" << load.sphere_diameter_m
                << ",\"materialDensityKgM3\":" << load.material_density_kg_m3
                << ",\"pelletCount\":" << load.pellet_count << ",\"zeroM\":" << zero
                << ",\"mpbrM\":" << mpbr << ",\"points\":[";
      const auto stride = std::max<std::size_t>(1, trajectory.distances.size() / 500);
      bool first = true;
      for (std::size_t i = 0; i < trajectory.distances.size(); i += stride) {
        if (!first) {
          std::cout << ',';
        }
        first = false;
        const auto diagnostics = aerodynamic_diagnostics(load, trajectory.speeds[i], atmosphere);
        const auto spin =
            compute_spin_drift_m(load, trajectory.times[i], rifle_twist, trajectory.speeds.front(),
                                 atmosphere, twist_direction);
        std::cout << "{\"distanceM\":" << trajectory.distances[i]
                  << ",\"speedMps\":" << trajectory.speeds[i]
                  << ",\"energyJ\":" << trajectory.energies[i]
                  << ",\"momentumKgms\":" << trajectory.momenta[i]
                  << ",\"timeS\":" << trajectory.times[i] << ",\"dropM\":" << trajectory.drops[i]
                  << ",\"mach\":" << diagnostics.mach << ",\"spinDriftM\":" << spin;
        if (diagnostics.has_sphere_data) {
          std::cout << ",\"cd\":" << diagnostics.cd << ",\"reynolds\":" << diagnostics.reynolds;
        }
        std::cout << '}';
      }
      std::cout << "]}";
    }
    std::cout << "]}\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
