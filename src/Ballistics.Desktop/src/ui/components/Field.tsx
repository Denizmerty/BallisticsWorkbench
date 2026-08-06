export function Field({
  label,
  value,
  unit,
  onChange,
  step = 'any',
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
  step?: number | 'any';
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          step={step}
          value={Number(value.toFixed(4))}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <b>{unit}</b>
      </div>
    </label>
  );
}
