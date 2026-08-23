import type { Inputs, Load, Result, UnitSystem } from '../types';
import { formatNumber } from '../lib/format';
import { M_TO_YD } from '../lib/units';

type Props = {
    engineState: string;
    engineClass: string;
    result: Result | null;
    load: Load | undefined;
    inputs: Inputs;
    units: UnitSystem;
    referenceDistanceM: number;
};

export function WorkbenchStatusBar({
    engineState,
    engineClass,
    result,
    load,
    inputs,
    units,
    referenceDistanceM,
}: Props) {
    const imperial = units === 'imperial';
    const distance = (metres: number) => (imperial ? metres * M_TO_YD : metres);
    const distanceUnit = imperial ? 'yd' : 'm';

    return (
        <div className="statusbar" role="status" aria-label="Workbench status">
            <span className="seg-item">
                <i className={`ind ${engineClass}`} />
                {engineState}
            </span>
            <span className="seg-item">
                <span className="lab">ρ</span>
                <b>{result ? `${result.atmosphere.densityKgM3.toFixed(4)} kg/m³` : 'N/A'}</b>
            </span>
            <span className="seg-item">
                <span className="lab">a</span>
                <b>{result ? `${result.atmosphere.speedOfSoundMps.toFixed(1)} m/s` : 'N/A'}</b>
            </span>
            <span className="seg-item grow">
                <span className="lab">load</span>
                <b>{load ? load.shortName : 'N/A'}</b>
            </span>
            <span className="seg-item">
                <span className="lab">ref</span>
                <b>
                    {formatNumber(distance(referenceDistanceM), 1)} {distanceUnit}
                </b>
            </span>
            <span className="seg-item">
                <span className="lab">range</span>
                <b>
                    {formatNumber(distance(inputs.distanceM), 0)} {distanceUnit}
                </b>
            </span>
            <span
                className="seg-item"
                title={
                    result
                        ? `Engine ${result.engineVersion}. Model ${result.modelVersion}`
                        : undefined
                }
            >
                <span className="lab">model</span>
                <b>{result?.modelVersion ?? 'N/A'}</b>
            </span>
            <span className="seg-item">{imperial ? 'US' : 'SI'}</span>
        </div>
    );
}
