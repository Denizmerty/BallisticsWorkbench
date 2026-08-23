import { useMemo } from 'react';
import type { Result } from '../types';
import { formatNumber } from '../lib/format';
import { dragDescription, firearmLabel } from '../lib/labels';
import { pointAt } from '../lib/trajectory';
import { IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from '../lib/units';

export type CompareKey =
    | 'shortName'
    | 'speedMps'
    | 'energyJ'
    | 'payloadEnergy'
    | 'momentumKgms'
    | 'payloadMomentum'
    | 'timeS'
    | 'dropM'
    | 'mpbrM';

export type CompareSort = { key: CompareKey; ascending: boolean };

type Props = {
    result: Result;
    selectedLoadId: string | null;
    referenceDistance: number;
    imperial: boolean;
    compareSort: CompareSort;
    onCompareSort: (sort: CompareSort) => void;
    onSelectedLoadId: (id: string) => void;
};

export function ComparisonTable({
    result,
    selectedLoadId,
    referenceDistance,
    imperial,
    compareSort,
    onCompareSort,
    onSelectedLoadId,
}: Props) {
    const dist = (metres: number) => (imperial ? metres * M_TO_YD : metres);
    const velocity = (value: number) => (imperial ? value * MPS_TO_FPS : value);
    const energy = (value: number) => (imperial ? value * J_TO_FTLB : value);
    const momentum = (value: number) => (imperial ? value * KGMS_TO_LBFTS : value);
    const drop = (metres: number) => (imperial ? metres / IN_TO_M : metres * 100);
    const compareRows = useMemo(() => {
        const rows = result.loads.map((item) => {
            const point = pointAt(item.points, referenceDistance);
            const count = Math.max(1, item.pelletCount);
            return {
                item,
                count,
                point,
                values: {
                    shortName: item.shortName,
                    speedMps: point?.speedMps ?? Number.NaN,
                    energyJ: point?.energyJ ?? Number.NaN,
                    payloadEnergy: point ? point.energyJ * count : Number.NaN,
                    momentumKgms: point?.momentumKgms ?? Number.NaN,
                    payloadMomentum: point ? point.momentumKgms * count : Number.NaN,
                    timeS: point?.timeS ?? Number.NaN,
                    dropM: point?.dropM ?? Number.NaN,
                    mpbrM: item.mpbrM ?? Number.NaN,
                } as Record<CompareKey, number | string>,
            };
        });
        const { key, ascending } = compareSort;
        const direction = ascending ? 1 : -1;
        return rows.sort((first, second) => {
            const firstValue = first.values[key];
            const secondValue = second.values[key];
            if (typeof firstValue === 'string' || typeof secondValue === 'string') {
                return String(firstValue).localeCompare(String(secondValue)) * direction;
            }
            return (firstValue - secondValue) * direction;
        });
    }, [compareSort, referenceDistance, result]);
    const sortCompare = (key: CompareKey) =>
        onCompareSort(
            compareSort.key === key
                ? { key, ascending: !compareSort.ascending }
                : { key, ascending: key === 'shortName' },
        );

    return (
        <div className="panel compare">
            <span className="eyebrow">
                ALL LOADS AT {formatNumber(dist(referenceDistance), 0)}{' '}
                {imperial ? 'YARDS' : 'METRES'} · CLICK A HEADING TO SORT
            </span>
            <div className="table-wrap calculator-table">
                <table>
                    <thead>
                        <tr>
                            {(
                                [
                                    ['shortName', 'Load'],
                                    ['speedMps', `Velocity (${imperial ? 'ft/s' : 'm/s'})`],
                                    ['energyJ', `Energy/projectile (${imperial ? 'ft·lbf' : 'J'})`],
                                    [
                                        'payloadEnergy',
                                        `Payload energy (${imperial ? 'ft·lbf' : 'J'})`,
                                    ],
                                    [
                                        'momentumKgms',
                                        `Momentum/projectile (${imperial ? 'lb·ft/s' : 'kg·m/s'})`,
                                    ],
                                    [
                                        'payloadMomentum',
                                        `Payload momentum (${imperial ? 'lb·ft/s' : 'kg·m/s'})`,
                                    ],
                                    ['timeS', 'Flight time (s)'],
                                    ['dropM', `Drop (${imperial ? 'in' : 'cm'})`],
                                    ['mpbrM', `MPBR (${imperial ? 'yd' : 'm'})`],
                                ] as [CompareKey, string][]
                            ).map(([key, label]) => (
                                <th
                                    key={key}
                                    className={`sortable${compareSort.key === key ? ' sorted' : ''}`}
                                    onClick={() => sortCompare(key)}
                                    title="Click to sort"
                                >
                                    {label}
                                    <i>
                                        {compareSort.key === key
                                            ? compareSort.ascending
                                                ? '▲'
                                                : '▼'
                                            : ''}
                                    </i>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {compareRows.map(({ item, count, point }) => (
                            <tr
                                className={item.id === selectedLoadId ? 'selected-row' : ''}
                                key={item.id}
                                onClick={() => onSelectedLoadId(item.id)}
                            >
                                <td>
                                    <strong>{item.shortName}</strong>
                                    <small>
                                        {firearmLabel(item)} · {dragDescription(item)}
                                        {count > 1 ? ` · ${count} pellets` : ''}
                                    </small>
                                </td>
                                <td>{formatNumber(velocity(point?.speedMps ?? Number.NaN), 1)}</td>
                                <td>{formatNumber(energy(point?.energyJ ?? Number.NaN), 0)}</td>
                                <td>
                                    {formatNumber(
                                        energy(point ? point.energyJ * count : Number.NaN),
                                        0,
                                    )}
                                </td>
                                <td>
                                    {formatNumber(momentum(point?.momentumKgms ?? Number.NaN), 3)}
                                </td>
                                <td>
                                    {formatNumber(
                                        momentum(point ? point.momentumKgms * count : Number.NaN),
                                        3,
                                    )}
                                </td>
                                <td>{formatNumber(point?.timeS ?? Number.NaN, 3)}</td>
                                <td>{formatNumber(drop(point?.dropM ?? Number.NaN), 2)}</td>
                                <td>{formatNumber(dist(item.mpbrM ?? Number.NaN), 0)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
