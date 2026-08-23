import { useCallback, useEffect, useState } from 'react';
import { formatNumber } from './format';
import { holdoverMil, holdoverMoa, sightGeometry, sightPathAt } from './holdover';
import { dragDescription, firearmLabel, projectileLabel } from './labels';
import { saveCsv } from './csv';
import type { PersistedProfiles } from './usePersistedProfiles';
import type { WorkbenchState } from './useWorkbenchState';
import { IN_TO_M, J_TO_FTLB, KGMS_TO_LBFTS, MPS_TO_FPS, M_TO_YD } from './units';
import { WORKSPACE_TABS } from '../components/Workspace';

export function useWorkbenchCommands(
    workbench: WorkbenchState,
    persistedProfiles: PersistedProfiles,
) {
    const {
        result,
        inputs,
        uncertainty,
        tableStepM,
        imperial,
        load,
        target,
        referenceDistance,
        selectedIndex,
        setSelectedLoadId,
        setTab,
        setUnits,
        setTheme,
        setError,
        resetAtmosphere,
        openNewCustom,
    } = workbench;
    const { setProfileOpen, exportProfiles, importProfiles, profileIds } = persistedProfiles;
    const [copied, setCopied] = useState(false);

    const exportCsv = useCallback(() => {
        if (result) void saveCsv(result, inputs, tableStepM, imperial, uncertainty);
    }, [imperial, inputs, result, tableStepM, uncertainty]);

    const copySummary = useCallback(async () => {
        if (!load || !target) return;
        const distance = (metres: number) => (imperial ? metres * M_TO_YD : metres);
        const velocity = (value: number) => (imperial ? value * MPS_TO_FPS : value);
        const energy = (value: number) => (imperial ? value * J_TO_FTLB : value);
        const momentum = (value: number) => (imperial ? value * KGMS_TO_LBFTS : value);
        const drop = (metres: number) => (imperial ? metres / IN_TO_M : metres * 100);
        const eventDistance = (value: number | null, status: string) =>
            value === null
                ? status.replaceAll('_', ' ')
                : `${formatNumber(distance(value), 1)} ${imperial ? 'yd' : 'm'}`;
        const eventPath = (value: number | null, status: string) =>
            value === null
                ? status.replaceAll('_', ' ')
                : `${formatNumber(drop(value), 2)} ${imperial ? 'in' : 'cm'}`;
        const targetGeometry = sightGeometry(load, inputs, inputs);
        const targetPathM = sightPathAt(target, targetGeometry);
        const distanceUnit = imperial ? 'yd' : 'm';
        const velocityUnit = imperial ? 'ft/s' : 'm/s';
        const energyUnit = imperial ? 'ft·lbf' : 'J';
        const momentumUnit = imperial ? 'lb·ft/s' : 'kg·m/s';
        const driftUnit = imperial ? 'in' : 'cm';
        const count = Math.max(1, load.pelletCount);
        const totalWindage =
            target.spinDriftM === null ? Number.NaN : target.windDriftM + target.spinDriftM;
        const eventSummary = [
            `near zero ${eventDistance(
                load.trajectoryEvents.nearZeroM,
                load.trajectoryEvents.zeroCrossingsStatus,
            )}`,
            `far zero ${eventDistance(
                load.trajectoryEvents.farZeroM,
                load.trajectoryEvents.zeroCrossingsStatus,
            )}`,
            `maximum ordinate ${eventPath(
                load.trajectoryEvents.maximumOrdinatePathM,
                load.trajectoryEvents.maximumOrdinateStatus,
            )} at ${eventDistance(
                load.trajectoryEvents.maximumOrdinateDistanceM,
                load.trajectoryEvents.maximumOrdinateStatus,
            )}`,
            `supersonic range ${eventDistance(
                load.trajectoryEvents.supersonicRangeM,
                load.trajectoryEvents.supersonicRangeStatus,
            )}`,
            `ground intersection ${eventDistance(
                load.trajectoryEvents.groundIntersectionM,
                load.trajectoryEvents.groundIntersectionStatus,
            )}`,
        ].join(' · ');
        const lines = [
            load.name,
            `${firearmLabel(load)} · ${dragDescription(load)}${count > 1 ? ` · ${count} pellets` : ''}`,
            `Range: ${formatNumber(distance(referenceDistance), 1)} ${distanceUnit}`,
            `Velocity: ${formatNumber(velocity(target.speedMps), 1)} ${velocityUnit}`,
            `Mach: ${formatNumber(target.mach, 2)}`,
            `Energy/${projectileLabel(load)}: ${formatNumber(energy(target.energyJ), 0)} ${energyUnit}`,
            ...(count > 1
                ? [
                      `Payload energy (${count}×): ${formatNumber(
                          energy(target.energyJ * count),
                          0,
                      )} ${energyUnit}`,
                  ]
                : []),
            `Momentum/${projectileLabel(load)}: ${formatNumber(
                momentum(target.momentumKgms),
                2,
            )} ${momentumUnit}`,
            `Drop: ${formatNumber(drop(target.dropM), 1)} ${driftUnit}`,
            `Wind drift: ${formatNumber(drop(target.windDriftM), 2)} ${driftUnit}`,
            `Spin drift: ${formatNumber(drop(target.spinDriftM ?? Number.NaN), 2)} ${driftUnit}`,
            `Total windage: ${formatNumber(drop(totalWindage), 2)} ${driftUnit}`,
            `Sight path: ${formatNumber(drop(targetPathM), 1)} ${driftUnit} ` +
                `(zero ${formatNumber(distance(targetGeometry.zeroM), 0)} ${distanceUnit})`,
            `Holdover: ${formatNumber(holdoverMoa(target.holdoverRad), 1)} MOA / ` +
                `${formatNumber(holdoverMil(target.holdoverRad), 2)} mil`,
            `Time of flight: ${formatNumber(target.timeS, 3)} s`,
            `MPBR: ${formatNumber(distance(load.mpbrM ?? Number.NaN), 1)} ${distanceUnit} · ` +
                `optimal zero ${formatNumber(distance(load.zeroM ?? Number.NaN), 1)} ${distanceUnit}`,
            `Trajectory events: ${eventSummary}`,
        ];
        try {
            await navigator.clipboard.writeText(lines.join('\n'));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            setError('Clipboard access was blocked by the system.');
        }
    }, [imperial, inputs, load, referenceDistance, setError, target]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey) {
                if (event.shiftKey && event.key.toLowerCase() === 'p') {
                    event.preventDefault();
                    setProfileOpen(true);
                } else if (event.key.toLowerCase() === 'r') {
                    event.preventDefault();
                    resetAtmosphere();
                } else if (event.key.toLowerCase() === 'e') {
                    event.preventDefault();
                    exportCsv();
                }
                return;
            }
            const node = event.target as HTMLElement | null;
            if (node && /^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) return;
            const loadCount = result?.loads.length ?? 0;
            if ((event.key === 'ArrowDown' || event.key === ']') && loadCount) {
                event.preventDefault();
                setSelectedLoadId(result!.loads[(selectedIndex + 1) % loadCount].id);
            } else if ((event.key === 'ArrowUp' || event.key === '[') && loadCount) {
                event.preventDefault();
                setSelectedLoadId(result!.loads[(selectedIndex - 1 + loadCount) % loadCount].id);
            } else if (event.key >= '1' && event.key <= '4') {
                event.preventDefault();
                setTab(WORKSPACE_TABS[Number(event.key) - 1]);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        const unsubscribers = window.ballistics
            ? [
                  window.ballistics.onAddCustom(openNewCustom),
                  window.ballistics.onOpenHelp(() => setTab('notes')),
                  window.ballistics.onOpenProfiles(() => setProfileOpen(true)),
                  window.ballistics.onExportCsv(exportCsv),
                  window.ballistics.onExportProfiles(() => exportProfiles(profileIds)),
                  window.ballistics.onImportProfiles(() => {
                      setProfileOpen(true);
                      void importProfiles('rename');
                  }),
                  window.ballistics.onResetAtmosphere(resetAtmosphere),
                  window.ballistics.onToggleUnits(() =>
                      setUnits((current) => (current === 'imperial' ? 'metric' : 'imperial')),
                  ),
                  window.ballistics.onToggleTheme(() =>
                      setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
                  ),
              ]
            : [];
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        };
    }, [
        exportCsv,
        exportProfiles,
        importProfiles,
        openNewCustom,
        profileIds,
        resetAtmosphere,
        result,
        selectedIndex,
        setProfileOpen,
        setSelectedLoadId,
        setTab,
        setTheme,
        setUnits,
    ]);

    return { copied, copySummary, exportCsv };
}
