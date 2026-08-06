export function HelpNotes() {
  return (
    <article className="help-document">
      <span className="eyebrow">MODEL REFERENCE AND OPERATING GUIDE</span>
      <h2>Quick Start</h2>
      <p>
        Choose a distance and atmospheric conditions, then read all loads in the Compare tab. The
        Range Table shows one selected load at regular increments. The Overview chart plots every
        active load continuously. The calculation is numerical and does not interpolate a prewritten
        range table.
      </p>

      <h3>Controllable status readout</h3>
      <p>
        The status readout is never tied silently to the first projectile. Use its Status and Load
        selectors to choose atmosphere and integration extent, a complete selected-load summary,
        retained-energy percentage, Mach and flight regime, sphere aerodynamics, or MPBR and optimal
        zero. Sphere aerodynamics reports instantaneous Cd and Reynolds number only for spherical
        loads. The readout updates when distance, load, units, or model inputs change.
      </p>

      <h2>Drag Model</h2>
      <p>
        The program integrates one shared point-mass trajectory state with fourth-order Runge–Kutta
        steps in horizontal distance. G1 uses the Ingalls/Mayevski piecewise retardation law. G7
        uses a Mach-indexed reference drag-coefficient table. Sphere loads use Morrison’s
        Reynolds-dependent smooth-sphere Cd relation combined with the Collins transonic correction
        fitted to Miller–Bailey sphere-drag data. Air density, dynamic viscosity, and local speed of
        sound are recomputed from the active atmosphere. Headwind and tailwind enter every model
        through air-relative velocity. The sphere model uses the same trajectory, gravity, chart,
        MPBR, status, unit, and export architecture as the other loads.
      </p>

      <h2>Projectile and Payload Values</h2>
      <p>
        Velocity, drop, time of flight, Mach, Cd, and Reynolds number describe one projectile or
        pellet. Energy and momentum are shown both per projectile and for the complete payload. For
        a slug or rifle cartridge, payload count is one and the two values are identical. For the
        built-in nine-pellet 00-buck load, payload totals are nine times the one-pellet scalar
        values. This arithmetic total does not imply that nine pellets behave as one solid
        projectile or follow one wound path.
      </p>

      <h2>Firearm Profiles</h2>
      <h3>Separate muzzle-velocity corrections</h3>
      <p>
        Shotgun and rifle corrections are independent. Use chronograph-derived percentages to
        represent a particular barrel and ammunition lot. A correction changes launch velocity and
        therefore every downstream result for that firearm group. It is not a barrel-length formula.
      </p>
      <h3>Sight height and MPBR</h3>
      <p>
        Shotgun and rifle sight heights are measured from bore axis to sight line. MPBR includes
        this offset, the selected vital-zone diameter, gravity, and drag. The displayed MPBR is the
        farthest range at which the optimized trajectory stays inside plus or minus half the
        vital-zone diameter. The MPBR status mode also shows the computed optimal zero.
      </p>
      <h3>Rifle twist and spin drift</h3>
      <p>
        Twist rate and direction belong to the rifle, not the cartridge. The rifle profile therefore
        controls both built-in .308 loads. A custom rifle projectile may optionally supply its own
        twist override. Spin drift uses the Miller stability estimate with velocity and air-density
        corrections, followed by the Litz empirical time-of-flight relation. Positive drift is
        rightward for right-hand twist and negative for left-hand twist. This remains an estimate,
        not a full six-degree-of-freedom solution.
      </p>

      <h2>Calibration</h2>
      <h3>White Blackout HV</h3>
      <p>
        575 m/s nominal; published 443 m/s at 33 m and 384 m/s at 50 m. Effective G1 BC = 0.05452.
        Model error at those anchors is about −0.5% and +0.4%.
      </p>
      <h3>BlackShock</h3>
      <p>455 m/s nominal; published 373 m/s at 33 m. Effective G1 BC = 0.07099.</p>
      <h3>Winchester X123RS15</h3>
      <p>
        1,760 ft/s with manufacturer-published G1 BC 0.068. The model reproduces the published 50,
        100, and 125 yd velocities to roughly 0.3%.
      </p>
      <h3>Winchester Super-X nine-pellet 00 buck</h3>
      <p>
        The built-in sphere load uses nine nominal 0.330-inch pure-lead pellets at 1,325 ft/s. A
        pure-lead sphere at that diameter is calculated as about 53.96 gr (3.497 g) per pellet. Its
        drag is not represented by a fitted ballistic coefficient. The shared fixed-step solver has
        been regression-tested against the standalone adaptive RK4 sphere solver under matched
        dry-air settings; ordinary-range velocity differences are far below 0.1%.
      </p>
      <h3>Hornady BLACK .308 Win 168 gr A-MAX, item 80971</h3>
      <p>
        2,700 ft/s from a 24-inch test barrel and manufacturer G1 BC 0.475. The published 100–500 yd
        velocity series is reproduced within about 0.11%.
      </p>
      <h3>Federal Power-Shok .308 Win 150 gr SP, 308A</h3>
      <p>
        2,820 ft/s from a 24-inch test barrel. Effective G1 BC 0.313 is fitted to Federal’s
        published velocity series and reproduces it within about 0.14%.
      </p>

      <h2>Custom Projectiles</h2>
      <p>
        Metric mode uses grams and metres per second; imperial mode uses grains and feet per second.
        Select G1, G7, or Sphere and choose the shotgun or rifle profile. For Sphere, enter
        diameter, material density, and payload count; mass is derived geometrically and the
        ordinary mass and BC fields are ignored. Custom names must be unique. For rifle spin drift,
        enter bullet length and diameter. Custom names are made unique automatically. A zero twist
        value means use the global rifle-profile twist.
      </p>

      <h2>Limitations</h2>
      <p>
        Slug BCs are effective coefficients derived from sparse measurements. Rifle BCs are
        manufacturer G1 values or fitted to official tables. These are average point-mass models,
        not CFD or six-degree-of-freedom simulations. Launch yaw, choke interaction, projectile or
        pellet deformation, pellet-pellet aerodynamic interaction, pattern spread, aerodynamic jump,
        true crosswind drift, Coriolis effect, and dynamic instability are not explicitly solved.
        The sphere correlation treats an isolated smooth sphere; launch flattening, alloy hardness,
        buffering, and pellet contact can change real drag. Uncertainty increases beyond measured
        regions and through transonic flight. Always verify real firearms with chronographing and
        actual zeroing.
      </p>
    </article>
  );
}
