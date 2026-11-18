"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type DispositionLetterOption = { id: string; subject: string; reference: string };

export default function DispositionLetterPicker({ options, selected, query, loading, error, onSearch, onSelect }: {
  options: DispositionLetterOption[];
  selected: DispositionLetterOption | null;
  query: string;
  loading: boolean;
  error?: string;
  onSearch: (query: string) => void;
  onSelect: (id: string) => void;
}) {
  const inputId = useId();
  const listId = `${inputId}-results`;
  const input = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const showOptions = expanded && !loading && !error && options.length > 0;
  const active = showOptions ? options[activeIndex] : undefined;
  const activeId = active && `${listId}-${active.id}`;

  useEffect(() => {
    input.current?.setCustomValidity(selected ? "" : "Pilih dokumen dari hasil pencarian.");
  }, [selected]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function close() {
    setExpanded(false);
    setActiveIndex(-1);
  }

  function choose(id: string) {
    onSelect(id);
    close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setExpanded(true);
      if (loading || error) return;
      const last = options.length - 1;
      setActiveIndex(index => event.key === "ArrowDown"
        ? Math.min(index + 1, last)
        : index < 0 ? last : Math.max(index - 1, 0));
    } else if (event.key === "Enter" && (expanded || !selected)) {
      event.preventDefault();
      if (active) choose(active.id);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      close();
    }
  }

  return <>
    <label htmlFor={inputId}>Dokumen</label>
    <input id={inputId} ref={input} className="input disposition-letter-search" type="search" role="combobox"
      required autoComplete="off" aria-autocomplete="list" aria-expanded={showOptions}
      aria-controls={showOptions ? listId : undefined} aria-activedescendant={activeId}
      placeholder="Cari nomor, perihal, pengirim, atau tujuan…"
      value={selected ? `${selected.reference} — ${selected.subject}` : query}
      onFocus={event => { if (selected) event.currentTarget.select(); setExpanded(true); }}
      onClick={event => { if (selected) event.currentTarget.select(); setExpanded(true); }}
      onChange={event => { onSearch(event.target.value); setActiveIndex(-1); setExpanded(true); }}
      onBlur={close} onKeyDown={handleKeyDown}/>
    {showOptions && <ul id={listId} role="listbox" aria-label="Hasil pencarian dokumen" className="disposition-letter-results">
      {options.map(option => <li key={option.id} id={`${listId}-${option.id}`} role="option"
        aria-selected={option.id === (active?.id ?? selected?.id)}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(option.id)}>
        <strong>{option.subject}</strong>
        <span className="muted">{option.reference}</span>
      </li>)}
    </ul>}
    {expanded && !showOptions && (error
      ? <span className="hint" role="alert">{error}</span>
      : <span className="hint" role="status">{loading ? "Mencari dokumen…" : query.trim()
        ? "Tidak ada dokumen yang cocok." : "Belum ada dokumen yang dapat didisposisikan."}</span>)}
  </>;
}
