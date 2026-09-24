import crypto from "crypto";
import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SheetJS is intentionally loaded at runtime so the app stays compatible with
// the existing TypeScript setup. v1.6.5 adds xlsx@0.18.5 to package.json.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX: any = require("xlsx");

type SheetConfig = {
  sheet: string;
  title: string;
  formatText: string;
  documentType: string;
  formatCode: string;
  hasUserInput: boolean;
  prefix: string;
};

const SHEETS: SheetConfig[] = [
  { sheet:"Perjanjian Kerjasama", title:"Perjanjian Kerjasama", formatText:"Format : P/ Nomor Surat / AR / tahun", documentType:"PERJANJIAN_KERJA_SAMA", formatCode:"PKS", hasUserInput:true, prefix:"P" },
  { sheet:"Surat Keluar- Direksi", title:"Direksi", formatText:"Format : Dir/ Nomor Surat / AR / tahun", documentType:"SURAT_DIREKSI", formatCode:"DIR", hasUserInput:true, prefix:"Dir" },
  { sheet:"Surat Keluar - Bag. Operasional", title:"Bagian Operasional", formatText:"Format : Oprsl / No. Surat / AR / tahun", documentType:"SURAT_OPERASIONAL", formatCode:"OPS", hasUserInput:false, prefix:"Oprsl" },
  { sheet:"Purchase Order", title:"Purchase Order", formatText:"Format : PO/ No. Surat / AR / tahun", documentType:"PURCHASE_ORDER", formatCode:"PO", hasUserInput:true, prefix:"PO" },
  { sheet:"Surat keluar- Bag. umum", title:"Bagian Umum", formatText:"Format : UM/ Nomor Surat / AR / tahun", documentType:"SURAT_UMUM", formatCode:"UMUM", hasUserInput:true, prefix:"UM" },
];
const BY_SHEET = new Map(SHEETS.map(x=>[x.sheet,x]));
const ALLOWED_EXPORT = new Set(["ROOT_ADMIN","STAFF","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"]);

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
function parseDate(value:unknown):{date:string|null;warning?:string}{
  if(value==null||s(value)==="")return {date:null};
  if(value instanceof Date && !Number.isNaN(value.getTime())){
    return {date:`${value.getUTCFullYear()}-${pad2(value.getUTCMonth()+1)}-${pad2(value.getUTCDate())}`};
  }
  if(typeof value==="number"&&Number.isFinite(value)){
    const p=XLSX.SSF.parse_date_code(value);
    if(p){ const d=isoDate(Number(p.y),Number(p.m),Number(p.d)); if(d)return {date:d}; }
  }
  const raw=s(value,100);
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return {date:raw};
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
function normalizeNumber(value:unknown){
  if(value==null)return "";
  if(typeof value==="number"&&Number.isFinite(value)){
    if(Number.isInteger(value))return String(value);
    return String(Number(value.toFixed(6)));
  }
  return s(value,80).replace(/\s+/g,"");
}
function parseLedgerSlot(raw:string){
  const m=raw.match(/^(\d+)(?:\.(\d+))?$/);
  if(!m)return null;
  const base=Number(m[1]), variant=Number(m[2]||0);
  // Protect the future numbering ledger from obvious legacy spreadsheet/date
  // serial mistakes while still preserving the original row in the database.
  if(!Number.isInteger(base)||base<1||base>9999||!Number.isInteger(variant)||variant<0)return null;
  return {base,variant};
}
function renderNumber(cfg:SheetConfig, raw:string, date:string){
  return `${cfg.prefix}/${raw}/AR/${date.slice(0,4)}`;
}
function statusFrom(...values:unknown[]){
  return values.some(v=>/\bBATAL\b/i.test(s(v)))?"CANCELLED":"ISSUED";
}
function workbookDate(value:unknown){
  if(!value)return "";
  if(value instanceof Date && !Number.isNaN(value.getTime())){
    return new Date(value.getUTCFullYear(),value.getUTCMonth(),value.getUTCDate());
  }
  const raw=String(value).slice(0,10);
  const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3])):raw;
}
function displayNumber(row:any){
  const legacy=s(row.legacy_number_text,80);
  if(legacy)return legacy;
  if(row.seq_base==null)return "";
  return Number(row.variant)>0?`${row.seq_base}.${row.variant}`:String(row.seq_base);
}
function setSheetAppearance(ws:any,cfg:SheetConfig){
  ws["!cols"] = cfg.hasUserInput
    ? [{wch:3},{wch:14},{wch:17},{wch:20},{wch:34},{wch:60},{wch:55}]
    : [{wch:3},{wch:14},{wch:17},{wch:34},{wch:60},{wch:55}];
  ws["!rows"]=[{hpt:21},{hpt:18},{hpt:8},{hpt:24}];
  const range=XLSX.utils.decode_range(ws["!ref"]||"A1:G1");
  for(let r=4;r<=range.e.r;r++){
    const dateCell=ws[XLSX.utils.encode_cell({r,c:2})];
    if(dateCell&&dateCell.t==="d")dateCell.z="dd mmm yy";
  }
}

export async function GET(request:Request){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!ALLOWED_EXPORT.has(user.role))return NextResponse.json({ok:false,error:"Anda tidak memiliki akses untuk export persuratan."},{status:403});

  const where=["l.direction='OUTGOING'",`l.document_type IN (${SHEETS.map(()=>"?").join(",")})`];
  const params:any[]=[...SHEETS.map(x=>x.documentType)];
  if(user.role!=="ROOT_ADMIN"){
    where.push(`(l.is_public=1 OR l.created_by=? OR l.current_owner_user_id=? OR (l.current_owner_user_id IS NULL AND l.current_role=?) OR EXISTS(SELECT 1 FROM siap_letter_actions a WHERE a.letter_id=l.id AND a.actor_user_id=?))`);
    params.push(user.id,user.id,user.role,user.id);
  }
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT l.*,u.name creator_name,nf.code format_code,nl.seq_base,nl.variant
     FROM siap_letters l
     JOIN siap_users u ON u.id=l.created_by
     LEFT JOIN siap_number_formats nf ON nf.id=l.number_format_id
     LEFT JOIN siap_number_ledger nl ON nl.letter_id=l.id
     WHERE ${where.join(" AND ")}
     ORDER BY l.document_type,l.letter_date ASC,COALESCE(nl.seq_base,999999) ASC,COALESCE(nl.variant,0) ASC,l.created_at ASC`,params
  );

  const book=XLSX.utils.book_new();
  for(const cfg of SHEETS){
    const list=rows.filter((r:any)=>String(r.document_type)===cfg.documentType);
    const aoa:any[][]=[];
    aoa.push(["",cfg.title]);
    aoa.push(["",cfg.formatText]);
    aoa.push([]);
    aoa.push(cfg.hasUserInput
      ?["","No. Surat","Tanggal Surat","User Input","Tujuan Surat","Perihal","Link File *dokumen lama tetap dipertahankan; dokumen baru tersimpan di SIAP ARU"]
      :["","No. Surat","Tanggal Surat","Tujuan Surat","Perihal","Link File *dokumen lama tetap dipertahankan; dokumen baru tersimpan di SIAP ARU"]);
    for(const r of list){
      const row=cfg.hasUserInput
        ?["",displayNumber(r),workbookDate(r.letter_date),s(r.legacy_user_input,180)||s(r.creator_name,180),s(r.recipient,255),s(r.subject,500),s(r.legacy_file_url,5000)]
        :["",displayNumber(r),workbookDate(r.letter_date),s(r.recipient,255),s(r.subject,500),s(r.legacy_file_url,5000)];
      aoa.push(row);
    }
    const ws=XLSX.utils.aoa_to_sheet(aoa,{cellDates:true});
    setSheetAppearance(ws,cfg);
    XLSX.utils.book_append_sheet(book,ws,cfg.sheet);
  }
  const out=XLSX.write(book,{type:"buffer",bookType:"xlsx",cellDates:true});
  await auditLog({userId:user.id,action:"OUTGOING_EXCEL_EXPORT",entityType:"LETTER",metadata:{rows:rows.length,sheets:SHEETS.map(x=>x.sheet)},request});
  const filename=`Form Persuratan ARU ${new Date().toISOString().slice(0,10)}.xlsx`;
  return new Response(out,{headers:{
    "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control":"no-store"
  }});
}

async function formatMap(conn:PoolConnection){
  const [rows]=await conn.query<RowDataPacket[]>(
    `SELECT id,code,document_type,pattern FROM siap_number_formats WHERE is_active=1 AND document_type IN (${SHEETS.map(()=>"?").join(",")})`,
    SHEETS.map(x=>x.documentType)
  );
  const map=new Map<string,any>();
  for(const r of rows)map.set(String(r.document_type),r);
  return map;
}

export async function POST(request:Request){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN")return NextResponse.json({ok:false,error:"Import Excel historis hanya dapat dilakukan Root Admin."},{status:403});
  try{
    const form=await request.formData();
    const file=form.get("file");
    if(!(file instanceof File))throw new Error("Pilih file Excel terlebih dahulu.");
    if(file.size>20*1024*1024)throw new Error("Ukuran file Excel maksimal 20 MB.");
    if(!/\.xlsx$/i.test(file.name))throw new Error("Gunakan file .xlsx.");
    const buffer=await file.arrayBuffer();
    const book=XLSX.read(buffer,{type:"array",cellDates:true,raw:true});

    const sourceRows:Array<{cfg:SheetConfig;sheet:string;rowNo:number;rawNumber:string;date:string;userInput:string;recipient:string;subject:string;fileText:string;status:string;warning?:string}> = [];
    const issues:string[]=[];
    let skipped=0;

    for(const sheetName of book.SheetNames){
      const cfg=BY_SHEET.get(sheetName);
      if(!cfg)continue;
      const ws=book.Sheets[sheetName];
      const data:any[][]=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
      for(let i=4;i<data.length;i++){
        const excelRow=i+1;
        const row=data[i]||[];
        const rawNumber=normalizeNumber(row[1]);
        const dateResult=parseDate(row[2]);
        const userInput=cfg.hasUserInput?s(row[3],180):"";
        const recipient=cfg.hasUserInput?s(row[4],255):s(row[3],255);
        const subject=cfg.hasUserInput?s(row[5],500):s(row[4],500);
        const fileText=cfg.hasUserInput?s(row[6],5000):s(row[5],5000);
        const meaningful=[rawNumber,row[2],userInput,recipient,subject,fileText].some(v=>s(v)!=="");
        if(!meaningful)continue;
        if(!dateResult.date){skipped++;issues.push(`${sheetName} baris ${excelRow}: ${dateResult.warning||"tanggal kosong"}; baris tidak diimport.`);continue;}
        if(!rawNumber){skipped++;issues.push(`${sheetName} baris ${excelRow}: nomor surat kosong; baris tidak diimport.`);continue;}
        if(dateResult.warning)issues.push(`${sheetName} baris ${excelRow}: ${dateResult.warning}`);
        sourceRows.push({cfg,sheet:sheetName,rowNo:excelRow,rawNumber,date:dateResult.date,userInput,recipient,subject:subject||"(Tanpa perihal - data Excel)",fileText,status:statusFrom(userInput,recipient,subject,fileText)});
      }
    }
    if(!sourceRows.length)throw new Error("Tidak ada data yang dapat diimport. Pastikan nama sheet mengikuti Form Persuratan ARU.");

    const result=await withTransaction(async conn=>{
      const formats=await formatMap(conn);
      for(const cfg of SHEETS)if(!formats.get(cfg.documentType))throw new Error(`Format nomor aktif untuk ${cfg.title} belum tersedia.`);
      let inserted=0,updated=0,ledgerLinked=0,conflicts=0;
      for(const src of sourceRows){
        const key=`ARU_XLSX:${src.sheet}:${src.rowNo}`;
        const fmt=formats.get(src.cfg.documentType);
        const rendered=renderNumber(src.cfg,src.rawNumber,src.date);
        const [existing]=await conn.query<RowDataPacket[]>(`SELECT id FROM siap_letters WHERE legacy_import_key=? LIMIT 1`,[key]);
        let letterId:string;
        if(existing[0]){
          letterId=String(existing[0].id);
          await conn.execute(
            `UPDATE siap_letters SET document_type=?,number_format_id=?,letter_number=?,recipient=?,subject=?,letter_date=?,issued_date=?,status=?,current_role=NULL,is_public=1,is_backdated=?,legacy_number_text=?,legacy_user_input=?,legacy_file_url=?,legacy_sheet_name=?,legacy_row_no=?,updated_by=? WHERE id=?`,
            [src.cfg.documentType,fmt.id,rendered,src.recipient||null,src.subject,src.date,src.date,src.status,src.date<new Date().toISOString().slice(0,10)?1:0,src.rawNumber,src.userInput||null,src.fileText||null,src.sheet,src.rowNo,user.id,letterId]
          );
          updated++;
        }else{
          letterId=crypto.randomUUID();
          await conn.execute(
            `INSERT INTO siap_letters (id,direction,document_type,number_format_id,letter_number,subject,recipient,letter_date,issued_date,confidentiality,summary,notes,status,current_role,is_public,is_backdated,cancelled_reason,legacy_import_key,legacy_number_text,legacy_user_input,legacy_file_url,legacy_sheet_name,legacy_row_no,legacy_number_conflict,created_by,updated_by)
             VALUES (?,?,?,?,?,?,?,?,?,'BIASA',NULL,? ,?,NULL,1,?,?,?,?,?,?,?,?,0,?,?)`,
            [letterId,"OUTGOING",src.cfg.documentType,fmt.id,rendered,src.subject,src.recipient||null,src.date,src.date,`Import historis dari ${src.sheet} baris ${src.rowNo}.`,src.status,src.date<new Date().toISOString().slice(0,10)?1:0,src.status==="CANCELLED"?"BATAL pada workbook sumber":null,key,src.rawNumber,src.userInput||null,src.fileText||null,src.sheet,src.rowNo,user.id,user.id]
          );
          await conn.execute(`INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment) VALUES (?,?,?,?,?,?,?)`,[crypto.randomUUID(),letterId,user.id,"IMPORT_LEGACY_EXCEL",null,src.status,`Import ${src.sheet} baris ${src.rowNo}`]);
          inserted++;
        }

        const slot=parseLedgerSlot(src.rawNumber);
        let conflict=0;
        if(slot){
          const [byLetter]=await conn.query<RowDataPacket[]>(`SELECT id FROM siap_number_ledger WHERE letter_id=? LIMIT 1`,[letterId]);
          if(!byLetter[0]){
            const [occupied]=await conn.query<RowDataPacket[]>(`SELECT id,letter_id FROM siap_number_ledger WHERE format_id=? AND number_year=? AND seq_base=? AND variant=? LIMIT 1`,[fmt.id,Number(src.date.slice(0,4)),slot.base,slot.variant]);
            if(occupied[0]&&String(occupied[0].letter_id||"")!==letterId){
              conflict=1;conflicts++;
            }else if(!occupied[0]){
              await conn.execute(
                `INSERT INTO siap_number_ledger (id,format_id,letter_id,number_year,letter_date,seq_base,variant,rendered_number,status,cancelled_reason,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                [crypto.randomUUID(),fmt.id,letterId,Number(src.date.slice(0,4)),src.date,slot.base,slot.variant,rendered,src.status==="CANCELLED"?"CANCELLED":"ISSUED",src.status==="CANCELLED"?"BATAL pada workbook sumber":null,user.id]
              );
              ledgerLinked++;
            }
          }
        }else{conflict=1;conflicts++;issues.push(`${src.sheet} baris ${src.rowNo}: nomor legacy \"${src.rawNumber}\" dipertahankan sebagai teks dan tidak dimasukkan ke ledger otomatis.`);}
        await conn.execute(`UPDATE siap_letters SET legacy_number_conflict=? WHERE id=?`,[conflict,letterId]);
      }
      return {inserted,updated,ledgerLinked,conflicts};
    });

    await auditLog({userId:user.id,action:"OUTGOING_EXCEL_IMPORT",entityType:"LETTER",metadata:{file:file.name,rows:sourceRows.length,skipped,...result,issues:issues.slice(0,50)},request});
    return NextResponse.json({ok:true,data:{file:file.name,processed:sourceRows.length,skipped,...result,issues:issues.slice(0,40),moreIssues:Math.max(0,issues.length-40)}});
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Import Excel gagal."},{status:400});
  }
}
