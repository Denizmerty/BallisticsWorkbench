import type { Load, ValidationIssue } from '../types';
import { dragDescription, firearmLabel } from '../lib/labels';

type Props = {
    loads: Load[];
    selectedLoadId: string | null;
    warnings: ValidationIssue[];
    onSelectedLoadId: (id: string) => void;
};

export function LoadManager({ loads, selectedLoadId, warnings, onSelectedLoadId }: Props) {
    return (
        <>
            <nav className="loads" aria-label="Loads">
                {loads.map((load) => (
                    <button
                        className={load.id === selectedLoadId ? 'active' : ''}
                        onClick={() => onSelectedLoadId(load.id)}
                        key={load.id}
                    >
                        <span>
                            {firearmLabel(load)} · {dragDescription(load)}
                            {load.pelletCount > 1 ? ` · ${load.pelletCount}×` : ''}
                        </span>
                        {load.shortName}
                    </button>
                ))}
            </nav>
            {warnings.length > 0 && (
                <div className="engine-warnings" role="status" aria-label="Engine warnings">
                    {warnings.map((warning) => (
                        <span key={`${warning.code}:${warning.field}`}>{warning.message}</span>
                    ))}
                </div>
            )}
        </>
    );
}
