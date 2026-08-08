# Changelog

All notable changes to Ballistics Workbench are recorded in this file.

## Unreleased

## 1.0.2 - 2026-08-08

- Licensed Ballistics Workbench under the GNU General Public License, version 3 or later, and added
  author and support contact details to the application Help page and README.

## 1.0.1 - 2026-08-08

- Reworked the desktop interface into a compact engineering layout with clearer grouping, a
  configurable status strip, responsive controls, aligned field rows, readable numeric inputs,
  safer long-name wrapping, and complete light and dark themes.
- Added a sight-in zero and holdover solution. New shotgun and rifle zero-range inputs place the
  trajectory relative to the line of sight, giving bullet path (above/below sight line) and the
  elevation come-up in both MOA and mil. These appear in the overview cards, range table, all-load
  chart (sight-path and holdover metrics), a new Holdover status mode, and CSV export. The geometry
  uses the same small-angle superposition as the maximum-point-blank-range routine and is covered
  by unit tests; the sight-in zero is distinct from the optimal zero reported for MPBR.
- Added crosswind wind drift. The trajectory solver now integrates a full three-dimensional
  velocity state, so a crosswind input produces genuine lateral drift from the air-relative drag
  rather than an empirical add-on. Wind drift, spin drift, and combined total windage appear in the
  overview cards, range table, all-load chart, status readout, and CSV export, with a new
  crosswind atmospheric input. With no crosswind, results are identical to the previous
  vertical-plane trajectory (verified against the native regression suite).
- Grouped thousands separators across every on-screen figure so energies, velocities, and
  Reynolds numbers read cleanly; non-finite values now render as an em dash instead of `NaN`.
- Added per-field validation highlighting: out-of-range inputs turn their own field red with a
  tooltip, alongside the existing error summary.
- Made the All-load calculator sortable — click any column heading to sort ascending or descending.
- Added a **Copy summary** action that places the selected load's values at the reference distance
  on the clipboard.
- Added keyboard navigation: number keys `1`–`4` switch tabs and the arrow keys (or `[` / `]`)
  cycle the selected load. The active tab is now remembered between sessions.
- Refined the trajectory chart with a subtle shaded area under the selected load and grouped axis
  labels, and completed the dark theme for alert boxes, scrollbars, and chart hints.
- Added `scripts\build-release.cmd` for one-command Release x64 compilation, native and renderer
  tests, NSIS installer packaging, and optional launch of the unpacked application.

## 1.0.0 — 2026-08-06

- Added a C++20 numerical core with G1, G7, and Reynolds–Mach sphere drag models.
- Added six built-in shotgun and .308 Winchester loads.
- Added atmosphere, firearm-profile, maximum point-blank range, and spin-drift calculations.
- Added the React and Electron desktop interface with metric and imperial units.
- Added interactive all-load charts, range tables, payload totals, custom loads, and CSV export.
- Added native regression tests and renderer unit tests, Visual Studio and CMake builds,
  cross-platform continuous integration, and Windows installer packaging.
