#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "ballistics.hpp"

namespace ballistics::protocol
{

inline constexpr int current_version = identity::protocol_version;
inline constexpr std::size_t maximum_request_bytes = identity::maximum_calculation_request_bytes;

struct FirearmConfiguration
{
    double sight_height_m {};
    double zero_range_m {};
    double muzzle_velocity_multiplier { 1.0 };
    double twist_inches {};
    int twist_direction { 1 };
    struct TemperatureVelocityPoint
    {
        double temperature_c {};
        double multiplier { 1.0 };
    };
    std::vector<TemperatureVelocityPoint> temperature_velocity_profile;
    std::string temperature_velocity_source;
};

struct UncertaintyConfiguration
{
    enum class Method
    {
        first_order,
        monte_carlo
    };

    Method method { Method::first_order };
    std::size_t monte_carlo_samples { 1000 };
    std::uint64_t monte_carlo_seed { 1113017667ULL };
    std::vector<UncertaintyCorrelation> correlations;
    double shotgun_muzzle_velocity_standard_deviation_mps {};
    double rifle_muzzle_velocity_standard_deviation_mps {};
    double drag_relative_standard_deviation {};
    double temperature_standard_deviation_c {};
    double pressure_standard_deviation_hpa {};
    double headwind_standard_deviation_mps {};
    double crosswind_standard_deviation_mps {};
    double shotgun_zero_range_standard_deviation_m {};
    double rifle_zero_range_standard_deviation_m {};
};

struct BuckshotPatternConfiguration
{
    std::string load_id;
    BuckshotPatternInput input;
};

struct Scenario
{
    double display_distance_m {};
    double solution_horizon_m { 2000.0 };
    double vital_zone_m {};
    double temperature_c {};
    double pressure_hpa {};
    double humidity_percent {};
    double headwind_mps {};
    double crosswind_mps {};
    double geometric_altitude_m {};
    bool altitude_dependent_atmosphere {};
    bool use_local_gravity {};
    bool coriolis_enabled {};
    double latitude_deg { 45.0 };
    double azimuth_deg {};
    double target_inclination_rad {};
    double target_elevation_m {};
    std::vector<WindLayer> wind_layers;
    std::string wind_provenance;
    FirearmConfiguration shotgun;
    FirearmConfiguration rifle;
    std::optional<UncertaintyConfiguration> uncertainty;
    std::optional<BuckshotPatternConfiguration> buckshot_pattern;
};

enum class RequestOperation
{
    calculation,
    calibrate_reference_bc
};

struct CalibrationRequest
{
    Projectile projectile;
    double temperature_c {};
    double pressure_hpa {};
    double humidity_percent {};
    double headwind_mps {};
    double crosswind_mps {};
    BcFitKind fit_kind { BcFitKind::constant };
    std::vector<double> band_minimum_velocities_mps;
    std::vector<VelocityObservation> observations;
};

struct Request
{
    int protocol_version { current_version };
    std::string request_id;
    RequestOperation operation { RequestOperation::calculation };
    Scenario scenario;
    std::vector<Projectile> custom_loads;
    CalibrationRequest calibration;
};

struct RequestParseResult
{
    std::optional<Request> request;
    std::string request_id;
    std::vector<ValidationIssue> issues;
};

[[nodiscard]] RequestParseResult parse_request(std::string_view source);

[[nodiscard]] std::string
error_response(std::string_view request_id, const std::vector<ValidationIssue>& issues);

[[nodiscard]] std::string escape_json(std::string_view value);

} // namespace ballistics::protocol
