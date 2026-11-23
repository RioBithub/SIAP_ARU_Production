import { SSF } from "xlsx";

export type SheetConfig = {
  sheet: string;
  title: string;
  formatText: string;
  documentType: string;
  formatCode: string;
  hasUserInput: boolean;
  prefix: string;
};

export const REGISTER_SHEETS: SheetConfig[] = [
  { sheet:"Perjanjian Kerjasama", title:"Perjanjian Kerjasama", formatText:"Format : P/ Nomor Surat / AR / tahun", documentType:"PERJANJIAN_KERJA_SAMA", formatCode:"PKS", hasUserInput:true, prefix:"P" },
  { sheet:"Surat Keluar- Direksi", title:"Direksi", formatText:"Format : Dir/ Nomor Surat / AR / tahun", documentType:"SURAT_DIREKSI", formatCode:"DIR", hasUserInput:true, prefix:"Dir" },
  { sheet:"Surat Keluar - Bag. Operasional", title:"Bagian Operasional", formatText:"Format : Oprsl / No. Surat / AR / tahun", documentType:"SURAT_OPERASIONAL", formatCode:"OPS", hasUserInput:false, prefix:"Oprsl" },
  { sheet:"Purchase Order", title:"Purchase Order", formatText:"Format : PO/ No. Surat / AR / tahun", documentType:"PURCHASE_ORDER", formatCode:"PO", hasUserInput:true, prefix:"PO" },
  { sheet:"Surat keluar- Bag. umum", title:"Bagian Umum", formatText:"Format : UM/ Nomor Surat / AR / tahun", documentType:"SURAT_UMUM", formatCode:"UMUM", hasUserInput:true, prefix:"UM" },
];

function s(v: unknown, max=5000) { return String(v ?? "").trim().slice(0,max); }
function pad2(v:number){ return String(v).padStart(2,"0"); }
function isoDate(y:number,m:number,d:number){
  const dt=new Date(Date.UTC(y,m-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
const MONTHS:Record<string,number>={
  januari:1,jan:1,februari:2,feb:2,maret:3,mar:3,april:4,apr:4,mei:5,may:5,
  juni:6,jun:6,juli:7,jul:7,agustus:8,agu:8,aug:8,september:9,sep:9,
  oktober:10,okt:10,oct:10,november:11,nov:11,desember:12,des:12,dec:12,
};
function normalizeDateText(input:string){
  return input
    .replace(/(\d)([A-Za-z])/g,"$1 $2")
    .replace(/aprill/ig,"April")
    .replace(/agutus|agusuts/ig,"Agustus")
    .replace(/septrember|setember/ig,"September")
    .replace(/\s+/g," ")
    .trim();
}
export function parseRegisterDate(value:unknown):{date:string|null;warning?:string}{
  if(value==null||s(value)==="")return {date:null};
  if(value instanceof Date && !Number.isNaN(value.getTime())){
    return {date:`${value.getUTCFullYear()}-${pad2(value.getUTCMonth()+1)}-${pad2(value.getUTCDate())}`};
  }
  if(typeof value==="number"&&Number.isFinite(value)){
    const p=SSF.parse_date_code(value);
    if(p){ const d=isoDate(Number(p.y),Number(p.m),Number(p.d)); if(d)return {date:d}; }
  }
  const raw=s(value,100);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    return { date: isoDate(year, month, day) };
  }
  const normalized=normalizeDateText(raw);
  const m=normalized.match(/^(\d{1,2})[\s\/-]+([A-Za-z]+|\d{1,2})[\s\/-]+(\d{2,4})$/);
  if(m){
    const day=Number(m[1]);
    const month=/^\d+$/.test(m[2])?Number(m[2]):MONTHS[m[2].toLowerCase()];
    let year=Number(m[3]);
    if(year<100)year+=2000;
    let warning:string|undefined;
    if(year===206){year=2026;warning=`Tahun pada Excel \"${raw}\" dinormalisasi menjadi 2026.`;}
    if(month){const d=isoDate(year,month,day);if(d)return {date:d,warning};}
  }
  return {date:null,warning:`Tanggal \"${raw}\" tidak dapat dibaca.`};
}
export function normalizeRegisterNumber(value:unknown){
  if(value==null)return "";
  if(typeof value==="number"&&Number.isFinite(value)){
    if(Number.isInteger(value))return String(value);
    return String(Number(value.toFixed(6)));
  }
  return s(value,80).replace(/\s+/g,"");
}
export function parseRegisterSlot(raw:string){
  const m=raw.match(/^(\d+)(?:[.,](\d+))?$/);
  if(!m)return null;
  const base=Number(m[1]), variant=Number(m[2]||0);
  // Protect the future numbering ledger from obvious legacy spreadsheet/date
  // serial mistakes while still preserving the original row in the database.
  if(!Number.isInteger(base)||base<1||base>9999||!Number.isInteger(variant)||variant<0)return null;
  return {base,variant};
}
