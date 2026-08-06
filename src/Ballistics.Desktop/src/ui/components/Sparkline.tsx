import type { Load, Metric, Point, UnitSystem } from '../types';
import { IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from '../lib/units';
import { pointAt } from '../lib/trajectory';

const CHART_COLORS = [
  '#2f6fda',
  '#b85c18',
  '#218739',
  '#a23f77',
  '#6b57b7',
  '#96720f',
  '#23858c',
  '#b33b3b',
  '#5c718d',
];

export function Sparkline({
  loads,
  selectedLoad,
  metric,
  units,
  selectedDistance,
  onSelectedDistance,
}: {
  loads: Load[];
  selectedLoad: Load;
  metric: Metric;
  units: UnitSystem;
  selectedDistance: number;
  onSelectedDistance: (distance: number) => void;
}) {
  if (!loads.length || !selectedLoad.points.length) return null;

  const imperial = units === 'imperial';
  const xMax = Math.max(1, ...loads.map((load) => load.points.at(-1)?.distanceM ?? 0));
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
                ? point.dropM * (imperial ? 1 / IN_TO_M : 100)
                : metric === 'timeS'
                  ? point.timeS
                  : point.spinDriftM * (imperial ? 1 / IN_TO_M : 100);

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
            : imperial
              ? 'in'
              : 'cm';
  const digits = metric === 'dropM' || metric === 'spinDriftM' || metric === 'timeS' ? 3 : 1;
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
              {(max - span * f).toFixed(
                metric === 'dropM' || metric === 'spinDriftM' || metric === 'timeS' ? 2 : 0,
              )}
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
              {(xMax * f * (imperial ? M_TO_YD : 1)).toFixed(0)}
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
        <strong>
          {selectedM * (imperial ? M_TO_YD : 1) >= 10
            ? (selectedM * (imperial ? M_TO_YD : 1)).toFixed(1)
            : (selectedM * (imperial ? M_TO_YD : 1)).toFixed(2)}{' '}
          {xUnit}
        </strong>
        <div>
          {series.map(({ load, color }) => {
            const point = pointAt(load.points, selectedM)!;
            return (
              <span
                className={load.shortName === selectedLoad.shortName ? 'selected' : ''}
                key={load.shortName}
              >
                <i style={{ background: color }} />
                {load.shortName}: {convert(load, point).toFixed(digits)} {yUnit}
              </span>
            );
          })}
        </div>
      </div>
      <p className="chart-hint">
        Move across the chart or click to inspect every load at an exact distance. Summary cards
        follow the selected point.
      </p>
    </div>
  );
}
