#include "ballistics.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace ballistics
{
namespace
{

constexpr double rho_std = 1.225;
constexpr double a_std = 340.294;
constexpr double mps_to_fps = 3.280839895013123;
constexpr double lb_to_kg = 0.45359237;
constexpr double pi = 3.1415926535897932384626433832795;
constexpr double k_cd_ref = rho_std * (pi / 4.0) * inches_to_m * inches_to_m / (2.0 * lb_to_kg);

struct G1Band
{
    double threshold;
    double coefficient;
    double exponent;
};

constexpr std::array<G1Band, 40> g1_table {
    { { 4230, 1.477404177730177e-4, 1.9565 }, { 3680, 1.920339268755614e-4, 1.925 },
      { 3450, 2.894751026819746e-4, 1.875 },  { 3295, 4.349905111115636e-4, 1.825 },
      { 3130, 6.520421871892662e-4, 1.775 },  { 2960, 9.748073985e-4, 1.725 },
      { 2830, 1.453721560286e-3, 1.675 },     { 2680, 2.162887202930376e-3, 1.625 },
      { 2460, 3.209559783129881e-3, 1.575 },  { 2225, 3.904368218691249e-3, 1.55 },
      { 2015, 3.222942271262614e-3, 1.575 },  { 1890, 2.203329542809e-3, 1.625 },
      { 1810, 1.511001028891904e-3, 1.675 },  { 1730, 8.609957592468259e-4, 1.75 },
      { 1595, 4.086146797305117e-4, 1.85 },   { 1520, 1.954473210037398e-4, 1.95 },
      { 1420, 5.431896266462351e-5, 2.125 },  { 1360, 8.847742581674416e-6, 2.375 },
      { 1315, 1.456922328720298e-6, 2.625 },  { 1280, 2.419485191895565e-7, 2.875 },
      { 1220, 1.657956321067612e-8, 3.25 },   { 1185, 4.745469537371e-10, 3.75 },
      { 1150, 1.379746590025088e-11, 4.25 },  { 1100, 4.070157961147882e-13, 4.75 },
      { 1060, 2.938236954847331e-14, 5.125 }, { 1025, 1.228597370014e-14, 5.25 },
      { 980, 2.916938264100495e-14, 5.125 },  { 945, 3.855099424807451e-13, 4.75 },
      { 905, 3.953721585280791e-12, 4.5 },    { 860, 1.051728804013e-10, 4.0 },
      { 810, 1.485749033551948e-9, 3.75 },    { 780, 1.041162981722437e-8, 3.5 },
      { 750, 1.231911859621178e-7, 3.0 },     { 700, 4.600998799e-7, 2.875 },
      { 640, 3.209559783129881e-6, 2.5 },     { 600, 7.566129470914212e-6, 2.375 },
      { 550, 1.490005193169e-5, 2.25 },       { 250, 1.241662783e-4, 1.875 },
      { 0, 1.477404177730177e-4, 1.9565 },    { -1, 0, 0 } }
};

double interpolate(
    double x,
    const std::vector<std::pair<double, double>>& table
)
{
    if (x <= table.front().first)
    {
        return table.front().second;
    }
    if (x >= table.back().first)
    {
        return table.back().second;
    }

    auto hi = std::upper_bound(
        table.begin(),
        table.end(),
        x,
        [](double value, const auto& item) { return value < item.first; }
    );

    auto lo = hi - 1;
    return lo->second + (x - lo->first) / (hi->first - lo->first) * (hi->second - lo->second);
}

const std::vector<std::pair<double, double>>& g7_table()
{
    // McCoy/BRL G7 standard-projectile drag curve. The source transcription, provenance, and
    // checksum live in validation/sources/g7-mccoy.csv and validation/manifest.json.
    static const std::vector<std::pair<double, double>> table {
        { 0.0, 0.1198 },  { 0.05, 0.1197 },  { 0.1, 0.1196 },  { 0.15, 0.1194 },
        { 0.2, 0.1193 },  { 0.25, 0.1194 },  { 0.3, 0.1194 },  { 0.35, 0.1194 },
        { 0.4, 0.1193 },  { 0.45, 0.1193 },  { 0.5, 0.1194 },  { 0.55, 0.1193 },
        { 0.6, 0.1194 },  { 0.65, 0.1197 },  { 0.7, 0.1202 },  { 0.725, 0.1207 },
        { 0.75, 0.1215 }, { 0.775, 0.1226 }, { 0.8, 0.1242 },  { 0.825, 0.1266 },
        { 0.85, 0.1306 }, { 0.875, 0.1368 }, { 0.9, 0.1464 },  { 0.925, 0.1660 },
        { 0.95, 0.2054 }, { 0.975, 0.2993 }, { 1.0, 0.3803 },  { 1.025, 0.4015 },
        { 1.05, 0.4043 }, { 1.075, 0.4034 }, { 1.1, 0.4014 },  { 1.125, 0.3987 },
        { 1.15, 0.3955 }, { 1.2, 0.3884 },   { 1.25, 0.3810 }, { 1.3, 0.3732 },
        { 1.35, 0.3657 }, { 1.4, 0.3580 },   { 1.5, 0.3440 },  { 1.55, 0.3376 },
        { 1.6, 0.3315 },  { 1.65, 0.3260 },  { 1.7, 0.3209 },  { 1.75, 0.3160 },
        { 1.8, 0.3117 },  { 1.85, 0.3078 },  { 1.9, 0.3042 },  { 1.95, 0.3010 },
        { 2.0, 0.2980 },  { 2.05, 0.2951 },  { 2.1, 0.2922 },  { 2.15, 0.2892 },
        { 2.2, 0.2864 },  { 2.25, 0.2835 },  { 2.3, 0.2807 },  { 2.35, 0.2779 },
        { 2.4, 0.2752 },  { 2.45, 0.2725 },  { 2.5, 0.2697 },  { 2.55, 0.2670 },
        { 2.6, 0.2643 },  { 2.65, 0.2615 },  { 2.7, 0.2588 },  { 2.75, 0.2561 },
        { 2.8, 0.2533 },  { 2.85, 0.2506 },  { 2.9, 0.2479 },  { 2.95, 0.2451 },
        { 3.0, 0.2424 },  { 3.1, 0.2368 },   { 3.2, 0.2313 },  { 3.3, 0.2258 },
        { 3.4, 0.2205 },  { 3.5, 0.2154 },   { 3.6, 0.2106 },  { 3.7, 0.2060 },
        { 3.8, 0.2017 },  { 3.9, 0.1975 },   { 4.0, 0.1935 },  { 4.2, 0.1861 },
        { 4.4, 0.1793 },  { 4.6, 0.1730 },   { 4.8, 0.1672 },  { 5.0, 0.1618 }
    };
    return table;
}

double cubic_bezier(
    const std::array<double, 4>& v,
    double u
)
{
    const auto q = 1.0 - u;
    return v[0] * q * q * q + 3 * v[1] * u * q * q + 3 * v[2] * u * u * q + v[3] * u * u * u;
}

double cubic_bezier_derivative(
    const std::array<double, 4>& v,
    double u
)
{
    const auto q = 1.0 - u;
    return 3.0 * ((v[1] - v[0]) * q * q + 2.0 * (v[2] - v[1]) * q * u + (v[3] - v[2]) * u * u);
}

double bezier_y_from_x(
    double x,
    const std::array<std::pair<double, double>, 4>& points
)
{
    std::array<double, 4> xs {};
    std::array<double, 4> ys {};

    for (std::size_t i = 0; i < 4; ++i)
    {
        xs[i] = points[i].first;
        ys[i] = points[i].second;
    }

    if (x <= xs[0])
    {
        return ys[0];
    }
    if (x >= xs[3])
    {
        return ys[3];
    }

    double low = 0.0;
    double high = 1.0;
    auto u = std::clamp((x - xs[0]) / (xs[3] - xs[0]), low, high);
    const auto x_tolerance = 8.0 * std::numeric_limits<double>::epsilon() *
        std::max({ 1.0, std::abs(x), std::abs(xs[0]), std::abs(xs[3]) });

    // The two Collins correction curves are monotone in x even though their control-point x values
    // are not ordered. Safeguarded Newton steps normally converge in a handful of evaluations. The
    // bracket prevents an overshoot and provides a deterministic full-precision fallback.
    for (int iteration = 0; iteration < 12; ++iteration)
    {
        const auto value = cubic_bezier(xs, u);
        const auto residual = value - x;
        if (std::abs(residual) <= x_tolerance)
        {
            return cubic_bezier(ys, u);
        }
        if (residual < 0.0)
        {
            low = u;
        }
        else
        {
            high = u;
        }

        const auto derivative = cubic_bezier_derivative(xs, u);
        const auto candidate = std::abs(derivative) > std::numeric_limits<double>::epsilon()
            ? u - residual / derivative
            : std::numeric_limits<double>::quiet_NaN();
        u = std::isfinite(candidate) && candidate > low && candidate < high
            ? candidate
            : (low + high) / 2.0;
    }

    for (int iteration = 0; iteration < 52; ++iteration)
    {
        u = (low + high) / 2.0;
        if (cubic_bezier(xs, u) < x)
        {
            low = u;
        }
        else
        {
            high = u;
        }
    }

    return cubic_bezier(ys, (low + high) / 2.0);
}

std::array<double, 3> sphere_aerodynamics(
    double speed,
    double diameter,
    const Atmosphere& atmosphere
)
{
    if (speed <= 0 || diameter <= 0)
    {
        return { 0.0, 0.0, 0.0 };
    }

    const auto mach = speed / atmosphere.speed_of_sound_mps;
    const auto reynolds =
        atmosphere.density_kg_m3 * speed * diameter / atmosphere.dynamic_viscosity_pa_s;
    return { sphere_drag_coefficient(mach, reynolds), reynolds, mach };
}

double g1_retardation(
    double speed_fps,
    double bc
)
{
    if (speed_fps <= 0)
    {
        return 0.0;
    }

    for (const auto& band : g1_table)
    {
        if (speed_fps >= band.threshold)
        {
            return band.coefficient * std::pow(speed_fps, band.exponent) / bc;
        }
    }

    return 0.0;
}

double physical_drag_acceleration(
    double drag_coefficient,
    double reference_area_m2,
    double mass_kg,
    double speed_mps,
    const Atmosphere& atmosphere
)
{
    if (drag_coefficient < 0.0 || reference_area_m2 <= 0.0 || mass_kg <= 0.0)
    {
        throw std::invalid_argument("invalid physical drag inputs");
    }
    return 0.5 * atmosphere.density_kg_m3 * drag_coefficient * reference_area_m2 * speed_mps *
        speed_mps / mass_kg;
}

double reference_drag_acceleration(
    double drag_coefficient,
    double ballistic_coefficient,
    double speed_mps,
    const Atmosphere& atmosphere
)
{
    const auto reference_area_m2 = pi * inches_to_m * inches_to_m / 4.0;
    const auto reference_mass_kg = ballistic_coefficient * lb_to_kg;
    return physical_drag_acceleration(
        drag_coefficient,
        reference_area_m2,
        reference_mass_kg,
        speed_mps,
        atmosphere
    );
}

// The compatibility solver integrates over horizontal distance, so it has a singularity
// when vx approaches zero. It remains available only for numerical A/B validation while the
// production solver below evolves Cartesian position and velocity directly in time.
using LegacyState = std::array<double, 6>;

LegacyState legacy_derivative(
    const LegacyState& s,
    const Projectile& p,
    const Atmosphere& a
)
{
    const auto vx_safe = std::max(s[3], 1e-6);
    const auto rx = s[3] + a.headwind_mps;
    const auto ry = s[4];
    const auto rz = s[5] - a.crosswind_mps;
    const auto relative = std::hypot(rx, ry, rz);

    const auto retard = drag_retardation_mps2(relative, p, a);
    const auto ax = relative > 1e-9 ? -retard * rx / relative : 0.0;
    const auto ay = relative > 1e-9 ? -retard * ry / relative - gravity_mps2 : -gravity_mps2;
    const auto az = relative > 1e-9 ? -retard * rz / relative : 0.0;

    return {
        1.0 / vx_safe, s[4] / vx_safe, s[5] / vx_safe, ax / vx_safe, ay / vx_safe, az / vx_safe
    };
}

LegacyState legacy_rk4(
    const LegacyState& s,
    double dx,
    const Projectile& p,
    const Atmosphere& a
)
{
    const auto k1 = legacy_derivative(s, p, a);

    LegacyState s2 {};
    for (std::size_t i = 0; i < s.size(); ++i)
    {
        s2[i] = s[i] + 0.5 * dx * k1[i];
    }

    const auto k2 = legacy_derivative(s2, p, a);

    LegacyState s3 {};
    for (std::size_t i = 0; i < s.size(); ++i)
    {
        s3[i] = s[i] + 0.5 * dx * k2[i];
    }

    const auto k3 = legacy_derivative(s3, p, a);

    LegacyState s4 {};
    for (std::size_t i = 0; i < s.size(); ++i)
    {
        s4[i] = s[i] + dx * k3[i];
    }

    const auto k4 = legacy_derivative(s4, p, a);

    LegacyState out {};
    for (std::size_t i = 0; i < s.size(); ++i)
    {
        out[i] = s[i] + dx * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]) / 6.0;
    }

    return out;
}

// Time-domain state: {x, y, z, vx, vy, vz}. z is positive to the shooter's right.
using TimeState = std::array<double, 6>;

TimeState time_derivative(
    const TimeState& s,
    const Projectile& p,
    const Environment& environment,
    bool include_drag,
    bool include_gravity,
    double aerodynamic_drag_multiplier
)
{
    const Vec3 position { s[0], s[1], s[2] };
    const auto atmosphere = environment.atmosphere_at(position);
    const auto rx = s[3] + atmosphere.headwind_mps;
    const auto ry = s[4];
    const auto rz = s[5] - atmosphere.crosswind_mps;
    const auto relative = std::hypot(rx, ry, rz);
    const auto retard = include_drag
        ? aerodynamic_drag_multiplier * drag_retardation_mps2(relative, p, atmosphere)
        : 0.0;
    const auto drag_scale = relative > 1e-12 ? -retard / relative : 0.0;

    const auto gravity = include_gravity ? environment.gravity_at_height(s[1]) : 0.0;
    const auto coriolis = environment.coriolis_acceleration({ s[3], s[4], s[5] }, s[1]);
    return {
        s[3],
        s[4],
        s[5],
        drag_scale * rx + coriolis.x,
        drag_scale * ry - gravity + coriolis.y,
        drag_scale * rz + coriolis.z
    };
}

struct DormandPrinceStep
{
    TimeState fifth_order;
    TimeState fourth_order;
};

DormandPrinceStep dormand_prince_54(
    const TimeState& s,
    double dt,
    const Projectile& p,
    const Environment& environment,
    bool include_drag,
    bool include_gravity,
    double aerodynamic_drag_multiplier
)
{
    const auto k1 = time_derivative(
        s,
        p,
        environment,
        include_drag,
        include_gravity,
        aerodynamic_drag_multiplier
    );
    TimeState stage {};
    const auto evaluate =
        [&](const std::initializer_list<std::pair<double, const TimeState*>>& terms)
    {
        for (std::size_t component = 0; component < s.size(); ++component)
        {
            stage[component] = s[component];
            for (const auto& [weight, derivative] : terms)
            {
                stage[component] += dt * weight * (*derivative)[component];
            }
        }
        return time_derivative(
            stage,
            p,
            environment,
            include_drag,
            include_gravity,
            aerodynamic_drag_multiplier
        );
    };

    const auto k2 = evaluate({ { 1.0 / 5.0, &k1 } });
    const auto k3 = evaluate({ { 3.0 / 40.0, &k1 }, { 9.0 / 40.0, &k2 } });
    const auto k4 = evaluate({ { 44.0 / 45.0, &k1 }, { -56.0 / 15.0, &k2 }, { 32.0 / 9.0, &k3 } });
    const auto k5 = evaluate(
        { { 19372.0 / 6561.0, &k1 },
          { -25360.0 / 2187.0, &k2 },
          { 64448.0 / 6561.0, &k3 },
          { -212.0 / 729.0, &k4 } }
    );
    const auto k6 = evaluate(
        { { 9017.0 / 3168.0, &k1 },
          { -355.0 / 33.0, &k2 },
          { 46732.0 / 5247.0, &k3 },
          { 49.0 / 176.0, &k4 },
          { -5103.0 / 18656.0, &k5 } }
    );
    const auto k7 = evaluate(
        { { 35.0 / 384.0, &k1 },
          { 500.0 / 1113.0, &k3 },
          { 125.0 / 192.0, &k4 },
          { -2187.0 / 6784.0, &k5 },
          { 11.0 / 84.0, &k6 } }
    );

    DormandPrinceStep result {};
    for (std::size_t component = 0; component < s.size(); ++component)
    {
        result.fifth_order[component] = s[component] +
            dt *
                (35.0 / 384.0 * k1[component] + 500.0 / 1113.0 * k3[component] +
                 125.0 / 192.0 * k4[component] - 2187.0 / 6784.0 * k5[component] +
                 11.0 / 84.0 * k6[component]);
        result.fourth_order[component] = s[component] +
            dt *
                (5179.0 / 57600.0 * k1[component] + 7571.0 / 16695.0 * k3[component] +
                 393.0 / 640.0 * k4[component] - 92097.0 / 339200.0 * k5[component] +
                 187.0 / 2100.0 * k6[component] + 1.0 / 40.0 * k7[component]);
    }
    return result;
}

double error_norm(
    const TimeState& before,
    const DormandPrinceStep& step,
    const SolverConfiguration& configuration
)
{
    double result = 0.0;
    for (std::size_t component = 0; component < before.size(); ++component)
    {
        const auto absolute_tolerance = component < 3
            ? configuration.absolute_position_tolerance_m
            : configuration.absolute_velocity_tolerance_mps;
        const auto scale = absolute_tolerance +
            configuration.relative_tolerance *
                std::max(std::abs(before[component]), std::abs(step.fifth_order[component]));
        result = std::max(
            result,
            std::abs(step.fifth_order[component] - step.fourth_order[component]) / scale
        );
    }
    return result;
}

double hermite_position(
    double p0,
    double v0,
    double p1,
    double v1,
    double dt,
    double u
)
{
    const auto u2 = u * u;
    const auto u3 = u2 * u;
    return (2.0 * u3 - 3.0 * u2 + 1.0) * p0 + (u3 - 2.0 * u2 + u) * dt * v0 +
        (-2.0 * u3 + 3.0 * u2) * p1 + (u3 - u2) * dt * v1;
}

double hermite_velocity(
    double p0,
    double v0,
    double p1,
    double v1,
    double dt,
    double u
)
{
    const auto u2 = u * u;
    return ((6.0 * u2 - 6.0 * u) * p0 + (3.0 * u2 - 4.0 * u + 1.0) * dt * v0 +
            (-6.0 * u2 + 6.0 * u) * p1 + (3.0 * u2 - 2.0 * u) * dt * v1) /
        dt;
}

TimeState interpolate_time_state(
    const TimeState& before,
    const TimeState& after,
    double dt,
    double u
)
{
    TimeState result {};
    for (std::size_t axis = 0; axis < 3; ++axis)
    {
        result[axis] =
            hermite_position(before[axis], before[axis + 3], after[axis], after[axis + 3], dt, u);
        result[axis + 3] =
            hermite_velocity(before[axis], before[axis + 3], after[axis], after[axis + 3], dt, u);
    }
    return result;
}

double interpolation_fraction_for_x(
    const TimeState& before,
    const TimeState& after,
    double dt,
    double target_x
)
{
    double low = 0.0;
    double high = 1.0;
    for (int iteration = 0; iteration < 60; ++iteration)
    {
        const auto mid = (low + high) / 2.0;
        if (hermite_position(before[0], before[3], after[0], after[3], dt, mid) < target_x)
        {
            low = mid;
        }
        else
        {
            high = mid;
        }
    }
    return (low + high) / 2.0;
}

bool finite_state(
    const TimeState& state
)
{
    return std::all_of(
        state.begin(),
        state.end(),
        [](double value) { return std::isfinite(value); }
    );
}

void validate_solver_configuration(
    const SolverConfiguration& configuration
)
{
    const auto positive_finite = [](double value)
    {
        return std::isfinite(value) && value > 0.0;
    };
    if (!positive_finite(configuration.relative_tolerance) ||
        !positive_finite(configuration.absolute_position_tolerance_m) ||
        !positive_finite(configuration.absolute_velocity_tolerance_mps) ||
        !positive_finite(configuration.initial_time_step_s) ||
        !positive_finite(configuration.minimum_time_step_s) ||
        !positive_finite(configuration.maximum_time_step_s) ||
        !positive_finite(configuration.maximum_time_s) ||
        !std::isfinite(configuration.minimum_forward_speed_mps) ||
        configuration.minimum_forward_speed_mps < 0.0 ||
        !std::isfinite(configuration.launch_elevation_rad) ||
        std::abs(configuration.launch_elevation_rad) >= pi / 2.0 ||
        !std::isfinite(configuration.launch_azimuth_rad) ||
        std::abs(configuration.launch_azimuth_rad) >= pi / 2.0 ||
        !std::isfinite(configuration.sight_line_elevation_rad) ||
        std::abs(configuration.sight_line_elevation_rad) >= pi / 2.0 ||
        !std::isfinite(configuration.ground_height_m) || configuration.maximum_steps == 0 ||
        !positive_finite(configuration.aerodynamic_drag_multiplier) ||
        configuration.minimum_time_step_s > configuration.maximum_time_step_s)
    {
        throw std::invalid_argument("invalid solver configuration");
    }
}

} // namespace

double Vec3::magnitude() const
{
    return std::hypot(x, y, z);
}

double BallisticLoad::payload_mass_kg() const
{
    return definition.mass_kg * std::max(1, ammunition.payload_count);
}

DragModel drag_model(
    const Projectile& projectile
)
{
    if (const auto* reference = std::get_if<ReferenceBcDrag>(&projectile.definition.drag))
    {
        return reference->curve == ReferenceDragCurve::g7 ? DragModel::g7 : DragModel::g1;
    }
    return std::holds_alternative<TabulatedDrag>(projectile.definition.drag)
        ? DragModel::tabulated_cd
        : DragModel::sphere;
}

const ReferenceBcDrag* reference_bc_drag(
    const Projectile& projectile
)
{
    return std::get_if<ReferenceBcDrag>(&projectile.definition.drag);
}

ReferenceBcDrag* reference_bc_drag(
    Projectile& projectile
)
{
    return std::get_if<ReferenceBcDrag>(&projectile.definition.drag);
}

const TabulatedDrag* tabulated_drag(
    const Projectile& projectile
)
{
    return std::get_if<TabulatedDrag>(&projectile.definition.drag);
}

TabulatedDrag* tabulated_drag(
    Projectile& projectile
)
{
    return std::get_if<TabulatedDrag>(&projectile.definition.drag);
}

const SphereDrag* sphere_drag(
    const Projectile& projectile
)
{
    return std::get_if<SphereDrag>(&projectile.definition.drag);
}

SphereDrag* sphere_drag(
    Projectile& projectile
)
{
    return std::get_if<SphereDrag>(&projectile.definition.drag);
}

double nominal_ballistic_coefficient(
    const Projectile& projectile
)
{
    const auto* reference = reference_bc_drag(projectile);
    if (!reference)
    {
        return 0.0;
    }
    if (const auto* constant = std::get_if<ConstantBallisticCoefficient>(&reference->coefficient))
    {
        return constant->value;
    }
    const auto& bands = std::get<BandedBallisticCoefficient>(reference->coefficient).bands;
    return bands.empty() ? 0.0 : bands.front().ballistic_coefficient;
}

double elevation_holdover_rad(
    double path_m,
    double distance_m
)
{
    if (!std::isfinite(path_m) || !std::isfinite(distance_m) || distance_m < 0.0)
    {
        throw std::invalid_argument("holdover geometry must be finite with non-negative distance");
    }
    return distance_m > 0.0 ? std::atan2(-path_m, distance_m) : 0.0;
}

double sphere_drag_vs_reynolds(
    double re
)
{
    if (!std::isfinite(re) || re <= 0.0)
    {
        throw std::invalid_argument("Reynolds number must be positive");
    }
    if (re > 2e6)
    {
        return 0.15;
    }
    if (re > 1.2e6)
    {
        return 0.19 - 8e4 / re;
    }
    if (re > 4.77e5)
    {
        return -0.485 + 0.1 * std::log10(re);
    }

    return 24.0 / re + (2.6 * (re / 5.0)) / (1.0 + std::pow(re / 5.0, 1.52)) +
        (0.411 * std::pow(re / 263000.0, -7.94) / (1.0 + std::pow(re / 263000.0, -8.0))) +
        std::pow(re, 0.8) / 461000.0;
}

double sphere_drag_coefficient(
    double mach,
    double reynolds
)
{
    if (!std::isfinite(mach) || mach < 0.0)
    {
        throw std::invalid_argument("Mach number must be finite and non-negative");
    }
    if (!std::isfinite(reynolds) || reynolds <= 0.0)
    {
        throw std::invalid_argument("Reynolds number must be positive");
    }

    const auto corrected = std::clamp(mach, sphere_supported_mach_min, sphere_supported_mach_max);
    constexpr std::array<std::pair<double, double>, 4> shock_points {
        { { 0.1, 0.0 }, { 0.95, 0.0 }, { 0.55, 0.95 }, { 1.5, 1.0 } }
    };
    constexpr std::array<std::pair<double, double>, 4> mask_points {
        { { 0.0, 1.1 }, { 0.85, 1.1 }, { 0.57, 0.05 }, { 1.0, 0.0 } }
    };

    const auto shock =
        corrected >= sphere_supported_mach_max ? 1.0 : bezier_y_from_x(corrected, shock_points);
    const auto mask = corrected > 1.0 ? 0.0 : bezier_y_from_x(corrected, mask_points);
    const auto reynolds_scale = 0.78 + 0.22 * std::atan(-12.0 * (corrected - 0.23));
    return shock + mask * sphere_drag_vs_reynolds(std::max(reynolds_scale * reynolds, 1e-12));
}

double g7_drag_coefficient(
    double mach
)
{
    if (!std::isfinite(mach) || mach < 0.0)
    {
        throw std::invalid_argument("Mach number must be finite and non-negative");
    }
    return interpolate(mach, g7_table());
}

double g1_drag_coefficient(
    double mach
)
{
    if (!std::isfinite(mach) || mach < 0.0)
    {
        throw std::invalid_argument("Mach number must be finite and non-negative");
    }
    if (mach == 0.0)
    {
        return 0.0;
    }
    const auto standard_speed_mps = mach * a_std;
    const auto standard_retardation_mps2 =
        g1_retardation(standard_speed_mps * mps_to_fps, 1.0) * fps_to_mps;
    return standard_retardation_mps2 / (k_cd_ref * standard_speed_mps * standard_speed_mps);
}

double tabulated_drag_coefficient(
    const Projectile& p,
    double mach
)
{
    if (!std::isfinite(mach) || mach < 0.0)
    {
        throw std::invalid_argument("Mach number must be finite and non-negative");
    }
    const auto* drag = tabulated_drag(p);
    if (!drag || drag->points.empty())
    {
        throw std::invalid_argument("tabulated drag curve is empty");
    }
    if (mach <= drag->points.front().mach)
    {
        return drag->points.front().drag_coefficient;
    }
    if (mach >= drag->points.back().mach)
    {
        return drag->points.back().drag_coefficient;
    }
    const auto high = std::upper_bound(
        drag->points.begin(),
        drag->points.end(),
        mach,
        [](double value, const MachCdPoint& point) { return value < point.mach; }
    );
    const auto low = high - 1;
    const auto fraction = (mach - low->mach) / (high->mach - low->mach);
    return low->drag_coefficient + fraction * (high->drag_coefficient - low->drag_coefficient);
}

double effective_ballistic_coefficient(
    const Projectile& p,
    double airspeed
)
{
    if (!std::isfinite(airspeed) || airspeed < 0.0)
    {
        throw std::invalid_argument("airspeed must be finite and non-negative");
    }
    const auto* reference = reference_bc_drag(p);
    if (!reference)
    {
        throw std::invalid_argument("projectile does not use reference-BC drag");
    }
    if (const auto* constant = std::get_if<ConstantBallisticCoefficient>(&reference->coefficient))
    {
        return constant->value;
    }
    const auto& bands = std::get<BandedBallisticCoefficient>(reference->coefficient).bands;
    if (bands.empty())
    {
        throw std::invalid_argument("ballistic-coefficient schedule is empty");
    }
    const auto selected = std::upper_bound(
        bands.begin(),
        bands.end(),
        airspeed,
        [](double value, const BallisticCoefficientBand& band)
        { return value < band.minimum_velocity_mps; }
    );
    return (selected == bands.begin() ? *selected : *(selected - 1)).ballistic_coefficient;
}

double drag_retardation_mps2(
    double speed,
    const Projectile& p,
    const Atmosphere& a
)
{
    if (speed <= 0.0)
    {
        return 0.0;
    }

    if (const auto* sphere = sphere_drag(p))
    {
        if (sphere->diameter_m <= 0.0 || p.definition.mass_kg <= 0.0)
        {
            throw std::invalid_argument("invalid sphere");
        }

        const auto cd = sphere_aerodynamics(speed, sphere->diameter_m, a)[0];
        const auto area = pi * sphere->diameter_m * sphere->diameter_m / 4.0;
        return physical_drag_acceleration(cd, area, p.definition.mass_kg, speed, a);
    }

    const auto mach = speed / a.speed_of_sound_mps;
    if (const auto* tabulated = tabulated_drag(p))
    {
        const auto area =
            pi * tabulated->reference_diameter_m * tabulated->reference_diameter_m / 4.0;
        return physical_drag_acceleration(
            tabulated_drag_coefficient(p, mach),
            area,
            p.definition.mass_kg,
            speed,
            a
        );
    }

    const auto* reference = reference_bc_drag(p);
    if (!reference)
    {
        throw std::invalid_argument("projectile has no drag definition");
    }
    const auto reference_cd = reference->curve == ReferenceDragCurve::g7
        ? g7_drag_coefficient(mach)
        : g1_drag_coefficient(mach);
    return reference_drag_acceleration(
        reference_cd,
        effective_ballistic_coefficient(p, speed),
        speed,
        a
    );
}

AerodynamicDiagnostics aerodynamic_diagnostics(
    const Projectile& p,
    const Vec3& ground_velocity,
    const Atmosphere& a
)
{
    const Vec3 air_relative {
        ground_velocity.x + a.headwind_mps,
        ground_velocity.y,
        ground_velocity.z - a.crosswind_mps
    };
    const auto ground_speed = ground_velocity.magnitude();
    const auto airspeed = air_relative.magnitude();

    if (const auto* sphere = sphere_drag(p))
    {
        const auto values = sphere_aerodynamics(airspeed, sphere->diameter_m, a);
        return { ground_speed, airspeed, values[0], values[1], values[2], true, true };
    }

    const auto mach = airspeed > 0.0 ? airspeed / a.speed_of_sound_mps : 0.0;
    if (const auto* tabulated = tabulated_drag(p))
    {
        const auto reynolds =
            a.density_kg_m3 * airspeed * tabulated->reference_diameter_m / a.dynamic_viscosity_pa_s;
        return { ground_speed, airspeed, tabulated_drag_coefficient(p, mach), reynolds, mach,
                 true,         true };
    }

    const auto* reference = reference_bc_drag(p);
    if (!reference)
    {
        throw std::invalid_argument("projectile has no drag definition");
    }
    const auto reference_cd = reference->curve == ReferenceDragCurve::g7
        ? g7_drag_coefficient(mach)
        : g1_drag_coefficient(mach);
    return { ground_speed, airspeed, reference_cd, 0.0, mach, true, false };
}

std::optional<TrajectorySample> Trajectory::sample_at(
    double distance
) const
{
    constexpr double tolerance = 1e-9;
    if (samples.empty() || !std::isfinite(distance) ||
        distance < samples.front().distance_m - tolerance ||
        distance > samples.back().distance_m + tolerance)
    {
        return std::nullopt;
    }

    const auto x = std::clamp(distance, samples.front().distance_m, samples.back().distance_m);
    const auto hi = std::lower_bound(
        samples.begin(),
        samples.end(),
        x,
        [](const TrajectorySample& sample, double value) { return sample.distance_m < value; }
    );

    if (hi == samples.begin())
    {
        return samples.front();
    }
    if (hi == samples.end())
    {
        return samples.back();
    }
    if (std::abs(hi->distance_m - x) <= tolerance)
    {
        return *hi;
    }

    const auto& a = *(hi - 1);
    const auto& b = *hi;
    const auto f = (x - a.distance_m) / (b.distance_m - a.distance_m);
    const auto lerp = [f](double first, double second)
    {
        return first + f * (second - first);
    };
    const auto vector_lerp = [&](const Vec3& first, const Vec3& second)
    {
        return Vec3 { lerp(first.x, second.x), lerp(first.y, second.y), lerp(first.z, second.z) };
    };

    TrajectorySample result;
    result.distance_m = x;
    result.position_m = vector_lerp(a.position_m, b.position_m);
    result.ground_velocity_mps = vector_lerp(a.ground_velocity_mps, b.ground_velocity_mps);
    result.air_relative_velocity_mps =
        vector_lerp(a.air_relative_velocity_mps, b.air_relative_velocity_mps);
    result.ground_speed_mps = result.ground_velocity_mps.magnitude();
    result.airspeed_mps = result.air_relative_velocity_mps.magnitude();
    result.energy_j = 0.5 * mass_kg * result.ground_speed_mps * result.ground_speed_mps;
    result.momentum_kgms = mass_kg * result.ground_speed_mps;
    result.time_s = lerp(a.time_s, b.time_s);
    result.drop_m = lerp(a.drop_m, b.drop_m);
    result.wind_drift_m = lerp(a.wind_drift_m, b.wind_drift_m);
    result.aerodynamics = {
        result.ground_speed_mps,
        result.airspeed_mps,
        lerp(a.aerodynamics.cd, b.aerodynamics.cd),
        lerp(a.aerodynamics.reynolds, b.aerodynamics.reynolds),
        lerp(a.aerodynamics.mach, b.aerodynamics.mach),
        a.aerodynamics.has_drag_coefficient && b.aerodynamics.has_drag_coefficient,
        a.aerodynamics.has_reynolds && b.aerodynamics.has_reynolds,
    };
    return result;
}

Trajectory integrate_trajectory_legacy(
    const Projectile& p,
    const Atmosphere& a,
    double max_distance,
    double multiplier,
    double dx
)
{
    if (!std::isfinite(multiplier) || multiplier < 0.5 || multiplier > 1.5)
    {
        throw std::invalid_argument("velocity multiplier out of range");
    }
    if (!std::isfinite(dx) || dx <= 0.0)
    {
        throw std::invalid_argument("step must be positive");
    }
    if (!std::isfinite(max_distance) || max_distance < 0.0)
    {
        throw std::invalid_argument("maximum distance must be finite and non-negative");
    }
    const auto validation = validate_projectile(p);
    if (!validation.empty())
    {
        throw std::invalid_argument(validation.front().message);
    }

    const auto v0 = p.ammunition.muzzle_velocity_mps * multiplier;

    LegacyState state { 0.0, 0.0, 0.0, v0, 0.0, 0.0 };
    double distance = 0.0;

    Trajectory trajectory;
    trajectory.mass_kg = p.definition.mass_kg;
    trajectory.requested_distance_m = max_distance;
    trajectory.solver.mode = SolverMode::legacy_distance;
    trajectory.samples.reserve(static_cast<std::size_t>(max_distance / dx) + 2);

    const auto append_sample = [&](double downrange, const LegacyState& current)
    {
        const Vec3 ground_velocity { current[3], current[4], current[5] };
        const Vec3
            air_relative { current[3] + a.headwind_mps, current[4], current[5] - a.crosswind_mps };
        const auto diagnostics = aerodynamic_diagnostics(p, ground_velocity, a);
        trajectory.samples.push_back(
            { downrange,
              { downrange, current[1], current[2] },
              ground_velocity,
              air_relative,
              diagnostics.ground_speed_mps,
              diagnostics.airspeed_mps,
              0.5 * p.definition.mass_kg * diagnostics.ground_speed_mps *
                  diagnostics.ground_speed_mps,
              p.definition.mass_kg * diagnostics.ground_speed_mps,
              current[0],
              -current[1],
              current[2],
              diagnostics }
        );
    };

    append_sample(0.0, state);

    while (distance < max_distance)
    {
        const auto step = std::min(dx, max_distance - distance);
        state = legacy_rk4(state, step, p, a);
        distance += step;
        ++trajectory.solver.attempted_steps;
        ++trajectory.solver.accepted_steps;

        if (!std::all_of(state.begin(), state.end(), [](double v) { return std::isfinite(v); }) ||
            !std::isfinite(distance))
        {
            trajectory.termination = TrajectoryTermination::non_finite_state;
            break;
        }
        if (state[3] <= 1.0)
        {
            trajectory.termination = TrajectoryTermination::minimum_forward_speed;
            break;
        }

        append_sample(distance, state);
    }

    trajectory.covered_distance_m = trajectory.samples.back().distance_m;
    return trajectory;
}

Trajectory integrate_trajectory(
    const Projectile& p,
    const Atmosphere& a,
    double max_distance,
    double multiplier,
    double output_interval
)
{
    return integrate_trajectory(
        p,
        a,
        max_distance,
        multiplier,
        output_interval,
        SolverConfiguration {}
    );
}

Trajectory integrate_trajectory(
    const Projectile& p,
    const Atmosphere& a,
    double max_distance,
    double multiplier,
    double output_interval,
    const SolverConfiguration& configuration
)
{
    if (configuration.mode == SolverMode::legacy_distance)
    {
        return integrate_trajectory_legacy(p, a, max_distance, multiplier, output_interval);
    }
    return integrate_trajectory(
        p,
        Environment::homogeneous(a),
        max_distance,
        multiplier,
        output_interval,
        configuration
    );
}

Trajectory integrate_trajectory(
    const Projectile& p,
    const Environment& environment,
    double max_distance,
    double multiplier,
    double output_interval,
    const SolverConfiguration& configuration
)
{
    if (configuration.mode == SolverMode::legacy_distance)
    {
        throw std::invalid_argument("legacy solver does not support an Environment");
    }
    if (!std::isfinite(multiplier) || multiplier < 0.5 || multiplier > 1.5)
    {
        throw std::invalid_argument("velocity multiplier out of range");
    }
    if (!std::isfinite(output_interval) || output_interval <= 0.0)
    {
        throw std::invalid_argument("output interval must be positive");
    }
    if (!std::isfinite(max_distance) || max_distance < 0.0)
    {
        throw std::invalid_argument("maximum distance must be finite and non-negative");
    }
    validate_solver_configuration(configuration);
    const auto validation = validate_projectile(p);
    if (!validation.empty())
    {
        throw std::invalid_argument(validation.front().message);
    }

    const auto v0 = p.ammunition.muzzle_velocity_mps * multiplier;
    const auto cos_elevation = std::cos(configuration.launch_elevation_rad);
    const auto cos_azimuth = std::cos(configuration.launch_azimuth_rad);
    TimeState state {
        0.0,
        0.0,
        0.0,
        v0 * cos_elevation * cos_azimuth,
        v0 * std::sin(configuration.launch_elevation_rad),
        v0 * cos_elevation * std::sin(configuration.launch_azimuth_rad)
    };
    double time = 0.0;
    double dt = std::clamp(
        configuration.initial_time_step_s,
        configuration.minimum_time_step_s,
        configuration.maximum_time_step_s
    );

    Trajectory trajectory;
    trajectory.mass_kg = p.definition.mass_kg;
    trajectory.requested_distance_m = max_distance;
    trajectory.solver.mode = SolverMode::adaptive_time;

    // MPBR and event calculations must not depend on a caller selecting a coarser presentation
    // interval. Keep the numerical trajectory at 25 cm or finer. The CLI downsamples separately.
    const auto sample_interval = std::min(output_interval, 0.25);
    trajectory.samples.reserve(static_cast<std::size_t>(max_distance / sample_interval) + 2);

    const auto append_sample = [&](double downrange, const TimeState& current, double sample_time)
    {
        const Vec3 position { downrange, current[1], current[2] };
        const auto atmosphere = environment.atmosphere_at(position);
        const Vec3 ground_velocity { current[3], current[4], current[5] };
        const Vec3 air_relative {
            current[3] + atmosphere.headwind_mps,
            current[4],
            current[5] - atmosphere.crosswind_mps
        };
        const auto diagnostics = aerodynamic_diagnostics(p, ground_velocity, atmosphere);
        trajectory.samples.push_back(
            { downrange,
              position,
              ground_velocity,
              air_relative,
              diagnostics.ground_speed_mps,
              diagnostics.airspeed_mps,
              0.5 * p.definition.mass_kg * diagnostics.ground_speed_mps *
                  diagnostics.ground_speed_mps,
              p.definition.mass_kg * diagnostics.ground_speed_mps,
              sample_time,
              -current[1],
              current[2],
              diagnostics }
        );
    };

    append_sample(0.0, state, 0.0);
    if (max_distance == 0.0)
    {
        trajectory.covered_distance_m = 0.0;
        return trajectory;
    }

    double next_sample_distance = sample_interval;
    bool finished = false;
    while (!finished)
    {
        if (trajectory.solver.attempted_steps >= configuration.maximum_steps)
        {
            trajectory.termination = TrajectoryTermination::maximum_steps;
            if (state[0] > trajectory.samples.back().distance_m + 1e-10)
            {
                append_sample(state[0], state, time);
            }
            break;
        }
        if (time >= configuration.maximum_time_s)
        {
            trajectory.termination = TrajectoryTermination::maximum_time;
            if (state[0] > trajectory.samples.back().distance_m + 1e-10)
            {
                append_sample(state[0], state, time);
            }
            break;
        }

        dt = std::min(dt, configuration.maximum_time_s - time);
        const auto before = state;
        const auto before_time = time;
        const auto step = dormand_prince_54(
            before,
            dt,
            p,
            environment,
            configuration.include_aerodynamic_drag,
            configuration.include_gravity,
            configuration.aerodynamic_drag_multiplier
        );
        ++trajectory.solver.attempted_steps;

        if (!finite_state(step.fifth_order) || !finite_state(step.fourth_order))
        {
            trajectory.termination = TrajectoryTermination::non_finite_state;
            break;
        }

        const auto normalized_error = error_norm(before, step, configuration);
        trajectory.solver.maximum_error_norm =
            std::max(trajectory.solver.maximum_error_norm, normalized_error);
        if (!std::isfinite(normalized_error))
        {
            trajectory.termination = TrajectoryTermination::non_finite_state;
            break;
        }

        if (normalized_error > 1.0 && dt > configuration.minimum_time_step_s)
        {
            ++trajectory.solver.rejected_steps;
            const auto factor = std::clamp(0.9 * std::pow(normalized_error, -0.2), 0.1, 0.5);
            dt = std::max(configuration.minimum_time_step_s, dt * factor);
            continue;
        }

        state = step.fifth_order;
        time += dt;
        ++trajectory.solver.accepted_steps;
        if (trajectory.solver.accepted_steps == 1)
        {
            trajectory.solver.minimum_accepted_time_step_s = dt;
            trajectory.solver.maximum_accepted_time_step_s = dt;
        }
        else
        {
            trajectory.solver.minimum_accepted_time_step_s =
                std::min(trajectory.solver.minimum_accepted_time_step_s, dt);
            trajectory.solver.maximum_accepted_time_step_s =
                std::max(trajectory.solver.maximum_accepted_time_step_s, dt);
        }
        trajectory.solver.final_time_step_s = dt;

        auto append_regular_samples = [&](double limit_distance)
        {
            while (next_sample_distance <= limit_distance + 1e-12 &&
                   next_sample_distance <= max_distance + 1e-12)
            {
                const auto target = std::min(next_sample_distance, max_distance);
                const auto u = interpolation_fraction_for_x(before, state, dt, target);
                append_sample(
                    target,
                    interpolate_time_state(before, state, dt, u),
                    before_time + u * dt
                );
                next_sample_distance += sample_interval;
            }
        };

        if (state[0] >= max_distance)
        {
            append_regular_samples(max_distance);
            if (trajectory.samples.back().distance_m < max_distance - 1e-10)
            {
                const auto u = interpolation_fraction_for_x(before, state, dt, max_distance);
                append_sample(
                    max_distance,
                    interpolate_time_state(before, state, dt, u),
                    before_time + u * dt
                );
            }
            trajectory.termination = TrajectoryTermination::requested_distance;
            finished = true;
        }
        else if (state[3] <= 0.0)
        {
            double low = 0.0;
            double high = 1.0;
            for (int iteration = 0; iteration < 60; ++iteration)
            {
                const auto mid = (low + high) / 2.0;
                const auto candidate = interpolate_time_state(before, state, dt, mid);
                if (candidate[3] > 0.0)
                {
                    low = mid;
                }
                else
                {
                    high = mid;
                }
            }
            const auto u = (low + high) / 2.0;
            const auto endpoint = interpolate_time_state(before, state, dt, u);
            append_regular_samples(endpoint[0]);
            if (trajectory.samples.back().distance_m < endpoint[0] - 1e-10)
            {
                append_sample(endpoint[0], endpoint, before_time + u * dt);
            }
            trajectory.termination = TrajectoryTermination::horizontal_reversal;
            finished = true;
        }
        else if (
            configuration.terminate_at_ground && before[1] >= configuration.ground_height_m &&
            state[1] < configuration.ground_height_m
        )
        {
            double low = 0.0;
            double high = 1.0;
            for (int iteration = 0; iteration < 60; ++iteration)
            {
                const auto mid = (low + high) / 2.0;
                const auto candidate = interpolate_time_state(before, state, dt, mid);
                if (candidate[1] >= configuration.ground_height_m)
                {
                    low = mid;
                }
                else
                {
                    high = mid;
                }
            }
            const auto u = (low + high) / 2.0;
            const auto endpoint = interpolate_time_state(before, state, dt, u);
            append_regular_samples(endpoint[0]);
            if (trajectory.samples.back().distance_m < endpoint[0] - 1e-10)
            {
                append_sample(endpoint[0], endpoint, before_time + u * dt);
            }
            trajectory.termination = TrajectoryTermination::ground_impact;
            finished = true;
        }
        else if (state[3] <= configuration.minimum_forward_speed_mps)
        {
            append_regular_samples(state[0]);
            if (trajectory.samples.back().distance_m < state[0] - 1e-10)
            {
                append_sample(state[0], state, time);
            }
            trajectory.termination = TrajectoryTermination::minimum_forward_speed;
            finished = true;
        }
        else if (time >= configuration.maximum_time_s)
        {
            append_regular_samples(state[0]);
            if (trajectory.samples.back().distance_m < state[0] - 1e-10)
            {
                append_sample(state[0], state, time);
            }
            trajectory.termination = TrajectoryTermination::maximum_time;
            finished = true;
        }
        else
        {
            append_regular_samples(state[0]);
        }

        if (!finished)
        {
            const auto factor = normalized_error == 0.0
                ? 5.0
                : std::clamp(0.9 * std::pow(normalized_error, -0.2), 0.2, 5.0);
            dt = std::clamp(
                dt * factor,
                configuration.minimum_time_step_s,
                configuration.maximum_time_step_s
            );
        }
    }

    trajectory.covered_distance_m = trajectory.samples.back().distance_m;
    return trajectory;
}

} // namespace ballistics
