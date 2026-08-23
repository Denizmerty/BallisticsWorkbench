import { useMemo, useState } from 'react';
import type {
    NamedProfile,
    ProfileConflictPolicy,
    ProfileKind,
    QuarantinedProfile,
} from '../lib/profiles';
import { MAX_NAMED_PROFILES, profileKindLabel } from '../lib/profiles';

type Props = {
    profiles: NamedProfile[];
    quarantine: QuarantinedProfile[];
    selectedLoadName: string | undefined;
    notice: string;
    busy: boolean;
    onClose(): void;
    onCreate(kind: ProfileKind, name: string, firearmGroup: 'rifle' | 'shotgun'): void;
    onApply(id: string): void;
    onDelete(id: string): void;
    onImport(policy: ProfileConflictPolicy): void;
    onExport(ids: string[]): void;
    onExportQuarantine(id: string): void;
    onClearQuarantine(): void;
};

const kinds: ProfileKind[] = ['combinedScenario', 'environment', 'firearm', 'ammunition'];

function profileDetail(profile: NamedProfile) {
    if (profile.kind === 'environment') {
        return (
            `${profile.data.temperatureC.toFixed(1)} °C · ${profile.data.pressureHpa.toFixed(1)} hPa · ` +
            `${profile.data.headwindMps.toFixed(1)} m/s headwind`
        );
    }
    if (profile.kind === 'firearm') {
        const twist =
            profile.data.group === 'rifle'
                ? ` · ${profile.data.twistInches.toFixed(1)} in ${profile.data.twistDirection > 0 ? 'RH' : 'LH'}`
                : '';
        return (
            `${profile.data.group} · zero ${profile.data.zeroRangeM.toFixed(1)} m · ` +
            `sight ${(profile.data.sightHeightM * 100).toFixed(1)} cm${twist}`
        );
    }
    if (profile.kind === 'ammunition') {
        return profile.data.selection === 'builtIn'
            ? `built-in · ${profile.data.loadId}`
            : `custom · ${profile.data.load.name} · ${profile.data.load.drag}`;
    }
    return (
        `${profile.data.customLoads.length} custom load${profile.data.customLoads.length === 1 ? '' : 's'} · ` +
        `${profile.data.inputs.distanceM.toFixed(0)} m · ${profile.data.preferredUnits}`
    );
}

export function ProfileManager({
    profiles,
    quarantine,
    selectedLoadName,
    notice,
    busy,
    onClose,
    onCreate,
    onApply,
    onDelete,
    onImport,
    onExport,
    onExportQuarantine,
    onClearQuarantine,
}: Props) {
    const [name, setName] = useState('');
    const [kind, setKind] = useState<ProfileKind>('combinedScenario');
    const [firearmGroup, setFirearmGroup] = useState<'rifle' | 'shotgun'>('rifle');
    const [conflictPolicy, setConflictPolicy] = useState<ProfileConflictPolicy>('rename');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const orderedProfiles = useMemo(
        () =>
            [...profiles].sort(
                (left, right) =>
                    kinds.indexOf(left.kind) - kinds.indexOf(right.kind) ||
                    left.name.localeCompare(right.name),
            ),
        [profiles],
    );
    const createDisabled =
        busy ||
        !name.trim() ||
        name.trim().length > 80 ||
        profiles.length >= MAX_NAMED_PROFILES ||
        (kind === 'ammunition' && !selectedLoadName);
    const toggleSelected = (id: string) =>
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const create = () => {
        if (createDisabled) return;
        onCreate(kind, name.trim(), firearmGroup);
        setName('');
    };

    return (
        <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
            <section
                className="modal profile-manager"
                role="dialog"
                aria-modal="true"
                aria-labelledby="profile-manager-title"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="modal-head">
                    <h2 id="profile-manager-title">Named profiles</h2>
                    <button type="button" onClick={onClose} aria-label="Close profile manager">
                        ×
                    </button>
                </header>

                <div className="profile-create">
                    <label>
                        Profile type
                        <select
                            value={kind}
                            onChange={(event) => setKind(event.target.value as ProfileKind)}
                        >
                            {kinds.map((item) => (
                                <option key={item} value={item}>
                                    {profileKindLabel(item)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="profile-name">
                        Name
                        <input
                            value={name}
                            maxLength={80}
                            placeholder="e.g. Cold range day"
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') create();
                            }}
                        />
                    </label>
                    {kind === 'firearm' ? (
                        <label>
                            Firearm group
                            <select
                                value={firearmGroup}
                                onChange={(event) =>
                                    setFirearmGroup(event.target.value as 'rifle' | 'shotgun')
                                }
                            >
                                <option value="rifle">Rifle</option>
                                <option value="shotgun">Shotgun</option>
                            </select>
                        </label>
                    ) : (
                        <p className="profile-capture-hint">
                            {kind === 'combinedScenario'
                                ? 'Captures all current inputs, uncertainty, custom loads, selection, and units.'
                                : kind === 'environment'
                                  ? 'Captures pressure semantics, atmosphere, and wind in SI.'
                                  : selectedLoadName
                                    ? `Captures selected ammunition: ${selectedLoadName}.`
                                    : 'Select a load before capturing ammunition.'}
                        </p>
                    )}
                    <button
                        className="primary"
                        type="button"
                        disabled={createDisabled}
                        onClick={create}
                    >
                        Save current
                    </button>
                </div>

                <div className="profile-transfer">
                    <label>
                        Import conflicts
                        <select
                            value={conflictPolicy}
                            onChange={(event) =>
                                setConflictPolicy(event.target.value as ProfileConflictPolicy)
                            }
                        >
                            <option value="rename">Keep both (rename imported)</option>
                            <option value="replace">Replace existing</option>
                            <option value="skip">Skip imported conflict</option>
                        </select>
                    </label>
                    <button type="button" disabled={busy} onClick={() => onImport(conflictPolicy)}>
                        Import file…
                    </button>
                    <button
                        type="button"
                        disabled={busy || profiles.length === 0}
                        onClick={() => onExport(profiles.map((profile) => profile.id))}
                    >
                        Export all…
                    </button>
                    <button
                        type="button"
                        disabled={busy || selectedIds.size === 0}
                        onClick={() => onExport([...selectedIds])}
                    >
                        Export selected…
                    </button>
                </div>

                {notice ? (
                    <p className="profile-notice" role="status">
                        {notice}
                    </p>
                ) : null}

                <div className="profile-list" aria-label="Saved profiles">
                    {orderedProfiles.length ? (
                        orderedProfiles.map((profile) => (
                            <article key={profile.id} className="profile-row">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.has(profile.id)}
                                    onChange={() => toggleSelected(profile.id)}
                                    aria-label={`Select ${profile.name} for export`}
                                />
                                <div>
                                    <strong>{profile.name}</strong>
                                    <span>{profileKindLabel(profile.kind)}</span>
                                    <small>{profileDetail(profile)}</small>
                                </div>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => onApply(profile.id)}
                                >
                                    Apply
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => onExport([profile.id])}
                                >
                                    Export
                                </button>
                                <button
                                    className="danger"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => onDelete(profile.id)}
                                >
                                    Delete
                                </button>
                            </article>
                        ))
                    ) : (
                        <p className="profile-empty">No named profiles have been saved.</p>
                    )}
                </div>

                {quarantine.length ? (
                    <details className="profile-quarantine">
                        <summary>{quarantine.length} quarantined profile entries</summary>
                        <p>
                            Invalid entries are excluded from calculations but retained with
                            diagnostics so their original JSON can be recovered.
                        </p>
                        {quarantine.map((entry) => (
                            <article key={entry.id}>
                                <div>
                                    <strong>{entry.sourceName}</strong>
                                    <small>{entry.reason}</small>
                                </div>
                                <button type="button" onClick={() => onExportQuarantine(entry.id)}>
                                    Recover JSON…
                                </button>
                            </article>
                        ))}
                        <button className="danger" type="button" onClick={onClearQuarantine}>
                            Clear quarantine
                        </button>
                    </details>
                ) : null}

                <footer className="modal-actions">
                    <span>
                        {profiles.length}/{MAX_NAMED_PROFILES} profiles
                    </span>
                    <button type="button" onClick={onClose}>
                        Close
                    </button>
                </footer>
            </section>
        </div>
    );
}
