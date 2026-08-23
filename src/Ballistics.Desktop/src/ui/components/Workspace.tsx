import type { Inputs, Load, Metric, Result, UnitSystem } from '../types';
import { statusText, type StatusMode } from '../lib/statusText';
import { ComparisonTable, type CompareSort } from './ComparisonTable';
import { HelpNotes } from './HelpNotes';
import { LoadManager } from './LoadManager';
import { RangeTable } from './RangeTable';
import { StatusReadout } from './StatusReadout';
import { TrajectoryOverview } from './TrajectoryOverview';

export type WorkspaceTab = 'overview' | 'table' | 'compare' | 'notes';

export const WORKSPACE_TABS: WorkspaceTab[] = ['overview', 'table', 'compare', 'notes'];

const TAB_LABELS: Record<WorkspaceTab, string> = {
    overview: 'Overview',
    table: 'Range table',
    compare: 'All-load calculator',
    notes: 'Help',
};

type Props = {
    tab: WorkspaceTab;
    result: Result | null;
    load: Load | undefined;
    selectedLoadId: string | null;
    statusMode: StatusMode;
    statusLoadId: string | null;
    inputs: Inputs;
    units: UnitSystem;
    referenceDistanceM: number;
    metric: Metric;
    tableStep: number;
    compareSort: CompareSort;
    error: string;
    onTabChange: (tab: WorkspaceTab) => void;
    onSelectedLoadId: (id: string) => void;
    onStatusModeChange: (mode: StatusMode) => void;
    onStatusLoadId: (id: string) => void;
    onMetricChange: (metric: Metric) => void;
    onReferenceDistanceChange: (distanceM: number) => void;
    onTableStepChange: (step: number) => void;
    onCompareSort: (sort: CompareSort) => void;
};

export function Workspace({
    tab,
    result,
    load,
    selectedLoadId,
    statusMode,
    statusLoadId,
    inputs,
    units,
    referenceDistanceM,
    metric,
    tableStep,
    compareSort,
    error,
    onTabChange,
    onSelectedLoadId,
    onStatusModeChange,
    onStatusLoadId,
    onMetricChange,
    onReferenceDistanceChange,
    onTableStepChange,
    onCompareSort,
}: Props) {
    const loads = result?.loads ?? [];
    const warnings = result?.issues.filter((issue) => issue.severity === 'warning') ?? [];
    const imperial = units === 'imperial';
    const statusMessage = statusText({
        result,
        mode: statusMode,
        selectedLoadId: statusLoadId,
        referenceDistanceM,
        inputs,
        imperial,
    });

    return (
        <section className="workspace">
            <nav className="top-tabs" aria-label="Workspace views">
                {WORKSPACE_TABS.map((workspaceTab, index) => (
                    <button
                        key={workspaceTab}
                        className={tab === workspaceTab ? 'active' : ''}
                        onClick={() => onTabChange(workspaceTab)}
                        title={`${TAB_LABELS[workspaceTab]} (${index + 1})`}
                    >
                        {TAB_LABELS[workspaceTab]}
                    </button>
                ))}
            </nav>
            <LoadManager
                loads={loads}
                selectedLoadId={load?.id ?? selectedLoadId}
                warnings={warnings}
                onSelectedLoadId={onSelectedLoadId}
            />
            <StatusReadout
                loads={loads}
                mode={statusMode}
                selectedLoadId={statusLoadId}
                message={statusMessage}
                onModeChange={onStatusModeChange}
                onSelectedLoadId={onStatusLoadId}
            />
            <div className="content">
                {error && <div className="error">{error}</div>}
                {tab === 'overview' && load && (
                    <TrajectoryOverview
                        load={load}
                        loads={loads.length ? loads : [load]}
                        inputs={inputs}
                        units={units}
                        referenceDistanceM={referenceDistanceM}
                        metric={metric}
                        onMetricChange={onMetricChange}
                        onReferenceDistanceChange={onReferenceDistanceChange}
                    />
                )}
                {tab === 'table' && load && (
                    <RangeTable
                        load={load}
                        inputs={inputs}
                        imperial={imperial}
                        referenceDistance={referenceDistanceM}
                        tableStep={tableStep}
                        onTableStepChange={onTableStepChange}
                    />
                )}
                {tab === 'compare' && result && (
                    <ComparisonTable
                        result={result}
                        selectedLoadId={load?.id ?? null}
                        referenceDistance={referenceDistanceM}
                        imperial={imperial}
                        compareSort={compareSort}
                        onCompareSort={onCompareSort}
                        onSelectedLoadId={onSelectedLoadId}
                    />
                )}
                {tab === 'notes' && (
                    <div className="panel notes">
                        <HelpNotes />
                    </div>
                )}
            </div>
        </section>
    );
}
