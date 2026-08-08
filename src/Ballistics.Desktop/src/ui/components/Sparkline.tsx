import type { Load, Metric, Point, UnitSystem } from '../types';
import { IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from '../lib/units';
import { formatDistance, formatNumber } from '../lib/format';
import { holdoverMoa, sightGeometry, sightPathM, type SightGeometry } from '../lib/holdover';
import { pointAt } from '../lib/trajectory';

const CHART_COLORS = [
  '#3b6ea5',
  '#a6572e',
  '#4a7c59',
  '#86608e',
  '#b0892e',
  '#3f7d80',
  '#9c4a4a',
  '#5a6b7d',
  '#6a7f3c',
];

export function Sparkline({
  loads,
  selectedLoad,
  metric,
  units,
  selectedDistance,
  onSelectedDistance,
  sightHeights,
  zeros,
}: {
  loads: Load[];
  selectedLoad: Load;
  metric: Metric;
  units: UnitSystem;
  selectedDistance: number;
  onSelectedDistance: (distance: number) => void;
  sightHeights: { shotgunSightM: number; rifleSightM: number };
  zeros: { shotgunZeroM: number; rifleZeroM: number };
}) {
  if (!loads.length || !selectedLoad.points.length) return null;

  const imperial = units === 'imperial';
  const xMax = Math.max(1, ...loads.map((load) => load.points.at(-1)?.distanceM ?? 0));
  const linear = imperial ? 1 / IN_TO_M : 100;
  const geometry = new Map<string, SightGeometry>(
    loads.map((load) => [load.shortName, sightGeometry(load, sightHeights, zeros)]),
  );
  const pathFor = (load: Load, point: Point) =>
    sightPathM(point.dropM, point.distanceM, geometry.get(load.shortName)!);
  const convert = (load: Load, point: Point) =>
    metric === 'speedMps'
      ? point.speedMps * (imperial ? MPS_TO_FPS : 1)
      : metric === 'energyJ'
        ? point.energyJ * (imperial ? J_TO_FTLB : 1)
        : metric === 'payloadEnergy'
          ? point.energyJ * load.pelletCount * (imperial ? J_TO_FTLB : 1)
          : metric === 'momentumKgms'
            ? point.momentumKgms * (imperial ? KGMS_TO_LBFTS : 1)
            : metric === 'payloadMomentum'
              ? point.momentumKgms * load.pelletCount * (imperial ? KGMS_TO_LBFTS : 1)
              : metric === 'dropM'
                ? point.dropM * linear
                : metric === 'timeS'
                  ? point.timeS
                  : metric === 'spinDriftM'
                    ? point.spinDriftM * linear
                    : metric === 'windDriftM'
                      ? point.windDriftM * linear
                      : metric === 'windageM'
                        ? (point.spinDriftM + point.windDriftM) * linear
                        : metric === 'sightPathM'
                          ? pathFor(load, point) * linear
                          : holdoverMoa(pathFor(load, point), point.distanceM);

  const series = loads.map((load, index) => ({
    load,
    color: CHART_COLORS[index % CHART_COLORS.length],
    values: load.points.map((point) => convert(load, point)),
  }));
  const allValues = series.flatMap((item) => item.values);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min || 1;
  const left = 66;
  const right = 980;
  const top = 22;
  const bottom = 252;
  const width = right - left;
  const height = bottom - top;
  const x = (distance: number) => left + (distance / xMax) * width;
  const y = (value: number) => top + ((max - value) / span) * height;
  const selectedM = Math.max(0, Math.min(selectedDistance, xMax));
  const selectedX = x(selectedM);
  const selectedPoint = pointAt(selectedLoad.points, selectedM)!;
  const selectedY = y(convert(selectedLoad, selectedPoint));
  const selectedSeries = series.find((item) => item.load.shortName === selectedLoad.shortName)!;
  const areaPath =
    selectedLoad.points
      .map(
        (point, index) =>
          `${index ? 'L' : 'M'} ${x(point.distanceM)} ${y(selectedSeries.values[index])}`,
      )
      .join(' ') +
    ` L ${x(selectedLoad.points.at(-1)!.distanceM)} ${bottom}` +
    ` L ${x(selectedLoad.points[0].distanceM)} ${bottom} Z`;
  const xUnit = imperial ? 'yd' : 'm';
  const yUnit =
    metric === 'speedMps'
      ? imperial
        ? 'ft/s'
        : 'm/s'
      : metric === 'energyJ' || metric === 'payloadEnergy'
        ? imperial
          ? 'ft·lbf'
          : 'J'
        : metric === 'momentumKgms' || metric === 'payloadMomentum'
          ? imperial
            ? 'lb·ft/s'
            : 'kg·m/s'
          : metric === 'timeS'
            ? 's'
            : metric === 'holdoverMoa'
              ? 'MOA'
              : imperial
                ? 'in'
                : 'cm';
  const preciseMetric =
    metric === 'dropM' ||
    metric === 'spinDriftM' ||
    metric === 'windDriftM' ||
    metric === 'windageM' ||
    metric === 'sightPathM' ||
    metric === 'timeS';
  const digits = preciseMetric ? 3 : 1;
  const choose = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * 1000;
    onSelectedDistance(Math.max(0, Math.min(xMax, ((px - left) / width) * xMax)));
  };
  return (
    <div className="chart-shell">
      <svg
        className="chart"
        viewBox="0 0 1000 285"
        onPointerMove={choose}
        onClick={choose}
        role="img"
        aria-label={`Interactive ${metric} chart`}
      >
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chart-area" d={areaPath} />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={`y${f}`}>
            <line
              className="grid"
              x1={left}
              x2={right}
              y1={top + height * f}
              y2={top + height * f}
            />
            <text className="tick" x={left - 10} y={top + height * f + 3} textAnchor="end">
              {formatNumber(max - span * f, preciseMetric ? 2 : 0)}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={`x${f}`}>
            <line
              className="grid vertical"
              x1={left + width * f}
              x2={left + width * f}
              y1={top}
              y2={bottom}
            />
            <text className="tick" x={left + width * f} y={bottom + 20} textAnchor="middle">
              {formatNumber(xMax * f * (imperial ? M_TO_YD : 1), 0)}
            </text>
          </g>
        ))}
        {series.map(({ load, color, values }) => {
          const path = load.points
            .map((point, index) => `${index ? 'L' : 'M'} ${x(point.distanceM)} ${y(values[index])}`)
            .join(' ');
          return (
            <path
              className={`trace ${load.shortName === selectedLoad.shortName ? 'selected' : ''}`}
              d={path}
              key={load.shortName}
              style={{ stroke: color }}
            />
          );
        })}
        <rect className="chart-frame" x={left} y={top} width={width} height={height} />
        <line className="crosshair" x1={selectedX} x2={selectedX} y1={top} y2={bottom} />
        <circle className="chart-point" cx={selectedX} cy={selectedY} r="5" />
        <text className="axis-label" x={(left + right) / 2} y="282" textAnchor="middle">
          Distance ({xUnit})
        </text>
        <text
          className="axis-label"
          transform={`translate(14 ${(top + bottom) / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {yUnit}
        </text>
      </svg>
      <div className="chart-readout">
        <strong>{formatDistance(selectedM * (imperial ? M_TO_YD : 1), xUnit)}</strong>
        <div>
          {series.map(({ load, color }) => {
            const point = pointAt(load.points, selectedM)!;
            return (
              <span
                className={load.shortName === selectedLoad.shortName ? 'selected' : ''}
                key={load.shortName}
              >
                <i style={{ background: color }} />
                {load.shortName}: {formatNumber(convert(load, point), digits)} {yUnit}
              </span>
            );
          })}
        </div>
      </div>
      <p className="chart-hint">
        Move across the chart or click to inspect every load at an exact distance; the readout
        follows the selected point.
      </p>
    </div>
  );
}
