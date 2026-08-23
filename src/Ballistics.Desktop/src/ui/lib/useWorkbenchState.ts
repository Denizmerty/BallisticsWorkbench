import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CustomDraft, Metric, UncertaintySettings, UnitSystem } from '../types';
import type { CompareSort } from '../components/ComparisonTable';
import { WORKSPACE_TABS, type WorkspaceTab } from '../components/Workspace';
import type { Theme } from '../components/WorkbenchToolbar';
import { densityToAltitude } from './atmosphere';
import {
    applyDragDataDocument,
    decodeDragDataDocument,
    dragDataFileName,
    serializeDragDataDocument,
} from './dragData';
import { reconcileSelectedLoadId } from './loadIdentity';
import {
    defaultUncertaintySettings,
    loadPersistedSettings,
    type PersistedSettings,
} from './persistence';
import { pointAt } from './trajectory';
import { validateCustomLoad, validateInputs, validateUncertaintySettings } from './validation';
import { useCalculationController } from './useCalculationController';
import { createDefaultCustomDraft, defaultInputs } from './workbenchDefaults';
import type { StatusMode } from './statusText';
import { M_TO_YD } from './units';

function storedWorkspaceTab() {
    const stored = localStorage.getItem('bw.tab');
    return WORKSPACE_TABS.includes(stored as WorkspaceTab) ? (stored as WorkspaceTab) : 'overview';
}

export function useWorkbenchState() {
    const persistedSettings = useMemo<PersistedSettings>(
        () => loadPersistedSettings(defaultInputs),
        [],
    );
    const [inputs, setInputs] = useState(persistedSettings.inputs);
    const [uncertainty, setUncertainty] = useState<UncertaintySettings>(
        persistedSettings.uncertainty,
    );
    const [selectedLoadId, setSelectedLoadId] = useState<string | null>(null);
    const [metric, setMetric] = useState<Metric>('energyJ');
    const [tab, setTab] = useState<WorkspaceTab>(storedWorkspaceTab);
    const [units, setUnits] = useState<UnitSystem>(() =>
        localStorage.getItem('bw.units') === 'imperial' ? 'imperial' : 'metric',
    );
    const [theme, setTheme] = useState<Theme>(() =>
        localStorage.getItem('bw.theme') === 'dark' ? 'dark' : 'light',
    );
    const [statusMode, setStatusMode] = useState<StatusMode>('atmosphere');
    const [statusLoadId, setStatusLoadId] = useState<string | null>(null);
    const [tableStep, setTableStep] = useState(25);
    const [chartDistance, setChartDistance] = useState(100);
    const [compareSort, setCompareSort] = useState<CompareSort>({
        key: 'shortName',
        ascending: true,
    });
    const [customOpen, setCustomOpen] = useState(false);
    const [editingCustom, setEditingCustom] = useState<number | null>(null);
    const [custom, setCustom] = useState<CustomDraft>(createDefaultCustomDraft);
    const [customLoads, setCustomLoads] = useState<CustomDraft[]>(persistedSettings.customLoads);
    const [customTransferNotice, setCustomTransferNotice] = useState('');
    const [localError, setError] = useState('');

    useEffect(() => localStorage.setItem('bw.units', units), [units]);
    useEffect(() => localStorage.setItem('bw.theme', theme), [theme]);
    useEffect(() => localStorage.setItem('bw.tab', tab), [tab]);

    const validationErrors = useMemo(() => validateInputs(inputs), [inputs]);
    const uncertaintyErrors = useMemo(
        () => validateUncertaintySettings(uncertainty),
        [uncertainty],
    );
    const calculation = useCalculationController(
        inputs,
        customLoads,
        uncertainty,
        validationErrors.length + uncertaintyErrors.length,
    );
    const result = calculation.result;
    const busy = calculation.status === 'pending';
    const stale = calculation.status === 'stale' || (busy && result !== null);
    const error = calculation.error || localError;

    useEffect(() => {
        if (calculation.status === 'success') setError('');
    }, [calculation.status]);

    const load = result?.loads.find((item) => item.id === selectedLoadId) ?? result?.loads[0];
    const selectedIndex =
        result && load ? result.loads.findIndex((item) => item.id === load.id) : 0;
    const imperial = units === 'imperial';
    const referenceDistance = Math.min(chartDistance, inputs.distanceM);
    const tableStepM = imperial ? tableStep / M_TO_YD : tableStep;
    const target = useMemo(
        () => (load ? pointAt(load.points, referenceDistance) : undefined),
        [load, referenceDistance],
    );

    useEffect(() => {
        if (!result) return;
        const resultIds = result.loads.map((item) => item.id);
        const customIds = customLoads.map((item) => item.id);
        const resultIsCurrent = calculation.status === 'success';
        const nextSelected = reconcileSelectedLoadId(
            selectedLoadId,
            resultIds,
            customIds,
            resultIsCurrent,
        );
        const nextStatus = reconcileSelectedLoadId(statusLoadId, resultIds, [], resultIsCurrent);
        if (nextSelected !== selectedLoadId) setSelectedLoadId(nextSelected);
        if (nextStatus !== statusLoadId) setStatusLoadId(nextStatus);
    }, [calculation.status, customLoads, result, selectedLoadId, statusLoadId]);

    const openNewCustom = useCallback(() => {
        if (customLoads.length >= 3) {
            setError('Up to 3 custom projectiles may be active at once.');
            return;
        }
        setEditingCustom(null);
        setCustom(createDefaultCustomDraft());
        setCustomTransferNotice('');
        setCustomOpen(true);
    }, [customLoads.length]);

    const openEditCustom = useCallback(() => {
        const index =
            load?.source === 'custom' ? customLoads.findIndex((item) => item.id === load.id) : -1;
        if (index >= 0 && customLoads[index]) {
            setEditingCustom(index);
            setCustom(customLoads[index]);
            setCustomTransferNotice('');
            setCustomOpen(true);
        }
    }, [customLoads, load]);

    const customErrors = useMemo(() => validateCustomLoad(custom), [custom]);
    const importDragData = useCallback(async () => {
        if (!window.ballistics) {
            setCustomTransferNotice('Drag-data import is available in the desktop application.');
            return;
        }
        try {
            const opened = await window.ballistics.openDragData();
            if (!opened) {
                setCustomTransferNotice('Import canceled.');
                return;
            }
            const document = await decodeDragDataDocument(opened.content);
            setCustom((current) => applyDragDataDocument(current, document));
            setCustomTransferNotice(`Imported and verified ${opened.fileName}.`);
        } catch (caught) {
            setCustomTransferNotice(
                caught instanceof Error ? caught.message : 'Drag-data import failed.',
            );
        }
    }, []);

    const exportDragData = useCallback(async () => {
        if (!window.ballistics) {
            setCustomTransferNotice('Drag-data export is available in the desktop application.');
            return;
        }
        try {
            const content = await serializeDragDataDocument(custom);
            const saved = await window.ballistics.saveDragData(
                content,
                dragDataFileName(custom.name),
            );
            setCustomTransferNotice(saved ? 'Drag data exported.' : 'Export canceled.');
        } catch (caught) {
            setCustomTransferNotice(
                caught instanceof Error ? caught.message : 'Drag-data export failed.',
            );
        }
    }, [custom]);

    const saveCustom = useCallback(() => {
        if (customErrors.length) return;
        const usedNames = new Set(
            [
                ...(result?.loads
                    .filter((item) => item.source === 'builtIn')
                    .map((item) => item.shortName) ?? []),
                ...customLoads
                    .filter((_, index) => index !== editingCustom)
                    .map((item) => item.name),
            ].map((name) => name.trim().toLowerCase()),
        );
        const baseName = custom.name.trim() || 'Custom';
        let uniqueName = baseName;
        let suffix = 2;
        while (usedNames.has(uniqueName.toLowerCase())) {
            uniqueName = `${baseName} (${suffix})`;
            suffix += 1;
        }
        const finalizedCustom = { ...custom, name: uniqueName };
        const next =
            editingCustom === null
                ? [...customLoads, finalizedCustom]
                : customLoads.map((candidate, index) =>
                      index === editingCustom ? finalizedCustom : candidate,
                  );
        setCustomLoads(next);
        setCustomOpen(false);
        setSelectedLoadId(finalizedCustom.id);
    }, [custom, customErrors.length, customLoads, editingCustom, result]);

    const removeCustom = useCallback(() => {
        const index =
            load?.source === 'custom' ? customLoads.findIndex((item) => item.id === load.id) : -1;
        if (index < 0) return;
        setCustomLoads((loads) => loads.filter((_, candidateIndex) => candidateIndex !== index));
        setSelectedLoadId(result?.loads.find((item) => item.source === 'builtIn')?.id ?? null);
    }, [customLoads, load, result]);

    const resetAtmosphere = useCallback(
        () =>
            setInputs((current) => ({
                ...current,
                temperatureC: 15,
                pressureHpa: 1013.25,
                pressureSource: 'stationPressure',
                pressureAltitudeM: 0,
                geometricAltitudeM: 0,
                altimeterSettingHpa: 1013.25,
                humidityPercent: 50,
                headwindMps: 0,
                crosswindMps: 0,
            })),
        [],
    );

    const resetAll = useCallback(() => {
        setInputs(defaultInputs);
        setUncertainty(defaultUncertaintySettings);
        setSelectedLoadId(null);
        setChartDistance(100);
    }, []);

    const densityAltitudeM = result ? densityToAltitude(result.atmosphere.densityKgM3) : null;
    const engineState = busy
        ? stale
            ? 'Calculating · previous results stale'
            : 'Calculating'
        : validationErrors.length
          ? 'Check inputs'
          : stale
            ? 'Results stale'
            : error
              ? 'Engine unavailable'
              : 'Ready';
    const engineClass = busy ? 'busy' : stale || error || validationErrors.length ? 'err' : '';

    return {
        persistedSettings,
        inputs,
        setInputs,
        uncertainty,
        setUncertainty,
        selectedLoadId,
        setSelectedLoadId,
        metric,
        setMetric,
        tab,
        setTab,
        units,
        setUnits,
        theme,
        setTheme,
        statusMode,
        setStatusMode,
        statusLoadId,
        setStatusLoadId,
        tableStep,
        setTableStep,
        chartDistance,
        setChartDistance,
        compareSort,
        setCompareSort,
        customOpen,
        setCustomOpen,
        editingCustom,
        custom,
        setCustom,
        customLoads,
        setCustomLoads,
        customTransferNotice,
        setError,
        validationErrors,
        calculation,
        result,
        busy,
        stale,
        error,
        load,
        selectedIndex,
        imperial,
        referenceDistance,
        tableStepM,
        target,
        customErrors,
        importDragData,
        exportDragData,
        openNewCustom,
        openEditCustom,
        saveCustom,
        removeCustom,
        resetAtmosphere,
        resetAll,
        densityAltitudeM,
        engineState,
        engineClass,
    };
}

export type WorkbenchState = ReturnType<typeof useWorkbenchState>;
