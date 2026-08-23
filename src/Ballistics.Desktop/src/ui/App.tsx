import { ProfileManager } from './components/ProfileManager';
import { CustomLoadDialog } from './components/CustomLoadDialog';
import { WorkbenchToolbar } from './components/WorkbenchToolbar';
import { InputSidebar } from './components/InputSidebar';
import { Workspace } from './components/Workspace';
import { WorkbenchStatusBar } from './components/WorkbenchStatusBar';
import { usePersistedProfiles } from './lib/usePersistedProfiles';
import { useWorkbenchCommands } from './lib/useWorkbenchCommands';
import { useWorkbenchState } from './lib/useWorkbenchState';

export function App() {
    const workbench = useWorkbenchState();
    const persistedProfiles = usePersistedProfiles(workbench);
    const commands = useWorkbenchCommands(workbench, persistedProfiles);

    const {
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
        setChartDistance,
        compareSort,
        setCompareSort,
        customOpen,
        setCustomOpen,
        editingCustom,
        custom,
        setCustom,
        customTransferNotice,
        validationErrors,
        result,
        busy,
        stale,
        error,
        load,
        imperial,
        referenceDistance,
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
    } = workbench;
    const {
        profiles,
        quarantinedProfiles,
        profileOpen,
        setProfileOpen,
        profileNotice,
        profileBusy,
        createNamedProfile,
        applyProfile,
        deleteProfile,
        importProfiles,
        exportProfiles,
        exportQuarantinedProfile,
        clearQuarantine,
    } = persistedProfiles;

    return (
        <div className="app" data-theme={theme}>
            <WorkbenchToolbar
                units={units}
                theme={theme}
                selectedLoadSource={load?.source}
                hasSelectedLoad={!!load}
                canExport={!!result && !busy && !stale}
                copied={commands.copied}
                onOpenProfiles={() => setProfileOpen(true)}
                onNewLoad={openNewCustom}
                onEditLoad={openEditCustom}
                onRemoveLoad={removeCustom}
                onCopySummary={commands.copySummary}
                onExportCsv={commands.exportCsv}
                onUnitsChange={setUnits}
                onThemeChange={setTheme}
            />
            <main>
                <InputSidebar
                    inputs={inputs}
                    uncertainty={uncertainty}
                    imperial={imperial}
                    densityAltitudeM={densityAltitudeM}
                    shotgunLoads={
                        result?.loads.filter((candidate) => candidate.firearmGroup === 'shotgun') ??
                        []
                    }
                    setInputs={setInputs}
                    setUncertainty={setUncertainty}
                    onResetAtmosphere={resetAtmosphere}
                    onResetAll={resetAll}
                />
                <Workspace
                    tab={tab}
                    result={result}
                    load={load}
                    selectedLoadId={selectedLoadId}
                    statusMode={statusMode}
                    statusLoadId={statusLoadId}
                    inputs={inputs}
                    units={units}
                    referenceDistanceM={referenceDistance}
                    metric={metric}
                    tableStep={tableStep}
                    compareSort={compareSort}
                    error={error}
                    onTabChange={setTab}
                    onSelectedLoadId={setSelectedLoadId}
                    onStatusModeChange={setStatusMode}
                    onStatusLoadId={setStatusLoadId}
                    onMetricChange={setMetric}
                    onReferenceDistanceChange={setChartDistance}
                    onTableStepChange={setTableStep}
                    onCompareSort={setCompareSort}
                />
            </main>
            <WorkbenchStatusBar
                engineState={engineState}
                engineClass={engineClass}
                result={result}
                load={load}
                inputs={inputs}
                units={units}
                referenceDistanceM={referenceDistance}
            />
            {profileOpen && (
                <ProfileManager
                    profiles={profiles}
                    quarantine={quarantinedProfiles}
                    selectedLoadName={load?.shortName}
                    notice={profileNotice}
                    busy={profileBusy}
                    onClose={() => setProfileOpen(false)}
                    onCreate={createNamedProfile}
                    onApply={applyProfile}
                    onDelete={deleteProfile}
                    onImport={(policy) => void importProfiles(policy)}
                    onExport={(ids) => void exportProfiles(ids)}
                    onExportQuarantine={(id) => void exportQuarantinedProfile(id)}
                    onClearQuarantine={clearQuarantine}
                />
            )}
            {customOpen && (
                <CustomLoadDialog
                    draft={custom}
                    inputs={inputs}
                    imperial={imperial}
                    errors={customErrors}
                    editing={editingCustom !== null}
                    transferNotice={customTransferNotice}
                    onChange={setCustom}
                    onImportDragData={() => void importDragData()}
                    onExportDragData={() => void exportDragData()}
                    onCancel={() => setCustomOpen(false)}
                    onSave={saveCustom}
                />
            )}
        </div>
    );
}
