const MONTH_NAMES = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function jakartaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function financeEditableWindow(date = new Date()) {
  const {year,month} = jakartaParts(date);
  return {
    year,
    currentMonth: month,
    maxEditableMonth: Math.min(12, month + 4)
  };
}

export function parseFinanceMonth(raw: unknown) {
  // MySQL DATE can arrive from mysql2 either as YYYY-MM-DD text or as a JS Date.
  // Normalize both forms before validating the finance period.
  let value = "";
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    value = `${raw.getUTCFullYear()}-${String(raw.getUTCMonth()+1).padStart(2,"0")}`;
  } else {
    const text = String(raw ?? "").trim();
    const sqlLike = text.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (sqlLike) {
      value = `${sqlLike[1]}-${sqlLike[2]}`;
    } else if (text) {
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) {
        value = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth()+1).padStart(2,"0")}`;
      }
    }
  }
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("Periode tidak valid.");
  const [year,month] = value.split("-").map(Number);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) throw new Error("Periode tidak valid.");
  return { value, year, month, sqlDate: `${value}-01` };
}

export function assertEditableFinanceMonth(raw: unknown) {
  const parsed = parseFinanceMonth(raw);
  const window = financeEditableWindow();
  if (parsed.year !== window.year) {
    throw new Error(`Untuk tahap awal, data Finance hanya dapat diedit pada tahun berjalan ${window.year}.`);
  }
  if (parsed.month > window.maxEditableMonth) {
    const maxName = MONTH_NAMES[window.maxEditableMonth - 1];
    throw new Error(`Periode ${MONTH_NAMES[parsed.month - 1]} ${parsed.year} belum dapat diedit. Finance dapat menyiapkan data maksimal 4 bulan ke depan, saat ini sampai ${maxName} ${window.year}.`);
  }
  return parsed;
}

export function assertEditableFinanceYear(raw: unknown) {
  const year = Number(raw);
  const window = financeEditableWindow();
  if (!Number.isInteger(year) || year !== window.year) {
    throw new Error(`Untuk tahap awal, pengaturan Tahun Berjalan hanya dapat diubah untuk ${window.year}.`);
  }
  return year;
}
