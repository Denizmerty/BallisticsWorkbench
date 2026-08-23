import type { Load } from '../types';
import type { StatusMode } from '../lib/statusText';

type Props = {
    loads: Load[];
    mode: StatusMode;
    selectedLoadId: string | null;
    message: string;
    onModeChange: (mode: StatusMode) => void;
    onSelectedLoadId: (id: string) => void;
};

const STATUS_OPTIONS: Array<{ value: StatusMode; label: string }> = [
    { value: 'atmosphere', label: 'Atmosphere & integration' },
    { value: 'summary', label: 'Selected load summary' },
    { value: 'retainedEnergy', label: 'Energy retained' },
    { value: 'mach', label: 'Mach & flight regime' },
    { value: 'sphere', label: 'Drag-coefficient diagnostics' },
    { value: 'windage', label: 'Windage (wind & spin)' },
    { value: 'holdover', label: 'Holdover & sight path' },
    { value: 'mpbr', label: 'MPBR & zero' },
    { value: 'events', label: 'Trajectory events' },
];

export function StatusReadout({
    loads,
    mode,
    selectedLoadId,
    message,
    onModeChange,
    onSelectedLoadId,
}: Props) {
    const selectedLoad = loads.find((load) => load.id === selectedLoadId) ?? loads[0];

    return (
        <section className="status-readout" aria-label="Configurable status readout">
            <label>
                Status
                <select
                    value={mode}
                    onChange={(event) => onModeChange(event.target.value as StatusMode)}
                >
                    {STATUS_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                Load
                <select
                    value={selectedLoad?.id ?? ''}
                    disabled={mode === 'atmosphere'}
                    onChange={(event) => onSelectedLoadId(event.target.value)}
                >
                    {loads.map((load) => (
                        <option value={load.id} key={load.id}>
                            {load.shortName}
                        </option>
                    ))}
                </select>
            </label>
            <p>{message}</p>
        </section>
    );
}
