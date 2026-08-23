#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "ballistics.hpp"

namespace
{

class DeterministicRandom
{
  public:
    explicit DeterministicRandom(
        std::uint64_t seed
    )
        : state_(seed)
    {
    }

    std::uint64_t next()
    {
        state_ ^= state_ >> 12U;
        state_ ^= state_ << 25U;
        state_ ^= state_ >> 27U;
        return state_ * 0x2545F4914F6CDD1DULL;
    }

    double between(
        double minimum,
        double maximum
    )
    {
        const auto fraction = static_cast<double>(next() >> 11U) / 9007199254740992.0;
        return minimum + fraction * (maximum - minimum);
    }

    std::size_t count(
        std::size_t minimum,
        std::size_t maximum
    )
    {
        return minimum + static_cast<std::size_t>(next() % (maximum - minimum + 1));
    }

  private:
    std::uint64_t state_;
};

bool contains_code(
    const std::vector<ballistics::ValidationIssue>& issues,
    std::string_view code
)
{
    return std::any_of(
        issues.begin(),
        issues.end(),
        [code](const auto& issue)
        { return issue.code == code && issue.severity == ballistics::ValidationSeverity::error; }
    );
}

void expect(
    bool condition,
    std::string_view message,
    std::size_t& failures
)
{
    if (!condition)
    {
        ++failures;
        if (failures <= 20)
        {
            std::cerr << message << '\n';
        }
    }
}

ballistics::Projectile base_load(
    std::size_t sequence
)
{
    auto load = ballistics::built_in_projectiles()[3];
    load.provenance.id = "property:" + std::to_string(sequence);
    load.provenance.is_custom = true;
    load.definition.name = load.provenance.id;
    load.definition.short_name = load.provenance.id;
    return load;
}

void check_valid_reference_cases(
    DeterministicRandom& random,
    std::size_t& failures
)
{
    for (std::size_t iteration = 0; iteration < 3000; ++iteration)
    {
        auto load = base_load(iteration);
        const auto curve = iteration % 2 == 0
            ? ballistics::ReferenceDragCurve::g1
            : ballistics::ReferenceDragCurve::g7;
        if (iteration % 3 == 0)
        {
            load.definition.drag = ballistics::ReferenceBcDrag {
                curve,
                ballistics::ConstantBallisticCoefficient { random.between(0.005, 2.0) }
            };
        }
        else
        {
            ballistics::BandedBallisticCoefficient schedule;
            const auto count = random.count(2, 16);
            schedule.bands.reserve(count);
            schedule.bands.push_back({ 0.0, random.between(0.005, 2.0) });
            auto threshold = random.between(0.1, 50.0);
            for (std::size_t index = 1; index < count; ++index)
            {
                schedule.bands.push_back({ threshold, random.between(0.005, 2.0) });
                threshold += random.between(0.1, 100.0);
            }
            if (schedule.bands.back().minimum_velocity_mps > 2000.0)
            {
                const auto scale = 1900.0 / schedule.bands.back().minimum_velocity_mps;
                for (std::size_t index = 1; index < schedule.bands.size(); ++index)
                {
                    schedule.bands[index].minimum_velocity_mps *= scale;
                }
            }
            load.definition.drag = ballistics::ReferenceBcDrag { curve, std::move(schedule) };
        }

        const auto issues = ballistics::validate_projectile(load);
        expect(issues.empty(), "valid reference-BC load was rejected", failures);
        expect(
            ballistics::reference_bc_drag(load) != nullptr &&
                ballistics::tabulated_drag(load) == nullptr &&
                ballistics::sphere_drag(load) == nullptr,
            "reference-BC alternative was not exclusive",
            failures
        );
        const auto speed = random.between(1.0, 1800.0);
        const auto coefficient = ballistics::effective_ballistic_coefficient(load, speed);
        expect(
            std::isfinite(coefficient) && coefficient >= 0.005 && coefficient <= 2.0,
            "valid reference coefficient lookup left its domain",
            failures
        );
    }
}

void check_valid_tabulated_cases(
    DeterministicRandom& random,
    std::size_t& failures
)
{
    const auto atmosphere = ballistics::Atmosphere::create(15.0, 1013.25, 50.0, 0.0, 0.0);
    for (std::size_t iteration = 0; iteration < 3000; ++iteration)
    {
        auto load = base_load(3000 + iteration);
        ballistics::TabulatedDrag drag;
        drag.reference_diameter_m = random.between(0.001, 0.05);
        const auto count = random.count(2, 32);
        drag.points.reserve(count);
        auto mach = random.between(0.0, 0.1);
        for (std::size_t index = 0; index < count; ++index)
        {
            drag.points.push_back({ mach, random.between(0.01, 4.9) });
            mach += random.between(0.001, 0.25);
        }
        if (drag.points.back().mach > 10.0)
        {
            const auto scale = 9.9 / drag.points.back().mach;
            for (auto& point : drag.points)
            {
                point.mach *= scale;
            }
        }
        load.definition.drag = std::move(drag);

        const auto issues = ballistics::validate_projectile(load);
        expect(issues.empty(), "valid tabulated load was rejected", failures);
        expect(
            ballistics::tabulated_drag(load) != nullptr &&
                ballistics::reference_bc_drag(load) == nullptr &&
                ballistics::sphere_drag(load) == nullptr,
            "tabulated alternative was not exclusive",
            failures
        );
        const auto speed = random.between(1.0, 1200.0);
        const auto acceleration = ballistics::drag_retardation_mps2(speed, load, atmosphere);
        expect(
            std::isfinite(acceleration) && acceleration > 0.0,
            "valid tabulated load produced invalid drag",
            failures
        );
    }
}

void check_valid_sphere_cases(
    DeterministicRandom& random,
    std::size_t& failures
)
{
    constexpr double pi = 3.1415926535897932384626433832795;
    const auto atmosphere = ballistics::Atmosphere::create(15.0, 1013.25, 50.0, 0.0, 0.0);
    for (std::size_t iteration = 0; iteration < 3000; ++iteration)
    {
        auto load = base_load(6000 + iteration);
        const auto diameter_m = random.between(0.001, 0.05);
        const auto density_kg_m3 = random.between(500.0, 25000.0);
        load.definition.mass_kg = density_kg_m3 * pi * diameter_m * diameter_m * diameter_m / 6.0;
        load.definition.geometry.reset();
        load.definition.drag = ballistics::SphereDrag { diameter_m, density_kg_m3 };
        load.firearm.group = ballistics::FirearmGroup::shotgun;
        load.firearm.twist_rate_inches.reset();

        const auto issues = ballistics::validate_projectile(load);
        expect(issues.empty(), "valid sphere load was rejected", failures);
        expect(
            ballistics::sphere_drag(load) != nullptr &&
                ballistics::reference_bc_drag(load) == nullptr &&
                ballistics::tabulated_drag(load) == nullptr,
            "sphere alternative was not exclusive",
            failures
        );
        const auto acceleration =
            ballistics::drag_retardation_mps2(random.between(1.0, 500.0), load, atmosphere);
        expect(
            std::isfinite(acceleration) && acceleration > 0.0,
            "valid sphere load produced invalid drag",
            failures
        );
    }
}

void check_invalid_boundaries(
    std::size_t& failures
)
{
    auto load = base_load(9000);

    for (const auto invalid : { 0.0, -0.1, 2.01, std::numeric_limits<double>::infinity() })
    {
        load.definition.drag = ballistics::ReferenceBcDrag {
            ballistics::ReferenceDragCurve::g1,
            ballistics::ConstantBallisticCoefficient { invalid }
        };
        expect(
            contains_code(ballistics::validate_projectile(load), "projectile.bc.range"),
            "invalid constant BC was not rejected",
            failures
        );
    }

    load.definition.drag = ballistics::ReferenceBcDrag {
        ballistics::ReferenceDragCurve::g7,
        ballistics::BandedBallisticCoefficient { { { 100.0, 0.2 }, { 400.0, 0.3 } } }
    };
    expect(
        contains_code(ballistics::validate_projectile(load), "projectile.bc_schedule.coverage"),
        "uncovered BC schedule was not rejected",
        failures
    );
    load.definition.drag = ballistics::ReferenceBcDrag {
        ballistics::ReferenceDragCurve::g7,
        ballistics::BandedBallisticCoefficient { { { 0.0, 0.2 }, { 500.0, 0.3 }, { 400.0, 0.4 } } }
    };
    expect(
        contains_code(ballistics::validate_projectile(load), "projectile.bc_schedule.order"),
        "unordered BC schedule was not rejected",
        failures
    );

    load.definition.drag = ballistics::TabulatedDrag { 0.0009, { { 0.0, 0.3 }, { 1.0, 0.3 } } };
    expect(
        contains_code(ballistics::validate_projectile(load), "projectile.mach_cd.diameter_range"),
        "invalid tabulated diameter was not rejected",
        failures
    );
    load.definition.drag = ballistics::TabulatedDrag { 0.01, { { 1.0, 0.3 }, { 0.5, 0.2 } } };
    expect(
        contains_code(ballistics::validate_projectile(load), "projectile.mach_cd.order"),
        "unordered Mach-Cd table was not rejected",
        failures
    );

    load.definition.drag = ballistics::SphereDrag { 0.01, 100.0 };
    expect(
        contains_code(ballistics::validate_projectile(load), "projectile.sphere.density_range"),
        "invalid sphere density was not rejected",
        failures
    );
    load.definition.drag = ballistics::SphereDrag { 0.01, 7800.0 };
    load.definition.mass_kg = 1.0;
    expect(
        contains_code(ballistics::validate_projectile(load), "projectile.sphere.mass_inconsistent"),
        "inconsistent sphere mass was not rejected",
        failures
    );

    load = base_load(9001);
    load.definition.geometry = ballistics::ProjectileGeometry { 0.0, 0.308 };
    expect(
        contains_code(ballistics::validate_projectile(load), "projectile.geometry.positive"),
        "invalid optional geometry was not rejected",
        failures
    );
    load = base_load(9002);
    load.ammunition.payload_count = 0;
    expect(
        contains_code(ballistics::validate_projectile(load), "projectile.payload_count.range"),
        "invalid payload count was not rejected",
        failures
    );
}

} // namespace

int main()
{
    static_assert(std::variant_size_v<ballistics::DragDefinition> == 3);
    static_assert(std::variant_size_v<ballistics::BallisticCoefficientDefinition> == 2);

    std::size_t failures = 0;
    DeterministicRandom random(0xB4111571C5ULL);
    check_valid_reference_cases(random, failures);
    check_valid_tabulated_cases(random, failures);
    check_valid_sphere_cases(random, failures);
    check_invalid_boundaries(failures);

    if (failures != 0)
    {
        std::cerr << failures << " projectile domain property checks failed\n";
        return 1;
    }
    std::cout << "Validated 9,000 generated domain-valid loads plus invariant boundary cases.\n";
    return 0;
}
