"use client";

import { useState } from "react";
import SearchableSelect from "@/components/SearchableSelect";

type Option = { value: string; label: string; search?: string };

export default function NotaTargetFields({ direct, reply, primary, initialRecipients = [], primaryOptions, additionalOptions }: {
  direct: boolean;
  reply: boolean;
  primary?: string;
  initialRecipients?: Option[];
  primaryOptions: Option[];
  additionalOptions: Option[];
}) {
  const [main, setMain] = useState(primary || "");
  const [additional, setAdditional] = useState(initialRecipients);
  const choices = additionalOptions.filter(option => option.value !== main &&
    !additional.some(person => person.value === option.value));
  return <>
    {!reply && <div className="field">
      <SearchableSelect name="routing_target_user_id" label={direct ? "Penerima Nota Dinas" : "Tujuan Review Awal"}
        ariaLabel={direct ? "Penerima Nota Dinas" : "Tujuan review"} required value={main}
        options={primaryOptions} placeholder="Pilih tujuan…" onChange={value => {
          setMain(value);
          setAdditional(people => people.filter(person => person.value !== value));
        }}/>
    </div>}
    <div className="field full">
      <SearchableSelect name="nota_recipient_choice" label="Penerima tambahan" options={choices} sizeThreshold={3}
        value="" disabled={!choices.length} placeholder="Tambah penerima…" onChange={value => {
          const person = choices.find(option => option.value === value);
          if (person) setAdditional(people => [...people, person]);
        }}/>
      <input type="hidden" name="nota_recipient_ids" value={JSON.stringify(additional.map(person => person.value))}/>
      {additional.length > 0 && <div className="row-actions">
        {additional.map(person => <button type="button" className="btn btn-secondary" key={person.value}
          aria-label={"Hapus penerima " + person.label}
          onClick={() => setAdditional(people => people.filter(item => item.value !== person.value))}>{person.label} ×</button>)}
      </div>}
      <span className="hint">{direct ? "Semua penerima mendapat nota saat pengirim menekan Kirim."
        : "Penerima tambahan mendapat nota setelah persetujuan. Tujuan review awal tetap satu akun."}</span>
    </div>
  </>;
}
