interface RangeFieldProps {
  label: string;
  symbol: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

export function RangeField({
  label,
  symbol,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: RangeFieldProps) {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;

  return (
    <label className="range-field">
      <span className="range-label">
        {label} <i>{symbol}</i>{unit ? `（${unit}）` : ''}
      </span>
      <span className="range-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={event => onChange(Number(event.target.value))}
        />
        <input
          className="number-input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value.toFixed(decimals)}
          onChange={event => onChange(Math.max(min, Math.min(max, Number(event.target.value))))}
        />
      </span>
      <span className="range-bounds"><span>{min}</span><span>{max}</span></span>
    </label>
  );
}
