"use client";

import { InputHTMLAttributes, useMemo, useState } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange"> & {
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (rawValue: string) => void;
  allowDecimals?: boolean;
};

function normalizeWhole(value: string | number | undefined) {
  if (value === undefined || value === null) return "";
  const source = String(value).trim();
  const decimal = source.match(/^(\d+)[.,](\d{1,2})$/);
  const digits = (decimal ? decimal[1] : source).replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+(?=\d)/, "");
}

function normalizeDecimal(value: string | number | undefined, fromDisplay = false) {
  if (value === undefined || value === null) return "";
  const source = String(value).trim().replace(/\s/g, "");
  if (!source) return "";

  let integer = "";
  let decimal: string | null = null;

  if (fromDisplay && source.includes(",")) {
    const idx = source.lastIndexOf(",");
    integer = source.slice(0, idx).replace(/\D/g, "");
    decimal = source.slice(idx + 1).replace(/\D/g, "").slice(0, 2);
  } else if (!fromDisplay && /^\d+\.\d{0,2}$/.test(source)) {
    const [i, d = ""] = source.split(".");
    integer = i;
    decimal = d.slice(0, 2);
  } else if (fromDisplay && /^\d+\.\d{1,2}$/.test(source) && !/^\d{1,3}(\.\d{3})+$/.test(source)) {
    const [i, d = ""] = source.split(".");
    integer = i;
    decimal = d.slice(0, 2);
  } else {
    integer = source.replace(/\D/g, "");
  }

  integer = integer.replace(/^0+(?=\d)/, "");
  if (!integer) integer = "0";
  return decimal === null ? integer : `${integer}.${decimal}`;
}

function groupInteger(raw: string) {
  if (!raw) return "";
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function displayValue(raw: string, allowDecimals: boolean) {
  if (!raw) return "";
  if (!allowDecimals) return groupInteger(raw);
  const hasDecimal = raw.includes(".");
  const [integer, decimal = ""] = raw.split(".");
  return `${groupInteger(integer)}${hasDecimal ? `,${decimal}` : ""}`;
}

/**
 * Input nominal Rupiah dengan pemisah ribuan otomatis.
 * Default menerima pecahan bila diperlukan: 4884428023.60 -> 4.884.428.023,60.
 * Set allowDecimals=false bila field memang hanya menerima Rupiah bulat.
 */
export default function CurrencyInput({
  value,
  defaultValue,
  onValueChange,
  name,
  className = "input",
  required,
  allowDecimals = true,
  ...props
}: Props) {
  const controlled = value !== undefined;
  const normalizeInitial = (v: string | number | undefined) => allowDecimals ? normalizeDecimal(v, false) : normalizeWhole(v);
  const [internal, setInternal] = useState(() => normalizeInitial(defaultValue));
  const raw = controlled ? normalizeInitial(value) : internal;
  const display = useMemo(() => displayValue(raw, allowDecimals), [raw, allowDecimals]);

  function update(nextDisplay: string) {
    const nextRaw = allowDecimals ? normalizeDecimal(nextDisplay, true) : normalizeWhole(nextDisplay);
    if (!controlled) setInternal(nextRaw);
    onValueChange?.(nextRaw);
  }

  return (
    <>
      <input
        {...props}
        className={className}
        type="text"
        inputMode={allowDecimals ? "decimal" : "numeric"}
        autoComplete="off"
        value={display}
        required={required}
        onChange={(e) => update(e.target.value)}
      />
      {name ? <input type="hidden" name={name} value={raw} /> : null}
    </>
  );
}
