#include <array>
#include <cmath>
#include <numbers>
#include <numeric>
#include <string>

#include "ballistics.hpp"
#include "test_framework.hpp"

namespace
{

using ballistics::Atmosphere;
using ballistics::Environment;
using ballistics::Vec3;
using ballistics::WindLayer;
using ballistics::WindLayerAxis;
using ballistics::testing::expect;
using ballistics::testing::expect_near;
using ballistics::testing::for_each_case;

BW_TEST_CASE(
    "published Cramer sound-speed cases are parameterized"
)
{
    struct SoundCase
    {
        double temperature_c;
        double pressure_hpa;
        double humidity_percent;
        double reference_mps;
        double conformance_tolerance_mps;
        bool declared_in_domain;
    };
    constexpr std::array cases {
        SoundCase { 0.0, 1013.25, 40.0, 331.5682, 0.37, true },
        SoundCase { 20.0, 1013.25, 60.0, 344.0945, 0.37, true },
        SoundCase { 30.0, 1013.25, 80.0, 350.9820, 0.37, true },
        SoundCase { 50.0, 1013.25, 80.0, 366.0778, 0.37, false },
    };
    for_each_case<SoundCase>(
        cases,
        [](const SoundCase& sample)
        {
            const auto atmosphere = Atmosphere::create(
                sample.temperature_c,
                sample.pressure_hpa,
                sample.humidity_percent,
                0.0,
                0.0
            );
            expect_near(
                atmosphere.speed_of_sound_mps,
                sample.reference_mps,
                sample.conformance_tolerance_mps,
                "published sound speed"
            );
            expect(
                ballistics::atmosphere_model_validity(atmosphere)
                        .sound_speed_within_declared_domain == sample.declared_in_domain,
                "sound-speed validity qualification"
            );
        }
    );
}

BW_TEST_CASE(
    "atmosphere validity flags follow the checked source domains"
)
{
    const auto qualified = ballistics::Atmosphere::create(20.0, 1013.25, 50.0, 0.0, 0.0);
    const auto density_temperature_extrapolation =
        ballistics::Atmosphere::create(10.0, 1013.25, 50.0, 0.0, 0.0);
    const auto density_pressure_extrapolation =
        ballistics::Atmosphere::create(20.0, 599.0, 50.0, 0.0, 0.0);
    const auto sound_pressure_extrapolation =
        ballistics::Atmosphere::create(20.0, 1030.0, 50.0, 0.0, 0.0);

    expect(
        ballistics::atmosphere_model_validity(qualified).density_within_declared_domain,
        "CIPM-qualified density point"
    );
    expect(
        !ballistics::atmosphere_model_validity(density_temperature_extrapolation)
             .density_within_declared_domain,
        "density temperature extrapolation"
    );
    expect(
        !ballistics::atmosphere_model_validity(density_pressure_extrapolation)
             .density_within_declared_domain,
        "density pressure extrapolation"
    );
    expect(
        !ballistics::atmosphere_model_validity(sound_pressure_extrapolation)
             .sound_speed_within_declared_domain,
        "sound-speed pressure extrapolation"
    );
}

BW_TEST_CASE(
    "WGS-84 local gravity varies by latitude and altitude"
)
{
    struct GravityCase
    {
        double latitude_deg;
        double altitude_m;
        double expected_mps2;
    };
    constexpr std::array cases {
        GravityCase { 0.0, 0.0, 9.7803253359 },
        GravityCase { 45.0, 0.0, 9.806197769373238 },
        GravityCase { 90.0, 0.0, 9.832184937858958 },
        GravityCase { 45.0, 2000.0, 9.800025769373238 },
    };
    for_each_case<GravityCase>(
        cases,
        [](const GravityCase& sample)
        {
            auto environment = Environment::homogeneous(Atmosphere::create(15, 1013.25, 50, 0, 0));
            environment.use_local_gravity = true;
            environment.latitude_deg = sample.latitude_deg;
            environment.firing_point_altitude_m = sample.altitude_m;
            expect_near(
                environment.gravity_at_height(0.0),
                sample.expected_mps2,
                5e-10,
                "WGS-84 gravity"
            );
        }
    );
}

BW_TEST_CASE(
    "wind layers interpolate on their declared coordinate axis"
)
{
    auto environment = Environment::homogeneous(Atmosphere::create(15, 1013.25, 50, 1, 2));
    environment.wind_layers = {
        WindLayer { WindLayerAxis::downrange, 100, 300, 2, 10, -4, 4, "range survey" },
        WindLayer { WindLayerAxis::height, 20, 40, -8, -4, 5, 9, "height survey" },
    };
    struct WindCase
    {
        Vec3 position;
        double headwind_mps;
        double crosswind_mps;
    };
    constexpr std::array cases {
        WindCase { { 0, 0, 0 }, 1, 2 },    WindCase { { 100, 0, 0 }, 2, -4 },
        WindCase { { 200, 0, 0 }, 6, 0 },  WindCase { { 300, 0, 0 }, 10, 4 },
        WindCase { { 50, 30, 0 }, -6, 7 },
    };
    for_each_case<WindCase>(
        cases,
        [&environment](const WindCase& sample)
        {
            const auto atmosphere = environment.atmosphere_at(sample.position);
            expect_near(atmosphere.headwind_mps, sample.headwind_mps, 1e-12, "headwind");
            expect_near(atmosphere.crosswind_mps, sample.crosswind_mps, 1e-12, "crosswind");
        }
    );
}

BW_TEST_CASE(
    "Coriolis acceleration follows latitude and azimuth sign conventions"
)
{
    constexpr double earth_rotation = 7.2921150e-5;
    auto environment = Environment::homogeneous(Atmosphere::create(15, 1013.25, 0, 0, 0));
    environment.coriolis_enabled = true;
    struct CoriolisCase
    {
        double latitude_deg;
        double azimuth_deg;
        Vec3 velocity;
        Vec3 expected;
    };
    const std::array cases {
        CoriolisCase {
            45.0,
            0.0,
            { 800, 0, 0 },
            { 0, 0, 2.0 * earth_rotation * std::sin(std::numbers::pi / 4.0) * 800 },
        },
        CoriolisCase {
            45.0,
            90.0,
            { 800, 0, 0 },
            { 0,
              2.0 * earth_rotation * std::cos(std::numbers::pi / 4.0) * 800,
              2.0 * earth_rotation * std::sin(std::numbers::pi / 4.0) * 800 },
        },
    };
    for_each_case<CoriolisCase>(
        cases,
        [&environment](const CoriolisCase& sample)
        {
            environment.latitude_deg = sample.latitude_deg;
            environment.shot_azimuth_deg = sample.azimuth_deg;
            const auto acceleration = environment.coriolis_acceleration(sample.velocity, 0.0);
            expect_near(acceleration.x, sample.expected.x, 1e-12, "forward acceleration");
            expect_near(acceleration.y, sample.expected.y, 1e-12, "vertical acceleration");
            expect_near(acceleration.z, sample.expected.z, 1e-12, "crossrange acceleration");
        }
    );
}

BW_TEST_CASE(
    "altitude-dependent atmosphere has lower pressure and density aloft"
)
{
    auto environment = Environment::homogeneous(Atmosphere::create(20, 900, 40, 0, 0));
    environment.altitude_dependent_atmosphere = true;
    const auto firing_point = environment.atmosphere_at({ 0, 0, 0 });
    const auto aloft = environment.atmosphere_at({ 1000, 1000, 0 });
    expect(aloft.temperature_c < firing_point.temperature_c, "temperature decreases with height");
    expect(
        aloft.station_pressure_hpa < firing_point.station_pressure_hpa,
        "pressure decreases with height"
    );
    expect(aloft.density_kg_m3 < firing_point.density_kg_m3, "density decreases with height");
}

BW_TEST_CASE(
    "empirical buckshot analysis separates calibration and holdout evidence"
)
{
    ballistics::BuckshotPatternInput input;
    input.pellet_count = 9;
    input.mean_muzzle_velocity_mps = 400.0;
    input.pellet_velocity_standard_deviation_mps = 6.0;
    input.choke = ballistics::ChokeClass::modified;
    input.deformation = ballistics::PelletDeformationClass::hardened_lead;
    input.target_range_m = 20.0;
    input.minimum_pellet_count = 3;
    input.target = {
        ballistics::TargetRegionShape::circle, 0.30, 0.30, 0.0, 0.0,
    };
    input.observations = {
        { 10.0, 0.39, 0.02, 5, ballistics::ObservationRole::calibration },
        { 20.0, 0.81, 0.03, 5, ballistics::ObservationRole::calibration },
        { 30.0, 1.23, 0.04, 5, ballistics::ObservationRole::holdout },
    };
    const auto result = ballistics::analyze_buckshot_pattern(input);
    expect(
        result.status == ballistics::PatternAnalysisStatus::validated_in_domain,
        "target lies inside calibration range"
    );
    expect(result.holdout_rmse_m.has_value(), "holdout RMSE is separate");
    expect(
        result.residuals.back().role == ballistics::ObservationRole::holdout,
        "holdout retained"
    );
    expect(result.predicted_diameter_90_m > 0.79, "fitted target diameter lower bound");
    expect(result.predicted_diameter_90_m < 0.82, "fitted target diameter upper bound");
    expect(
        result.per_pellet_hit_probability > 0.0 && result.per_pellet_hit_probability < 1.0,
        "per-pellet probability bounded"
    );
    expect_near(
        std::accumulate(
            result.pellet_count_probabilities.begin(),
            result.pellet_count_probabilities.end(),
            0.0
        ),
        1.0,
        1e-12,
        "pellet-count distribution normalized"
    );
    expect(
        result.validity_statement.find("Pellet wakes") != std::string::npos,
        "swarm-aerodynamics exclusion stated"
    );
}

BW_TEST_CASE(
    "buckshot analysis flags range extrapolation"
)
{
    ballistics::BuckshotPatternInput input;
    input.pellet_count = 8;
    input.mean_muzzle_velocity_mps = 390.0;
    input.pellet_velocity_standard_deviation_mps = 5.0;
    input.choke = ballistics::ChokeClass::cylinder;
    input.deformation = ballistics::PelletDeformationClass::plated;
    input.target_range_m = 45.0;
    input.minimum_pellet_count = 1;
    input.target = {
        ballistics::TargetRegionShape::rectangle, 0.4, 0.6, 0.1, -0.1,
    };
    input.observations = {
        { 10.0, 0.5, 0.03, 3, ballistics::ObservationRole::calibration },
        { 20.0, 1.0, 0.05, 3, ballistics::ObservationRole::calibration },
        { 30.0, 1.48, 0.06, 3, ballistics::ObservationRole::holdout },
    };
    const auto result = ballistics::analyze_buckshot_pattern(input);
    expect(
        result.status == ballistics::PatternAnalysisStatus::extrapolated,
        "outside calibration range is explicit"
    );
    expect(
        result.probability_at_least_minimum >= 0.0 && result.probability_at_least_minimum <= 1.0,
        "at-least probability bounded"
    );
}

} // namespace

int main()
{
    return ballistics::testing::run_all();
}
