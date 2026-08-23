import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProfileConflictPolicy, ProfileKind } from './profiles';
import {
    appendCapturedProfile,
    applyNamedProfile,
    captureProfile,
    importProfileDocument,
    profileDocumentFilename,
    profileImportMessage,
    ProfileDocumentError,
    serializeProfileDocument,
} from './profiles';
import { savePersistedSettings } from './persistence';
import type { WorkbenchState } from './useWorkbenchState';
import { defaultInputs } from './workbenchDefaults';

export function usePersistedProfiles(workbench: WorkbenchState) {
    const {
        persistedSettings,
        inputs,
        setInputs,
        uncertainty,
        setUncertainty,
        customLoads,
        setCustomLoads,
        result,
        load,
        selectedLoadId,
        setSelectedLoadId,
        units,
        setUnits,
        chartDistance,
        setChartDistance,
        setError,
    } = workbench;
    const [profiles, setProfiles] = useState(persistedSettings.profiles);
    const [quarantinedProfiles, setQuarantinedProfiles] = useState(
        persistedSettings.quarantinedProfiles,
    );
    const [profileOpen, setProfileOpen] = useState(false);
    const [profileNotice, setProfileNotice] = useState('');
    const [profileBusy, setProfileBusy] = useState(false);
    const [availableBuiltInLoadIds, setAvailableBuiltInLoadIds] = useState<string[]>([]);

    useEffect(() => {
        try {
            savePersistedSettings(
                inputs,
                customLoads,
                uncertainty,
                window.localStorage,
                profiles,
                quarantinedProfiles,
            );
        } catch {
            // A storage quota or policy failure must not prevent calculations.
        }
    }, [customLoads, inputs, profiles, quarantinedProfiles, uncertainty]);

    useEffect(() => {
        if (!result) return;
        setAvailableBuiltInLoadIds(
            result.loads
                .filter((candidate) => candidate.source === 'builtIn')
                .map((candidate) => candidate.id),
        );
    }, [result]);

    const profileContext = useCallback(
        () => ({
            inputs,
            uncertainty,
            customLoads,
            availableLoadIds: [
                ...availableBuiltInLoadIds,
                ...customLoads.map((candidate) => candidate.id),
            ],
            selectedLoad: load,
            selectedLoadId: load?.id ?? selectedLoadId,
            preferredUnits: units,
        }),
        [availableBuiltInLoadIds, customLoads, inputs, load, selectedLoadId, uncertainty, units],
    );

    const createNamedProfile = useCallback(
        (kind: ProfileKind, name: string, firearmGroup: 'rifle' | 'shotgun') => {
            try {
                const captured = captureProfile(kind, name, profileContext(), firearmGroup);
                const next = appendCapturedProfile(profiles, captured);
                const saved = next.at(-1)!;
                setProfiles(next);
                setProfileNotice(
                    `Saved ${saved.name} as a ${kind === 'combinedScenario' ? 'combined scenario' : kind} profile.`,
                );
            } catch (cause) {
                setProfileNotice(
                    cause instanceof Error ? cause.message : 'The profile could not be saved.',
                );
            }
        },
        [profileContext, profiles],
    );

    const applyProfile = useCallback(
        (id: string) => {
            const profile = profiles.find((candidate) => candidate.id === id);
            if (!profile) return;
            const applied = applyNamedProfile(profile, profileContext());
            setProfileNotice(applied.message);
            if (!applied.ok) return;
            setInputs(applied.inputs);
            setUncertainty(applied.uncertainty);
            setCustomLoads(applied.customLoads);
            setSelectedLoadId(applied.selectedLoadId);
            setUnits(applied.preferredUnits);
            setChartDistance(Math.min(applied.inputs.distanceM, chartDistance));
            setError('');
        },
        [
            chartDistance,
            profileContext,
            profiles,
            setChartDistance,
            setCustomLoads,
            setError,
            setInputs,
            setSelectedLoadId,
            setUncertainty,
            setUnits,
        ],
    );

    const deleteProfile = useCallback(
        (id: string) => {
            const removed = profiles.find((profile) => profile.id === id);
            if (!removed) return;
            setProfiles((current) => current.filter((profile) => profile.id !== id));
            setProfileNotice(`Deleted ${removed.name}.`);
        },
        [profiles],
    );

    const exportProfiles = useCallback(
        async (ids: string[]) => {
            const selected = profiles.filter((profile) => ids.includes(profile.id));
            if (!selected.length) return;
            if (!window.ballistics) {
                setProfileNotice(
                    'Profile file export is available in the Electron desktop application.',
                );
                return;
            }
            setProfileBusy(true);
            try {
                const content = serializeProfileDocument(selected, defaultInputs);
                const saved = await window.ballistics.saveProfiles(
                    content,
                    profileDocumentFilename(),
                );
                setProfileNotice(
                    saved
                        ? `Exported ${selected.length} profile${selected.length === 1 ? '' : 's'}.`
                        : 'Profile export was canceled.',
                );
            } catch (cause) {
                setProfileNotice(cause instanceof Error ? cause.message : 'Profile export failed.');
            } finally {
                setProfileBusy(false);
            }
        },
        [profiles],
    );

    const importProfiles = useCallback(
        async (policy: ProfileConflictPolicy) => {
            if (!window.ballistics) {
                setProfileNotice(
                    'Profile file import is available in the Electron desktop application.',
                );
                return;
            }
            setProfileBusy(true);
            try {
                const opened = await window.ballistics.openProfiles();
                if (!opened) {
                    setProfileNotice('Profile import was canceled.');
                    return;
                }
                const imported = importProfileDocument(
                    opened.content,
                    profiles,
                    defaultInputs,
                    policy,
                );
                setProfiles(imported.profiles);
                setQuarantinedProfiles((current) =>
                    [...current, ...imported.quarantine].slice(-20),
                );
                setProfileNotice(`${opened.fileName}: ${profileImportMessage(imported.summary)}`);
            } catch (cause) {
                setProfileNotice(
                    cause instanceof ProfileDocumentError || cause instanceof Error
                        ? cause.message
                        : 'Profile import failed.',
                );
            } finally {
                setProfileBusy(false);
            }
        },
        [profiles],
    );

    const exportQuarantinedProfile = useCallback(
        async (id: string) => {
            const entry = quarantinedProfiles.find((candidate) => candidate.id === id);
            if (!entry || !window.ballistics) return;
            const content = `${JSON.stringify(
                {
                    format: 'ballistics-workbench-profile-quarantine',
                    schemaVersion: 1,
                    exportedAt: new Date().toISOString(),
                    sourceName: entry.sourceName,
                    reason: entry.reason,
                    importedAt: entry.importedAt,
                    rawJson: entry.rawJson,
                },
                null,
                2,
            )}\n`;
            setProfileBusy(true);
            try {
                const safeName =
                    entry.sourceName.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48) || 'profile';
                const saved = await window.ballistics.saveProfiles(
                    content,
                    `${safeName}.quarantine.json`,
                );
                setProfileNotice(
                    saved
                        ? `Recovered ${entry.sourceName} diagnostics.`
                        : 'Recovery export was canceled.',
                );
            } catch (cause) {
                setProfileNotice(
                    cause instanceof Error ? cause.message : 'Recovery export failed.',
                );
            } finally {
                setProfileBusy(false);
            }
        },
        [quarantinedProfiles],
    );

    const profileIds = useMemo(() => profiles.map((profile) => profile.id), [profiles]);
    const clearQuarantine = useCallback(() => {
        setQuarantinedProfiles([]);
        setProfileNotice('Cleared quarantined profile entries.');
    }, []);

    return {
        profiles,
        quarantinedProfiles,
        profileOpen,
        setProfileOpen,
        profileNotice,
        profileBusy,
        profileIds,
        createNamedProfile,
        applyProfile,
        deleteProfile,
        exportProfiles,
        importProfiles,
        exportQuarantinedProfile,
        clearQuarantine,
    };
}

export type PersistedProfiles = ReturnType<typeof usePersistedProfiles>;
