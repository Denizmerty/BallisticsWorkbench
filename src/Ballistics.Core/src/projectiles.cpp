#include <cmath>
#include <string>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

#include "ballistics.hpp"

namespace ballistics
{
namespace
{

constexpr double pi = 3.1415926535897932384626433832795;

Projectile make_reference_load(
    std::string name,
    std::string short_name,
    double mass_kg,
    double muzzle_velocity_mps,
    double ballistic_coefficient,
    std::string drag_description,
    ReferenceDragCurve curve,
    FirearmGroup firearm_group,
    std::optional<ProjectileGeometry> geometry,
    std::string id
)
{
    return {
        { std::move(name),
          std::move(short_name),
          mass_kg,
          geometry,
          ReferenceBcDrag { curve, ConstantBallisticCoefficient { ballistic_coefficient } } },
        { muzzle_velocity_mps, 1 },
        { firearm_group, std::nullopt },
        { false, std::move(id), std::move(drag_description) }
    };
}

Projectile make_sphere_load(
    std::string name,
    std::string short_name,
    double muzzle_velocity_mps,
    double diameter_m,
    double material_density_kg_m3,
    int payload_count,
    std::string drag_description,
    std::string id
)
{
    const auto mass_kg = material_density_kg_m3 * pi * diameter_m * diameter_m * diameter_m / 6.0;
    return {
        { std::move(name),
          std::move(short_name),
          mass_kg,
          std::nullopt,
          SphereDrag { diameter_m, material_density_kg_m3 } },
        { muzzle_velocity_mps, payload_count },
        { FirearmGroup::shotgun, std::nullopt },
        { false, std::move(id), std::move(drag_description) }
    };
}

} // namespace

std::vector<ValidationIssue> validate_projectile(
    const Projectile& p
)
{
    std::vector<ValidationIssue> issues;
    const auto error = [&](std::string code, std::string field, std::string message)
    {
        issues.push_back(
            { std::move(code), std::move(field), std::move(message), ValidationSeverity::error }
        );
    };

    if (p.provenance.id.empty())
    {
        error("projectile.id.required", "id", "Projectile ID is required.");
    }
    if (p.definition.name.empty())
    {
        error("projectile.name.required", "name", "Projectile name is required.");
    }
    if (!std::isfinite(p.definition.mass_kg) || p.definition.mass_kg <= 0.0)
    {
        error("projectile.mass.positive", "massKg", "Projectile mass must be positive.");
    }
    if (!std::isfinite(p.ammunition.muzzle_velocity_mps) ||
        p.ammunition.muzzle_velocity_mps < 1.0 || p.ammunition.muzzle_velocity_mps > 2000.0)
    {
        error(
            "projectile.velocity.range",
            "muzzleVelocityMps",
            "Muzzle velocity must be between 1 and 2000 m/s."
        );
    }
    if (p.ammunition.payload_count < 1 || p.ammunition.payload_count > 1000)
    {
        error(
            "projectile.payload_count.range",
            "pelletCount",
            "Payload count must be between 1 and 1000."
        );
    }
    if (p.definition.geometry &&
        (!std::isfinite(p.definition.geometry->length_inches) ||
         !std::isfinite(p.definition.geometry->diameter_inches) ||
         p.definition.geometry->length_inches <= 0.0 ||
         p.definition.geometry->diameter_inches <= 0.0))
    {
        error(
            "projectile.geometry.positive",
            "bulletGeometry",
            "Provided projectile geometry must contain positive finite dimensions."
        );
    }

    std::visit(
        [&](const auto& drag)
        {
            using Drag = std::decay_t<decltype(drag)>;
            if constexpr (std::is_same_v<Drag, SphereDrag>)
            {
                if (!std::isfinite(drag.diameter_m) || drag.diameter_m < 0.001 ||
                    drag.diameter_m > 0.05)
                {
                    error(
                        "projectile.sphere.diameter_range",
                        "drag.diameterM",
                        "Sphere diameter must be between 0.001 and 0.05 m."
                    );
                }
                if (!std::isfinite(drag.material_density_kg_m3) ||
                    drag.material_density_kg_m3 < 500.0 || drag.material_density_kg_m3 > 25000.0)
                {
                    error(
                        "projectile.sphere.density_range",
                        "drag.materialDensityKgM3",
                        "Sphere material density must be between 500 and 25000 kg/m3."
                    );
                }
                const auto expected_mass = drag.material_density_kg_m3 * pi * drag.diameter_m *
                    drag.diameter_m * drag.diameter_m / 6.0;
                if (std::isfinite(expected_mass) && expected_mass > 0.0 &&
                    std::isfinite(p.definition.mass_kg) &&
                    std::abs(p.definition.mass_kg - expected_mass) > expected_mass * 1e-9)
                {
                    error(
                        "projectile.sphere.mass_inconsistent",
                        "massKg",
                        "Sphere mass must match its diameter and material density."
                    );
                }
            }
            else if constexpr (std::is_same_v<Drag, TabulatedDrag>)
            {
                if (!std::isfinite(drag.reference_diameter_m) ||
                    drag.reference_diameter_m < 0.001 || drag.reference_diameter_m > 0.05)
                {
                    error(
                        "projectile.mach_cd.diameter_range",
                        "drag.referenceDiameterM",
                        "Drag reference diameter must be between 0.001 and 0.05 m."
                    );
                }
                if (drag.points.size() < 2 || drag.points.size() > 64)
                {
                    error(
                        "projectile.mach_cd.count",
                        "drag.points",
                        "A tabulated Mach-Cd curve must contain between 2 and 64 points."
                    );
                }
                for (std::size_t index = 0; index < drag.points.size(); ++index)
                {
                    const auto& point = drag.points[index];
                    const auto field = "drag.points[" + std::to_string(index) + "]";
                    if (!std::isfinite(point.mach) || point.mach < 0.0 || point.mach > 10.0)
                    {
                        error(
                            "projectile.mach_cd.mach_range",
                            field + ".mach",
                            "Curve Mach values must be between 0 and 10."
                        );
                    }
                    if (!std::isfinite(point.drag_coefficient) || point.drag_coefficient <= 0.0 ||
                        point.drag_coefficient > 5.0)
                    {
                        error(
                            "projectile.mach_cd.cd_range",
                            field + ".dragCoefficient",
                            "Curve drag coefficients must be positive and at most 5."
                        );
                    }
                    if (index > 0 && point.mach <= drag.points[index - 1].mach)
                    {
                        error(
                            "projectile.mach_cd.order",
                            field + ".mach",
                            "Curve Mach values must be strictly increasing."
                        );
                    }
                }
            }
            else
            {
                if (const auto* constant =
                        std::get_if<ConstantBallisticCoefficient>(&drag.coefficient))
                {
                    if (!std::isfinite(constant->value) || constant->value <= 0.0 ||
                        constant->value > 2.0)
                    {
                        error(
                            "projectile.bc.range",
                            "drag.ballisticCoefficient",
                            "Ballistic coefficient must be positive and at most 2."
                        );
                    }
                    return;
                }

                const auto& bands = std::get<BandedBallisticCoefficient>(drag.coefficient).bands;
                if (bands.size() < 2 || bands.size() > 16)
                {
                    error(
                        "projectile.bc_schedule.count",
                        "drag.velocityBands",
                        "A velocity-banded BC schedule must contain between 2 and 16 bands."
                    );
                }
                for (std::size_t index = 0; index < bands.size(); ++index)
                {
                    const auto& band = bands[index];
                    const auto field = "drag.velocityBands[" + std::to_string(index) + "]";
                    if (!std::isfinite(band.minimum_velocity_mps) ||
                        band.minimum_velocity_mps < 0.0 || band.minimum_velocity_mps > 2000.0)
                    {
                        error(
                            "projectile.bc_schedule.velocity_range",
                            field + ".minimumVelocityMps",
                            "Band minimum velocity must be between 0 and 2000 m/s."
                        );
                    }
                    if (!std::isfinite(band.ballistic_coefficient) ||
                        band.ballistic_coefficient <= 0.0 || band.ballistic_coefficient > 2.0)
                    {
                        error(
                            "projectile.bc_schedule.bc_range",
                            field + ".ballisticCoefficient",
                            "Band ballistic coefficient must be positive and at most 2."
                        );
                    }
                    if (index == 0 && band.minimum_velocity_mps != 0.0)
                    {
                        error(
                            "projectile.bc_schedule.coverage",
                            field + ".minimumVelocityMps",
                            "The first BC band must begin at 0 m/s."
                        );
                    }
                    if (index > 0 &&
                        band.minimum_velocity_mps <= bands[index - 1].minimum_velocity_mps)
                    {
                        error(
                            "projectile.bc_schedule.order",
                            field + ".minimumVelocityMps",
                            "BC band minimum velocities must be strictly increasing."
                        );
                    }
                }
            }
        },
        p.definition.drag
    );

    return issues;
}

const std::vector<Projectile>& built_in_projectiles()
{
    static const std::vector<Projectile> loads {
        make_reference_load(
            "B&P White Blackout HV 12/70, 28 g",
            "White Blackout HV",
            0.028,
            575.0,
            0.054624716532086,
            "effective BC fitted to 33 m and 50 m data",
            ReferenceDragCurve::g1,
            FirearmGroup::shotgun,
            std::nullopt,
            "builtin:white-blackout-hv"
        ),
        make_reference_load(
            "B&P BlackShock 12/70, 32 g",
            "BlackShock",
            0.032,
            455.0,
            0.0709673760860212,
            "effective BC fitted to 33 m data",
            ReferenceDragCurve::g1,
            FirearmGroup::shotgun,
            std::nullopt,
            "builtin:blackshock"
        ),
        make_reference_load(
            "Winchester Super-X X123RS15 12/76, 1 oz",
            "Winchester X123RS15",
            0.028349523125,
            1760.0 * fps_to_mps,
            0.068,
            "manufacturer-published G1 BC",
            ReferenceDragCurve::g1,
            FirearmGroup::shotgun,
            std::nullopt,
            "builtin:winchester-x123rs15"
        ),
        make_reference_load(
            "Hornady BLACK .308 Win A-MAX, 168 gr (80971)",
            "Hornady A-MAX 168 gr",
            168.0 * grains_to_kg,
            2700.0 * fps_to_mps,
            0.475,
            "manufacturer G1 BC, 24-inch test barrel",
            ReferenceDragCurve::g1,
            FirearmGroup::rifle,
            ProjectileGeometry { 1.24, 0.308 },
            "builtin:hornady-amax-168"
        ),
        make_reference_load(
            "Federal Power-Shok .308 Win SP, 150 gr (308A)",
            "Federal SP 150 gr",
            150.0 * grains_to_kg,
            2820.0 * fps_to_mps,
            0.312368144835017,
            "effective G1 BC fitted to official table, 24-inch test barrel",
            ReferenceDragCurve::g1,
            FirearmGroup::rifle,
            ProjectileGeometry { 1.13, 0.308 },
            "builtin:federal-sp-150"
        ),
        make_sphere_load(
            "Winchester Super-X 12/70, 9-pellet 00 Buck, 1,325 ft/s",
            "Winchester 9-pellet 00",
            1325.0 * fps_to_mps,
            0.330 * inches_to_m,
            11340.0,
            9,
            "Morrison sphere model",
            "builtin:winchester-00-buck"
        )
    };

    return loads;
}

} // namespace ballistics
