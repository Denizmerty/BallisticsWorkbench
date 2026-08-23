#pragma once

#include <ballistics/product_identity.hpp>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

namespace ballistics
{

enum class DragModel
{
    g1,
    g7,
    tabulated_cd,
    sphere
};

enum class FirearmGroup
{
    shotgun,
    rifle
};

enum class WindLayerAxis
{
    height,
    downrange
};

enum class TrajectoryTermination
{
    requested_distance,
    ground_impact,
    minimum_forward_speed,
    maximum_time,
    maximum_steps,
    horizontal_reversal,
    non_finite_state,
};

enum class SolverMode
{
    adaptive_time,
    legacy_distance
};

enum class MpbrStatus
{
    complete,
    horizon_limited,
    no_solution,
    invalid_geometry
};

enum class SpinDriftStatus
{
    available,
    not_applicable,
    missing_geometry,
    invalid_stability,
    unstable,
    outside_empirical_domain
};

enum class ZeroingStatus
{
    complete,
    range_unavailable,
    no_solution,
    invalid_geometry
};

enum class DragValidityStatus
{
    within_domain,
    extrapolated,
    not_declared
};

enum class ObservationRole
{
    calibration,
    holdout
};

enum class ChokeClass
{
    cylinder,
    improved_cylinder,
    modified,
    full,
    custom
};

enum class PelletDeformationClass
{
    soft_lead,
    hardened_lead,
    plated,
    buffered,
    unknown
};

enum class TargetRegionShape
{
    circle,
    rectangle
};

enum class PatternAnalysisStatus
{
    validated_in_domain,
    extrapolated,
    insufficient_information
};

enum class BcFitKind
{
    constant,
    velocity_bands
};

enum class CalibrationStatus
{
    converged,
    maximum_iterations,
    insufficient_information,
    solver_failure,
};

enum class UncertaintyStatus
{
    complete,
    partial,
    no_inputs,
    baseline_unavailable
};

enum class UncertaintyVariable
{
    muzzle_velocity,
    drag,
    temperature,
    pressure,
    headwind,
    crosswind,
    zero_range
};

enum class TrajectoryEventStatus
{
    complete,
    horizon_limited,
    baseline_unavailable,
    not_applicable
};

enum class MachCrossingDirection
{
    accelerating,
    decelerating
};

enum class ValidationSeverity
{
    warning,
    error
};

struct ValidationIssue
{
    std::string code;
    std::string field;
    std::string message;
    ValidationSeverity severity { ValidationSeverity::error };
};

struct Vec3
{
    double x {};
    double y {};
    double z {};

    [[nodiscard]] double magnitude() const;
};

struct BallisticCoefficientBand
{
    double minimum_velocity_mps {};
    double ballistic_coefficient {};
};

struct MachCdPoint
{
    double mach {};
    double drag_coefficient {};
};

enum class ReferenceDragCurve
{
    g1,
    g7
};

struct ConstantBallisticCoefficient
{
    double value {};
};

struct BandedBallisticCoefficient
{
    std::vector<BallisticCoefficientBand> bands;
};

using BallisticCoefficientDefinition =
    std::variant<ConstantBallisticCoefficient, BandedBallisticCoefficient>;

struct ReferenceBcDrag
{
    ReferenceDragCurve curve { ReferenceDragCurve::g1 };
    BallisticCoefficientDefinition coefficient { ConstantBallisticCoefficient {} };
};

struct TabulatedDrag
{
    double reference_diameter_m {};
    std::vector<MachCdPoint> points;
};

struct SphereDrag
{
    double diameter_m {};
    double material_density_kg_m3 {};
};

using DragDefinition = std::variant<ReferenceBcDrag, TabulatedDrag, SphereDrag>;

struct ProjectileGeometry
{
    double length_inches {};
    double diameter_inches {};
};

struct ProjectileDefinition
{
    std::string name;
    std::string short_name;
    double mass_kg {};
    std::optional<ProjectileGeometry> geometry;
    DragDefinition drag { ReferenceBcDrag {} };
};

struct AmmunitionLoad
{
    double muzzle_velocity_mps {};
    int payload_count { 1 };
};

struct FirearmConfiguration
{
    FirearmGroup group { FirearmGroup::shotgun };
    std::optional<double> twist_rate_inches;
};

struct LoadProvenance
{
    bool is_custom {};
    std::string id;
    std::string drag_description;
};

struct BallisticLoad
{
    ProjectileDefinition definition;
    AmmunitionLoad ammunition;
    FirearmConfiguration firearm;
    LoadProvenance provenance;

    [[nodiscard]] double payload_mass_kg() const;
};

// Compatibility name retained for the public API introduced before the domain was split into
// projectile, ammunition, firearm, and provenance ownership. New code should use BallisticLoad.
using Projectile = BallisticLoad;

[[nodiscard]] DragModel drag_model(const Projectile& projectile);

[[nodiscard]] const ReferenceBcDrag* reference_bc_drag(const Projectile& projectile);

[[nodiscard]] ReferenceBcDrag* reference_bc_drag(Projectile& projectile);

[[nodiscard]] const TabulatedDrag* tabulated_drag(const Projectile& projectile);

[[nodiscard]] TabulatedDrag* tabulated_drag(Projectile& projectile);

[[nodiscard]] const SphereDrag* sphere_drag(const Projectile& projectile);

[[nodiscard]] SphereDrag* sphere_drag(Projectile& projectile);

[[nodiscard]] double nominal_ballistic_coefficient(const Projectile& projectile);

struct DragValidity
{
    DragValidityStatus status { DragValidityStatus::not_declared };
    std::optional<double> supported_mach_min;
    std::optional<double> supported_mach_max;
    std::optional<double> supported_reynolds_min;
    std::optional<double> supported_reynolds_max;
    std::optional<double> observed_mach_min;
    std::optional<double> observed_mach_max;
    std::optional<double> observed_reynolds_min;
    std::optional<double> observed_reynolds_max;
};

struct VelocityObservation
{
    double distance_m {};
    double measured_velocity_mps {};
    double standard_deviation_mps {};
    ObservationRole role { ObservationRole::calibration };
};

struct CalibrationResidual
{
    double distance_m {};
    double measured_velocity_mps {};
    double predicted_velocity_mps {};
    double residual_mps {};
    double normalized_residual {};
    double standard_deviation_mps {};
    ObservationRole role { ObservationRole::calibration };
};

struct BallisticCoefficientEstimate
{
    double minimum_velocity_mps {};
    double ballistic_coefficient {};
    std::optional<double> confidence_95_low;
    std::optional<double> confidence_95_high;
};

struct BcCalibrationResult
{
    BcFitKind fit_kind { BcFitKind::constant };
    CalibrationStatus status { CalibrationStatus::solver_failure };
    std::vector<BallisticCoefficientEstimate> estimates;
    std::vector<CalibrationResidual> residuals;
    double calibration_rmse_mps {};
    double weighted_rmse {};
    std::optional<double> holdout_rmse_mps;
    double reduced_chi_square {};
    std::size_t iterations {};
    std::size_t objective_evaluations {};
};

struct PatternObservation
{
    double range_m {};
    double diameter_90_m {};
    double standard_uncertainty_m {};
    std::size_t shell_count { 1 };
    ObservationRole role { ObservationRole::calibration };
};

struct BuckshotTargetRegion
{
    TargetRegionShape shape { TargetRegionShape::circle };
    double width_m {};
    double height_m {};
    double center_horizontal_m {};
    double center_vertical_m {};
};

struct BuckshotPatternInput
{
    std::size_t pellet_count {};
    double mean_muzzle_velocity_mps {};
    double pellet_velocity_standard_deviation_mps {};
    ChokeClass choke { ChokeClass::cylinder };
    PelletDeformationClass deformation { PelletDeformationClass::unknown };
    double target_range_m {};
    std::size_t minimum_pellet_count { 1 };
    BuckshotTargetRegion target;
    std::vector<PatternObservation> observations;
};

struct PatternResidual
{
    double range_m {};
    double measured_diameter_90_m {};
    double predicted_diameter_90_m {};
    double residual_m {};
    double normalized_residual {};
    ObservationRole role { ObservationRole::calibration };
};

struct BuckshotPatternResult
{
    PatternAnalysisStatus status { PatternAnalysisStatus::insufficient_information };
    double fitted_angular_diameter_rad {};
    double angular_standard_uncertainty_rad {};
    double calibration_rmse_m {};
    std::optional<double> holdout_rmse_m;
    double reduced_chi_square {};
    double calibration_range_min_m {};
    double calibration_range_max_m {};
    double predicted_diameter_90_m {};
    double predicted_diameter_90_low_95_m {};
    double predicted_diameter_90_high_95_m {};
    double per_pellet_hit_probability {};
    double per_pellet_hit_probability_low_95 {};
    double per_pellet_hit_probability_high_95 {};
    double expected_pellet_count {};
    double probability_at_least_minimum {};
    std::vector<double> pellet_count_probabilities;
    std::vector<PatternResidual> residuals;
    std::string validity_statement;
};

struct UncertaintyInputs
{
    double muzzle_velocity_standard_deviation_mps {};
    double drag_relative_standard_deviation {};
    double temperature_standard_deviation_c {};
    double pressure_standard_deviation_hpa {};
    double headwind_standard_deviation_mps {};
    double crosswind_standard_deviation_mps {};
    double zero_range_standard_deviation_m {};
};

struct TrajectoryUncertaintySample
{
    double distance_m {};
    bool available { true };
    double speed_standard_deviation_mps {};
    double energy_standard_deviation_j {};
    double momentum_standard_deviation_kgms {};
    double time_standard_deviation_s {};
    double drop_standard_deviation_m {};
    double path_standard_deviation_m {};
    double holdover_standard_deviation_rad {};
    double wind_drift_standard_deviation_m {};
};

struct TrajectoryUncertaintyResult
{
    UncertaintyStatus status { UncertaintyStatus::baseline_unavailable };
    std::size_t active_input_count {};
    std::size_t completed_input_count {};
    std::vector<TrajectoryUncertaintySample> samples;
};

struct UncertaintyCorrelation
{
    UncertaintyVariable first { UncertaintyVariable::muzzle_velocity };
    UncertaintyVariable second { UncertaintyVariable::drag };
    double coefficient {};
};

struct UncertaintyInterval
{
    double median {};
    double low_95 {};
    double high_95 {};
};

struct MonteCarloUncertaintySample
{
    double distance_m {};
    bool available { true };
    UncertaintyInterval speed_mps;
    UncertaintyInterval energy_j;
    UncertaintyInterval momentum_kgms;
    UncertaintyInterval time_s;
    UncertaintyInterval drop_m;
    UncertaintyInterval path_m;
    UncertaintyInterval holdover_rad;
    UncertaintyInterval wind_drift_m;
};

struct MonteCarloUncertaintyResult
{
    UncertaintyStatus status { UncertaintyStatus::baseline_unavailable };
    std::uint64_t seed {};
    std::size_t requested_sample_count {};
    std::size_t completed_sample_count {};
    double maximum_split_quantile_delta {};
    std::vector<MonteCarloUncertaintySample> samples;
};

struct Atmosphere
{
    double temperature_c {};
    double station_pressure_hpa {};
    double relative_humidity_percent {};
    double headwind_mps {};
    double crosswind_mps {};
    double density_kg_m3 {};
    double speed_of_sound_mps {};
    double dynamic_viscosity_pa_s {};

    // Positive headwind_mps blows toward the shooter. Positive crosswind_mps blows from the
    // shooter's left to right, deflecting the projectile to the right (matching the spin-drift sign
    // convention).
    [[nodiscard]] static Atmosphere create(
        double temperature_c,
        double station_pressure_hpa,
        double relative_humidity_percent,
        double headwind_mps,
        double crosswind_mps = 0.0
    );
};

struct AtmosphereModelValidity
{
    bool density_within_declared_domain {};
    bool sound_speed_within_declared_domain {};
    bool viscosity_within_declared_domain {};
    std::string density_model;
    std::string sound_speed_model;
    std::string viscosity_model;
};

struct WindLayer
{
    WindLayerAxis axis { WindLayerAxis::height };
    double start_m {};
    double end_m {};
    double start_headwind_mps {};
    double end_headwind_mps {};
    double start_crosswind_mps {};
    double end_crosswind_mps {};
    std::string source;
};

struct Environment
{
    Atmosphere firing_point;
    double firing_point_altitude_m {};
    bool altitude_dependent_atmosphere {};
    bool use_local_gravity {};
    bool coriolis_enabled {};
    double latitude_deg { 45.0 };
    double shot_azimuth_deg {};
    std::vector<WindLayer> wind_layers;
    std::string wind_provenance;

    [[nodiscard]] static Environment homogeneous(const Atmosphere& atmosphere);

    [[nodiscard]] Atmosphere atmosphere_at(const Vec3& position_m) const;

    [[nodiscard]] double gravity_at_height(double height_m) const;

    [[nodiscard]] Vec3
    coriolis_acceleration(const Vec3& ground_velocity_mps, double height_m) const;
};

struct AerodynamicDiagnostics
{
    double ground_speed_mps {};
    double airspeed_mps {};
    double cd {};
    double reynolds {};
    double mach {};
    bool has_drag_coefficient {};
    bool has_reynolds {};
};

struct TrajectorySample
{
    double distance_m {};
    Vec3 position_m;
    Vec3 ground_velocity_mps;
    Vec3 air_relative_velocity_mps;
    double ground_speed_mps {};
    double airspeed_mps {};
    double energy_j {};
    double momentum_kgms {};
    double time_s {};
    double drop_m {};
    double wind_drift_m {};
    AerodynamicDiagnostics aerodynamics;
};

struct SolverConfiguration
{
    SolverMode mode { SolverMode::adaptive_time };
    double relative_tolerance { 5e-10 };
    double absolute_position_tolerance_m { 5e-10 };
    double absolute_velocity_tolerance_mps { 5e-9 };
    double initial_time_step_s { 1e-3 };
    double minimum_time_step_s { 1e-8 };
    double maximum_time_step_s { 0.05 };
    double maximum_time_s { 120.0 };
    std::size_t maximum_steps { 2000000 };
    double minimum_forward_speed_mps { 1.0 };
    double launch_elevation_rad {};
    double launch_azimuth_rad {};
    // Elevation of the sight/target line above local horizontal. Bore elevation is expressed in
    // the same local coordinate frame and therefore includes this base angle after zeroing.
    double sight_line_elevation_rad {};
    bool terminate_at_ground {};
    double ground_height_m {};
    bool include_aerodynamic_drag { true };
    // Verification/reference scenarios may disable gravity. Application requests use the default.
    bool include_gravity { true };
    double aerodynamic_drag_multiplier { 1.0 };
};

struct ShotGeometry
{
    double maximum_distance_m {};
    double zero_range_m {};
    double sight_height_m {};
    double target_distance_m {};
    double target_elevation_m {};
    double target_inclination_rad {};
    double vital_zone_m {};
    double output_interval_m { 0.25 };
};

struct ShotScenario
{
    Environment environment;
    ShotGeometry geometry;
    SolverConfiguration solver;
    double muzzle_velocity_multiplier { 1.0 };
};

struct SolverDiagnostics
{
    SolverMode mode { SolverMode::adaptive_time };
    std::size_t attempted_steps {};
    std::size_t accepted_steps {};
    std::size_t rejected_steps {};
    double minimum_accepted_time_step_s {};
    double maximum_accepted_time_step_s {};
    double final_time_step_s {};
    double maximum_error_norm {};
};

struct Trajectory
{
    std::vector<TrajectorySample> samples;
    double mass_kg {};
    double requested_distance_m {};
    double covered_distance_m {};
    TrajectoryTermination termination { TrajectoryTermination::requested_distance };
    SolverDiagnostics solver;

    [[nodiscard]] std::optional<TrajectorySample> sample_at(double distance_m) const;
};

struct ZeroedTrajectory
{
    Trajectory trajectory;
    double bore_elevation_rad {};
    double zero_error_m {};
    ZeroingStatus status { ZeroingStatus::invalid_geometry };
};

struct MachCrossing
{
    double mach {};
    double distance_m {};
    MachCrossingDirection direction { MachCrossingDirection::decelerating };
};

struct TrajectoryEvents
{
    double analyzed_distance_m {};
    TrajectoryEventStatus zero_crossings_status { TrajectoryEventStatus::baseline_unavailable };
    std::optional<double> near_zero_m;
    std::optional<double> far_zero_m;
    TrajectoryEventStatus maximum_ordinate_status { TrajectoryEventStatus::baseline_unavailable };
    std::optional<double> maximum_ordinate_distance_m;
    std::optional<double> maximum_ordinate_path_m;
    TrajectoryEventStatus supersonic_range_status { TrajectoryEventStatus::baseline_unavailable };
    std::optional<double> supersonic_range_m;
    TrajectoryEventStatus ground_intersection_status {
        TrajectoryEventStatus::baseline_unavailable
    };
    std::optional<double> ground_intersection_m;
    std::vector<MachCrossing> mach_crossings;
};

struct MpbrResult
{
    double zero_m {};
    double mpbr_m {};
    MpbrStatus status { MpbrStatus::no_solution };
};

struct SpinDriftResult
{
    double drift_m {};
    double gyroscopic_stability {};
    SpinDriftStatus status { SpinDriftStatus::not_applicable };
};

inline constexpr double gravity_mps2 = 9.80665;
inline constexpr double fps_to_mps = 0.3048;
inline constexpr double inches_to_m = 0.0254;
inline constexpr double grains_to_kg = 0.00006479891;
inline constexpr std::string_view engine_version = identity::engine_version;
inline constexpr std::string_view model_version = identity::model_version;
inline constexpr double sphere_supported_mach_min = 0.2;
inline constexpr double sphere_supported_mach_max = 1.5;
inline constexpr double sphere_supported_reynolds_min = 100.0;
inline constexpr double sphere_supported_reynolds_max = 2.0e6;

[[nodiscard]] double altitude_to_pressure_hpa(double altitude_m);

[[nodiscard]] double pressure_to_altitude_m(double pressure_hpa);

[[nodiscard]] double altimeter_setting_to_station_pressure_hpa(
    double altimeter_setting_hpa,
    double geometric_altitude_m
);

[[nodiscard]] double
station_pressure_to_altimeter_setting_hpa(double station_pressure_hpa, double geometric_altitude_m);

[[nodiscard]] double density_to_altitude_m(double density_kg_m3);

[[nodiscard]] AtmosphereModelValidity atmosphere_model_validity(const Atmosphere& atmosphere);

[[nodiscard]] double line_of_sight_path_m(
    const TrajectorySample& sample,
    double sight_height_m,
    double sight_line_elevation_rad
);

[[nodiscard]] double elevation_holdover_rad(double path_m, double distance_m);

[[nodiscard]] double sphere_drag_vs_reynolds(double reynolds);

[[nodiscard]] double sphere_drag_coefficient(double mach, double reynolds);

[[nodiscard]] double g7_drag_coefficient(double mach);

[[nodiscard]] double g1_drag_coefficient(double mach);

[[nodiscard]] double tabulated_drag_coefficient(const Projectile& projectile, double mach);

[[nodiscard]] double drag_retardation_mps2(
    double relative_speed_mps,
    const Projectile& projectile,
    const Atmosphere& atmosphere
);

[[nodiscard]] double
effective_ballistic_coefficient(const Projectile& projectile, double airspeed_mps);

[[nodiscard]] AerodynamicDiagnostics aerodynamic_diagnostics(
    const Projectile& projectile,
    const Vec3& ground_velocity_mps,
    const Atmosphere& atmosphere
);

[[nodiscard]] Trajectory integrate_trajectory(
    const Projectile& projectile,
    const Atmosphere& atmosphere,
    double maximum_distance_m,
    double muzzle_velocity_multiplier = 1.0,
    double dx_m = 0.25
);

[[nodiscard]] Trajectory integrate_trajectory(
    const Projectile& projectile,
    const Atmosphere& atmosphere,
    double maximum_distance_m,
    double muzzle_velocity_multiplier,
    double output_interval_m,
    const SolverConfiguration& configuration
);

[[nodiscard]] Trajectory integrate_trajectory(
    const Projectile& projectile,
    const Environment& environment,
    double maximum_distance_m,
    double muzzle_velocity_multiplier,
    double output_interval_m,
    const SolverConfiguration& configuration
);

[[nodiscard]] ZeroedTrajectory
integrate_shot_scenario(const Projectile& projectile, const ShotScenario& scenario);

// Validation-only compatibility path. Production callers use the adaptive time-domain solver.
[[nodiscard]] Trajectory integrate_trajectory_legacy(
    const Projectile& projectile,
    const Atmosphere& atmosphere,
    double maximum_distance_m,
    double muzzle_velocity_multiplier = 1.0,
    double dx_m = 0.25
);

[[nodiscard]] ZeroedTrajectory integrate_zeroed_trajectory(
    const Projectile& projectile,
    const Atmosphere& atmosphere,
    double maximum_distance_m,
    double zero_range_m,
    double sight_height_m,
    double muzzle_velocity_multiplier = 1.0,
    double output_interval_m = 0.25,
    const SolverConfiguration& configuration = SolverConfiguration {}
);

[[nodiscard]] TrajectoryEvents analyze_trajectory_events(
    const ZeroedTrajectory& zeroed,
    double sight_height_m,
    double sight_line_elevation_rad = 0.0
);

[[nodiscard]] MpbrResult
compute_mpbr(const Trajectory& trajectory, double vital_zone_m, double sight_height_m = 0.0);

[[nodiscard]] MpbrResult compute_native_mpbr(
    const Projectile& projectile,
    const Atmosphere& atmosphere,
    double maximum_distance_m,
    double vital_zone_m,
    double sight_height_m = 0.0,
    double muzzle_velocity_multiplier = 1.0,
    double output_interval_m = 0.25,
    const SolverConfiguration& configuration = SolverConfiguration {}
);

[[nodiscard]] MpbrResult
compute_scenario_mpbr(const Projectile& projectile, const ShotScenario& scenario);

[[nodiscard]] DragValidity evaluate_drag_validity(
    const Projectile& projectile,
    const Trajectory& trajectory,
    double maximum_distance_m
);

[[nodiscard]] BcCalibrationResult calibrate_reference_ballistic_coefficient(
    const Projectile& projectile,
    const Atmosphere& atmosphere,
    const std::vector<VelocityObservation>& observations,
    BcFitKind fit_kind,
    const std::vector<double>& band_minimum_velocities_mps = {},
    std::size_t maximum_iterations = 30
);

[[nodiscard]] BuckshotPatternResult analyze_buckshot_pattern(const BuckshotPatternInput& input);

[[nodiscard]] TrajectoryUncertaintyResult propagate_trajectory_uncertainty(
    const Projectile& projectile,
    const Atmosphere& atmosphere,
    const ZeroedTrajectory& baseline,
    double maximum_distance_m,
    double zero_range_m,
    double sight_height_m,
    double muzzle_velocity_multiplier,
    const UncertaintyInputs& uncertainty,
    const std::vector<double>& output_distances_m,
    double output_interval_m = 0.25,
    const SolverConfiguration& configuration = SolverConfiguration {}
);

[[nodiscard]] MonteCarloUncertaintyResult propagate_monte_carlo_uncertainty(
    const Projectile& projectile,
    const ShotScenario& baseline_scenario,
    const UncertaintyInputs& uncertainty,
    const std::vector<UncertaintyCorrelation>& correlations,
    const std::vector<double>& output_distances_m,
    std::size_t sample_count = 1000,
    std::uint64_t seed = 0x42574d43ULL
);

[[nodiscard]] SpinDriftResult compute_spin_drift(
    const Projectile& projectile,
    double time_of_flight_s,
    double twist_rate_inches,
    double muzzle_velocity_mps,
    const Atmosphere& atmosphere,
    int twist_direction_sign = 1
);

[[nodiscard]] std::vector<ValidationIssue> validate_projectile(const Projectile& projectile);

[[nodiscard]] const std::vector<Projectile>& built_in_projectiles();

} // namespace ballistics
