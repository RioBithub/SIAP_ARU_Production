"use client";

import { useId, useState } from "react";

type Option = { value: string; label: string; search?: string };

export default function SearchableSelect({ name, label, ariaLabel, options, placeholder = "Pilih…", required,
  value, defaultValue = "", onChange, disabled, sizeThreshold = 8 }: {
  name: string; label: string; ariaLabel?: string; options: Option[]; placeholder?: string; required?: boolean;
  value?: string; defaultValue?: string; onChange?: (value: string) => void; disabled?: boolean;
  sizeThreshold?: number;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [localValue, setLocalValue] = useState(defaultValue);
  const selected = value ?? localValue;
  const needle = query.trim().toLocaleLowerCase("id-ID");
  const visible = options.filter(option => option.value === selected ||
    (option.label + " " + (option.search || "")).toLocaleLowerCase("id-ID").includes(needle));

  return <>
    <label htmlFor={id}>{label}</label>
    {options.length >= sizeThreshold && <input type="search" className="input" aria-label={"Cari " + label.toLowerCase()}
      placeholder={"Cari " + label.toLowerCase() + "…"} value={query} disabled={disabled}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}/>}
    <select id={id} aria-label={ariaLabel} className="select" name={name} value={selected} disabled={disabled}
      required={required} onChange={event => { setLocalValue(event.target.value); onChange?.(event.target.value); }}>
      <option value="">{query && !visible.length ? "Tidak ada hasil pencarian" : placeholder}</option>
      {visible.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select>
  </>;
}
