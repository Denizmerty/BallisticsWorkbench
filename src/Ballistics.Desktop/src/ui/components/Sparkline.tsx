import type { Load, Metric, Point, UnitSystem } from '../types';
import { IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from '../lib/units';
import { formatDistance, formatNumber } from '../lib/format';
import { holdoverMoa, sightGeometry, sightPathAt, type SightGeometry } from '../lib/holdover';
import { pointAt, uncertaintyAt } from '../lib/trajectory';

const CONFIDENCE_95_MULTIPLIER = 1.959963984540054;
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
    const pathFor = (load: Load, point: Point) => sightPathAt(point, geometry.get(load.shortName)!);
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
                          ? (point.spinDriftM ?? Number.NaN) * linear
                          : metric === 'windDriftM'
                            ? point.windDriftM * linear
                            : metric === 'windageM'
                              ? point.spinDriftM === null
                                  ? Number.NaN
                                  : (point.spinDriftM + point.windDriftM) * linear
                              : metric === 'sightPathM'
                                ? pathFor(load, point) * linear
                                : holdoverMoa(point.holdoverRad);

    const series = loads.map((load, index) => ({
        load,
        color: CHART_COLORS[index % CHART_COLORS.length],
        values: load.points.map((point) => convert(load, point)),
    }));
    const uncertaintyFor = (load: Load, distanceM: number) => {
        if (load.uncertainty?.status !== 'complete') return Number.NaN;
        const sample = uncertaintyAt(load.uncertainty.points, distanceM);
        if (!sample?.available) return Number.NaN;
        const scale = imperial ? 1 / IN_TO_M : 100;
        return metric === 'speedMps'
            ? sample.speedStandardDeviationMps * (imperial ? MPS_TO_FPS : 1)
            : metric === 'energyJ'
              ? sample.energyStandardDeviationJ * (imperial ? J_TO_FTLB : 1)
              : metric === 'payloadEnergy'
                ? sample.energyStandardDeviationJ * load.pelletCount * (imperial ? J_TO_FTLB : 1)
                : metric === 'momentumKgms'
                  ? sample.momentumStandardDeviationKgms * (imperial ? KGMS_TO_LBFTS : 1)
                  : metric === 'payloadMomentum'
                    ? sample.momentumStandardDeviationKgms *
                      load.pelletCount *
                      (imperial ? KGMS_TO_LBFTS : 1)
                    : metric === 'timeS'
                      ? sample.timeStandardDeviationS
                      : metric === 'dropM'
                        ? sample.dropStandardDeviationM * scale
                        : metric === 'windDriftM'
                          ? sample.windDriftStandardDeviationM * scale
                          : metric === 'sightPathM'
                            ? sample.pathStandardDeviationM * scale
                            : metric === 'holdoverMoa'
                              ? holdoverMoa(sample.holdoverStandardDeviationRad)
                              : Number.NaN;
    };
    const confidenceBand =
        selectedLoad.uncertainty?.status === 'complete'
            ? selectedLoad.points.map((point) => {
                  const center = convert(selectedLoad, point);
                  const halfWidth =
                      uncertaintyFor(selectedLoad, point.distanceM) * CONFIDENCE_95_MULTIPLIER;
                  const lower = center - halfWidth;
                  const nonnegative = [
                      'speedMps',
                      'energyJ',
                      'payloadEnergy',
                      'momentumKgms',
                      'payloadMomentum',
                      'timeS',
                  ].includes(metric);
                  return {
                      distanceM: point.distanceM,
                      upper: center + halfWidth,
                      lower: nonnegative ? Math.max(0, lower) : lower,
                  };
              })
            : [];
    const confidenceAvailable =
        confidenceBand.length === selectedLoad.points.length &&
        confidenceBand.length > 0 &&
        confidenceBand.every(
            (point) => Number.isFinite(point.upper) && Number.isFinite(point.lower),
        );
    const allValues = series.flatMap((item) => item.values).filter(Number.isFinite);
    if (confidenceAvailable) {
        allValues.push(...confidenceBand.flatMap((point) => [point.lower, point.upper]));
    }
    if (!allValues.length) allValues.push(0);
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
    const selectedCoverage = selectedLoad.points.at(-1)?.distanceM ?? 0;
    const selectedM = Math.max(0, Math.min(selectedDistance, selectedCoverage));
    const selectedX = x(selectedM);
    const selectedPoint = pointAt(selectedLoad.points, selectedM)!;
    const selectedValue = convert(selectedLoad, selectedPoint);
    const selectedConfidenceHalfWidth =
        uncertaintyFor(selectedLoad, selectedM) * CONFIDENCE_95_MULTIPLIER;
    const selectedY = y(Number.isFinite(selectedValue) ? selectedValue : min);
    const selectedSeries = series.find((item) => item.load.shortName === selectedLoad.shortName)!;
    const linePath = (load: Load, values: number[]) => {
        let drawing = false;
        return load.points
            .map((point, index) => {
                const value = values[index];
                if (!Number.isFinite(value)) {
                    drawing = false;
                    return '';
                }
                const command = drawing ? 'L' : 'M';
                drawing = true;
                return `${command} ${x(point.distanceM)} ${y(value)}`;
            })
            .filter(Boolean)
            .join(' ');
    };
    const selectedLine = linePath(selectedLoad, selectedSeries.values);
    const areaPath = selectedSeries.values.every(Number.isFinite)
        ? [
              selectedLine,
              `L ${x(selectedLoad.points.at(-1)!.distanceM)} ${bottom}`,
              `L ${x(selectedLoad.points[0].distanceM)} ${bottom}`,
              'Z',
          ].join(' ')
        : '';
    const confidencePath = confidenceAvailable
        ? [
              ...confidenceBand.map(
                  (point, index) =>
                      `${index === 0 ? 'M' : 'L'} ${x(point.distanceM)} ${y(point.upper)}`,
              ),
              ...confidenceBand
                  .slice()
                  .reverse()
                  .map((point) => `L ${x(point.distanceM)} ${y(point.lower)}`),
              'Z',
          ].join(' ')
        : '';
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
                {confidenceAvailable && <path className="uncertainty-band" d={confidencePath} />}
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                    <g key={`y${f}`}>
                        <line
                            className="grid"
                            x1={left}
                            x2={right}
                            y1={top + height * f}
                            y2={top + height * f}
                        />
                        <text
                            className="tick"
                            x={left - 10}
                            y={top + height * f + 3}
                            textAnchor="end"
                        >
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
                        <text
                            className="tick"
                            x={left + width * f}
                            y={bottom + 20}
                            textAnchor="middle"
                        >
                            {formatNumber(xMax * f * (imperial ? M_TO_YD : 1), 0)}
                        </text>
                    </g>
                ))}
                {series.map(({ load, color, values }) => {
                    const path = linePath(load, values);
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
                {Number.isFinite(selectedValue) && (
                    <circle className="chart-point" cx={selectedX} cy={selectedY} r="5" />
                )}
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
                        const point = pointAt(load.points, selectedM);
                        const value = point ? convert(load, point) : Number.NaN;
                        return (
                            <span
                                className={
                                    load.shortName === selectedLoad.shortName ? 'selected' : ''
                                }
                                key={load.shortName}
                            >
                                <i style={{ background: color }} />
                                {load.shortName}: {formatNumber(value, digits)} {yUnit}
                                {load.id === selectedLoad.id &&
                                Number.isFinite(selectedConfidenceHalfWidth)
                                    ? ` ± ${formatNumber(selectedConfidenceHalfWidth, digits)} ${yUnit} (95%)`
                                    : ''}
                            </span>
                        );
                    })}
                </div>
            </div>
            <p className="chart-hint">
                Move across the chart or click to inspect every load at an exact distance. The
                readout follows the selected point.
                {confidenceAvailable
                    ? ' The shaded region is the selected load’s approximate deterministic 95% confidence band.'
                    : ''}
            </p>
        </div>
    );
}
