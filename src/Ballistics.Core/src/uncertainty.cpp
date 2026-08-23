#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <utility>
#include <vector>

#include "ballistics.hpp"

namespace ballistics
{
namespace
{

constexpr double standard_air_density_kg_m3 = 1.225;
constexpr double metres_per_second_to_feet_per_second = 3.280839895013123;

} // namespace

TrajectoryUncertaintyResult propagate_trajectory_uncertainty(
    const Projectile& projectile,
    const Atmosphere& atmosphere,
    const ZeroedTrajectory& baseline,
    double maximum_distance_m,
    double zero_range_m,
    double sight_height_m,
    double muzzle_velocity_multiplier,
    const UncertaintyInputs& uncertainty,
    const std::vector<double>& output_distances_m,
    double output_interval_m,
    const SolverConfiguration& configuration
)
{
    const std::array<std::pair<double, double>, 7> bounded_inputs { {
        { uncertainty.muzzle_velocity_standard_deviation_mps, 200.0 },
        { uncertainty.drag_relative_standard_deviation, 1.0 },
        { uncertainty.temperature_standard_deviation_c, 30.0 },
        { uncertainty.pressure_standard_deviation_hpa, 200.0 },
        { uncertainty.headwind_standard_deviation_mps, 50.0 },
        { uncertainty.crosswind_standard_deviation_mps, 50.0 },
        { uncertainty.zero_range_standard_deviation_m, 200.0 },
    } };
    for (const auto& [value, maximum] : bounded_inputs)
    {
        if (!std::isfinite(value) || value < 0.0 || value > maximum)
        {
            throw std::invalid_argument(
                "Uncertainty inputs must be finite, non-negative, and bounded."
            );
        }
    }
    if (!std::isfinite(maximum_distance_m) || maximum_distance_m < 0.0 ||
        !std::isfinite(zero_range_m) || zero_range_m < 5.0 || zero_range_m > 1000.0 ||
        !std::isfinite(sight_height_m) || sight_height_m < 0.0 || sight_height_m > 0.25 ||
        !std::isfinite(muzzle_velocity_multiplier) || muzzle_velocity_multiplier < 0.5 ||
        muzzle_velocity_multiplier > 1.5)
    {
        throw std::invalid_argument("Uncertainty propagation geometry is invalid.");
    }
    if (output_distances_m.empty())
    {
        throw std::invalid_argument(
            "Uncertainty propagation requires at least one output distance."
        );
    }
    double previous_distance = -1.0;
    for (const auto distance : output_distances_m)
    {
        if (!std::isfinite(distance) || distance < 0.0 || distance > maximum_distance_m ||
            distance <= previous_distance)
        {
            throw std::invalid_argument(
                "Uncertainty output distances must be strictly increasing within the trajectory."
            );
        }
        previous_distance = distance;
    }

    TrajectoryUncertaintyResult result;
    result.samples.reserve(output_distances_m.size());
    for (const auto distance : output_distances_m)
    {
        result.samples.push_back({ distance });
    }
    result.active_input_count = static_cast<std::size_t>(std::count_if(
        bounded_inputs.begin(),
        bounded_inputs.end(),
        [](const auto& item) { return item.first > 0.0; }
    ));
    if (baseline.status != ZeroingStatus::complete || baseline.trajectory.samples.empty())
    {
        result.status = UncertaintyStatus::baseline_unavailable;
        for (auto& sample : result.samples)
        {
            sample.available = false;
        }
        return result;
    }
    for (std::size_t index = 0; index < output_distances_m.size(); ++index)
    {
        if (!baseline.trajectory.sample_at(output_distances_m[index]))
        {
            result.samples[index].available = false;
        }
    }

    if (result.active_input_count == 0)
    {
        result.status = UncertaintyStatus::no_inputs;
        return result;
    }

    const auto squared = [](double value)
    {
        return value * value;
    };
    const auto accumulate_pair =
        [&](const Trajectory& higher,
            const Trajectory& lower,
            double coordinate_span,
            double standard_deviation)
    {
        bool pair_complete = coordinate_span > 0.0;
        for (std::size_t index = 0; index < output_distances_m.size(); ++index)
        {
            auto& output = result.samples[index];
            const auto high = higher.sample_at(output.distance_m);
            const auto low = lower.sample_at(output.distance_m);
            if (!high || !low || coordinate_span <= 0.0)
            {
                output.available = false;
                pair_complete = false;
                continue;
            }
            const auto contribution = [&](double high_value, double low_value)
            {
                return squared((high_value - low_value) / coordinate_span * standard_deviation);
            };
            output.speed_standard_deviation_mps +=
                contribution(high->ground_speed_mps, low->ground_speed_mps);
            output.energy_standard_deviation_j += contribution(high->energy_j, low->energy_j);
            output.momentum_standard_deviation_kgms +=
                contribution(high->momentum_kgms, low->momentum_kgms);
            output.time_standard_deviation_s += contribution(high->time_s, low->time_s);
            output.drop_standard_deviation_m += contribution(high->drop_m, low->drop_m);
            output.path_standard_deviation_m += contribution(
                high->position_m.y - sight_height_m,
                low->position_m.y - sight_height_m
            );
            output.holdover_standard_deviation_rad += contribution(
                elevation_holdover_rad(high->position_m.y - sight_height_m, output.distance_m),
                elevation_holdover_rad(low->position_m.y - sight_height_m, output.distance_m)
            );
            output.wind_drift_standard_deviation_m +=
                contribution(high->wind_drift_m, low->wind_drift_m);
        }
        if (pair_complete)
        {
            ++result.completed_input_count;
        }
    };

    const auto fixed_bore_trajectory =
        [&](const Atmosphere& perturbed_atmosphere,
            double perturbed_multiplier,
            double drag_multiplier = 1.0)
    {
        auto perturbed_configuration = configuration;
        perturbed_configuration.launch_elevation_rad = baseline.bore_elevation_rad;
        perturbed_configuration.terminate_at_ground = false;
        perturbed_configuration.aerodynamic_drag_multiplier =
            configuration.aerodynamic_drag_multiplier * drag_multiplier;
        return integrate_trajectory(
            projectile,
            perturbed_atmosphere,
            maximum_distance_m,
            perturbed_multiplier,
            output_interval_m,
            perturbed_configuration
        );
    };

    if (uncertainty.muzzle_velocity_standard_deviation_mps > 0.0)
    {
        const auto standard_deviation = uncertainty.muzzle_velocity_standard_deviation_mps;
        const auto baseline_velocity =
            projectile.ammunition.muzzle_velocity_mps * muzzle_velocity_multiplier;
        const auto step = std::clamp(standard_deviation * 0.1, 0.05, 1.0);
        const auto lower_velocity =
            std::max(projectile.ammunition.muzzle_velocity_mps * 0.5, baseline_velocity - step);
        const auto higher_velocity =
            std::min(projectile.ammunition.muzzle_velocity_mps * 1.5, baseline_velocity + step);
        accumulate_pair(
            fixed_bore_trajectory(
                atmosphere,
                higher_velocity / projectile.ammunition.muzzle_velocity_mps
            ),
            fixed_bore_trajectory(
                atmosphere,
                lower_velocity / projectile.ammunition.muzzle_velocity_mps
            ),
            higher_velocity - lower_velocity,
            standard_deviation
        );
    }

    if (uncertainty.drag_relative_standard_deviation > 0.0)
    {
        const auto standard_deviation = uncertainty.drag_relative_standard_deviation;
        const auto step = std::clamp(standard_deviation * 0.1, 1e-4, 0.01);
        const auto reference_bc = reference_bc_drag(projectile) != nullptr;
        const auto higher_drag_multiplier = std::exp(reference_bc ? -step : step);
        const auto lower_drag_multiplier = std::exp(reference_bc ? step : -step);
        accumulate_pair(
            fixed_bore_trajectory(atmosphere, muzzle_velocity_multiplier, higher_drag_multiplier),
            fixed_bore_trajectory(atmosphere, muzzle_velocity_multiplier, lower_drag_multiplier),
            2.0 * step,
            standard_deviation
        );
    }

    const auto atmosphere_pair =
        [&](double standard_deviation,
            double baseline_value,
            double minimum,
            double maximum,
            double minimum_step,
            double maximum_step,
            const auto& create_atmosphere)
    {
        if (standard_deviation <= 0.0)
        {
            return;
        }
        const auto step = std::clamp(standard_deviation * 0.1, minimum_step, maximum_step);
        const auto lower_value = std::max(minimum, baseline_value - step);
        const auto higher_value = std::min(maximum, baseline_value + step);
        accumulate_pair(
            fixed_bore_trajectory(create_atmosphere(higher_value), muzzle_velocity_multiplier),
            fixed_bore_trajectory(create_atmosphere(lower_value), muzzle_velocity_multiplier),
            higher_value - lower_value,
            standard_deviation
        );
    };

    atmosphere_pair(
        uncertainty.temperature_standard_deviation_c,
        atmosphere.temperature_c,
        -60.0,
        60.0,
        0.01,
        0.25,
        [&](double value)
        {
            return Atmosphere::create(
                value,
                atmosphere.station_pressure_hpa,
                atmosphere.relative_humidity_percent,
                atmosphere.headwind_mps,
                atmosphere.crosswind_mps
            );
        }
    );
    atmosphere_pair(
        uncertainty.pressure_standard_deviation_hpa,
        atmosphere.station_pressure_hpa,
        500.0,
        1100.0,
        0.1,
        2.0,
        [&](double value)
        {
            return Atmosphere::create(
                atmosphere.temperature_c,
                value,
                atmosphere.relative_humidity_percent,
                atmosphere.headwind_mps,
                atmosphere.crosswind_mps
            );
        }
    );
    atmosphere_pair(
        uncertainty.headwind_standard_deviation_mps,
        atmosphere.headwind_mps,
        -100.0,
        100.0,
        0.01,
        0.25,
        [&](double value)
        {
            return Atmosphere::create(
                atmosphere.temperature_c,
                atmosphere.station_pressure_hpa,
                atmosphere.relative_humidity_percent,
                value,
                atmosphere.crosswind_mps
            );
        }
    );
    atmosphere_pair(
        uncertainty.crosswind_standard_deviation_mps,
        atmosphere.crosswind_mps,
        -100.0,
        100.0,
        0.01,
        0.25,
        [&](double value)
        {
            return Atmosphere::create(
                atmosphere.temperature_c,
                atmosphere.station_pressure_hpa,
                atmosphere.relative_humidity_percent,
                atmosphere.headwind_mps,
                value
            );
        }
    );

    if (uncertainty.zero_range_standard_deviation_m > 0.0)
    {
        const auto standard_deviation = uncertainty.zero_range_standard_deviation_m;
        const auto step = std::clamp(standard_deviation * 0.1, 0.05, 1.0);
        const auto lower_range = std::max(5.0, zero_range_m - step);
        const auto higher_range = std::min(1000.0, zero_range_m + step);
        const auto higher = integrate_zeroed_trajectory(
            projectile,
            atmosphere,
            maximum_distance_m,
            higher_range,
            sight_height_m,
            muzzle_velocity_multiplier,
            output_interval_m,
            configuration
        );
        const auto lower = integrate_zeroed_trajectory(
            projectile,
            atmosphere,
            maximum_distance_m,
            lower_range,
            sight_height_m,
            muzzle_velocity_multiplier,
            output_interval_m,
            configuration
        );
        if (higher.status == ZeroingStatus::complete && lower.status == ZeroingStatus::complete)
        {
            accumulate_pair(
                higher.trajectory,
                lower.trajectory,
                higher_range - lower_range,
                standard_deviation
            );
        }
        else
        {
            for (auto& sample : result.samples)
            {
                sample.available = false;
            }
        }
    }

    for (auto& sample : result.samples)
    {
        sample.speed_standard_deviation_mps = std::sqrt(sample.speed_standard_deviation_mps);
        sample.energy_standard_deviation_j = std::sqrt(sample.energy_standard_deviation_j);
        sample.momentum_standard_deviation_kgms =
            std::sqrt(sample.momentum_standard_deviation_kgms);
        sample.time_standard_deviation_s = std::sqrt(sample.time_standard_deviation_s);
        sample.drop_standard_deviation_m = std::sqrt(sample.drop_standard_deviation_m);
        sample.path_standard_deviation_m = std::sqrt(sample.path_standard_deviation_m);
        sample.holdover_standard_deviation_rad = std::sqrt(sample.holdover_standard_deviation_rad);
        sample.wind_drift_standard_deviation_m = std::sqrt(sample.wind_drift_standard_deviation_m);
    }
    const auto every_sample_available = std::all_of(
        result.samples.begin(),
        result.samples.end(),
        [](const TrajectoryUncertaintySample& sample) { return sample.available; }
    );
    result.status =
        result.completed_input_count == result.active_input_count && every_sample_available
        ? UncertaintyStatus::complete
        : UncertaintyStatus::partial;
    return result;
}

SpinDriftResult compute_spin_drift(
    const Projectile& p,
    double tof,
    double twist,
    double muzzle,
    const Atmosphere& a,
    int sign
)
{
    const auto d = p.definition.geometry ? p.definition.geometry->diameter_inches : 0.0;
    const auto bl = p.definition.geometry ? p.definition.geometry->length_inches : 0.0;

    if (p.firearm.group != FirearmGroup::rifle)
    {
        return { 0.0, 0.0, SpinDriftStatus::not_applicable };
    }
    if (d <= 0.0 || twist <= 0.0 || bl <= 0.0)
    {
        return { 0.0, 0.0, SpinDriftStatus::missing_geometry };
    }

    const auto tcal = twist / d;
    const auto lcal = bl / d;
    const auto mass_gr = p.definition.mass_kg / grains_to_kg;

    const auto base = 30.0 * mass_gr / (tcal * tcal * d * d * d * lcal * (1.0 + lcal * lcal));
    const auto velocity =
        std::pow(std::max(muzzle * metres_per_second_to_feet_per_second / 2800.0, 0.05), 1.0 / 3.0);
    const auto sg = base * velocity * standard_air_density_kg_m3 / std::max(a.density_kg_m3, 0.1);

    if (!std::isfinite(sg) || sg <= 0.0 || !std::isfinite(tof) || tof < 0.0)
    {
        return { 0.0, sg, SpinDriftStatus::invalid_stability };
    }
    if (sg < 1.0)
    {
        return { 0.0, sg, SpinDriftStatus::unstable };
    }
    // Miller's published examples require Sg > 1 for stability and describe 3.5 as the upper end
    // of the supporting experience. The Litz drift expression is not extrapolated beyond it.
    if (sg > 3.5)
    {
        return { 0.0, sg, SpinDriftStatus::outside_empirical_domain };
    }

    const auto drift = 1.25 * (sg + 1.2) * std::pow(tof, 1.83);

    return { (sign < 0 ? -1.0 : 1.0) * drift * inches_to_m, sg, SpinDriftStatus::available };
}

} // namespace ballistics
