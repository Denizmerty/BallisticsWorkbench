#include <algorithm>
#include <cmath>
#include <stdexcept>

#include "ballistics.hpp"
#include "generated_atmosphere_conversions.hpp"

namespace ballistics
{
namespace
{

constexpr double dry_air_gas_constant_j_kgk = 287.058;
constexpr double water_vapor_gas_constant_j_kgk = 461.495;
constexpr double sutherland_reference_viscosity_pa_s = 1.716e-5;
constexpr double sutherland_reference_temperature_k = 273.15;
constexpr double sutherland_constant_k = 110.333;
constexpr double earth_rotation_rad_s = 7.2921150e-5;
constexpr double pi = 3.1415926535897932384626433832795;

double saturation_vapor_pressure_pa(
    double temperature_c
)
{
    const auto temperature_k = temperature_c + 273.15;
    return std::exp(
        1.2811805e-5 * temperature_k * temperature_k - 1.9509874e-2 * temperature_k + 34.04926034 -
        6.3536311e3 / temperature_k
    );
}

double moist_air_sound_speed_mps(
    double temperature_c,
    double pressure_pa,
    double relative_humidity_percent
)
{
    // Cramer (JASA 93(5), 1993), with a fixed 400 ppm CO2 mole fraction. The declared domain is
    // exposed by atmosphere_model_validity. Callers can retain results outside it without treating
    // extrapolation as source-qualified.
    constexpr double carbon_dioxide_mole_fraction = 400e-6;
    const auto enhancement =
        1.00062 + 3.14e-8 * pressure_pa + 5.6e-7 * temperature_c * temperature_c;
    const auto water_vapor_mole_fraction = std::clamp(
        relative_humidity_percent / 100.0 * enhancement *
            saturation_vapor_pressure_pa(temperature_c) / pressure_pa,
        0.0,
        0.99
    );
    const auto temperature_squared = temperature_c * temperature_c;
    const auto pressure_squared = pressure_pa * pressure_pa;
    const auto humidity_squared = water_vapor_mole_fraction * water_vapor_mole_fraction;
    const auto carbon_dioxide_squared = carbon_dioxide_mole_fraction * carbon_dioxide_mole_fraction;

    return 331.5024 + 0.603055 * temperature_c - 0.000528 * temperature_squared +
        (51.471935 + 0.1495874 * temperature_c - 0.000782 * temperature_squared) *
        water_vapor_mole_fraction +
        (-1.82e-7 + 3.73e-8 * temperature_c - 2.93e-10 * temperature_squared) * pressure_pa +
        (-85.20931 - 0.228525 * temperature_c + 5.91e-5 * temperature_squared) *
        carbon_dioxide_mole_fraction -
        2.835149 * humidity_squared - 2.15e-13 * pressure_squared +
        29.179762 * carbon_dioxide_squared +
        0.000486 * water_vapor_mole_fraction * pressure_pa * carbon_dioxide_mole_fraction;
}

double interpolate_layer_value(
    double coordinate,
    double start,
    double end,
    double start_value,
    double end_value
)
{
    if (end <= start)
    {
        return start_value;
    }
    const auto fraction = std::clamp((coordinate - start) / (end - start), 0.0, 1.0);
    return start_value + fraction * (end_value - start_value);
}

const WindLayer* active_wind_layer(
    const std::vector<WindLayer>& layers,
    const Vec3& position
)
{
    for (const auto& layer : layers)
    {
        const auto coordinate = layer.axis == WindLayerAxis::height ? position.y : position.x;
        if (coordinate >= layer.start_m && coordinate <= layer.end_m)
        {
            return &layer;
        }
    }
    return nullptr;
}

void validate_wind_layer(
    const WindLayer& layer
)
{
    const auto finite = [](double value)
    {
        return std::isfinite(value);
    };
    if (!finite(layer.start_m) || !finite(layer.end_m) || layer.end_m <= layer.start_m ||
        !finite(layer.start_headwind_mps) || !finite(layer.end_headwind_mps) ||
        !finite(layer.start_crosswind_mps) || !finite(layer.end_crosswind_mps) ||
        std::abs(layer.start_headwind_mps) > 100.0 || std::abs(layer.end_headwind_mps) > 100.0 ||
        std::abs(layer.start_crosswind_mps) > 100.0 || std::abs(layer.end_crosswind_mps) > 100.0)
    {
        throw std::invalid_argument("invalid wind layer");
    }
}

} // namespace

double altitude_to_pressure_hpa(
    double altitude_m
)
{
    return generated::atmosphere_conversion::altitude_to_pressure_hpa(altitude_m);
}

double pressure_to_altitude_m(
    double pressure_hpa
)
{
    return generated::atmosphere_conversion::pressure_to_altitude_m(pressure_hpa);
}

double altimeter_setting_to_station_pressure_hpa(
    double altimeter_setting_hpa,
    double geometric_altitude_m
)
{
    return generated::atmosphere_conversion::altimeter_setting_to_station_pressure_hpa(
        altimeter_setting_hpa,
        geometric_altitude_m
    );
}

double station_pressure_to_altimeter_setting_hpa(
    double station_pressure_hpa,
    double geometric_altitude_m
)
{
    return generated::atmosphere_conversion::station_pressure_to_altimeter_setting_hpa(
        station_pressure_hpa,
        geometric_altitude_m
    );
}

double density_to_altitude_m(
    double density_kg_m3
)
{
    return generated::atmosphere_conversion::density_to_altitude_m(density_kg_m3);
}

Atmosphere Atmosphere::create(
    double temperature_c,
    double station_pressure_hpa,
    double relative_humidity_percent,
    double headwind_mps,
    double crosswind_mps
)
{
    if (!std::isfinite(temperature_c) || temperature_c < -60.0 || temperature_c > 60.0)
    {
        throw std::invalid_argument("temperature out of range");
    }
    if (!std::isfinite(station_pressure_hpa) || station_pressure_hpa < 500.0 ||
        station_pressure_hpa > 1100.0)
    {
        throw std::invalid_argument("pressure out of range");
    }
    if (!std::isfinite(relative_humidity_percent) || relative_humidity_percent < 0.0 ||
        relative_humidity_percent > 100.0)
    {
        throw std::invalid_argument("humidity out of range");
    }
    if (!std::isfinite(headwind_mps) || std::abs(headwind_mps) > 100.0)
    {
        throw std::invalid_argument("wind out of range");
    }
    if (!std::isfinite(crosswind_mps) || std::abs(crosswind_mps) > 100.0)
    {
        throw std::invalid_argument("crosswind out of range");
    }

    const auto temperature_k = temperature_c + 273.15;
    const auto pressure_pa = station_pressure_hpa * 100.0;
    const auto saturation_pressure_pa =
        610.94 * std::exp(17.625 * temperature_c / (temperature_c + 243.04));
    const auto vapor_pressure_pa = std::clamp(
        relative_humidity_percent / 100.0 * saturation_pressure_pa,
        0.0,
        0.99 * pressure_pa
    );
    const auto density_kg_m3 =
        (pressure_pa - vapor_pressure_pa) / (dry_air_gas_constant_j_kgk * temperature_k) +
        vapor_pressure_pa / (water_vapor_gas_constant_j_kgk * temperature_k);
    const auto speed_of_sound_mps =
        moist_air_sound_speed_mps(temperature_c, pressure_pa, relative_humidity_percent);
    const auto dynamic_viscosity_pa_s = sutherland_reference_viscosity_pa_s *
        std::pow(temperature_k / sutherland_reference_temperature_k, 1.5) *
        (sutherland_reference_temperature_k + sutherland_constant_k) /
        (temperature_k + sutherland_constant_k);

    return {
        temperature_c, station_pressure_hpa, relative_humidity_percent, headwind_mps,
        crosswind_mps, density_kg_m3,        speed_of_sound_mps,        dynamic_viscosity_pa_s
    };
}

AtmosphereModelValidity atmosphere_model_validity(
    const Atmosphere& atmosphere
)
{
    const auto pressure_pa = atmosphere.station_pressure_hpa * 100.0;
    return {
        atmosphere.temperature_c >= 15.0 && atmosphere.temperature_c <= 27.0 &&
            pressure_pa >= 60000.0 && pressure_pa <= 110000.0,
        atmosphere.temperature_c >= 0.0 && atmosphere.temperature_c <= 30.0 &&
            pressure_pa >= 75000.0 && pressure_pa <= 102000.0,
        atmosphere.temperature_c >= -60.0 && atmosphere.temperature_c <= 60.0,
        "ideal_moist_air_mixture",
        "cramer_1993_400_ppm_co2",
        "sutherland_110_333_k"
    };
}

Environment Environment::homogeneous(
    const Atmosphere& atmosphere
)
{
    Environment environment;
    environment.firing_point = atmosphere;
    return environment;
}

Atmosphere Environment::atmosphere_at(
    const Vec3& position_m
) const
{
    for (const auto& layer : wind_layers)
    {
        validate_wind_layer(layer);
    }

    auto temperature_c = firing_point.temperature_c;
    auto pressure_hpa = firing_point.station_pressure_hpa;
    if (altitude_dependent_atmosphere)
    {
        const auto base_temperature_k = firing_point.temperature_c + 273.15;
        const auto local_temperature_k =
            base_temperature_k - generated::atmosphere_conversion::lapse_rate_k_m * position_m.y;
        if (local_temperature_k <= 0.0)
        {
            throw std::invalid_argument("altitude-dependent atmosphere left its physical domain");
        }
        temperature_c = local_temperature_k - 273.15;
        pressure_hpa = firing_point.station_pressure_hpa *
            std::pow(local_temperature_k / base_temperature_k,
                     generated::atmosphere_conversion::pressure_exponent);
    }

    auto headwind_mps = firing_point.headwind_mps;
    auto crosswind_mps = firing_point.crosswind_mps;
    if (const auto* layer = active_wind_layer(wind_layers, position_m))
    {
        const auto coordinate = layer->axis == WindLayerAxis::height ? position_m.y : position_m.x;
        headwind_mps = interpolate_layer_value(
            coordinate,
            layer->start_m,
            layer->end_m,
            layer->start_headwind_mps,
            layer->end_headwind_mps
        );
        crosswind_mps = interpolate_layer_value(
            coordinate,
            layer->start_m,
            layer->end_m,
            layer->start_crosswind_mps,
            layer->end_crosswind_mps
        );
    }

    return Atmosphere::create(
        temperature_c,
        pressure_hpa,
        firing_point.relative_humidity_percent,
        headwind_mps,
        crosswind_mps
    );
}

double Environment::gravity_at_height(
    double height_m
) const
{
    if (!use_local_gravity)
    {
        return gravity_mps2;
    }
    if (!std::isfinite(latitude_deg) || latitude_deg < -90.0 || latitude_deg > 90.0 ||
        !std::isfinite(firing_point_altitude_m) || !std::isfinite(height_m))
    {
        throw std::invalid_argument("invalid local-gravity location");
    }

    const auto latitude_rad = latitude_deg * pi / 180.0;
    const auto sin_squared = std::sin(latitude_rad) * std::sin(latitude_rad);
    const auto ellipsoid_gravity = 9.7803253359 * (1.0 + 0.00193185265241 * sin_squared) /
        std::sqrt(1.0 - 0.00669437999013 * sin_squared);
    return ellipsoid_gravity - 3.086e-6 * (firing_point_altitude_m + height_m);
}

Vec3 Environment::coriolis_acceleration(
    const Vec3& ground_velocity_mps,
    double height_m
) const
{
    static_cast<void>(height_m);
    if (!coriolis_enabled)
    {
        return {};
    }
    if (!std::isfinite(latitude_deg) || latitude_deg < -90.0 || latitude_deg > 90.0 ||
        !std::isfinite(shot_azimuth_deg))
    {
        throw std::invalid_argument("invalid Coriolis location or azimuth");
    }

    const auto latitude_rad = latitude_deg * pi / 180.0;
    const auto azimuth_rad = shot_azimuth_deg * pi / 180.0;
    const auto sin_latitude = std::sin(latitude_rad);
    const auto cos_latitude = std::cos(latitude_rad);
    const auto sin_azimuth = std::sin(azimuth_rad);
    const auto cos_azimuth = std::cos(azimuth_rad);

    const auto east_velocity =
        ground_velocity_mps.x * sin_azimuth + ground_velocity_mps.z * cos_azimuth;
    const auto north_velocity =
        ground_velocity_mps.x * cos_azimuth - ground_velocity_mps.z * sin_azimuth;
    const auto up_velocity = ground_velocity_mps.y;

    const auto east_acceleration =
        2.0 * earth_rotation_rad_s * (sin_latitude * north_velocity - cos_latitude * up_velocity);
    const auto north_acceleration = -2.0 * earth_rotation_rad_s * sin_latitude * east_velocity;
    const auto up_acceleration = 2.0 * earth_rotation_rad_s * cos_latitude * east_velocity;

    return { east_acceleration * sin_azimuth + north_acceleration * cos_azimuth,
             up_acceleration,
             east_acceleration * cos_azimuth - north_acceleration * sin_azimuth };
}

double line_of_sight_path_m(
    const TrajectorySample& sample,
    double sight_height_m,
    double sight_line_elevation_rad
)
{
    if (!std::isfinite(sight_height_m) || sight_height_m < 0.0 ||
        !std::isfinite(sight_line_elevation_rad) || std::abs(sight_line_elevation_rad) >= pi / 2.0)
    {
        throw std::invalid_argument("invalid line-of-sight geometry");
    }
    return sample.position_m.y - sight_height_m -
        std::tan(sight_line_elevation_rad) * sample.distance_m;
}

} // namespace ballistics
