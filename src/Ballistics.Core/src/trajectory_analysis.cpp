#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <optional>
#include <stdexcept>
#include <utility>

#include "ballistics.hpp"

namespace ballistics
{

ZeroedTrajectory integrate_zeroed_trajectory(
    const Projectile& p,
    const Atmosphere& a,
    double max_distance,
    double zero_range,
    double sight_height,
    double multiplier,
    double output_interval,
    const SolverConfiguration& configuration
)
{
    if (!std::isfinite(zero_range) || !std::isfinite(sight_height) || zero_range <= 0.0 ||
        sight_height < 0.0 || configuration.mode != SolverMode::adaptive_time)
    {
        return { {}, 0.0, 0.0, ZeroingStatus::invalid_geometry };
    }

    auto solve_configuration = configuration;
    solve_configuration.terminate_at_ground = false;

    const auto evaluate = [&](double elevation) -> std::optional<double>
    {
        solve_configuration.launch_elevation_rad = elevation;
        const auto candidate = integrate_trajectory(
            p,
            a,
            zero_range,
            multiplier,
            output_interval,
            solve_configuration
        );
        const auto endpoint = candidate.sample_at(zero_range);
        if (!endpoint || candidate.termination != TrajectoryTermination::requested_distance)
        {
            return std::nullopt;
        }
        return line_of_sight_path_m(
            *endpoint,
            sight_height,
            configuration.sight_line_elevation_rad
        );
    };

    double low = configuration.sight_line_elevation_rad - 0.05;
    double high = configuration.sight_line_elevation_rad + 0.05;
    auto low_error = evaluate(low);
    auto high_error = evaluate(high);
    if (!low_error || !high_error)
    {
        solve_configuration.launch_elevation_rad = configuration.sight_line_elevation_rad;
        return {
            integrate_trajectory(
                p,
                a,
                max_distance,
                multiplier,
                output_interval,
                solve_configuration
            ),
            0.0,
            0.0,
            ZeroingStatus::range_unavailable
        };
    }

    for (int expansion = 0; expansion < 4 && (*low_error > 0.0 || *high_error < 0.0); ++expansion)
    {
        low = std::max(-0.4, low * 2.0);
        high = std::min(0.4, high * 2.0);
        low_error = evaluate(low);
        high_error = evaluate(high);
        if (!low_error || !high_error)
        {
            break;
        }
    }
    if (!low_error || !high_error || *low_error > 0.0 || *high_error < 0.0)
    {
        solve_configuration.launch_elevation_rad = configuration.sight_line_elevation_rad;
        return {
            integrate_trajectory(
                p,
                a,
                max_distance,
                multiplier,
                output_interval,
                solve_configuration
            ),
            0.0,
            0.0,
            ZeroingStatus::no_solution
        };
    }

    double midpoint = 0.0;
    double midpoint_error = 0.0;
    for (int iteration = 0; iteration < 50; ++iteration)
    {
        midpoint = (low + high) / 2.0;
        const auto error = evaluate(midpoint);
        if (!error)
        {
            solve_configuration.launch_elevation_rad = configuration.sight_line_elevation_rad;
            return {
                integrate_trajectory(
                    p,
                    a,
                    max_distance,
                    multiplier,
                    output_interval,
                    solve_configuration
                ),
                0.0,
                0.0,
                ZeroingStatus::range_unavailable
            };
        }
        midpoint_error = *error;
        if (std::abs(midpoint_error) <= 1e-8)
        {
            break;
        }
        if (midpoint_error < 0.0)
        {
            low = midpoint;
        }
        else
        {
            high = midpoint;
        }
    }

    solve_configuration = configuration;
    solve_configuration.launch_elevation_rad = midpoint;
    auto trajectory =
        integrate_trajectory(p, a, max_distance, multiplier, output_interval, solve_configuration);
    if (max_distance >= zero_range)
    {
        if (const auto zero_sample = trajectory.sample_at(zero_range))
        {
            midpoint_error = line_of_sight_path_m(
                *zero_sample,
                sight_height,
                configuration.sight_line_elevation_rad
            );
        }
    }
    return { std::move(trajectory), midpoint, midpoint_error, ZeroingStatus::complete };
}

ZeroedTrajectory integrate_shot_scenario(
    const Projectile& projectile,
    const ShotScenario& scenario
)
{
    const auto& geometry = scenario.geometry;
    if (!std::isfinite(geometry.maximum_distance_m) || geometry.maximum_distance_m < 0.0 ||
        !std::isfinite(geometry.zero_range_m) || geometry.zero_range_m <= 0.0 ||
        !std::isfinite(geometry.sight_height_m) || geometry.sight_height_m < 0.0 ||
        !std::isfinite(geometry.target_distance_m) || geometry.target_distance_m < 0.0 ||
        !std::isfinite(geometry.target_elevation_m) ||
        !std::isfinite(geometry.target_inclination_rad) ||
        std::abs(geometry.target_inclination_rad) >= std::acos(-1.0) / 2.0 ||
        !std::isfinite(geometry.output_interval_m) || geometry.output_interval_m <= 0.0)
    {
        return { {}, 0.0, 0.0, ZeroingStatus::invalid_geometry };
    }
    if (std::abs(geometry.target_elevation_m) > 1e-12 &&
        std::abs(geometry.target_inclination_rad) > 1e-12)
    {
        return { {}, 0.0, 0.0, ZeroingStatus::invalid_geometry };
    }

    auto configuration = scenario.solver;
    configuration.sight_line_elevation_rad = std::abs(geometry.target_elevation_m) > 1e-12
        ? std::atan2(geometry.target_elevation_m, geometry.target_distance_m)
        : geometry.target_inclination_rad;
    configuration.launch_elevation_rad = configuration.sight_line_elevation_rad;

    const auto evaluate = [&](double elevation) -> std::optional<double>
    {
        auto candidate_configuration = configuration;
        candidate_configuration.launch_elevation_rad = elevation;
        candidate_configuration.terminate_at_ground = false;
        const auto candidate = integrate_trajectory(
            projectile,
            scenario.environment,
            geometry.zero_range_m,
            scenario.muzzle_velocity_multiplier,
            geometry.output_interval_m,
            candidate_configuration
        );
        const auto endpoint = candidate.sample_at(geometry.zero_range_m);
        if (!endpoint || candidate.termination != TrajectoryTermination::requested_distance)
        {
            return std::nullopt;
        }
        return line_of_sight_path_m(
            *endpoint,
            geometry.sight_height_m,
            configuration.sight_line_elevation_rad
        );
    };

    auto low = configuration.sight_line_elevation_rad - 0.05;
    auto high = configuration.sight_line_elevation_rad + 0.05;
    auto low_error = evaluate(low);
    auto high_error = evaluate(high);
    for (int expansion = 0;
         expansion < 4 && low_error && high_error && (*low_error > 0.0 || *high_error < 0.0);
         ++expansion)
    {
        const auto half_width = 0.05 * std::pow(2.0, expansion + 1);
        low = std::max(-0.4, configuration.sight_line_elevation_rad - half_width);
        high = std::min(0.4, configuration.sight_line_elevation_rad + half_width);
        low_error = evaluate(low);
        high_error = evaluate(high);
    }
    if (!low_error || !high_error)
    {
        return { {}, 0.0, 0.0, ZeroingStatus::range_unavailable };
    }
    if (*low_error > 0.0 || *high_error < 0.0)
    {
        return { {}, 0.0, 0.0, ZeroingStatus::no_solution };
    }

    auto midpoint = (low + high) / 2.0;
    auto midpoint_error = 0.0;
    for (int iteration = 0; iteration < 50; ++iteration)
    {
        midpoint = (low + high) / 2.0;
        const auto error = evaluate(midpoint);
        if (!error)
        {
            return { {}, midpoint, 0.0, ZeroingStatus::range_unavailable };
        }
        midpoint_error = *error;
        if (std::abs(midpoint_error) <= 1e-8)
        {
            break;
        }
        if (midpoint_error < 0.0)
        {
            low = midpoint;
        }
        else
        {
            high = midpoint;
        }
    }

    configuration.launch_elevation_rad = midpoint;
    auto trajectory = integrate_trajectory(
        projectile,
        scenario.environment,
        geometry.maximum_distance_m,
        scenario.muzzle_velocity_multiplier,
        geometry.output_interval_m,
        configuration
    );
    if (const auto zero_sample = trajectory.sample_at(geometry.zero_range_m))
    {
        midpoint_error = line_of_sight_path_m(
            *zero_sample,
            geometry.sight_height_m,
            configuration.sight_line_elevation_rad
        );
    }
    return { std::move(trajectory), midpoint, midpoint_error, ZeroingStatus::complete };
}

TrajectoryEvents analyze_trajectory_events(
    const ZeroedTrajectory& zeroed,
    double sight_height,
    double sight_line_elevation_rad
)
{
    if (!std::isfinite(sight_height) || sight_height < 0.0 ||
        !std::isfinite(sight_line_elevation_rad) ||
        std::abs(sight_line_elevation_rad) >= std::acos(-1.0) / 2.0)
    {
        throw std::invalid_argument(
            "Trajectory-event sight height must be finite and non-negative."
        );
    }

    TrajectoryEvents result;
    const auto& trajectory = zeroed.trajectory;
    result.analyzed_distance_m = trajectory.covered_distance_m;
    if (zeroed.status != ZeroingStatus::complete || trajectory.samples.size() < 2)
    {
        return result;
    }

    constexpr double value_tolerance = 1e-10;
    const auto sight_line_slope = std::tan(sight_line_elevation_rad);
    const auto range_slope = [](const TrajectorySample& sample)
    {
        return std::abs(sample.ground_velocity_mps.x) > 1e-12
            ? sample.ground_velocity_mps.y / sample.ground_velocity_mps.x
            : 0.0;
    };
    const auto range_value =
        [&](const TrajectorySample& first,
            const TrajectorySample& second,
            double fraction,
            double intercept,
            double slope)
    {
        const auto span = second.distance_m - first.distance_m;
        const auto u2 = fraction * fraction;
        const auto u3 = u2 * fraction;
        const auto first_value = first.position_m.y - intercept - slope * first.distance_m;
        const auto second_value = second.position_m.y - intercept - slope * second.distance_m;
        return (2.0 * u3 - 3.0 * u2 + 1.0) * first_value +
            (u3 - 2.0 * u2 + fraction) * span * (range_slope(first) - slope) +
            (-2.0 * u3 + 3.0 * u2) * second_value +
            (u3 - u2) * span * (range_slope(second) - slope);
    };
    const auto range_derivative =
        [&](const TrajectorySample& first,
            const TrajectorySample& second,
            double fraction,
            double intercept,
            double slope)
    {
        const auto span = second.distance_m - first.distance_m;
        const auto u2 = fraction * fraction;
        const auto first_value = first.position_m.y - intercept - slope * first.distance_m;
        const auto second_value = second.position_m.y - intercept - slope * second.distance_m;
        return (6.0 * u2 - 6.0 * fraction) * first_value +
            (3.0 * u2 - 4.0 * fraction + 1.0) * span * (range_slope(first) - slope) +
            (-6.0 * u2 + 6.0 * fraction) * second_value +
            (3.0 * u2 - 2.0 * fraction) * span * (range_slope(second) - slope);
    };
    const auto root_fraction =
        [&](const TrajectorySample& first,
            const TrajectorySample& second,
            double intercept,
            double slope)
    {
        double low = 0.0;
        double high = 1.0;
        const auto initial = range_value(first, second, low, intercept, slope);
        for (int iteration = 0; iteration < 60; ++iteration)
        {
            const auto middle = (low + high) / 2.0;
            const auto value = range_value(first, second, middle, intercept, slope);
            if ((initial < 0.0) == (value < 0.0))
            {
                low = middle;
            }
            else
            {
                high = middle;
            }
        }
        return (low + high) / 2.0;
    };
    const auto range_at_fraction =
        [](const TrajectorySample& first, const TrajectorySample& second, double fraction)
    {
        return first.distance_m + fraction * (second.distance_m - first.distance_m);
    };

    bool found_apex = false;
    bool found_ground = false;
    if (range_slope(trajectory.samples.front()) <= sight_line_slope)
    {
        result.maximum_ordinate_distance_m = 0.0;
        result.maximum_ordinate_path_m = -sight_height;
        result.maximum_ordinate_status = TrajectoryEventStatus::complete;
        found_apex = true;
    }

    constexpr std::array<double, 3> transonic_thresholds { 1.2, 1.0, 0.8 };
    for (std::size_t index = 1; index < trajectory.samples.size(); ++index)
    {
        const auto& first = trajectory.samples[index - 1];
        const auto& second = trajectory.samples[index];
        const auto first_path =
            first.position_m.y - sight_height - sight_line_slope * first.distance_m;
        const auto second_path =
            second.position_m.y - sight_height - sight_line_slope * second.distance_m;

        if (!result.near_zero_m && first_path < -value_tolerance && second_path >= -value_tolerance)
        {
            result.near_zero_m = range_at_fraction(
                first,
                second,
                root_fraction(first, second, sight_height, sight_line_slope)
            );
        }
        if (!result.far_zero_m && first_path > value_tolerance && second_path <= value_tolerance)
        {
            result.far_zero_m = range_at_fraction(
                first,
                second,
                root_fraction(first, second, sight_height, sight_line_slope)
            );
        }

        if (!found_apex && range_slope(first) > sight_line_slope &&
            range_slope(second) <= sight_line_slope)
        {
            double low = 0.0;
            double high = 1.0;
            for (int iteration = 0; iteration < 60; ++iteration)
            {
                const auto middle = (low + high) / 2.0;
                if (range_derivative(first, second, middle, sight_height, sight_line_slope) > 0.0)
                {
                    low = middle;
                }
                else
                {
                    high = middle;
                }
            }
            const auto fraction = (low + high) / 2.0;
            result.maximum_ordinate_distance_m = range_at_fraction(first, second, fraction);
            result.maximum_ordinate_path_m =
                range_value(first, second, fraction, sight_height, sight_line_slope);
            result.maximum_ordinate_status = TrajectoryEventStatus::complete;
            found_apex = true;
        }

        if (!found_ground && first.position_m.y > value_tolerance &&
            second.position_m.y <= value_tolerance)
        {
            result.ground_intersection_m =
                range_at_fraction(first, second, root_fraction(first, second, 0.0, 0.0));
            result.ground_intersection_status = TrajectoryEventStatus::complete;
            found_ground = true;
        }

        for (const auto threshold : transonic_thresholds)
        {
            const auto first_delta = first.aerodynamics.mach - threshold;
            const auto second_delta = second.aerodynamics.mach - threshold;
            const auto decelerating = first_delta > 0.0 && second_delta <= 0.0;
            const auto accelerating = first_delta < 0.0 && second_delta >= 0.0;
            if (!decelerating && !accelerating)
            {
                continue;
            }
            const auto denominator = first.aerodynamics.mach - second.aerodynamics.mach;
            const auto fraction = denominator == 0.0 ? 0.0 : first_delta / denominator;
            result.mach_crossings.push_back(
                { threshold,
                  range_at_fraction(first, second, std::clamp(fraction, 0.0, 1.0)),
                  decelerating ? MachCrossingDirection::decelerating
                               : MachCrossingDirection::accelerating }
            );
        }
    }

    std::sort(
        result.mach_crossings.begin(),
        result.mach_crossings.end(),
        [](const MachCrossing& first, const MachCrossing& second)
        {
            if (first.distance_m != second.distance_m)
            {
                return first.distance_m < second.distance_m;
            }
            return first.mach > second.mach;
        }
    );

    result.zero_crossings_status = result.near_zero_m && result.far_zero_m
        ? TrajectoryEventStatus::complete
        : TrajectoryEventStatus::horizon_limited;
    if (!found_apex)
    {
        result.maximum_ordinate_status = TrajectoryEventStatus::horizon_limited;
    }
    if (!found_ground)
    {
        result.ground_intersection_status = TrajectoryEventStatus::horizon_limited;
    }

    if (trajectory.samples.front().aerodynamics.mach <= 1.0)
    {
        result.supersonic_range_status = TrajectoryEventStatus::not_applicable;
    }
    else
    {
        const auto crossing = std::find_if(
            result.mach_crossings.begin(),
            result.mach_crossings.end(),
            [](const MachCrossing& item)
            { return item.mach == 1.0 && item.direction == MachCrossingDirection::decelerating; }
        );
        if (crossing == result.mach_crossings.end())
        {
            result.supersonic_range_status = TrajectoryEventStatus::horizon_limited;
        }
        else
        {
            result.supersonic_range_m = crossing->distance_m;
            result.supersonic_range_status = TrajectoryEventStatus::complete;
        }
    }
    return result;
}

MpbrResult compute_mpbr(
    const Trajectory& t,
    double vital,
    double sight
)
{
    const auto radius = vital / 2.0;

    if (!std::isfinite(radius) || !std::isfinite(sight) || radius <= 0.0 || sight < 0.0 ||
        sight > radius || t.samples.empty() || t.covered_distance_m < 5.0)
    {
        return { 0.0, 0.0, MpbrStatus::invalid_geometry };
    }

    const auto height = [&](const TrajectorySample& sample, double zero, double drop_zero)
    {
        return -sample.drop_m - sight + (drop_zero + sight) * sample.distance_m / zero;
    };

    const auto ordinate = [&](double zero)
    {
        const auto zero_sample = t.sample_at(zero);
        if (!zero_sample)
        {
            return std::numeric_limits<double>::quiet_NaN();
        }
        const auto dz = zero_sample->drop_m;
        auto best = -sight;
        for (const auto& sample : t.samples)
        {
            if (sample.distance_m > zero * 1.5 + 50.0)
            {
                break;
            }
            best = std::max(best, height(sample, zero, dz));
        }
        return best;
    };

    const auto search_hi = std::min(t.covered_distance_m * 0.9, 1500.0);
    if (search_hi <= 5.0)
    {
        return { 0.0, 0.0, MpbrStatus::horizon_limited };
    }

    // The maximum-ordinate function can be high for a very short zero, fall below the vital-zone
    // radius, then rise through the desired far/optimal-zero root. Scan for the final negative-to-
    // positive bracket before refining it.
    double lo = 0.0;
    double hi = 0.0;
    auto previous_zero = 5.0;
    auto previous_value = ordinate(previous_zero) - radius;
    constexpr int bracket_steps = 96;
    for (int i = 1; i <= bracket_steps; ++i)
    {
        const auto candidate = 5.0 + (search_hi - 5.0) * static_cast<double>(i) / bracket_steps;
        const auto value = ordinate(candidate) - radius;
        if (std::isfinite(previous_value) && std::isfinite(value) && previous_value <= 0.0 &&
            value >= 0.0)
        {
            lo = previous_zero;
            hi = candidate;
        }
        previous_zero = candidate;
        previous_value = value;
    }

    if (hi <= lo)
    {
        // Without a bracket we cannot distinguish a missing solution from one beyond the
        // supplied trajectory. Do not make a numerical claim. Callers may extend the horizon.
        return { 0.0, 0.0, MpbrStatus::horizon_limited };
    }

    for (int i = 0; i < 60; ++i)
    {
        const auto mid = (lo + hi) / 2.0;
        if (ordinate(mid) > radius)
        {
            hi = mid;
        }
        else
        {
            lo = mid;
        }
    }

    const auto zero = (lo + hi) / 2.0;
    const auto zero_sample = t.sample_at(zero);
    if (!zero_sample)
    {
        return { 0.0, 0.0, MpbrStatus::horizon_limited };
    }
    const auto dz = zero_sample->drop_m;

    auto mpbr = zero;
    auto previous = height(t.samples.front(), zero, dz);
    bool found = false;

    for (std::size_t i = 1; i < t.samples.size(); ++i)
    {
        const auto current = height(t.samples[i], zero, dz);

        if (t.samples[i].distance_m > zero && current < -radius)
        {
            if (previous != current)
            {
                mpbr = t.samples[i - 1].distance_m +
                    (previous + radius) / (previous - current) *
                        (t.samples[i].distance_m - t.samples[i - 1].distance_m);
            }
            else
            {
                mpbr = t.samples[i - 1].distance_m;
            }
            found = true;
            break;
        }

        previous = current;
    }

    if (!found)
    {
        return { zero, 0.0, MpbrStatus::horizon_limited };
    }

    return { zero, mpbr, MpbrStatus::complete };
}

MpbrResult compute_native_mpbr(
    const Projectile& p,
    const Atmosphere& a,
    double max_distance,
    double vital,
    double sight,
    double multiplier,
    double output_interval,
    const SolverConfiguration& configuration
)
{
    const auto radius = vital / 2.0;
    if (!std::isfinite(radius) || !std::isfinite(sight) || !std::isfinite(max_distance) ||
        radius <= 0.0 || sight < 0.0 || sight > radius || max_distance < 5.0 ||
        configuration.mode != SolverMode::adaptive_time)
    {
        return { 0.0, 0.0, MpbrStatus::invalid_geometry };
    }

    auto solve_configuration = configuration;
    solve_configuration.terminate_at_ground = false;
    const auto maximum_path = [&](double elevation) -> std::optional<double>
    {
        solve_configuration.launch_elevation_rad = elevation;
        const auto trajectory = integrate_trajectory(
            p,
            a,
            max_distance,
            multiplier,
            output_interval,
            solve_configuration
        );
        if (trajectory.samples.empty())
        {
            return std::nullopt;
        }
        double maximum = -sight;
        for (const auto& sample : trajectory.samples)
        {
            maximum = std::max(maximum, sample.position_m.y - sight);
        }
        return maximum;
    };

    double low = -0.01;
    double high = 0.05;
    auto low_path = maximum_path(low);
    auto high_path = maximum_path(high);
    if (!low_path || !high_path)
    {
        return { 0.0, 0.0, MpbrStatus::no_solution };
    }
    for (int expansion = 0; expansion < 4 && *high_path < radius; ++expansion)
    {
        high *= 2.0;
        high_path = maximum_path(high);
        if (!high_path)
        {
            return { 0.0, 0.0, MpbrStatus::no_solution };
        }
    }
    if (*low_path > radius || *high_path < radius)
    {
        return { 0.0, 0.0, MpbrStatus::horizon_limited };
    }

    double elevation = 0.0;
    for (int iteration = 0; iteration < 40; ++iteration)
    {
        elevation = (low + high) / 2.0;
        const auto path = maximum_path(elevation);
        if (!path)
        {
            return { 0.0, 0.0, MpbrStatus::no_solution };
        }
        if (std::abs(*path - radius) <= 1e-8)
        {
            break;
        }
        if (*path < radius)
        {
            low = elevation;
        }
        else
        {
            high = elevation;
        }
    }

    solve_configuration = configuration;
    solve_configuration.launch_elevation_rad = elevation;
    solve_configuration.terminate_at_ground = false;
    const auto trajectory =
        integrate_trajectory(p, a, max_distance, multiplier, output_interval, solve_configuration);
    if (trajectory.samples.size() < 2)
    {
        return { 0.0, 0.0, MpbrStatus::horizon_limited };
    }

    std::size_t apex = 0;
    for (std::size_t index = 1; index < trajectory.samples.size(); ++index)
    {
        if (trajectory.samples[index].position_m.y > trajectory.samples[apex].position_m.y)
        {
            apex = index;
        }
    }

    const auto crossing_after_apex = [&](double level) -> std::optional<double>
    {
        auto previous_path = trajectory.samples[apex].position_m.y - sight;
        for (std::size_t index = apex + 1; index < trajectory.samples.size(); ++index)
        {
            const auto path = trajectory.samples[index].position_m.y - sight;
            if (path <= level && previous_path > level)
            {
                const auto& previous = trajectory.samples[index - 1];
                const auto& current = trajectory.samples[index];
                const auto fraction = (previous_path - level) / (previous_path - path);
                return previous.distance_m + fraction * (current.distance_m - previous.distance_m);
            }
            previous_path = path;
        }
        return std::nullopt;
    };

    const auto zero = crossing_after_apex(0.0);
    const auto mpbr = crossing_after_apex(-radius);
    if (!zero || !mpbr)
    {
        return { zero.value_or(0.0), 0.0, MpbrStatus::horizon_limited };
    }
    return { *zero, *mpbr, MpbrStatus::complete };
}

MpbrResult compute_scenario_mpbr(
    const Projectile& projectile,
    const ShotScenario& scenario
)
{
    const auto& geometry = scenario.geometry;
    const auto radius = geometry.vital_zone_m / 2.0;
    if (!std::isfinite(radius) || radius <= 0.0 || !std::isfinite(geometry.sight_height_m) ||
        geometry.sight_height_m < 0.0 || geometry.sight_height_m > radius ||
        !std::isfinite(geometry.maximum_distance_m) || geometry.maximum_distance_m < 5.0 ||
        !std::isfinite(geometry.target_inclination_rad) ||
        !std::isfinite(geometry.target_distance_m) || geometry.target_distance_m < 0.0 ||
        !std::isfinite(geometry.target_elevation_m) ||
        (std::abs(geometry.target_inclination_rad) > 1e-12 &&
         std::abs(geometry.target_elevation_m) > 1e-12))
    {
        return { 0.0, 0.0, MpbrStatus::invalid_geometry };
    }

    const auto sight_line_elevation_rad = std::abs(geometry.target_elevation_m) > 1e-12
        ? std::atan2(geometry.target_elevation_m, geometry.target_distance_m)
        : geometry.target_inclination_rad;
    auto configuration = scenario.solver;
    configuration.sight_line_elevation_rad = sight_line_elevation_rad;
    configuration.terminate_at_ground = false;

    const auto maximum_path = [&](double bore_elevation_rad) -> std::optional<double>
    {
        auto candidate_configuration = configuration;
        candidate_configuration.launch_elevation_rad = bore_elevation_rad;
        const auto trajectory = integrate_trajectory(
            projectile,
            scenario.environment,
            geometry.maximum_distance_m,
            scenario.muzzle_velocity_multiplier,
            geometry.output_interval_m,
            candidate_configuration
        );
        if (trajectory.samples.empty())
        {
            return std::nullopt;
        }
        auto maximum = -geometry.sight_height_m;
        for (const auto& sample : trajectory.samples)
        {
            maximum = std::max(
                maximum,
                line_of_sight_path_m(sample, geometry.sight_height_m, sight_line_elevation_rad)
            );
        }
        return maximum;
    };

    auto low = sight_line_elevation_rad - 0.01;
    auto high = sight_line_elevation_rad + 0.05;
    auto low_path = maximum_path(low);
    auto high_path = maximum_path(high);
    if (!low_path || !high_path)
    {
        return { 0.0, 0.0, MpbrStatus::no_solution };
    }
    for (int expansion = 0; expansion < 4 && *high_path < radius; ++expansion)
    {
        high = sight_line_elevation_rad + 0.05 * std::pow(2.0, expansion + 1);
        high_path = maximum_path(high);
        if (!high_path)
        {
            return { 0.0, 0.0, MpbrStatus::no_solution };
        }
    }
    if (*low_path > radius || *high_path < radius)
    {
        return { 0.0, 0.0, MpbrStatus::horizon_limited };
    }

    auto bore_elevation_rad = (low + high) / 2.0;
    for (int iteration = 0; iteration < 45; ++iteration)
    {
        bore_elevation_rad = (low + high) / 2.0;
        const auto path = maximum_path(bore_elevation_rad);
        if (!path)
        {
            return { 0.0, 0.0, MpbrStatus::no_solution };
        }
        if (std::abs(*path - radius) <= 1e-8)
        {
            break;
        }
        if (*path < radius)
        {
            low = bore_elevation_rad;
        }
        else
        {
            high = bore_elevation_rad;
        }
    }

    configuration.launch_elevation_rad = bore_elevation_rad;
    const auto trajectory = integrate_trajectory(
        projectile,
        scenario.environment,
        geometry.maximum_distance_m,
        scenario.muzzle_velocity_multiplier,
        geometry.output_interval_m,
        configuration
    );
    if (trajectory.samples.size() < 2)
    {
        return { 0.0, 0.0, MpbrStatus::horizon_limited };
    }

    std::size_t apex = 0;
    auto apex_path = line_of_sight_path_m(
        trajectory.samples.front(),
        geometry.sight_height_m,
        sight_line_elevation_rad
    );
    for (std::size_t index = 1; index < trajectory.samples.size(); ++index)
    {
        const auto path = line_of_sight_path_m(
            trajectory.samples[index],
            geometry.sight_height_m,
            sight_line_elevation_rad
        );
        if (path > apex_path)
        {
            apex = index;
            apex_path = path;
        }
    }

    const auto crossing_after_apex = [&](double level) -> std::optional<double>
    {
        auto previous_path = apex_path;
        for (std::size_t index = apex + 1; index < trajectory.samples.size(); ++index)
        {
            const auto path = line_of_sight_path_m(
                trajectory.samples[index],
                geometry.sight_height_m,
                sight_line_elevation_rad
            );
            if (path <= level && previous_path > level)
            {
                const auto& previous = trajectory.samples[index - 1];
                const auto& current = trajectory.samples[index];
                const auto fraction = (previous_path - level) / (previous_path - path);
                return previous.distance_m + fraction * (current.distance_m - previous.distance_m);
            }
            previous_path = path;
        }
        return std::nullopt;
    };

    const auto zero = crossing_after_apex(0.0);
    const auto mpbr = crossing_after_apex(-radius);
    if (!zero || !mpbr)
    {
        return { zero.value_or(0.0), 0.0, MpbrStatus::horizon_limited };
    }
    return { *zero, *mpbr, MpbrStatus::complete };
}

DragValidity evaluate_drag_validity(
    const Projectile& p,
    const Trajectory& trajectory,
    double maximum_distance
)
{
    DragValidity result;
    const auto* sphere = sphere_drag(p);
    const auto* tabulated = tabulated_drag(p);
    if ((!sphere && !tabulated) || trajectory.samples.empty() || !std::isfinite(maximum_distance) ||
        maximum_distance < 0.0)
    {
        return result;
    }

    result.status = DragValidityStatus::within_domain;
    if (sphere)
    {
        result.supported_mach_min = sphere_supported_mach_min;
        result.supported_mach_max = sphere_supported_mach_max;
        result.supported_reynolds_min = sphere_supported_reynolds_min;
        result.supported_reynolds_max = sphere_supported_reynolds_max;
    }
    else if (tabulated && !tabulated->points.empty())
    {
        result.supported_mach_min = tabulated->points.front().mach;
        result.supported_mach_max = tabulated->points.back().mach;
    }
    else
    {
        return result;
    }

    auto observed_mach_min = std::numeric_limits<double>::infinity();
    auto observed_mach_max = 0.0;
    auto observed_reynolds_min = std::numeric_limits<double>::infinity();
    auto observed_reynolds_max = 0.0;

    for (const auto& sample : trajectory.samples)
    {
        if (sample.distance_m > maximum_distance + 1e-9)
        {
            break;
        }
        observed_mach_min = std::min(observed_mach_min, sample.aerodynamics.mach);
        observed_mach_max = std::max(observed_mach_max, sample.aerodynamics.mach);
        if (sphere)
        {
            observed_reynolds_min = std::min(observed_reynolds_min, sample.aerodynamics.reynolds);
            observed_reynolds_max = std::max(observed_reynolds_max, sample.aerodynamics.reynolds);
        }
    }

    if (!std::isfinite(observed_mach_min))
    {
        return {};
    }
    result.observed_mach_min = observed_mach_min;
    result.observed_mach_max = observed_mach_max;
    if (sphere)
    {
        if (!std::isfinite(observed_reynolds_min))
        {
            return {};
        }
        result.observed_reynolds_min = observed_reynolds_min;
        result.observed_reynolds_max = observed_reynolds_max;
    }

    const auto outside_mach = observed_mach_min < *result.supported_mach_min ||
        observed_mach_max > *result.supported_mach_max;
    const auto outside_reynolds = result.supported_reynolds_min && result.supported_reynolds_max &&
        (observed_reynolds_min < *result.supported_reynolds_min ||
         observed_reynolds_max > *result.supported_reynolds_max);
    if (outside_mach || outside_reynolds)
    {
        result.status = DragValidityStatus::extrapolated;
    }
    return result;
}

} // namespace ballistics
