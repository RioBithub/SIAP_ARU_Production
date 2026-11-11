"use client";

import { FormEvent,useEffect,useMemo,useState } from "react";
import type { Role, SessionUser } from "@/lib/types";
import { REVIEW_ROLES, canHandleSecretariat, reviewRole } from "@/lib/correspondence-workflow";
import Modal from "@/components/Modal";
import StatusBadge, { statusLabel } from "@/components/StatusBadge";
import BusinessDocumentFields, { BusinessDocumentSummary, ReferencePicker } from "@/components/BusinessDocumentFields";
import { INVOICE_INCOMING, INVOICE_OUTGOING, SPK_INCOMING, SPK_OUTGOING, isBusinessDocument, isInvoice, type DocumentReference } from "@/lib/business-documents";

type Direction="INCOMING"|"OUTGOING"|"INTERNAL";
type Props={direction:Direction;user:SessionUser};
type PendingAction={action:string;label:string;requiredComment?:boolean;issue?:boolean};

type RoutingUser={id:string;name:string;role:Role;unit_name:string|null};
const isReviewer=(account:RoutingUser)=>REVIEW_ROLES.some(role=>role===account.role);

const today=()=>new Date().toISOString().slice(0,10);
const fmtDate=(v:any)=>v?new Date(String(v).slice(0,10)+"T00:00:00").toLocaleDateString("id-ID",{day:"2-digit",month:"short",year:"numeric"}):"-";
const size=(n:number)=>n<1024*1024?`${(n/1024).toFixed(0)} KB`:`${(n/1024/1024).toFixed(2)} MB`;
const DOC_LABELS:Record<string,string>={
  PERJANJIAN_KERJA_SAMA:"Perjanjian Kerja Sama",
  SURAT_DIREKSI:"Surat Keluar Direksi",
  SURAT_OPERASIONAL:"Bagian Operasional",
  PURCHASE_ORDER:"Purchase Order (PO)",
  SURAT_UMUM:"Surat Keluar Umum",
  [SPK_OUTGOING]:"Surat Perintah Kerja (SPK)",
  [SPK_INCOMING]:"Surat Perintah Kerja (SPK) Masuk",
  [INVOICE_INCOMING]:"Invoice Masuk",
  [INVOICE_OUTGOING]:"Invoice Keluar",
  SURAT_MASUK_UMUM:"Surat Masuk Umum",
  NOTA_DINAS:"Nota Dinas",
  LEMBAR_PENGANTAR:"Lembar Pengantar"
};
const docLabel=(r:any)=>r.format_name||DOC_LABELS[r.document_type]||String(r.document_type||"-").replace(/_/g," ");
const DOC_TYPE_CLASS:Record<string,string>={
  PERJANJIAN_KERJA_SAMA:"letter-pks",
  PURCHASE_ORDER:"letter-po",
  SURAT_DIREKSI:"letter-direksi",
  SURAT_OPERASIONAL:"letter-operasional",
  SURAT_UMUM:"letter-umum",
  SURAT_PERINTAH_KERJA:"letter-umum",
  SURAT_MASUK_UMUM:"letter-masuk",
  NOTA_DINAS:"letter-nota",
  LEMBAR_PENGANTAR:"letter-nota"
};
const docTypeClass=(t:any)=>DOC_TYPE_CLASS[String(t||"")]||"letter-default";
const outgoingNumber=(r:any)=>isBusinessDocument(r.document_type)?(r.letter_number||r.display_number):r.display_number;
const currentTargetLabel=(r:any)=>{
  if(r.current_role==="SECRETARIAT") return "Sekretariat";
  if(r.current_owner_name){
    return `${r.current_owner_name}${r.current_owner_unit?` — ${r.current_owner_unit}`:""}`;
  }

  if(r.status==="DRAFT" && r.routing_target_name){
    return `Tujuan awal: ${r.routing_target_name}${r.routing_target_unit?` — ${r.routing_target_unit}`:""}`;
  }

  if(r.status==="MANAGER_REVIEW") return "Manager";
  if(r.status==="DIRECTOR_OPS_REVIEW") return "Direktur Operasional";
  if(r.status==="PRESIDENT_DIRECTOR_REVIEW") return "Direktur Utama";
  if(r.status==="READY_TO_ISSUE") return "Staff Pembuat";
  if(r.status==="RETURNED_STAFF") return "Staff Pembuat";

  return "-";
};

const FALLBACK_LETTER_TYPE_OPTIONS=[
  ["PERJANJIAN_KERJA_SAMA","Perjanjian Kerja Sama"],
  ["PURCHASE_ORDER","Purchase Order (PO)"],
  ["SURAT_DIREKSI","Surat Keluar Direksi"],
  ["SURAT_OPERASIONAL","Bagian Operasional"],
  ["SURAT_UMUM","Surat Keluar Umum"],
  [SPK_OUTGOING,"Surat Perintah Kerja (SPK)"],
  [INVOICE_OUTGOING,"Invoice Keluar"]
] as const;
const INCOMING_TYPE_OPTIONS=[
  ["SURAT_MASUK_UMUM","Surat Masuk Umum"],
  [SPK_INCOMING,"Surat Perintah Kerja (SPK) Masuk"],
  [INVOICE_INCOMING,"Invoice Masuk"],
] as const;
const humanAction=(a:string)=>({
  RECEIVE_INCOMING:"Diserahkan ke Sekretariat",RETURN_PREVIOUS:"Kembali satu tingkat",
  PREPARE_ISSUE:"Nomor difinalisasi",MARK_SENT:"Pengiriman dicatat",REJECT:"Ditolak",SUBMIT:"Diajukan",APPROVE:"Disetujui & Diteruskan",APPROVE_FINAL:"Disetujui / Selesai",RETURN:"Dikembalikan",ISSUE:"Diterbitkan",CANCEL:"Dibatalkan",COMPLETE:"Diselesaikan",RESPONSE:"Tanggapan",CREATE_OUTGOING:"Draft Dibuat",CREATE_INTERNAL:"Nota Dinas Dibuat",REGISTER_INCOMING:"Surat Diregistrasi",IMPORT_LEGACY_EXCEL:"Diimpor dari Excel Lama"}[a]||a.replace(/_/g," "));

function titleFor(direction:Direction){
  if(direction==="INCOMING") return "Surat Masuk";
  if(direction==="OUTGOING") return "Surat Keluar";
  return "Nota Dinas";
}

export default function LettersClient({direction,user}:Props){
  const [rows,setRows]=useState<any[]>([]);
  const [formats,setFormats]=useState<any[]>([]);
  const [documentTypes,setDocumentTypes]=useState<any[]>([]);
  const [routingUsers,setRoutingUsers]=useState<RoutingUser[]>([]);
  const [queue,setQueue]=useState(direction!=="INTERNAL"&&user.role==="SECRETARIAT");
  const [sourceLetter,setSourceLetter]=useState<DocumentReference[]>([]);
  const [sourceDispositionId,setSourceDispositionId]=useState("");
  const [sourceLoading,setSourceLoading]=useState(false);
  const hasSecretariat=routingUsers.some(account=>account.role==="SECRETARIAT");
  const incomingToSecretariat=direction==="INCOMING"&&hasSecretariat&&!canHandleSecretariat(user.role);
  const reviewers=routingUsers.filter(account=>direction==="INCOMING"&&hasSecretariat
    ? isReviewer(account) : account.role==="MANAGER");
  const canDraftOutgoing=user.role==="STAFF"||user.role==="ROOT_ADMIN";
  const [q,setQ]=useState("");
  const [status,setStatus]=useState("");
  const [docType,setDocType]=useState("");
  const [year,setYear]=useState("");
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [createOpen,setCreateOpen]=useState(false);
  const [detail,setDetail]=useState<any>(null);
  const [detailOpen,setDetailOpen]=useState(false);
  const [editOpen,setEditOpen]=useState(false);
  const [createType,setCreateType]=useState(direction==="INCOMING"?"SURAT_MASUK_UMUM":"SURAT_UMUM");
  const [createBusy,setCreateBusy]=useState(false);
  const [pendingAction,setPendingAction]=useState<PendingAction|null>(null);
  const [actionFiles,setActionFiles]=useState<File[]>([]);
  const [actionBusy,setActionBusy]=useState(false);
  const [importOpen,setImportOpen]=useState(false);
  const [importFile,setImportFile]=useState<File|null>(null);
  const [importBusy,setImportBusy]=useState(false);
  const [importResult,setImportResult]=useState<any>(null);

  async function load(filters?:{q?:string;status?:string;docType?:string;year?:string;queue?:boolean}){
    setLoading(true);setError("");
    const fq=filters?.q??q, fs=filters?.status??status, ft=filters?.docType??docType, fy=filters?.year??year;
    const p=new URLSearchParams({direction,limit:direction==="OUTGOING"?"2000":"500"});
    if(fq)p.set("q",fq);if(fs)p.set("status",fs);if(ft)p.set("document_type",ft);if(fy)p.set("year",fy);
    if(filters?.queue??queue)p.set("queue","secretariat");
    const res=await fetch(`/api/letters?${p}`);const j=await res.json();
    if(j.ok)setRows(j.data);else setError(j.error);
    setLoading(false);
  }
  async function loadFormats(){
    if(direction==="INTERNAL")return;
    const typeRequest = fetch("/api/admin/document-types?direction=" + direction + "&active=1");
    const formatRequest = direction==="OUTGOING" ? fetch("/api/admin/number-formats") : Promise.resolve(null);
    const [typeResponse, formatResponse] = await Promise.all([typeRequest, formatRequest]);
    if (typeResponse.ok) {
      const result = await typeResponse.json();
      if (result.ok) {
        setDocumentTypes(result.data);
        setCreateType(current => result.data.length && current !== "__CUSTOM__" && !result.data.some((type:any)=>type.code===current)
          ? result.data[0].code : current);
      }
    }
    if (formatResponse?.ok) {
      const result = await formatResponse.json();
      if (result.ok) setFormats(result.data.filter((format:any)=>format.is_active));
    }
  }

  async function loadReviewers(){
    const r=await fetch("/api/users/lookup");
    const j=await r.json();

    if(j.ok) setRoutingUsers(j.data);
  }

  useEffect(()=>{
    void load();
    void loadFormats();
    void loadReviewers();
    const params=new URLSearchParams(window.location.search);
    const linkedId=params.get("letter_id");
    if(linkedId) void openDetail(linkedId);
    const linkedDisposition=params.get("source_disposition_id");
    const linkedLetter=params.get("source_letter_id");
    if(direction!=="OUTGOING"||!(canDraftOutgoing||(user.role==="FINANCE"&&linkedDisposition))||!(linkedDisposition||linkedLetter)) return;
    setCreateOpen(true);
    if(linkedDisposition){
      setSourceDispositionId(linkedDisposition);
      return;
    }
    setSourceLoading(true);
    const controller=new AbortController();
    const search=new URLSearchParams({kind:"source",id:linkedLetter!});
    void fetch("/api/letters/references?"+search,{signal:controller.signal})
      .then(async response=>{
        const result=await response.json();
        if(!response.ok||!result.data?.[0]) throw new Error("Dokumen asal tidak dapat dibuka.");
        setSourceLetter([result.data[0]]);
      })
      .catch(error=>{if(!controller.signal.aborted)setError(error.message);})
      .finally(()=>{if(!controller.signal.aborted)setSourceLoading(false);});
    return ()=>controller.abort();
  },[direction]);

  function openCreate(){
    setSourceLetter([]);
    setSourceDispositionId("");
    setError("");
    setCreateOpen(true);
  }

  const canCreate=direction==="INTERNAL"||(direction==="OUTGOING"&&(canDraftOutgoing||(user.role==="FINANCE"&&sourceDispositionId)))
    ||(direction==="INCOMING"&&(canDraftOutgoing||user.role==="SECRETARIAT"
      ||(hasSecretariat&&REVIEW_ROLES.some(role=>role===user.role))));
  const createLabel=direction==="INCOMING"?(incomingToSecretariat?"Serahkan Surat":"Registrasi Surat")
    :direction==="INTERNAL"?"Buat Nota Dinas":"Buat Draft Surat";
  const typeOptions=documentTypes.length
    ? documentTypes.map((x:any)=>[x.code,x.name] as [string,string])
    : direction==="INCOMING"?INCOMING_TYPE_OPTIONS:FALLBACK_LETTER_TYPE_OPTIONS;
  const businessForm=isBusinessDocument(createType);
  const incomingFileRequired=direction==="INCOMING"&&businessForm;
  const signedIssue=Boolean(pendingAction?.issue&&(detail?.letter.uses_secretariat||(detail?.letter.document_type===SPK_OUTGOING&&detail?.business?.managed)));
  const actionFileLimit=signedIssue?4:5;

  function formObject(fd:FormData){
    const out:any={};
    fd.forEach((value,key)=>{ out[key]=value; });
    if(typeof out.business==="string") out.business=JSON.parse(out.business);
    return out;
  }

  async function create(event: FormEvent<HTMLFormElement>){
    event.preventDefault();
    if (createBusy) return;
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const original = form.get("original_file");
    const file = original && typeof original !== "string" && original.size > 0 ? original : null;
    const extras = form.getAll("additional_files").filter((value): value is File => typeof value !== "string" && value.size > 0);
    if (extras.length > 5) {
      setError("Maksimal 5 lampiran tambahan.");
      return;
    }
    if ([...extras, ...(file ? [file] : [])].some(value => value.size > 10 * 1024 * 1024)) {
      setError("Ukuran maksimal 10 MB per file.");
      return;
    }
    setCreateBusy(true);
    try {
      const body = formObject(form);
      body.direction = direction;
      body.is_public = body.is_public === "on";
      delete body.original_file;
      delete body.additional_files;

      if(direction==="OUTGOING"){
        body.source_letter_id=sourceLetter[0]?.id;
        body.source_disposition_id=sourceDispositionId||undefined;
      }
      const atomicOriginal = file;
      const metadata = JSON.stringify(body);
      const upload = new FormData();
      if (atomicOriginal) {
        upload.set("metadata", metadata);
        upload.set("original_file", atomicOriginal);
      }
      const response = await fetch("/api/letters", atomicOriginal
        ? { method: "POST", body: upload }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: metadata });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setError(result.error || "Gagal menyimpan dokumen.");
        return;
      }

      const failedFiles: string[] = [];
      const pending = [
        ...extras.map(value => ({ kind: "ADDITIONAL", file: value })),
      ];
      for (const item of pending) {
        try {
          const attachment = new FormData();
          attachment.set("file", item.file);
          attachment.set("kind", item.kind);
          const uploaded = await fetch("/api/letters/" + result.data.id + "/attachments", { method: "POST", body: attachment });
          if (!uploaded.ok) failedFiles.push(item.file.name);
        } catch {
          failedFiles.push(item.file.name);
        }
      }

      setCreateOpen(false);
      setMessage(direction==="INCOMING"?(result.data.status==="SECRETARIAT_INTAKE"?"Surat diserahkan ke Sekretariat.":"Surat diregistrasi dan diteruskan.")
        :direction==="INTERNAL"?"Nota Dinas tersimpan sebagai draft. Buka detail untuk mengajukan ke Manager."
        :"Draft dan nomor dokumen tersimpan. Buka detail untuk mengajukan ke Manager reviewer.");
      await load();
      if (failedFiles.length) {
        await openDetail(result.data.id);
        setError("Dokumen tersimpan. Unggah ulang file berikut dari detail dokumen: " + failedFiles.join(", "));
      }
    } catch {
      setError("Gagal memuat hasil penyimpanan. Cek daftar dokumen sebelum mencoba kembali.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function importExcel(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!importFile){setError("Pilih file .xlsx terlebih dahulu.");return;}
    setImportBusy(true);setError("");setImportResult(null);
    const fd=new FormData();fd.set("file",importFile);
    const r=await fetch("/api/letters/outgoing-excel",{method:"POST",body:fd});
    const j=await r.json();setImportBusy(false);
    if(!r.ok){setError(j.error||"Import Excel gagal.");return;}
    setImportResult(j.data);
    setMessage(`Import Excel selesai: ${j.data.inserted} data baru, ${j.data.updated} data diperbarui, ${j.data.conflicts} nomor legacy ditandai untuk pengecekan.`);
    await load();await loadFormats();
  }

  async function openDetail(id:string){
    const r=await fetch(`/api/letters/${id}`);const j=await r.json();if(!r.ok){setError(j.error);return}
    if(j.data.letter.direction!==direction){setError("Arah dokumen tidak sesuai dengan halaman ini.");return;}
    setDetail(j.data);setDetailOpen(true);
  }

  function startAction(action:string,label:string,requiredComment=false,issue=false){
    setActionFiles([]);setError("");
    setPendingAction({action,label,requiredComment,issue});
  }

  async function submitAction(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!detail||!pendingAction)return;
    setActionBusy(true);setError("");
    const form=new FormData(e.currentTarget);
    const comment=String(form.get("comment")||"").trim();
    if(pendingAction.requiredComment&&!comment){setError("Catatan/alasan wajib diisi.");setActionBusy(false);return;}
    const fd=new FormData();
    fd.set("action",pendingAction.action);
    fd.set("comment",comment);
    if(pendingAction.issue) fd.set("issued_date",String(form.get("issued_date")||today()));
    if(pendingAction.action==="REGISTER_INCOMING") fd.set("routing_target_user_id",String(form.get("routing_target_user_id")||""));
    if(pendingAction.action==="MARK_SENT") fd.set("sent_date",String(form.get("sent_date")||""));
    if(signedIssue){
      const signed = form.get("signed_file");
      if (!signed || typeof signed === "string" || signed.size === 0) {
        setError("Unggah naskah yang sudah ditandatangani.");setActionBusy(false);return;
      }
      fd.set("signed_file",signed);
      fd.set("signature_method",String(form.get("signature_method")||""));
    }
    actionFiles.slice(0,actionFileLimit).forEach(f=>fd.append("files",f));
    try {
      const response = await fetch("/api/letters/" + detail.letter.id + "/actions", { method: "POST", body: fd });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setError(result.error || "Proses dokumen gagal.");
        return;
      }
      setPendingAction(null);
      setDetailOpen(false);
      setMessage(pendingAction.label + " berhasil.");
      await load();
    } catch {
      setError("Gagal memuat hasil aksi. Buka kembali detail untuk memeriksa status dokumen.");
    } finally {
      setActionBusy(false);
    }
  }

  async function upload(kind:"ORIGINAL"|"ADDITIONAL",file:File){
    const fd=new FormData();fd.set("file",file);fd.set("kind",kind);
    setError("");
    try {
      const response = await fetch("/api/letters/" + detail.letter.id + "/attachments", { method: "POST", body: fd });
      const result = await response.json();
      if(!response.ok){setError(result.error||"Lampiran gagal diunggah.");return;}
      await openDetail(detail.letter.id);setMessage("Lampiran berhasil diunggah.");
    } catch {
      setError("Gagal memuat hasil unggah. Periksa daftar lampiran sebelum mencoba kembali.");
    }
  }

  async function editLetter(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!detail)return;
    setError("");
    const fd=new FormData(e.currentTarget);
    const body=formObject(fd);
    body.is_public=body.is_public==="on";
    if(canChangeSource()) body.source_letter_id=sourceLetter[0]?.id||"";
    const r=await fetch(`/api/letters/${detail.letter.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok){setError(j.error);return}
    setEditOpen(false);setMessage("Data dokumen berhasil diperbarui.");await openDetail(detail.letter.id);await load();
  }

  function canEditDetail(){
    if(!detail)return false;
    const letter=detail.letter;
    const own=user.role==="ROOT_ADMIN"||letter.created_by===user.id;
    const draft=["DRAFT","RETURNED_STAFF"].includes(letter.status);
    if(letter.uses_secretariat&&letter.status==="SECRETARIAT_INTAKE") return own||canHandleSecretariat(user.role);
    if(letter.uses_secretariat||detail.business?.managed||isInvoice(letter.document_type)) return own&&draft;
    return user.role==="ROOT_ADMIN"||(own&&draft)||(user.role==="STAFF"&&letter.status==="RETURNED_STAFF");
  }

  function canChangeSource(){
    return direction==="OUTGOING"&&detail&&["DRAFT","RETURNED_STAFF"].includes(detail.letter.status)
      &&(user.role==="ROOT_ADMIN"||detail.letter.created_by===user.id)
      &&!detail.hasSourceDisposition&&(!detail.hasSourceLetter||detail.sourceLetter);
  }

  function openEdit(){
    setError("");
    setSourceLetter(detail.sourceLetter?[detail.sourceLetter]:[]);
    setEditOpen(true);
  }

  function canDispositionFromDetail(){
    if(!detail)return false;

    const allowedRole=[
      "ROOT_ADMIN",
      "MANAGER",
      "DIRECTOR_OPS",
      "PRESIDENT_DIRECTOR"
    ].includes(user.role);

    if(!allowedRole)return false;

    if(detail.letter.direction==="OUTGOING"){
      return detail.letter.status==="ISSUED";
    }

    return ["APPROVED","DISPOSED","IN_PROGRESS","COMPLETED"].includes(detail.letter.status);
  }

  function actionButtons(){
    if(!detail)return null;
    const letter=detail.letter;
    const s=letter.status;const d=letter.direction as Direction;
    const secretariat=Boolean(letter.uses_secretariat);
    const handlesSecretariat=secretariat&&letter.current_role==="SECRETARIAT"&&canHandleSecretariat(user.role);
    const buttons:Array<[string,string,string,boolean?,boolean?]>=[];

    if(d==="INCOMING"&&s==="SECRETARIAT_INTAKE"&&handlesSecretariat)
      buttons.push(["REGISTER_INCOMING","Registrasi & Teruskan","btn-primary"]);
    if(["DRAFT","RETURNED_STAFF"].includes(s) && (user.role==="ROOT_ADMIN"||detail.letter.created_by===user.id)) {
      buttons.push(["SUBMIT","Ajukan ke Manager","btn-primary",false,false]);
    }
    const expected=s==="SECRETARIAT_REVIEW"&&secretariat?"SECRETARIAT":reviewRole(s);
    const isAssignedReviewer=user.role==="ROOT_ADMIN"||(user.role===expected&&
      (!letter.current_owner_user_id||letter.current_owner_user_id===user.id));
    if(expected&&isAssignedReviewer){
      if(d==="OUTGOING"){
        const label=s==="PRESIDENT_DIRECTOR_REVIEW"?"ACC Final Dirut":s==="SECRETARIAT_REVIEW"?"Teruskan ke Dirut"
          :s==="DIRECTOR_OPS_REVIEW"&&secretariat&&letter.secretariat_review_required?"Teruskan ke Sekretariat":"Approve & Teruskan";
        buttons.push(["APPROVE",label,"btn-success"],["RETURN","Kembalikan ke Penyusun","btn-secondary",true]);
        if(s!=="MANAGER_REVIEW") buttons.push(["RETURN_PREVIOUS","Kembalikan Satu Tingkat","btn-secondary",true]);
        if(s==="PRESIDENT_DIRECTOR_REVIEW") buttons.push(["REJECT","Tolak Surat","btn-danger",true]);
      }else{
        if((d==="INTERNAL"||(d==="INCOMING"&&secretariat))&&s!=="PRESIDENT_DIRECTOR_REVIEW")
          buttons.push(["APPROVE_FINAL","Setujui di Tahap Ini","btn-success"]);
        buttons.push(["APPROVE",s==="PRESIDENT_DIRECTOR_REVIEW"?"Setujui"
          :s==="MANAGER_REVIEW"?"Teruskan ke Dirops":"Teruskan ke Dirut","btn-primary"]);
        const returnLabel=d==="INCOMING"&&secretariat&&letter.current_owner_user_id===letter.routing_target_user_id
          ?"Kembalikan ke Sekretariat":s==="MANAGER_REVIEW"?"Kembalikan ke Penyusun":"Kembalikan Satu Tingkat";
        buttons.push(["RETURN",returnLabel,"btn-secondary",true]);
      }
    }
    const participated=
      user.role==="ROOT_ADMIN" ||
      detail.letter.created_by===user.id ||
      detail.letter.current_owner_user_id===user.id ||
      Boolean(detail.actions?.some((a:any)=>a.actor_user_id===user.id));

    if(d==="INTERNAL" && participated && s!=="CANCELLED"){
      buttons.push(["RESPONSE","Beri Tanggapan","btn-secondary",true,false]);
    }

    if(d==="OUTGOING"&&s==="READY_TO_ISSUE"&&handlesSecretariat)
      buttons.push(["PREPARE_ISSUE","Finalisasi Nomor","btn-primary"]);
    if(d==="OUTGOING"&&(secretariat?s==="WAITING_SIGNATURE"&&handlesSecretariat
      :s==="READY_TO_ISSUE"&&(user.role==="ROOT_ADMIN"||letter.created_by===user.id))) {
      const label=detail.letter.document_type===SPK_OUTGOING?"Terbitkan SPK"
        :detail.letter.document_type===INVOICE_OUTGOING?"Terbitkan Invoice":"Terbitkan Surat";
      buttons.push(["ISSUE",label,"btn-success",false,true]);
    }
    if(d==="OUTGOING"&&s==="ISSUED"&&handlesSecretariat&&!letter.sent_date)
      buttons.push(["MARK_SENT","Catat Pengiriman","btn-primary"]);
    if(!["CANCELLED","COMPLETED","ISSUED","REJECTED"].includes(s)&&(user.role==="ROOT_ADMIN"||detail.letter.created_by===user.id)) {
      buttons.push(["CANCEL","Batalkan","btn-danger",true]);
    }
    return buttons.map(b=><button key={b[0]} className={`btn ${b[2]}`} onClick={()=>startAction(b[0],b[1],Boolean(b[3]),Boolean(b[4]))}>{b[1]}</button>);
  }

  const generalAttachments=useMemo(()=>detail?.attachments?.filter((a:any)=>!a.letter_action_id)||[],[detail]);
  const processAttachmentsFor=(actionId:string)=>detail?.attachments?.filter((a:any)=>a.letter_action_id===actionId)||[];

  const pageDescription=direction==="INCOMING"
    ?"Registrasi surat eksternal yang diterima perusahaan, review, return, attachment, dan histori."
    :direction==="OUTGOING"
      ?"Susun draf, ikuti review Manager dan Dirops, lalu proses penerbitan setelah ACC Dirut."
      :"Dokumen internal yang dapat dibuat oleh seluruh role SIAP dan diajukan ke Manager tujuan beserta lampiran. Nota Dinas bukan lembar disposisi.";

  const currentYear=new Date().getFullYear();
  const yearOptions=Array.from({length:7},(_,i)=>String(currentYear-i));
  function resetFilters(){setQ("");setStatus("");setDocType("");setYear("");void load({q:"",status:"",docType:"",year:""})}

  return <main className="page">
    <div className="page-head"><div><h2>{titleFor(direction)}</h2><p>{pageDescription}</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>{direction==="OUTGOING"&&<a className="btn btn-secondary" href="/api/letters/outgoing-excel">↓ Export Excel</a>}{direction==="OUTGOING"&&user.role==="ROOT_ADMIN"&&<button className="btn btn-secondary" onClick={()=>{setImportOpen(true);setImportResult(null);setImportFile(null)}}>↑ Import Excel Lama</button>}{canCreate&&<button className="btn btn-primary" onClick={openCreate}>+ {createLabel}</button>}</div></div>

    {direction==="OUTGOING"&&<div className="notice" style={{marginBottom:13}}>
      {hasSecretariat?"Surat dengan alur Sekretariat masuk antrian penerbitan setelah ACC. Cek administrasi sebelum ACC mengikuti jenis surat."
        :"Pilih Manager reviewer saat membuat draf. Setelah ACC Dirut, penyusun dapat menerbitkan surat dari detail."}
    </div>}
    {direction==="INTERNAL"&&<div className="notice" style={{marginBottom:13}}><b>Nota Dinas dapat dibuat oleh seluruh role SIAP.</b><br/>Pembuat memilih Manager tujuan, mengisi perihal/ringkasan, dan dapat melampirkan dokumen pendukung. Manager dapat memberi tanggapan, menyelesaikan di levelnya, meneruskan ke Dirops, atau mengembalikan ke pembuat untuk revisi. Setiap tahap dapat membawa catatan dan lampiran tambahan. <b>Semua dokumen yang tersimpan dapat diunduh kembali dari Detail Nota Dinas.</b> Disposisi tetap digunakan untuk instruksi/tindak lanjut pimpinan kepada PIC, bukan sebagai pengganti Nota Dinas.</div>}

    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
    <div className="toolbar letter-filter-bar">
      <div className="search"><span>⌕</span><input value={q} onChange={e=>setQ(e.target.value)} placeholder={direction==="INTERNAL"?"Cari perihal, tujuan, pembuat...":"Cari nomor, perihal, pengirim/tujuan..."} onKeyDown={e=>e.key==="Enter"&&load()}/></div>
      {direction!=="INTERNAL"&&<select aria-label="Filter jenis dokumen" className="select filter-select" value={docType} onChange={e=>setDocType(e.target.value)}><option value="">Semua jenis dokumen</option>{typeOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
      <select aria-label="Filter status surat" className="select filter-select" value={status} onChange={e=>setStatus(e.target.value)}>
        <option value="">Semua status</option>
        {["DRAFT","SECRETARIAT_INTAKE","MANAGER_REVIEW","DIRECTOR_OPS_REVIEW","SECRETARIAT_REVIEW",
          "PRESIDENT_DIRECTOR_REVIEW","READY_TO_ISSUE","WAITING_SIGNATURE","APPROVED","ISSUED","SENT",
          "DISPOSED","IN_PROGRESS","COMPLETED","RETURNED_STAFF","REJECTED","CANCELLED"]
          .map(value=><option key={value} value={value}>{statusLabel(value)}</option>)}
      </select>
      <select className="select filter-select filter-year" value={year} onChange={e=>setYear(e.target.value)}><option value="">Semua tahun</option>{yearOptions.map(y=><option key={y} value={y}>{y}</option>)}</select>
      <button className="btn btn-primary" onClick={() => load()}>Terapkan</button>
      {direction!=="INTERNAL"&&canHandleSecretariat(user.role)&&
        <button type="button" className={"btn "+(queue?"btn-primary":"btn-secondary")} aria-pressed={queue}
          onClick={()=>{setQueue(!queue);void load({queue:!queue});}}>
          {queue?"Tampilkan Semua Surat":"Antrian Sekretariat"}
        </button>}
      {(q||status||docType||year)&&<button className="btn btn-secondary" onClick={resetFilters}>Reset</button>}
    </div>
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr>{direction!=="INTERNAL"&&<th>{direction==="INCOMING"?"Nomor Surat":"No."}</th>}<th>Jenis Dokumen</th><th>Perihal</th><th>{direction==="INCOMING"?"Pengirim":"Tujuan"}</th><th>Tanggal</th><th>Status</th><th>Tujuan Saat Ini</th><th>Sifat</th><th>Lampiran</th><th></th></tr></thead><tbody>
      {!loading&&rows.map(r=><tr key={r.id} className={`letter-row ${docTypeClass(r.document_type)}`}>{direction!=="INTERNAL"&&<td className="mono"><b>{direction==="OUTGOING"?(outgoingNumber(r)||"-"):(r.external_number||"-")}</b></td>}<td><span className={`badge letter-type-badge ${docTypeClass(r.document_type)}`}>{docLabel(r)}</span></td><td><b>{r.subject}</b>{r.legacy_import_key&&<span className="muted" style={{display:"block",fontSize:9.5,marginTop:3}}>Data Excel lama{r.legacy_number_conflict?" • cek nomor historis":""}</span>}</td><td>{direction==="INCOMING"?r.sender:r.recipient}</td><td>{fmtDate(r.letter_date)}</td><td><StatusBadge status={r.sent_date&&r.status==="ISSUED"?"SENT":r.status}/></td><td><b style={{fontSize:11}}>{currentTargetLabel(r)}</b></td><td><span className={`badge ${r.confidentiality==="RAHASIA"?"red":r.confidentiality==="PENTING"?"orange":"gray"}`}>{r.confidentiality}</span></td><td>{r.attachment_count}</td><td><button className="btn btn-secondary" onClick={()=>openDetail(r.id)}>Detail</button></td></tr>)}
      {!loading&&rows.length===0&&<tr><td colSpan={direction==="INTERNAL"?9:10}><div className="empty">Belum ada data.</div></td></tr>}
      {loading&&<tr><td colSpan={direction==="INTERNAL"?9:10}><div className="empty">Memuat...</div></td></tr>}
    </tbody></table></div></div>

    {importOpen&&direction==="OUTGOING"&&user.role==="ROOT_ADMIN"&&<Modal title="Import Form Persuratan ARU" subtitle="Pindahkan daftar Excel lama ke database SIAP tanpa mengubah nomor historisnya." onClose={()=>!importBusy&&setImportOpen(false)}>
      <form className="form-grid" onSubmit={importExcel}>
        <div className="field full"><div className="notice"><b>Langkahnya ringkas:</b><br/>1. Pilih <b>Form Persuratan ARU.xlsx</b>.<br/>2. Klik <b>Import ke Database</b>.<br/>3. Cek ringkasan hasil. Import ulang file yang sama aman: baris yang sudah pernah masuk akan diperbarui, bukan diduplikasi.</div></div>
        <div className="field full"><label>File Excel</label><input className="input" type="file" accept=".xlsx" onChange={e=>setImportFile(e.target.files?.[0]||null)} required/><span className="hint">Dibaca: Perjanjian Kerjasama, Surat Keluar- Direksi, Surat Keluar - Bag. Operasional, Purchase Order, dan Surat keluar- Bag. umum. Sheet Kwitansi tidak diimport.</span></div>
        <div className="field full"><div className="format-preview"><span>Nomor historis</span><b>Tetap seperti Excel (termasuk .1, .2)</b><span>Data tidak standar / duplikat</span><b>Tetap disimpan dan diberi penanda untuk pengecekan</b><span>Sumber utama setelah import</span><b>Database SIAP ARU</b></div></div>
        {importResult&&<div className="field full"><div className="success"><b>Import selesai.</b><br/>{importResult.processed} baris diproses • {importResult.inserted} baru • {importResult.updated} diperbarui • {importResult.ledgerLinked} nomor terhubung ledger • {importResult.conflicts} perlu pengecekan • {importResult.skipped} dilewati.</div>{importResult.issues?.length>0&&<details style={{marginTop:10}}><summary style={{cursor:"pointer",fontWeight:700}}>Lihat catatan import ({importResult.issues.length}{importResult.moreIssues?` + ${importResult.moreIssues} lainnya`:""})</summary><div className="notice" style={{marginTop:8,maxHeight:220,overflow:"auto"}}>{importResult.issues.map((x:string,i:number)=><div key={i}>• {x}</div>)}</div></details>}</div>}
        <div className="field full modal-actions"><button type="button" className="btn btn-secondary" disabled={importBusy} onClick={()=>setImportOpen(false)}>Tutup</button><button className="btn btn-primary" disabled={importBusy||!importFile}>{importBusy?"Mengimpor...":"Import ke Database"}</button></div>
      </form>
    </Modal>}

    {createOpen&&<Modal title={direction==="INCOMING"?createLabel+" Masuk":createLabel} subtitle={direction==="INTERNAL"?"Nota Dinas digunakan Staff untuk menyampaikan laporan/permohonan ke Manager/atasan.":direction==="OUTGOING"?"Draft disusun Staff. Nomor direservasi per jenis surat dan seluruh proses tercatat di audit log.":"Semua perubahan tercatat di audit log."} onClose={()=>!createBusy&&setCreateOpen(false)}>
      <form onSubmit={create} className="form-grid">
        {error&&<div className="field full error" role="alert">{error}</div>}
        <div className="field">
          <label>Jenis Dokumen</label>
          {direction==="INTERNAL"
            ? <><input type="hidden" name="document_type" value="NOTA_DINAS"/><div className="input">Nota Dinas</div></>
            : <select aria-label="Jenis Dokumen" className="select" name={createType==="__CUSTOM__"?undefined:"document_type"} required value={createType} onChange={e=>setCreateType(e.target.value)}>
                {typeOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}
                {direction==="INCOMING"&&<option value="__CUSTOM__">Jenis lainnya</option>}
              </select>}
        </div>
        {direction==="INCOMING"&&createType==="__CUSTOM__"&&<div className="field"><label>Nama jenis dokumen</label><input aria-label="Nama jenis dokumen" className="input" name="document_type" maxLength={80} required/></div>}
        {direction==="OUTGOING"&&<div className="field"><label>Format Nomor</label><select aria-label="Format Nomor" key={createType} className="select" name="number_format_id" required><option value="">Pilih format...</option>{formats.filter((f:any)=>f.document_type===createType).map((f:any)=><option value={f.id} key={f.id}>{f.name}</option>)}</select></div>}
        {direction==="OUTGOING"&&<div className="field"><label>Nomor Dasar Custom <span className="muted">(opsional)</span></label><input className="input" type="number" min="1" step="1" name="custom_number_base" placeholder="Otomatis"/><span className="hint">Contoh 135. Jika 135 sudah terpakai pada jenis/tahun yang sama, sistem memakai 135.1, 135.2, dst.</span></div>}
        {direction==="INCOMING"&&<>
          <div className="field"><label>Nomor Surat Asal</label><input className="input" name="external_number" required/></div>
          <div className="field"><label>Asal / Pengirim</label><input className="input" name="sender" required/></div>
          <div className="field"><label>Ditujukan Kepada</label><input className="input" name="recipient" maxLength={255}/></div>
          <div className="field full">
            <label>Tujuan Review Awal</label>
            <select className="select" name="routing_target_user_id" required>
              <option value="">Pilih penerima pertama...</option>
              {reviewers.map((r:any)=>
                <option key={r.id} value={r.id}>
                  {r.name}{r.unit_name?` — ${r.unit_name}`:""}
                </option>
              )}
            </select>
            <span className="hint">
              {hasSecretariat?"Pilih pihak yang dituju untuk telaah. Sekretariat dapat memperbarui tujuan saat registrasi.":"Pilih Manager yang menangani surat ini."}
            </span>
          </div>
        </>}
        {direction==="OUTGOING"&&<>
          <div className="field"><label>Tujuan Surat</label><input className="input" name="recipient" required/></div>
          <div className="field">
            <label>Manager Reviewer</label>
            <select className="select" name="routing_target_user_id" required>
              <option value="">Pilih Manager...</option>
              {reviewers.map((r:any)=>
                <option key={r.id} value={r.id}>
                  {r.name}{r.unit_name?` — ${r.unit_name}`:""}
                </option>
              )}
            </select>
            <span className="hint">Draft diajukan ke Manager ini, lalu Dirops → Dirut.</span>
          </div>
        </>}
        {direction==="INTERNAL"&&
          <div className="field">
            <label>Tujuan Review Awal</label>
            <select className="select" name="routing_target_user_id" required>
              <option value="">Pilih penerima...</option>
              {reviewers.map((r:any)=>
                <option key={r.id} value={r.id}>
                  {r.name}{r.unit_name?` — ${r.unit_name}`:""}
                </option>
              )}
            </select>
            <span className="hint">
              Nota Dinas selalu masuk ke Manager yang dipilih. Manager dapat menyelesaikan di levelnya atau meneruskan ke Dirops.
            </span>
          </div>}
        <div className="field"><label>{direction==="INTERNAL"?"Tanggal Nota Dinas":"Tanggal Surat"}</label><input className="input" type="date" name="letter_date" defaultValue={today()} required/>{direction==="OUTGOING"&&<span className="hint">Backdate diperbolehkan. Nomor existing tidak digeser; collision menghasilkan .1, .2, dst.</span>}</div>
        {direction==="INCOMING"&&<div className="field"><label>Tanggal Diterima</label><input className="input" type="date" name="received_date" defaultValue={today()} required/></div>}
        <div className="field full"><label>Perihal</label><input className="input" name="subject" required/></div>
        <div className="field"><label>Sifat Dokumen</label><select className="select" name="confidentiality" defaultValue="BIASA"><option>BIASA</option><option>PENTING</option><option>RAHASIA</option></select></div>
        <div className="field"><label>Visibilitas</label><label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500}}><input type="checkbox" key={businessForm?"private":"regular"} name="is_public" defaultChecked={direction!=="INTERNAL"&&!businessForm&&!sourceDispositionId&&!sourceLetter.length}/> {direction==="INTERNAL"?"Dapat dilihat lebih luas oleh user persuratan":"Public untuk user yang punya akses persuratan"}</label></div>
        <div className="field full"><label>{direction==="INTERNAL"?"Isi / Ringkasan Nota Dinas":"Ringkasan / Isi Ringkas"}</label><textarea className="textarea" name="summary"/></div>
        <div className="field full"><label>Catatan</label><textarea className="textarea" name="notes" placeholder={direction==="INTERNAL"?"Keterangan tambahan untuk Manager":"Catatan awal proses"}/></div>
        {direction==="OUTGOING"&&(sourceDispositionId
          ?<div className="field full notice">Draf ini ditautkan ke Disposisi asal.</div>
          :<div className="field full">
            <ReferencePicker kind="source" selected={sourceLetter} onChange={setSourceLetter} limit={1}/>
          </div>)}
        {businessForm&&<BusinessDocumentFields key={createType} documentType={createType} outgoing={direction==="OUTGOING"}/>}
        <div className="field full"><label>{incomingFileRequired?"Dokumen Asli (wajib)":direction==="OUTGOING"?"File Draft / Dokumen Utama (opsional)":direction==="INTERNAL"?"Dokumen Utama / Pengantar (opsional)":"Surat Asli (opsional)"}</label><input aria-label="Dokumen asli" className="input" type="file" name="original_file" required={incomingFileRequired} accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"/><span className="hint">Maksimal 10 MB. Dokumen original disimpan tanpa kompresi. Lampiran proses/tambahan dikompresi bila efektif.</span></div>
        <div className="field full"><label>Lampiran Tambahan <span className="muted">(opsional, maksimal 5 file)</span></label><input className="input" type="file" name="additional_files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"/><span className="hint">Lampiran tambahan maksimal 10 MB per file dan dikompresi otomatis bila hasilnya lebih kecil. Cocok untuk data pendukung, hasil telaah, atau bukti proses.</span></div>
        <div className="field full" style={{display:"flex",justifyContent:"flex-end",gap:8,flexDirection:"row"}}><button type="button" className="btn btn-secondary" disabled={createBusy} onClick={()=>setCreateOpen(false)}>Batal</button><button className="btn btn-primary" disabled={createBusy||sourceLoading}>{createBusy?"Menyimpan...":direction==="INCOMING"?(incomingToSecretariat?"Kirim ke Sekretariat":"Registrasi & Teruskan"):"Simpan Draft"}</button></div>
      </form>
    </Modal>}

    {detailOpen&&detail&&<Modal title={detail.letter.subject} subtitle={direction==="OUTGOING"?`No. ${outgoingNumber(detail.letter)||"-"} • ${docLabel(detail.letter)}`:direction==="INTERNAL"?`${docLabel(detail.letter)} • kepada ${detail.letter.recipient||"Manager"}`:(detail.letter.external_number||"Detail surat")} onClose={()=>setDetailOpen(false)}>
      <div className="grid-2">
        <div>
          <div className="kpi-list">
            <div className="kpi-row"><span>Status</span><StatusBadge status={detail.letter.sent_date&&detail.letter.status==="ISSUED"?"SENT":detail.letter.status}/></div>
            <div className="kpi-row"><span>Tujuan Saat Ini</span><b>{detail.letter.owner_name?`${detail.letter.owner_name}${detail.letter.owner_unit?` — ${detail.letter.owner_unit}`:""}`:currentTargetLabel(detail.letter)}</b></div>
            {detail.letter.routing_target_name&&<div className="kpi-row"><span>Tujuan Awal</span><b>{detail.letter.routing_target_name}{detail.letter.routing_target_unit?` — ${detail.letter.routing_target_unit}`:""}</b></div>}
            <div className="kpi-row"><span>Jenis Dokumen</span><b>{docLabel(detail.letter)}</b></div>
            {direction==="OUTGOING"&&<div className="kpi-row"><span>Nomor Dokumen</span><b className="mono">{detail.letter.letter_number||outgoingNumber(detail.letter)||"-"}</b></div>}
            {detail.letter.recipient&&<div className="kpi-row"><span>Ditujukan Kepada</span><b>{detail.letter.recipient}</b></div>}
            {detail.sourceLetter&&<div className="kpi-row"><span>Dokumen Asal</span>
              <a href={"/letters/"+({INCOMING:"incoming",INTERNAL:"internal",OUTGOING:"outgoing"} as Record<string,string>)[detail.sourceLetter.direction]+"?letter_id="+encodeURIComponent(detail.sourceLetter.id)}>
                {detail.sourceLetter.number||detail.sourceLetter.subject}
              </a></div>}
            {detail.sourceDisposition&&<div className="kpi-row"><span>Penugasan Asal</span>
              <a href={"/dispositions?disposition_id="+encodeURIComponent(detail.sourceDisposition.id)}>Buka Disposisi</a>
            </div>}
            <div className="kpi-row"><span>Tanggal</span><b>{fmtDate(detail.letter.letter_date)}</b></div>
            {direction==="OUTGOING"&&detail.letter.issued_date&&<div className="kpi-row"><span>Tanggal Terbit</span><b>{fmtDate(detail.letter.issued_date)}</b></div>}
            {detail.letter.sent_date&&<div className="kpi-row"><span>Tanggal Kirim</span><b>{fmtDate(detail.letter.sent_date)}</b></div>}
            <div className="kpi-row"><span>Sifat</span><b>{detail.letter.confidentiality}</b></div>
            {direction!=="INTERNAL"&&<div className="kpi-row"><span>Backdate</span><b>{detail.letter.is_backdated?"Ya":"Tidak"}</b></div>}
            <div className="kpi-row"><span>Dibuat oleh</span><b>{detail.letter.creator_name}</b></div>
            {direction==="OUTGOING"&&detail.letter.legacy_sheet_name&&<div className="kpi-row"><span>Sumber Historis</span><b>{detail.letter.legacy_sheet_name} • baris {detail.letter.legacy_row_no}</b></div>}
          </div>
          {direction==="OUTGOING"&&detail.letter.legacy_number_conflict===1&&<div className="notice" style={{marginTop:13}}><b>Nomor historis dipertahankan apa adanya.</b> Slot ini terdeteksi duplikat/tidak standar pada workbook lama, sehingga tidak dipakai untuk menggeser penomoran otomatis baru.</div>}
          {direction==="OUTGOING"&&detail.letter.legacy_file_url&&<div className="card" style={{boxShadow:"none",marginTop:13}}><div className="card-body"><b>Referensi File Lama</b><p className="muted" style={{marginTop:4}}>Nilai dari kolom Link File pada workbook lama.</p>{/^https?:\/\//i.test(String(detail.letter.legacy_file_url))?<a className="btn btn-secondary" href={String(detail.letter.legacy_file_url)} target="_blank" rel="noreferrer">Buka Link Lama ↗</a>:<div className="notice" style={{marginTop:8}}>{String(detail.letter.legacy_file_url)}</div>}</div></div>}
          {direction==="OUTGOING"&&detail.letter.status==="READY_TO_ISSUE"&&<div className="success" style={{marginTop:13}}><b>ACC final selesai.</b> {detail.letter.uses_secretariat?"Sekretariat memfinalisasi nomor dan menyiapkan tanda tangan.":"Penyusun dapat menerbitkan surat dari detail ini."}</div>}
          {direction==="OUTGOING"&&detail.letter.status==="RETURNED_STAFF"&&<div className="error" style={{marginTop:13}}><b>Dikembalikan ke Staff.</b> Baca catatan reviewer pada riwayat, revisi draft, lalu ajukan kembali mulai dari Manager.</div>}
          <div style={{marginTop:13}} className="notice">{detail.letter.summary||"Belum ada ringkasan."}</div>
          {detail.business&&<BusinessDocumentSummary details={detail.business} documentType={detail.letter.document_type}/>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:13}}>
            {canEditDetail()&&<button className="btn btn-secondary" onClick={openEdit}>Edit Metadata</button>}
            {direction==="OUTGOING"&&detail.business?.invoice&&!["CANCELLED","REJECTED"].includes(detail.letter.status)&&
              <a className="btn btn-secondary" href={"/print/letters/"+detail.letter.id} target="_blank" rel="noreferrer">Pratinjau Invoice ↗</a>}
            {direction==="OUTGOING"&&detail.letter.document_type===SPK_OUTGOING&&detail.letter.status===(detail.letter.uses_secretariat?"WAITING_SIGNATURE":"READY_TO_ISSUE")&&
              <a className="btn btn-secondary" href={"/print/letters/"+detail.letter.id} target="_blank" rel="noreferrer">Cetak SPK untuk TTD ↗</a>}
            {canDispositionFromDetail()&&<a className="btn btn-primary" href={`/dispositions?letter_id=${detail.letter.id}`}>+ Buat Disposisi</a>}
            {direction!=="OUTGOING"&&canDraftOutgoing&&!["CANCELLED","REJECTED"].includes(detail.letter.status)&&
              <a className="btn btn-secondary" href={"/letters/outgoing?source_letter_id="+encodeURIComponent(detail.letter.id)}>Buat Draf Surat Keluar</a>}
            {actionButtons()}
          </div>

          <div className="card" style={{boxShadow:"none",marginTop:14}}>
            <div className="card-head"><div><h3>Dokumen & Lampiran Umum</h3><p>Dokumen utama disimpan apa adanya. Lampiran tambahan dikompresi hanya bila hasilnya lebih kecil. Semua file di bagian ini dapat diunduh kembali sesuai hak akses.</p></div></div>
            <div className="card-body">
              {generalAttachments.map((a:any)=><div className="kpi-row" key={a.id}><div><b>{a.original_name}</b><span style={{display:"block"}}>{a.attachment_kind} • {size(Number(a.original_size))}{a.is_compressed?" • compressed":""} • {a.uploaded_by_name}</span></div><a className="btn btn-secondary" href={`/api/attachments/${a.id}`} download>↓ Unduh</a></div>)}
              {!generalAttachments.length&&<div className="empty">Belum ada lampiran umum.</div>}
              {error&&!editOpen&&!pendingAction&&<div className="error" role="alert">{error}</div>}
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                {(!detail.letter.uses_secretariat||direction!=="OUTGOING"||["DRAFT","RETURNED_STAFF"].includes(detail.letter.status))
                  &&(detail.letter.created_by===user.id||user.role==="ROOT_ADMIN"||
                  (detail.letter.status==="SECRETARIAT_INTAKE"&&canHandleSecretariat(user.role)))&&
                  <label className="btn btn-secondary">+ Dokumen Utama<input hidden type="file" aria-label="Unggah dokumen utama" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" onChange={async e=>{
                    const input=e.currentTarget;
                    const file=input.files?.[0];
                    if(file) await upload("ORIGINAL",file);
                    input.value="";
                  }}/></label>}
                <label className="btn btn-secondary">+ Lampiran Tambahan<input hidden type="file" aria-label="Unggah lampiran tambahan" multiple onChange={async e=>{
                  const input=e.currentTarget;
                  for(const file of Array.from(input.files||[]).slice(0,5)) await upload("ADDITIONAL",file);
                  input.value="";
                }}/></label>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 style={{fontSize:13}}>Riwayat Proses & Lampiran</h3>
          <p className="muted" style={{fontSize:11}}>Setiap submit, approval, return, penerbitan, atau pembatalan dapat membawa catatan dan maksimal 5 lampiran proses.</p>
          <div className="timeline">{detail.actions?.map((a:any,i:number)=>{
            const af=processAttachmentsFor(a.id);
            return <div className="timeline-row" key={a.id}><div className="timeline-dot">{i+1}</div><div style={{width:"100%"}}><b>{humanAction(a.action)} • {a.actor_name}</b><p>{a.from_status?`${a.from_status} → ${a.to_status}`:a.to_status}{a.comment?` • ${a.comment}`:""}</p>{af.length>0&&<div style={{display:"grid",gap:6,marginTop:7}}>{af.map((f:any)=><div key={f.id} style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",padding:"7px 9px",border:"1px solid var(--line)",borderRadius:9}}><span style={{fontSize:10.5}}><b>{f.original_name}</b><br/><span className="muted">{size(Number(f.original_size))}{f.is_compressed?" • compressed":""}</span></span><a className="btn btn-secondary" href={`/api/attachments/${f.id}`} download>↓ Unduh</a></div>)}</div>}</div></div>
          })}</div>
        </div>
      </div>
    </Modal>}

    {editOpen&&detail&&<Modal title="Edit Data Dokumen" subtitle="Perbarui data dan rujukan dokumen." onClose={()=>setEditOpen(false)}>
      <form className="form-grid" onSubmit={editLetter}>
        {error&&<div className="field full error" role="alert">{error}</div>}
        <div className="field full"><label>Perihal</label><input className="input" name="subject" defaultValue={detail.letter.subject} required/></div>
        {direction==="INCOMING"?<div className="field"><label>Asal / Pengirim</label><input className="input" name="sender" defaultValue={detail.letter.sender||""}/></div>:<div className="field"><label>Tujuan</label><input className="input" name="recipient" defaultValue={detail.letter.recipient||""}/></div>}
        {direction==="INCOMING"&&<div className="field">
          <label>Ditujukan Kepada</label><input className="input" name="recipient" defaultValue={detail.letter.recipient||""}/>
        </div>}
        {direction==="INCOMING"&&(detail.business||detail.letter.status==="SECRETARIAT_INTAKE")&&<>
          <div className="field"><label>Nomor Dokumen Asal</label><input className="input" name="external_number" defaultValue={detail.letter.external_number||""} required/></div>
          <div className="field"><label>Tanggal Diterima</label><input className="input" type="date" name="received_date" defaultValue={String(detail.letter.received_date||"").slice(0,10)} required/></div>
        </>}
        <div className="field"><label>Sifat</label><select className="select" name="confidentiality" defaultValue={detail.letter.confidentiality}><option>BIASA</option><option>PENTING</option><option>RAHASIA</option></select></div>
        <div className="field full"><label>Ringkasan</label><textarea className="textarea" name="summary" defaultValue={detail.letter.summary||""}/></div>
        <div className="field full"><label>Catatan</label><textarea className="textarea" name="notes" defaultValue={detail.letter.notes||""}/></div>
        <div className="field full"><label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500}}><input type="checkbox" name="is_public" defaultChecked={Boolean(detail.letter.is_public)}/> Public</label><span className="hint">Dokumen RAHASIA tidak dapat dibuat public. Root Admin tetap dapat melihat seluruh data.</span></div>
        {canChangeSource()&&<div className="field full">
          <ReferencePicker kind="source" letterId={detail.letter.id} selected={sourceLetter} onChange={setSourceLetter} limit={1}/>
        </div>}
        {detail.business&&<BusinessDocumentFields documentType={detail.letter.document_type} outgoing={direction==="OUTGOING"} initial={detail.business} letterId={detail.letter.id}/>}
        <div className="field full" style={{display:"flex",flexDirection:"row",justifyContent:"flex-end",gap:8}}><button type="button" className="btn btn-secondary" onClick={()=>setEditOpen(false)}>Batal</button><button className="btn btn-primary">Simpan Perubahan</button></div>
      </form>
    </Modal>}

    {pendingAction&&detail&&<Modal title={pendingAction.label} subtitle="Catatan dan lampiran pada aksi ini akan tersimpan permanen pada riwayat proses dan Audit Log." onClose={()=>!actionBusy&&setPendingAction(null)}>
      <form className="form-grid" onSubmit={submitAction}>
        {error&&<div className="field full error" role="alert">{error}</div>}
        {pendingAction.action==="REGISTER_INCOMING"&&<div className="field full">
          <label>Teruskan Kepada</label>
          <select aria-label="Teruskan kepada" className="select" name="routing_target_user_id" defaultValue={detail.letter.routing_target_user_id||""} required>
            <option value="">Pilih tujuan...</option>
            {routingUsers.filter(isReviewer).map(account=><option key={account.id} value={account.id}>{account.name}{account.unit_name?" · "+account.unit_name:""}</option>)}
          </select>
        </div>}
        {pendingAction.action==="PREPARE_ISSUE"&&<div className="field full notice"><b>Nomor surat</b> {detail.letter.letter_number}</div>}
        {pendingAction.action==="MARK_SENT"&&<div className="field">
          <label>Tanggal Kirim</label><input aria-label="Tanggal kirim" className="input" type="date" name="sent_date" defaultValue={today()}
            min={String(detail.letter.issued_date||"").slice(0,10)} required/>
        </div>}
        {pendingAction.issue&&<div className="field"><label>Tanggal Terbit</label><input className="input" type="date" name="issued_date" defaultValue={today()} required/><span className="hint">Setelah diterbitkan, status surat menjadi ISSUED dan nomor ledger dikunci sebagai terbit.</span></div>}
        <div className="field full"><label>{pendingAction.requiredComment?"Catatan / Alasan (wajib)":"Catatan Proses (opsional)"}</label><textarea className="textarea" name="comment" required={pendingAction.requiredComment} placeholder={pendingAction.action==="RETURN"?"Jelaskan apa yang harus direvisi oleh Staff...":pendingAction.action==="ISSUE"?"Contoh: Surat final telah ditandatangani dan siap dikirim.":"Catatan keputusan / arahan tambahan..."}/></div>
        {signedIssue&&<>
          <div className="field"><label>Metode Tanda Tangan</label><select aria-label="Metode tanda tangan" className="select" name="signature_method" required defaultValue="">
            <option value="">Pilih metode...</option><option value="DIGITAL">Digital</option><option value="BASAH">Basah</option>
          </select></div>
          <div className="field full"><label>Naskah Bertanda Tangan</label><input aria-label="Naskah bertanda tangan" className="input" type="file" name="signed_file" accept=".pdf,.jpg,.jpeg,.png" required/>
            <span className="hint">Unggah PDF dari layanan TTD digital atau hasil pindai tanda tangan basah. Maksimal 10 MB.</span>
          </div>
        </>}
        <div className="field full"><label>Lampiran Proses <span className="muted">(opsional, maksimal {actionFileLimit} file)</span></label><input className="input" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv" onChange={e=>setActionFiles(Array.from(e.target.files||[]).slice(0,actionFileLimit))}/><span className="hint">Maksimal 10 MB per file. Lampiran proses dikompresi bila hasil kompresi lebih kecil dan tetap dapat di-download dari riwayat.</span>{actionFiles.length>0&&<div className="notice" style={{marginTop:7}}>{actionFiles.map(f=><div key={`${f.name}-${f.size}`}>{f.name} • {size(f.size)}</div>)}</div>}</div>
        <div className="field full" style={{display:"flex",flexDirection:"row",justifyContent:"flex-end",gap:8}}><button type="button" className="btn btn-secondary" disabled={actionBusy} onClick={()=>setPendingAction(null)}>Batal</button><button className={`btn ${["RETURN","RETURN_PREVIOUS","CANCEL","REJECT"].includes(pendingAction.action)?"btn-danger":"btn-primary"}`} disabled={actionBusy}>{actionBusy?"Memproses...":pendingAction.label}</button></div>
      </form>
    </Modal>}
  </main>;
}
