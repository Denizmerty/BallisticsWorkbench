import type { UnitSystem } from '../types';

export type Theme = 'light' | 'dark';

type Props = {
    units: UnitSystem;
    theme: Theme;
    selectedLoadSource?: 'builtIn' | 'custom';
    hasSelectedLoad: boolean;
    canExport: boolean;
    copied: boolean;
    onOpenProfiles: () => void;
    onNewLoad: () => void;
    onEditLoad: () => void;
    onRemoveLoad: () => void;
    onCopySummary: () => void;
    onExportCsv: () => void;
    onUnitsChange: (units: UnitSystem) => void;
    onThemeChange: (theme: Theme) => void;
};

export function WorkbenchToolbar({
    units,
    theme,
    selectedLoadSource,
    hasSelectedLoad,
    canExport,
    copied,
    onOpenProfiles,
    onNewLoad,
    onEditLoad,
    onRemoveLoad,
    onCopySummary,
    onExportCsv,
    onUnitsChange,
    onThemeChange,
}: Props) {
    const customSelected = selectedLoadSource === 'custom';
    const imperial = units === 'imperial';

    return (
        <div className="appbar">
            <span className="app-name">Ballistics Workbench</span>
            <span className="tsep" />
            <button className="tbtn" onClick={onOpenProfiles} title="Ctrl+Shift+P">
                Profiles…
            </button>
            <span className="tsep" />
            <button className="tbtn" onClick={onNewLoad}>
                New load…
            </button>
            <button className="tbtn" disabled={!customSelected} onClick={onEditLoad}>
                Edit load…
            </button>
            <button className="tbtn danger" disabled={!customSelected} onClick={onRemoveLoad}>
                Remove load
            </button>
            <span className="tsep" />
            <button
                className="tbtn"
                disabled={!hasSelectedLoad}
                onClick={onCopySummary}
                title="Copy the selected load's values at the reference distance"
            >
                {copied ? 'Copied' : 'Copy summary'}
            </button>
            <button className="tbtn" disabled={!canExport} onClick={onExportCsv}>
                Export CSV
            </button>
            <span className="spacer" />
            <div className="seg" role="group" aria-label="Units">
                <button
                    className={imperial ? '' : 'active'}
                    onClick={() => onUnitsChange('metric')}
                >
                    Metric
                </button>
                <button
                    className={imperial ? 'active' : ''}
                    onClick={() => onUnitsChange('imperial')}
                >
                    Imperial
                </button>
            </div>
            <div className="seg" role="group" aria-label="Theme">
                <button
                    className={theme === 'light' ? 'active' : ''}
                    onClick={() => onThemeChange('light')}
                >
                    Light
                </button>
                <button
                    className={theme === 'dark' ? 'active' : ''}
                    onClick={() => onThemeChange('dark')}
                >
                    Dark
                </button>
            </div>
        </div>
    );
}
