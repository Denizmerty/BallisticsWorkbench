export function Field({
    label,
    value,
    unit,
    onChange,
    step = 'any',
    error,
    wide = false,
}: {
    label: string;
    value: number;
    unit: string;
    onChange: (v: number) => void;
    step?: number | 'any';
    error?: string;
    wide?: boolean;
}) {
    return (
        <label className={`field${wide ? ' wide' : ''}${error ? ' invalid' : ''}`}>
            <span>{label}</span>
            <div className="fval" title={error}>
                <input
                    type="number"
                    step={step}
                    value={Number(value.toFixed(4))}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => onChange(Number(e.target.value))}
                />
                <b>{unit}</b>
            </div>
        </label>
    );
}
