"use client";

import { InputHTMLAttributes, useMemo, useState } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange"> & {
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (rawValue: string) => void;
};

function normalize(value: string | number | undefined) {
  if (value === undefined || value === null) return "";
  const source = String(value).trim();
  // DECIMAL dari MySQL kadang terbaca seperti "1000.00". Karena nominal SIAP
  // ditampilkan tanpa pecahan Rupiah, buang bagian desimal sebelum grouping.
  const decimal = source.match(/^(\d+)[.,](\d{1,2})$/);
  const digits = (decimal ? decimal[1] : source).replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+(?=\d)/, "");
}

function groupRupiah(raw: string) {
  if (!raw) return "";
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Input nominal Rupiah yang tetap mengirim angka mentah ke backend.
 * Contoh tampilan: 333.333.232.323 -> nilai form/API: 333333232323.
 */
export default function CurrencyInput({
  value,
  defaultValue,
  onValueChange,
  name,
  className = "input",
  required,
  ...props
}: Props) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(() => normalize(defaultValue));
  const raw = controlled ? normalize(value) : internal;
  const display = useMemo(() => groupRupiah(raw), [raw]);

  function update(nextDisplay: string) {
    const nextRaw = normalize(nextDisplay);
    if (!controlled) setInternal(nextRaw);
    onValueChange?.(nextRaw);
  }

  return (
    <>
      <input
        {...props}
        className={className}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        required={required}
        onChange={(e) => update(e.target.value)}
      />
      {name ? <input type="hidden" name={name} value={raw} /> : null}
    </>
  );
}
