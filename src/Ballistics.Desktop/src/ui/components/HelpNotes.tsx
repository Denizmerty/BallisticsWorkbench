export function HelpNotes() {
    return (
        <article className="help-document">
            <span className="eyebrow">MODEL REFERENCE AND OPERATING GUIDE</span>
            <h2>Quick Start</h2>
            <p>
                Choose a distance and atmospheric conditions, then read all loads in the All-load
                Calculator tab. The Range Table shows one selected load at regular increments. The
                Overview chart plots every active load continuously. The calculation is numerical
                and does not interpolate a prewritten range table.
            </p>

            <h3>Working efficiently</h3>
            <p>
                Number keys <b>1</b>–<b>4</b> switch between Overview, Range Table, All-load
                Calculator, and Help. The arrow keys, or <b>[</b> and <b>]</b>, cycle the selected
                load. <b>Ctrl+E</b>
                exports the current range table and <b>Ctrl+R</b> resets the atmosphere. In the
                All-load Calculator, click any column heading to sort by it. Click again to reverse
                the order. The <b>Copy summary</b> button places the selected load&rsquo;s values at
                the reference distance on the clipboard. Out-of-range inputs are highlighted
                individually and listed in the sidebar, and the engine pauses until they are
                corrected. The active tab, chosen units, theme, custom loads, and named profiles are
                all remembered between sessions. Press <b>Ctrl+Shift+P</b> to open the profile
                manager.
            </p>

            <h2>Named profiles and interchange</h2>
            <p>
                The <b>Profiles</b> manager saves the current environment, one firearm group, the
                selected ammunition, or a complete combined scenario under a name. Environment and
                firearm profiles update only their own fields. Ammunition profiles select a built-in
                load or restore a custom load. Combined scenarios atomically restore every physical
                input, uncertainty settings, custom loads, selected load, and preferred units.
            </p>
            <p>
                Exported <code>.bwprofile.json</code> files use a strict versioned schema and
                canonical SI values regardless of display units. Before importing, choose whether
                same-ID or same-name conflicts are renamed, replaced, or skipped. Valid profiles
                still import when a sibling is malformed. Invalid entries enter a recoverable
                quarantine with their original JSON and a diagnostic. Legacy settings envelopes from
                schema versions 2 through 7 can be migrated to a combined-scenario profile. Profile
                files are limited to 1 MiB and 64 profiles.
            </p>

            <h3>Controllable status readout</h3>
            <p>
                The status readout follows the load selected in its Load control. Use its Status and
                Load selectors to choose atmosphere and integration extent, a complete selected-load
                summary, retained-energy percentage, Mach and flight regime, drag-coefficient
                diagnostics, windage (wind and spin drift), holdover and sight path, MPBR and
                optimal zero, or native trajectory events. Drag diagnostics report reference Cd for
                G models and physical Cd/Reynolds values for sphere and tabulated curves. The
                readout updates when distance, load, units, or model inputs change.
            </p>

            <h2>Drag Model</h2>
            <p>
                The program integrates one shared point-mass trajectory state in time with adaptive
                Dormand–Prince 5(4) steps. G1 uses the Ingalls/Mayevski piecewise retardation law.
                G7 uses a Mach-indexed reference drag-coefficient table. Custom Mach–Cd loads
                linearly interpolate a user-supplied coefficient table and use the entered reference
                diameter as frontal area. Sphere loads use Morrison’s Reynolds-dependent
                smooth-sphere Cd relation combined with the Collins transonic correction fitted to
                Miller–Bailey sphere-drag data. Air density, dynamic viscosity, and local speed of
                sound are recomputed from the active atmosphere. Headwind and tailwind enter every
                model through air-relative velocity. The sphere model uses the same trajectory,
                gravity, chart, MPBR, status, unit, and export architecture as the other loads.
            </p>

            <h2>Atmosphere Inputs</h2>
            <p>
                Choose one pressure source: measured station pressure, ICAO pressure altitude, or an
                altimeter setting paired with the field's geometric elevation. The latter is an
                aviation altimeter setting, not mean-sea-level pressure. Each mode resolves to
                station pressure before the native solver runs. The resolved pressure and pressure
                altitude remain visible. Density altitude is a derived standard-atmosphere index
                from the calculated moist-air density. The current trajectory uses one homogeneous
                atmosphere evaluated at the firing point. It does not vary air properties along the
                flight path.
            </p>

            <h2>Projectile and Payload Values</h2>
            <p>
                Velocity, drop, wind drift, spin drift, time of flight, Mach, Cd, and Reynolds
                number describe one projectile or pellet. Energy and momentum are shown both per
                projectile and for the complete payload. For a slug or rifle cartridge, payload
                count is one and the two values are identical. For the built-in nine-pellet 00-buck
                load, payload totals are nine times the one-pellet scalar values. This arithmetic
                total does not imply that nine pellets behave as one solid projectile or follow one
                wound path.
            </p>

            <h2>Firearm Profiles</h2>
            <h3>Separate muzzle-velocity corrections</h3>
            <p>
                Shotgun and rifle corrections are independent. Use chronograph-derived percentages
                to represent a particular barrel and ammunition lot. A correction changes launch
                velocity and changes every downstream result for that firearm group. It is not a
                barrel-length formula.
            </p>
            <h3>Sight height and MPBR</h3>
            <p>
                Shotgun and rifle sight heights are measured from bore axis to sight line. MPBR
                includes this offset, the selected vital-zone diameter, gravity, and drag. The
                displayed MPBR is the farthest range at which the optimized trajectory stays inside
                plus or minus half the vital-zone diameter. The MPBR status mode also shows the
                computed <em>optimal</em> zero.
            </p>
            <h3>Sight-in zero, path, and holdover</h3>
            <p>
                The shotgun and rifle <b>zero range</b> inputs are the distances at which each
                firearm is actually sighted in. The MPBR calculation reports a separate optimal
                zero. Given a zero and sight height, the program places the trajectory relative to
                the line of sight. <b>Path vs sight line</b> is positive when the projectile is
                above the line of sight (the mid-range rise) and negative when it has fallen below.
                At the muzzle the path equals the negative sight height, and it crosses zero exactly
                at the sight-in distance.
            </p>
            <p>
                <b>Holdover</b> is the elevation correction needed to hit at a given distance,
                reported in both minutes of angle (MOA) and milliradians (mil). Positive means hold
                or dial up. It is the exact native <code>atan2</code> angle subtended by the path
                deficit, so it is independent of metric or imperial units. The range table lists
                path and holdover at every step, the overview cards and the Holdover status mode
                report them at the selected distance, and the chart can plot sight path or holdover
                directly. The engine also propagates angular holdover uncertainty. The renderer only
                converts radians to MOA or mil. The engine solves the actual bore elevation and
                reintegrates the shot. MPBR uses the same native trajectory geometry.
            </p>
            <h3>Trajectory events</h3>
            <p>
                The engine analyzes the full solution horizon for the rising near zero, falling far
                zero, maximum ordinate above the sight line, Mach 1.2/1.0/0.8 crossings, supersonic
                range, and intersection with the muzzle-height ground plane. These events appear in
                the Overview and Trajectory events status mode and are included in copied summaries
                and CSV exports. A<em> horizon limited</em> value means the defining crossing was
                not reached. It is not an estimate at the final endpoint. A subsonic launch reports
                supersonic range as
                <em> not applicable</em>.
            </p>
            <h3>Rifle twist and spin drift</h3>
            <p>
                Twist rate and direction belong to the rifle, not the cartridge. The rifle profile
                controls both built-in .308 loads. A custom rifle projectile may optionally supply
                its own twist override. Spin drift uses the Miller stability estimate with velocity
                and air-density corrections, followed by the Litz empirical time-of-flight relation.
                Positive drift is rightward for right-hand twist and negative for left-hand twist.
                The drift estimate is available only from Sg 1.0 through 3.5. Unstable or
                out-of-domain estimates retain Sg but do not report a displacement. This remains an
                estimate, not a full six-degree-of-freedom solution.
            </p>

            <h2>Wind</h2>
            <h3>Headwind, crosswind, and windage</h3>
            <p>
                The headwind and crosswind components are entered separately. Headwind (positive
                toward the shooter) enters every drag model through air-relative velocity and
                changes retained velocity, energy, drop, and time of flight. Crosswind is integrated
                directly. The trajectory solver carries a full three-dimensional velocity state, so
                a crosswind produces lateral drift from the drag acting on the sideways air-relative
                velocity. Positive crosswind blows from the shooter&rsquo;s left to right and
                deflects the projectile to the right. With no crosswind the lateral state stays
                exactly zero and results are identical to the pure vertical-plane trajectory.
            </p>
            <p>
                Wind drift and spin drift are reported separately and combined as{' '}
                <b>total windage</b>. Both use the same right-positive sign convention, so they add
                directly. Wind drift scales with a load&rsquo;s time-of-flight lag, so a low-BC slug
                or a round pellet drifts far more than a streamlined rifle bullet at the same range
                and wind speed.
            </p>

            <h2>Uncertainty bands</h2>
            <p>
                Enable <b>Uncertainty bands</b> in the sidebar to enter independent one-sigma values
                for shotgun and rifle muzzle velocity, relative BC or drag scale, temperature,
                station pressure, headwind, crosswind, and each sight-zero range. G1/G7 loads treat
                the relative input as BC uncertainty. Sphere and Mach&ndash;Cd loads treat it as
                drag-scale uncertainty. A zero value disables that contribution.
            </p>
            <p>
                The engine uses deterministic local sensitivity derivatives and combines independent
                contributions by root sum square. The shaded chart region and the 95% half-width
                readouts are approximate first-order intervals, not proof of real-world coverage.
                They do not include correlated inputs, drag-model error, projectile shape variation,
                or uncertainty in the empirical spin-drift estimate. Spin-drift and total-windage
                charts have no band. The CSV export records all inputs, method, status, standard
                deviations, and 95% half-widths.
            </p>

            <h2>Measured-velocity BC fitting</h2>
            <p>
                Open a custom G1 or G7 projectile and expand{' '}
                <b>Fit G1/G7 BC from measured velocities</b>. Enter chronograph or Doppler ranges,
                velocities, and one-sigma measurement uncertainty. Mark the points used to determine
                the coefficients as calibration and reserve other points as holdout. The fitter can
                estimate one constant BC or two to four coefficients at fixed velocity thresholds.
                It reports coefficient confidence intervals plus every raw and normalized residual.
                Apply is enabled only for a converged fit. Export the residual report to retain the
                observations, atmosphere, engine/model identity, estimates, and errors.
            </p>
            <p>
                Holdout observations do not influence the fit. Without them, the result is
                calibration only and is not evidence of validation. A held-out error describes only
                the supplied dataset and does not prove accuracy for another ammunition lot, barrel,
                atmosphere, or velocity range.
            </p>

            <h2>Built-in load calibration notes</h2>
            <h3>White Blackout HV</h3>
            <p>
                575 m/s nominal; published 443 m/s at 33 m and 384 m/s at 50 m. Effective G1 BC =
                0.054624717. Model error at those anchors is about −0.5% and +0.4%.
            </p>
            <h3>BlackShock</h3>
            <p>455 m/s nominal. Published 373 m/s at 33 m. Effective G1 BC = 0.070967376.</p>
            <h3>Winchester X123RS15</h3>
            <p>
                1,760 ft/s with manufacturer-published G1 BC 0.068. The model reproduces the
                published 50, 100, and 125 yd velocities to roughly 0.3%.
            </p>
            <h3>Winchester Super-X nine-pellet 00 buck</h3>
            <p>
                The built-in sphere load uses nine nominal 0.330-inch pure-lead pellets at 1,325
                ft/s. A pure-lead sphere at that diameter is calculated as about 53.96 gr (3.497 g)
                per pellet. Its drag is not represented by a fitted ballistic coefficient. The
                adaptive time-domain solver is checked against a tighter reference configuration and
                the retained legacy solver under matched conditions. Ordinary-range velocity
                differences are far below 0.1%. The current sphere fit declares Mach 0.2–1.5 and
                Reynolds 100–2,000,000 as its supported box. Results outside it remain visible but
                carry an extrapolation warning.
            </p>
            <h3>Hornady BLACK .308 Win 168 gr A-MAX, item 80971</h3>
            <p>
                2,700 ft/s from a 24-inch test barrel and manufacturer G1 BC 0.475. The published
                100–500 yd velocity series is reproduced within about 0.11%.
            </p>
            <h3>Federal Power-Shok .308 Win 150 gr SP, 308A</h3>
            <p>
                2,820 ft/s from a 24-inch test barrel. Effective G1 BC 0.312368145 is reproducibly
                fitted to Federal’s published velocity series and reproduces it within about 0.015%.
            </p>

            <h2>Custom Projectiles</h2>
            <p>
                Metric mode uses grams and metres per second. Imperial mode uses grains and feet per
                second. Select G1, G7, Mach–Cd table, or Sphere and choose the shotgun or rifle
                profile. For Sphere, enter diameter, material density, and payload count. Mass is
                derived geometrically and the ordinary mass and BC fields are ignored. G1/G7 loads
                may use one constant BC or an ordered velocity-banded schedule. The first band
                starts at 0 m/s and each later threshold activates its BC at that airspeed. A
                Mach–Cd load requires mass, reference diameter, and 2–64 ordered Mach/Cd points.
                Linear interpolation is used between points. Outside the supplied Mach range the
                nearest endpoint is held constant and the engine reports an extrapolation warning.
                Custom names must be unique. For rifle spin drift, enter bullet length and diameter.
                Custom names are made unique automatically. A zero twist value means use the global
                rifle-profile twist.
            </p>

            <h2>Limitations</h2>
            <p>
                Slug BCs are effective coefficients derived from sparse measurements. Rifle BCs are
                manufacturer G1 values or fitted to official tables. These are average point-mass
                models, not CFD or six-degree-of-freedom simulations. Launch yaw, choke interaction,
                projectile or pellet deformation, pellet-pellet aerodynamic interaction, pattern
                aerodynamic jump, and dynamic instability are not included in the model. Crosswind
                drift and optional Coriolis acceleration are point-mass effects and do not include
                the aerodynamic jump that a real crosswind induces at the muzzle. The empirical
                buckshot panel fits measured pattern spread and target-region pellet probabilities;
                it does not model pellet wakes or swarm aerodynamics. The sphere correlation treats
                an isolated smooth sphere. Launch flattening, alloy hardness, buffering, and pellet
                contact can change real drag. Uncertainty increases beyond measured regions and
                through transonic flight. Always verify real firearms with chronographing and actual
                zeroing.
            </p>

            <h2>Project, Support, and License</h2>
            <p>
                Ballistics Workbench is developed and maintained by <b>Deniz Mert Yayla</b>. For bug
                reports, proposed fixes, and suggestions, email <b>denizmerty@gmail.com</b>.
            </p>
            <p>
                Copyright &copy; 2026 Deniz Mert Yayla. Ballistics Workbench is free software
                licensed under the GNU General Public License, version 3 or any later version. The
                complete license text is included with the source code and packaged application.
                This software is provided without warranty.
            </p>
        </article>
    );
}
