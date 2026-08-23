#include "legacy_cli.hpp"

#include <charconv>
#include <cmath>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace ballistics::cli
{
namespace
{

class Arguments
{
  public:
    Arguments(
        int argc,
        char** argv
    )
    {
        static const std::unordered_set<std::string> known {
            "--distance",        "--temperature",
            "--pressure",        "--humidity",
            "--headwind",        "--crosswind",
            "--vital-zone",      "--shotgun-sight",
            "--rifle-sight",     "--shotgun-zero",
            "--rifle-zero",      "--shotgun-mv",
            "--rifle-mv",        "--rifle-twist",
            "--twist-direction", "--custom-name",
            "--custom-drag",     "--custom-group",
            "--custom-mass",     "--custom-mv",
            "--custom-bc",       "--custom-sphere-diameter",
            "--custom-density",  "--custom-count",
            "--custom-twist",    "--custom-length",
            "--custom-diameter",
        };

        for (int i = 1; i < argc; i += 2)
        {
            const std::string name = argv[i];
            if (!known.contains(name))
            {
                throw std::invalid_argument("Unknown argument: " + name);
            }
            if (i + 1 >= argc)
            {
                throw std::invalid_argument("Missing value for argument: " + name);
            }
            if (!values_.emplace(name, argv[i + 1]).second)
            {
                throw std::invalid_argument("Duplicate argument: " + name);
            }
        }
    }

    [[nodiscard]] double number(
        const std::string& name,
        double fallback
    ) const
    {
        const auto found = values_.find(name);
        if (found == values_.end())
        {
            return fallback;
        }

        double value {};
        const auto* begin = found->second.data();
        const auto* end = begin + found->second.size();
        const auto parsed = std::from_chars(begin, end, value, std::chars_format::general);
        if (parsed.ec != std::errc {} || parsed.ptr != end || !std::isfinite(value))
        {
            throw std::invalid_argument("Invalid numeric value for " + name + ": " + found->second);
        }
        return value;
    }

    [[nodiscard]] std::string text(
        const std::string& name,
        const std::string& fallback = {}
    ) const
    {
        const auto found = values_.find(name);
        return found == values_.end() ? fallback : found->second;
    }

  private:
    std::unordered_map<std::string, std::string> values_;
};

void require_range(
    double value,
    double minimum,
    double maximum,
    const char* label
)
{
    if (!std::isfinite(value) || value < minimum || value > maximum)
    {
        throw std::invalid_argument(
            std::string(label) + " must be between " + std::to_string(minimum) + " and " +
            std::to_string(maximum)
        );
    }
}

} // namespace

ballistics::protocol::Request legacy_request(
    int argc,
    char** argv
)
{
    using namespace ballistics;
    const Arguments arguments(argc, argv);
    protocol::Request request;
    request.request_id = "legacy-cli";
    auto& scenario = request.scenario;
    scenario.display_distance_m = arguments.number("--distance", 100);
    scenario.solution_horizon_m = 2000;
    scenario.temperature_c = arguments.number("--temperature", 15);
    scenario.pressure_hpa = arguments.number("--pressure", 1013.25);
    scenario.humidity_percent = arguments.number("--humidity", 50);
    scenario.headwind_mps = arguments.number("--headwind", 0);
    scenario.crosswind_mps = arguments.number("--crosswind", 0);
    scenario.vital_zone_m = arguments.number("--vital-zone", .15);
    scenario.shotgun.sight_height_m = arguments.number("--shotgun-sight", .025);
    scenario.rifle.sight_height_m = arguments.number("--rifle-sight", .04);
    scenario.shotgun.zero_range_m = arguments.number("--shotgun-zero", 50.0);
    scenario.rifle.zero_range_m = arguments.number("--rifle-zero", 100.0);
    scenario.shotgun.muzzle_velocity_multiplier = arguments.number("--shotgun-mv", 1.0);
    scenario.rifle.muzzle_velocity_multiplier = arguments.number("--rifle-mv", 1.0);
    scenario.rifle.twist_inches = arguments.number("--rifle-twist", 10.0);
    scenario.rifle.twist_direction = arguments.number("--twist-direction", 1.0) < 0 ? -1 : 1;

    require_range(scenario.display_distance_m, 0, 2000, "Distance (m)");
    require_range(scenario.temperature_c, -60, 60, "Temperature (C)");
    require_range(scenario.pressure_hpa, 500, 1100, "Station pressure (hPa)");
    require_range(scenario.humidity_percent, 0, 100, "Humidity (%)");
    require_range(scenario.headwind_mps, -100, 100, "Headwind (m/s)");
    require_range(scenario.crosswind_mps, -100, 100, "Crosswind (m/s)");
    require_range(scenario.vital_zone_m, .01, 2, "Vital zone (m)");
    require_range(scenario.shotgun.sight_height_m, 0, .25, "Shotgun sight height (m)");
    require_range(scenario.rifle.sight_height_m, 0, .25, "Rifle sight height (m)");
    require_range(scenario.shotgun.zero_range_m, 5, 1000, "Shotgun zero range (m)");
    require_range(scenario.rifle.zero_range_m, 5, 1000, "Rifle zero range (m)");
    require_range(
        scenario.shotgun.muzzle_velocity_multiplier,
        .75,
        1.25,
        "Shotgun velocity multiplier"
    );
    require_range(
        scenario.rifle.muzzle_velocity_multiplier,
        .75,
        1.25,
        "Rifle velocity multiplier"
    );
    require_range(scenario.rifle.twist_inches, 5, 30, "Rifle twist (in/turn)");

    const auto custom_name = arguments.text("--custom-name");
    if (custom_name.empty())
    {
        return request;
    }

    const auto drag = arguments.text("--custom-drag", "G1");
    const auto group = arguments.text("--custom-group", "shotgun");
    auto diameter = arguments.number("--custom-sphere-diameter", 0.0);
    auto density = arguments.number("--custom-density", 11340.0);
    auto mass = arguments.number("--custom-mass", 0.01);
    const auto muzzle_velocity = arguments.number("--custom-mv", 400);
    auto ballistic_coefficient = arguments.number("--custom-bc", .1);
    const auto count = arguments.number("--custom-count", 1);
    const auto twist = arguments.number("--custom-twist", 0);
    const auto length = arguments.number("--custom-length", 0);
    const auto bullet_diameter = arguments.number("--custom-diameter", 0);
    if (drag != "G1" && drag != "G7" && drag != "Sphere")
    {
        throw std::invalid_argument("Custom drag model must be G1, G7, or Sphere");
    }
    if (group != "rifle" && group != "shotgun")
    {
        throw std::invalid_argument("Custom firearm profile must be rifle or shotgun");
    }
    require_range(muzzle_velocity, 1, 2000, "Custom muzzle velocity (m/s)");
    require_range(count, 1, 1000, "Custom payload count");
    if (std::floor(count) != count)
    {
        throw std::invalid_argument("Custom payload count must be an integer");
    }
    if (!std::isfinite(twist) || !std::isfinite(length) || !std::isfinite(bullet_diameter) ||
        twist < 0 || length < 0 || bullet_diameter < 0)
    {
        throw std::invalid_argument("Custom optional dimensions cannot be negative");
    }

    std::string bc_kind;
    if (drag == "Sphere")
    {
        require_range(diameter, .001, .05, "Custom sphere diameter (m)");
        require_range(density, 500, 25000, "Custom material density (kg/m3)");
        mass = density * 3.14159265358979323846 * diameter * diameter * diameter / 6;
        ballistic_coefficient = 0;
        bc_kind = "Morrison sphere Cd(Re) plus Collins transonic correction";
    }
    else
    {
        if (!std::isfinite(mass) || mass <= 0)
        {
            throw std::invalid_argument("Custom projectile mass must be positive");
        }
        if (!std::isfinite(ballistic_coefficient) || ballistic_coefficient <= 0 ||
            ballistic_coefficient > 2)
        {
            throw std::invalid_argument(
                "Custom ballistic coefficient must be positive and at most 2"
            );
        }
        diameter = 0;
        density = 0;
        bc_kind = "user-entered " + drag + " BC";
    }

    DragDefinition drag_definition = drag == "Sphere"
        ? DragDefinition { SphereDrag { diameter, density } }
        : DragDefinition { ReferenceBcDrag {
              drag == "G7" ? ReferenceDragCurve::g7 : ReferenceDragCurve::g1,
              ConstantBallisticCoefficient { ballistic_coefficient } } };
    std::optional<ProjectileGeometry> geometry;
    if (length > 0.0 && bullet_diameter > 0.0)
    {
        geometry = ProjectileGeometry { length, bullet_diameter };
    }
    FirearmConfiguration firearm {
        group == "rifle" ? FirearmGroup::rifle : FirearmGroup::shotgun,
        twist > 0.0 ? std::optional<double> { twist } : std::nullopt
    };
    request.custom_loads.push_back(
        { { custom_name, custom_name, mass, geometry, std::move(drag_definition) },
          { muzzle_velocity, static_cast<int>(count) },
          firearm,
          { true, "custom:legacy", std::move(bc_kind) } }
    );
    return request;
}

} // namespace ballistics::cli
