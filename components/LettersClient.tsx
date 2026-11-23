"use client";

import { FormEvent,useEffect,useMemo,useRef,useState } from "react";
import type { Role, SessionUser } from "@/lib/types";
import { PURGE_CONFIRMATION, REVIEW_ROLES, canHandleSecretariat, canReceiveDirectorNota, canRequestNotaDraft, isNotaDirector,
  formatLetterFileSize as size, letterDirectionLabel, reviewRole } from "@/lib/correspondence-workflow";
import Modal from "@/components/Modal";
import StatusBadge, { statusLabel } from "@/components/StatusBadge";
import BusinessDocumentFields, { BusinessDocumentSummary, ReferencePicker } from "@/components/BusinessDocumentFields";
import { INVOICE_INCOMING, INVOICE_OUTGOING, SPK_INCOMING, SPK_OUTGOING, isBusinessDocument, isInvoice, type DocumentReference } from "@/lib/business-documents";

import { DELIVERY_METHODS, MANAGER_SCOPES, jakartaDate, staffUnit, unitManagerScope, type ManagerScope } from "@/lib/v11-workflow";
import PaymentDocumentsPanel from "@/components/PaymentDocumentsPanel";
import ConfidentialityBadge from "@/components/ConfidentialityBadge";
import AttachmentActions from "@/components/AttachmentActions";
import LetterHistory from "@/components/LetterHistory";
import SearchableSelect from "@/components/SearchableSelect";
import { formatWorkflowTime } from "@/lib/workflow-time";
import AttachmentSandbox from "@/components/AttachmentSandbox";
import OutgoingSignaturePanel from "@/components/OutgoingSignaturePanel";
import NotaDocumentPanel from "@/components/NotaDocumentPanel";
import CorrespondenceLayoutFields from "@/components/CorrespondenceLayoutFields";
import OutgoingDocumentPanel from "@/components/OutgoingDocumentPanel";
import { emptyCorrespondenceLayout } from "@/lib/correspondence-layout";
import { NOTA_NUMBER_CODES, type NumberSourceSettings } from "@/lib/correspondence-number-source";
import NotaResponses from "@/components/NotaResponses";
import NotaTargetFields from "@/components/NotaTargetFields";
import { PersekotFields, ReceiptFields, UnitField, WorkflowSummary } from "@/components/V11LetterFields";

type TrashOperation = "trash" | "restore" | "purge";
type Direction="INCOMING"|"OUTGOING"|"INTERNAL";
type Props={direction:Direction;user:SessionUser};
type PendingAction={action:string;label:string;requiredComment?:boolean;issue?:boolean};

type RoutingUser={id:string;name:string;role:Role;unit_name:string|null;v11_scope?:ManagerScope};
type ReplyRecipient = { id: string; name: string; unit: string | null };
type ReplyOrigin = {
  id: string; subject: string; confidentiality: string;
  recipient: ReplyRecipient | null;
  authors: Array<{ id: string; name: string; recipient: ReplyRecipient }>;
};
const isReviewer=(account:RoutingUser)=>REVIEW_ROLES.some(role=>role===account.role);
const notaOption = (account: Pick<RoutingUser, "id" | "name" | "unit_name"> & { email?: string }) => ({
  value: account.id, label: [account.name, account.unit_name].filter(Boolean).join(" — "), search: account.email,
});

const today=jakartaDate;
const fmtDate=(v:any)=>v?new Date(String(v).slice(0,10)+"T00:00:00").toLocaleDateString("id-ID",{day:"2-digit",month:"short",year:"numeric"}):"-";
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
const docLabel=(r:any)=>r.v11_kind==="NOTA_REPLY"?"Balasan Nota Dinas"
  :r.v11_kind==="NOTA_DIRECT"?"Nota Dinas Direksi":r.document_type==="NOTA_DINAS"?"Nota Dinas":r.format_name||DOC_LABELS[r.document_type]||String(r.document_type||"-").replace(/_/g," ");
const directNotaSent=(kind:string,status:string)=>["NOTA_REPLY","NOTA_DIRECT"].includes(kind)&&status==="COMPLETED";
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
export default function LettersClient({direction,user}:Props){
  const [rows,setRows]=useState<any[]>([]);
  const [formats,setFormats]=useState<any[]>([]);
  const [documentTypes,setDocumentTypes]=useState<any[]>([]);
  const [routingUsers,setRoutingUsers]=useState<RoutingUser[]>([]);
  const [v11Enabled,setV11Enabled]=useState(false);
  const [notaKind,setNotaKind]=useState("NOTA");
  const persekot=notaKind==="PERSEKOT";
  const [signatureMethod,setSignatureMethod]=useState("");
  const [signingReady,setSigningReady]=useState(false);
  const [queue,setQueue]=useState(false);
  const isRoot=user.role==="ROOT_ADMIN";
  const [trash,setTrash]=useState(false);
  const [trashTarget,setTrashTarget]=useState<{id:string;subject:string;operation:TrashOperation}|null>(null);
  const [pendingCleanup,setPendingCleanup]=useState(0);
  const [cleanupBusy,setCleanupBusy]=useState(false);
  const [trashBusy,setTrashBusy]=useState(false);
  const listRequest=useRef<AbortController|null>(null);
  const [recipients,setRecipients]=useState({defaultRecipient:"PT Aru Raharja",recipients:["PT Aru Raharja"]});
  const [formatId,setFormatId]=useState("");
  const [letterDate,setLetterDate]=useState(today);
  const [customBase,setCustomBase]=useState("");
  const [numberPreview,setNumberPreview]=useState<{rendered:string;highestBase:number;year:number;source:NumberSourceSettings["source"]}|null>(null);
  const [numberError,setNumberError]=useState("");
  const [sourceLetter,setSourceLetter]=useState<DocumentReference[]>([]);
  const [sourceDispositionId,setSourceDispositionId]=useState("");
  const [sourceLoading,setSourceLoading]=useState(false);
  const [notaAuthor,setNotaAuthor]=useState("");
  const [replyOrigin,setReplyOrigin]=useState<ReplyOrigin|null>(null);
  const hasSecretariat=routingUsers.some(account=>account.role==="SECRETARIAT");
  const incomingToSecretariat=direction==="INCOMING"&&(v11Enabled||(hasSecretariat&&!canHandleSecretariat(user.role)));
  const officialManagers=routingUsers.filter(account=>account.role==="MANAGER"&&account.v11_scope);
  const directorAccounts=routingUsers.filter(account=>isNotaDirector(account.role));
  const noteAuthorRole=routingUsers.find(account=>account.id===notaAuthor)?.role || user.role;
  const managerNota=v11Enabled&&direction==="INTERNAL"&&noteAuthorRole==="MANAGER";
  const directingNota=v11Enabled&&direction==="INTERNAL"&&isNotaDirector(noteAuthorRole);
  const staffManagerScope=unitManagerScope(staffUnit(user.unit_name));
  const preparableAuthors=officialManagers.filter(account=>!staffManagerScope||account.v11_scope===staffManagerScope);
  const requestScope=officialManagers.find(account=>account.id===user.id)?.v11_scope;
  const draftStaff=routingUsers.filter(account=>{
    if(account.role!=="STAFF") return false;
    if(user.role!=="MANAGER") return true;
    const scope=unitManagerScope(staffUnit(account.unit_name));
    return Boolean(requestScope&&(!scope||scope===requestScope));
  });
  const financeManager=officialManagers.some(account=>account.id===user.id&&account.v11_scope==="KSU");
  const reviewers=v11Enabled
    ? managerNota ? directorAccounts : officialManagers
    : routingUsers.filter(account=>direction==="INCOMING"&&hasSecretariat ? isReviewer(account) : account.role==="MANAGER");
  const reviewerLabel=(account:RoutingUser)=>account.v11_scope ? MANAGER_SCOPES[account.v11_scope]
    : [account.name,account.unit_name].filter(Boolean).join(" — ");
  const canDraftOutgoing=user.role==="STAFF"||user.role==="ROOT_ADMIN";
  const [q,setQ]=useState("");
  const [status,setStatus]=useState("");
  const [docType,setDocType]=useState("");
  const [year,setYear]=useState("");
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [createOpen,setCreateOpen]=useState(false);
  const [draftRequestOpen,setDraftRequestOpen]=useState(false);
  const [documentSource,setDocumentSource]=useState<"GENERATED"|"UPLOAD">("GENERATED");
  const [layout,setLayout]=useState(emptyCorrespondenceLayout);
  const [detail,setDetail]=useState<any>(null);
  const [detailOpen,setDetailOpen]=useState(false);
  const [editOpen,setEditOpen]=useState(false);
  const [createType,setCreateType]=useState(direction==="INCOMING"?"SURAT_MASUK_UMUM":"SURAT_UMUM");
  const notaFormats=formats.filter(format=>NOTA_NUMBER_CODES.some(code=>code===format.code));
  const supportsSystemDraft=direction==="OUTGOING"||(direction==="INTERNAL"&&v11Enabled);
  const selectedFormatId=direction==="INTERNAL"
    ? formatId || NOTA_NUMBER_CODES.map(code=>notaFormats.find(format=>format.code===code)?.id).find(Boolean) || ""
    : formatId;
  const [createBusy,setCreateBusy]=useState(false);
  const [pendingAction,setPendingAction]=useState<PendingAction|null>(null);
  const [actionFiles,setActionFiles]=useState<File[]>([]);
  const [actionBusy,setActionBusy]=useState(false);
  const [importOpen,setImportOpen]=useState(false);
  const [importFile,setImportFile]=useState<File|null>(null);
  const [importBusy,setImportBusy]=useState(false);
  const [importResult,setImportResult]=useState<any>(null);

  async function load(filters?:{q?:string;status?:string;docType?:string;year?:string;queue?:boolean;trash?:boolean}){
    listRequest.current?.abort();
    const controller=new AbortController();
    listRequest.current=controller;
    setLoading(true);setError("");
    const fq=filters?.q??q, fs=filters?.status??status, ft=filters?.docType??docType, fy=filters?.year??year;
    const p=new URLSearchParams({direction,limit:direction==="OUTGOING"?"2000":"500"});
    if(fq)p.set("q",fq);if(fs)p.set("status",fs);if(ft)p.set("document_type",ft);if(fy)p.set("year",fy);
    if(filters?.trash??trash) p.set("trash","1");
    else if(filters?.queue??queue) p.set("queue","secretariat");
    try {
      const res=await fetch(`/api/letters?${p}`,{signal:controller.signal,cache:"no-store"});
      const j=await res.json();
      if(controller.signal.aborted) return;
      if(j.ok) setRows(j.data);
      else {setRows([]);setError(j.error||"Daftar surat belum dapat dimuat.");}
    } catch {
      if(!controller.signal.aborted) {setRows([]);setError("Daftar surat belum dapat dimuat.");}
    } finally {
      if(!controller.signal.aborted) setLoading(false);
    }
  }
  async function loadFormats(){
    const typeRequest = direction==="INTERNAL" ? Promise.resolve(null) : fetch("/api/admin/document-types?direction=" + direction + "&active=1");
    const formatRequest = direction!=="INCOMING" ? fetch("/api/admin/number-formats") : Promise.resolve(null);
    const [typeResponse, formatResponse] = await Promise.all([typeRequest, formatRequest]);
    if (typeResponse?.ok) {
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

    if(j.ok) { setRoutingUsers(j.data); setV11Enabled(Boolean(j.v11Enabled)); }
  }

  useEffect(()=>{
    void load();
    void loadFormats();
    void loadReviewers();
    if(direction==="INCOMING") void fetch("/api/admin/correspondence-settings")
      .then(response=>response.ok?response.json():null)
      .then(result=>{if(result?.data)setRecipients(result.data);})
      .catch(()=>{});
    return ()=>listRequest.current?.abort();
  },[direction]);

  useEffect(()=>{
    setNumberPreview(null);
    setNumberError("");
    if(!supportsSystemDraft||!createOpen||!selectedFormatId||!letterDate) return;
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      const params=new URLSearchParams({format_id:selectedFormatId,date:letterDate,base:customBase});
      void fetch("/api/admin/number-formats/preview?"+params,{signal:controller.signal})
        .then(response=>response.json())
        .then(result=>{
          if(controller.signal.aborted) return;
          if(result.ok) setNumberPreview(result.data);
          else setNumberError(result.error||"Nomor belum dapat diperkirakan.");
        }).catch(()=>{if(!controller.signal.aborted)setNumberError("Pratinjau nomor belum dapat dimuat.");});
    },180);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[supportsSystemDraft,createOpen,selectedFormatId,letterDate,customBase]);

  useEffect(()=>{
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
    setNotaKind("NOTA");
    setDocumentSource("GENERATED");
    setLayout(emptyCorrespondenceLayout());
    setNotaAuthor("");
    setReplyOrigin(null);
    setFormatId("");
    setLetterDate(today());
    setCustomBase("");
    setSourceLetter([]);
    setSourceDispositionId("");
    setError("");
    setCreateOpen(true);
  }

  function openNotaReply() {
    if (!detail?.notaRouting) return;
    const { replyRecipient, replyAuthors } = detail.notaRouting;
    const { id, subject, confidentiality } = detail.letter;
    setDetailOpen(false);
    openCreate();
    setReplyOrigin({id, subject, confidentiality, recipient:replyRecipient, authors:replyAuthors});
  }

  const directNotaForm=directingNota&&notaKind==="NOTA";
  const replyRecipient=replyOrigin?.recipient ?? replyOrigin?.authors.find(account=>account.id===notaAuthor)?.recipient;
  const canAskStaff=direction==="INTERNAL"&&v11Enabled&&canRequestNotaDraft(user.role);

  function notaOptions(role: Role, authorId: string, direct: boolean) {
    const available=routingUsers.filter(account=>account.id!==authorId&&(!direct||canReceiveDirectorNota(role,account.role)));
    const primary=direct?available:role==="MANAGER"?directorAccounts:officialManagers;
    return { primaryOptions: primary.map(notaOption), additionalOptions: available.map(notaOption) };
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
  const incomingFileRequired=direction==="INCOMING"&&(businessForm||v11Enabled);
  const outgoingSigned=direction==="OUTGOING"&&detail?.attachments?.find((file:any)=>file.id===detail.v11?.signature_attachment_id);
  const signedIssue=Boolean(pendingAction?.issue&&(outgoingSigned||signingReady||detail?.letter.uses_secretariat||(detail?.letter.document_type===SPK_OUTGOING&&detail?.business?.managed)));
  const actionFileLimit=signedIssue || (detail?.v11&&["MARK_SENT","REGISTER_INCOMING"].includes(pendingAction?.action||"")) ? 4 : 5;

  function formObject(fd:FormData){
    const out:any={};
    fd.forEach((value,key)=>{ out[key]=value; });
    if(typeof out.business==="string") out.business=JSON.parse(out.business);
    if(typeof out.nota_recipient_ids==="string") out.nota_recipient_ids=JSON.parse(out.nota_recipient_ids);
    delete out.nota_recipient_choice;
    if(fd.has("persekot_checklist")) out.persekot_checklist=fd.getAll("persekot_checklist");
    delete out.receipt_file;
    delete out.spb_file;
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
      if (supportsSystemDraft && !draftRequestOpen) {
        body.document_source=documentSource;
        if (documentSource==="GENERATED") body.document_layout=layout;
      }
      if (direction==="INTERNAL" && v11Enabled && !draftRequestOpen) {
        if (replyOrigin) body.nota_reply_to_id=replyOrigin.id;
        if (notaKind==="PAYMENT_REQUEST") body.payment_request=true;
        if (persekot) body.persekot=true;
      }
      if (draftRequestOpen) {
        body.document_type="NOTA_DINAS";
      }

      if(direction==="OUTGOING"){
        body.source_letter_id=sourceLetter[0]?.id;
        body.source_disposition_id=sourceDispositionId||undefined;
      }
      const metadata = JSON.stringify(body);
      const upload = new FormData();
      if (file) upload.set("original_file", file);
      for (const name of ["receipt_file", "spb_file"]) {
        const attachment=form.get(name);
        if(attachment&&typeof attachment!=="string"&&attachment.size) upload.set(name,attachment);
      }
      const multipart = [...upload.keys()].length > 0;
      if (multipart) upload.set("metadata", metadata);
      const response = await fetch("/api/letters", multipart
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
      setDraftRequestOpen(false);
      setMessage(direction==="INCOMING"?(result.data.status==="SECRETARIAT_INTAKE"?"Surat diserahkan ke Sekretariat.":"Surat diregistrasi dan diteruskan.")
        :direction==="INTERNAL"?(draftRequestOpen?"Permintaan draf dikirim ke Staff.":notaAuthor?"Draf tersimpan untuk diperiksa pengirim.":"Draf Nota Dinas tersimpan.")
        :"Draft dan nomor dokumen tersimpan. Buka detail untuk mengajukan ke Manager reviewer.");
      await load();
      if (failedFiles.length) {
        await openDetail(result.data.id);
        setError("Dokumen tersimpan. Unggah ulang file berikut dari detail dokumen: " + failedFiles.join(", "));
      } else if (direction==="INTERNAL" && v11Enabled) {
        await openDetail(result.data.id);
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

  async function readDetail(id:string){
    const response=await fetch(`/api/letters/${id}`,{cache:"no-store"});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result?.data?.letter) throw new Error(result?.error||"Gagal membuka detail surat.");
    if(result.data.letter.direction!==direction) throw new Error("Arah dokumen tidak sesuai dengan halaman ini.");
    return result.data;
  }

  async function openDetail(id:string){
    try{
      const next=await readDetail(id);
      setSigningReady(false);setDetail(next);setDetailOpen(true);
    }catch(e){
      setError(e instanceof Error?e.message:"Gagal membuka detail surat.");
    }
  }

  async function refreshDetail(id:string){
    const next=await readDetail(id);
    setDetail((current:typeof detail)=>current?.letter.id===id?next:current);
  }

  function startAction(action:string,label:string,requiredComment=false,issue=false){
    setActionFiles([]);setError("");setSignatureMethod(issue ? outgoingSigned ? "SAVED_SIGNATURE" : signingReady ? "MEKARI_API" : "" : "");
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
    if(pendingAction.action==="UNDO_APPROVAL") fd.set("approval_id",detail.approvalId);
    if(pendingAction.issue) fd.set("issued_date",String(form.get("issued_date")||today()));
    if(pendingAction.action==="REGISTER_INCOMING") fd.set("routing_target_user_id",String(form.get("routing_target_user_id")||""));
    if(pendingAction.action==="MARK_SENT") fd.set("sent_date",String(form.get("sent_date")||""));
    if(detail.v11) {
      for(const key of ["received_date","received_time","delivery_method","delivered_by","received_by","receipt_note",
        "receipt_file","dispatch_channel","dispatch_recipient","dispatch_file"]) {
        const value=form.get(key);
        if(value!==null&&(typeof value==="string"||value.size)) fd.set(key,value);
      }
    }
    if(signedIssue){
      const signed = form.get("signed_file");
      const method=String(form.get("signature_method")||"");
      if (method!=="MEKARI_API"&&method!=="SAVED_SIGNATURE") {
        if (!signed || typeof signed === "string" || signed.size === 0) {
          setError("Unggah naskah yang sudah ditandatangani.");setActionBusy(false);return;
        }
        fd.set("signed_file",signed);
      }
      fd.set("signature_method",method);
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
    const spb=fd.get("spb_file");
    const upload=new FormData();
    if(spb&&typeof spb!=="string"&&spb.size) {
      upload.set("spb_file",spb);
      upload.set("metadata",JSON.stringify(body));
    }
    const r=await fetch(`/api/letters/${detail.letter.id}`,upload.has("spb_file")
      ? {method:"PATCH",body:upload} : {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok){setError(j.error);return}
    setEditOpen(false);setMessage("Data dokumen berhasil diperbarui.");await openDetail(detail.letter.id);await load();
  }

  function canEditDetail(){
    if(!detail)return false;
    const letter=detail.letter;
    const own=user.role==="ROOT_ADMIN"||letter.created_by===user.id||detail.notaRouting?.authorId===user.id||
      (user.role==="STAFF"&&detail.notaRouting?.drafter?.id===user.id);
    const draft=["DRAFT","RETURNED_STAFF"].includes(letter.status);
    if(letter.uses_secretariat&&letter.status==="SECRETARIAT_INTAKE") return own||canHandleSecretariat(user.role);
    if(detail.v11||letter.uses_secretariat||detail.business?.managed||isInvoice(letter.document_type)) return own&&draft;
    return user.role==="ROOT_ADMIN"||(own&&draft);
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

    const letter=detail.letter;
    if(detail.v11) {
      if(letter.direction==="INCOMING"&&reviewRole(letter.status)) return letter.current_owner_user_id===user.id;
      return letter.status==="APPROVED";
    }
    return ["APPROVED","DISPOSED","IN_PROGRESS","COMPLETED"].includes(letter.status);
  }

  function actionButtons(){
    if(!detail)return null;
    const letter=detail.letter;
    const s=letter.status;const d=letter.direction as Direction;
    const secretariat=Boolean(letter.uses_secretariat);
    const handlesSecretariat=secretariat&&letter.current_role==="SECRETARIAT"&&canHandleSecretariat(user.role);
    const buttons:Array<[string,string,string,boolean?,boolean?]>=[];
    const draft=["DRAFT","RETURNED_STAFF"].includes(s);
    const author=detail.notaRouting?.authorId||letter.created_by;
    const delegated=author!==letter.created_by;

    if(d==="INCOMING"&&s==="SECRETARIAT_INTAKE"&&handlesSecretariat)
      buttons.push(["REGISTER_INCOMING","Registrasi & Teruskan","btn-primary"]);
    if(draft&&user.role==="STAFF"&&detail.notaRouting?.drafter?.id===user.id&&letter.current_owner_user_id===user.id)
      buttons.push(["HANDOFF_NOTA_DRAFT","Serahkan Draf ke Pengirim","btn-primary"]);
    if (draft && detail.notaRouting?.direct) {
      if (author===user.id && isNotaDirector(user.role)) {
        buttons.push(detail.notaRouting.isReply
          ? ["SEND_NOTA_REPLY","Kirim Balasan Nota Dinas","btn-primary"]
          : ["SEND_NOTA_DIRECT","Kirim Nota Dinas","btn-primary"]);
      }
    } else if(draft && (author===user.id || (!delegated&&user.role==="ROOT_ADMIN"))) {
      buttons.push(["SUBMIT",detail.v11&&d==="INTERNAL"?"Ajukan Nota Dinas":"Ajukan ke Manager","btn-primary",false,false]);
    }
    const expected=s==="SECRETARIAT_REVIEW"&&secretariat?"SECRETARIAT":reviewRole(s);
    const isAssignedReviewer=user.role==="ROOT_ADMIN"||(user.role===expected&&
      (!letter.current_owner_user_id||letter.current_owner_user_id===user.id));
    if(expected&&isAssignedReviewer){
      if(d==="OUTGOING"){
        const label=s==="PRESIDENT_DIRECTOR_REVIEW"?"ACC Final Dirut":s==="SECRETARIAT_REVIEW"?"Teruskan ke Dirut"
          :s==="DIRECTOR_OPS_REVIEW"&&secretariat&&letter.secretariat_review_required?"Teruskan ke Sekretariat":"Approve & Teruskan";
        buttons.push(["APPROVE",label,"btn-success"],["RETURN","Kembalikan ke Penyusun","btn-secondary",true]);
        if(!detail.v11&&s!=="MANAGER_REVIEW") buttons.push(["RETURN_PREVIOUS","Kembalikan Satu Tingkat","btn-secondary",true]);
        if(s==="PRESIDENT_DIRECTOR_REVIEW") buttons.push(["REJECT","Tolak Surat","btn-danger",true]);
      }else{
        if(!detail.v11?.payment || detail.v11.verified) {
          if((d==="INTERNAL"||(d==="INCOMING"&&secretariat))&&s!=="PRESIDENT_DIRECTOR_REVIEW")
            buttons.push(["APPROVE_FINAL","Setujui di Tahap Ini","btn-success"]);
          buttons.push(["APPROVE",s==="PRESIDENT_DIRECTOR_REVIEW"?"Setujui"
            :s==="MANAGER_REVIEW"?"Teruskan ke Dirops":"Teruskan ke Dirut","btn-primary"]);
        }
        const returnLabel=d==="INCOMING"&&secretariat&&(detail.v11||letter.current_owner_user_id===letter.routing_target_user_id)
          ?"Kembalikan ke Sekretariat":s==="MANAGER_REVIEW"||detail.v11?"Kembalikan ke Penyusun":"Kembalikan Satu Tingkat";
        buttons.push(["RETURN",returnLabel,"btn-secondary",true]);
        if(detail.v11) buttons.push(["REJECT","Tolak Final","btn-danger",true]);
      }
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
    if(!["CANCELLED","COMPLETED","ISSUED","REJECTED"].includes(s)&&
      (user.role==="ROOT_ADMIN"||author===user.id||(delegated&&draft&&letter.created_by===user.id))) {
      buttons.push(["CANCEL","Batalkan","btn-danger",true]);
    }
    if(detail.v11?.payment && financeManager && s==="APPROVED" && detail.v11.payment.status==="PAID")
      buttons.push(["COMPLETE","Tandai Invoice Selesai","btn-success"]);
    if(detail.v11&&!detail.v11.payment && (d==="OUTGOING"?s==="ISSUED"&&letter.sent_date:s==="APPROVED") &&
      (["ROOT_ADMIN","DIRECTOR_OPS","PRESIDENT_DIRECTOR"].includes(user.role)||letter.routing_target_user_id===user.id))
      buttons.push(["COMPLETE","Tandai Selesai","btn-success"]);
    if(detail.approvalId) buttons.push(["UNDO_APPROVAL","Batalkan Persetujuan","btn-secondary",true]);
    const nota=detail.notaDocument;
    const missingSignature=nota&&(!nota.source||(!nota.signed&&(nota.requiresProof||!nota.manualReason)));
    return buttons.map(b=><button key={b[0]} className={`btn ${b[2]}`}
      disabled={["SUBMIT","SEND_NOTA_REPLY","SEND_NOTA_DIRECT"].includes(b[0])&&Boolean(missingSignature||detail.draftDocument?.needsSource)}
      onClick={()=>startAction(b[0],b[1],Boolean(b[3]),Boolean(b[4]))}>{b[1]}</button>);
  }

  const generalAttachments=useMemo(()=>detail?.attachments?.filter((a:any)=>
    !a.letter_action_id&&a.source_kind!=="PAYMENT_DOCUMENT"&&
    a.id!==detail.notaDocument?.source?.id&&a.id!==detail.notaDocument?.signed?.id&&a.id!==detail.draftDocument?.source?.id)||[],[detail]);
  const receiptFile=detail?.attachments?.find((file:any)=>file.id===detail.v11?.receipt_attachment_id);
  const signingFiles=(detail?.attachments??[]).filter((file:any)=>!file.letter_action_id&&(
    ["ADDITIONAL","PAYMENT_DOCUMENT"].includes(file.attachment_kind)||
    (file.attachment_kind==="ORIGINAL"&&file.id===detail?.originalId&&!detail.notaDocument&&direction!=="OUTGOING")))
      .map((file:any)=>file.id===detail?.draftDocument?.source?.id?{...file,slots:detail.draftDocument.slots}:file);

  const pageDescription=direction==="INCOMING"
    ?"Registrasi surat eksternal yang diterima perusahaan, review, return, attachment, dan histori."
    :direction==="OUTGOING"
      ?"Susun draf, ikuti review Manager dan Dirops, lalu proses penerbitan setelah ACC Dirut."
      :"Dokumen internal yang dapat dibuat oleh seluruh role SIAP dan diajukan ke Manager tujuan beserta lampiran. Nota Dinas bukan lembar disposisi.";

  const currentYear=new Date().getFullYear();
  const yearOptions=Array.from({length:7},(_,i)=>String(currentYear-i));
  function resetFilters(nextTrash=trash) {
    setQ("");setStatus("");setDocType("");setYear("");setQueue(false);
    void load({q:"",status:"",docType:"",year:"",queue:false,trash:nextTrash});
  }

  useEffect(()=>{
    if(!trash||!isRoot) return;
    const controller=new AbortController();
    void fetch("/api/admin/letter-purge-files",{signal:controller.signal})
      .then(r=>r.ok?r.json():null)
      .then(result=>{if(result?.ok&&!controller.signal.aborted)setPendingCleanup(result.data.pending);})
      .catch(()=>{});
    return ()=>controller.abort();
  },[trash,isRoot]);

  function showTrashAction(row:{id:string;subject:string}, operation:TrashOperation) {
    setError("");
    setTrashTarget({id:row.id,subject:row.subject,operation});
  }

  async function moveLetter(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(!trashTarget) return;
    setTrashBusy(true);setError("");
    const fields=new FormData(e.currentTarget);
    const {operation,id}=trashTarget;
    try {
      const response=await fetch("/api/letters/"+id+"/trash",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({operation,reason:fields.get("reason"),confirmation:fields.get("confirmation")}),
      });
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||"Surat belum dapat diproses.");
      setTrashTarget(null);setDetailOpen(false);
      setMessage(operation==="purge"?"Surat sudah dihapus permanen."
        :operation==="restore"?"Surat dipulihkan.":"Surat dipindahkan ke Sampah.");
      if(operation==="purge" && result.data?.pending!==0) {
        setPendingCleanup(count=>count+Math.max(1,result.data?.pending||1));
      }
      await load();
    } catch(error) {
      setError(error instanceof Error?error.message:"Surat belum dapat diproses.");
    } finally {setTrashBusy(false);}
  }

  async function cleanupFiles() {
    setCleanupBusy(true);setError("");
    try {
      const response=await fetch("/api/admin/letter-purge-files",{method:"POST"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Pembersihan lampiran belum berhasil.");
      setPendingCleanup(result.data.pending);
      if(!result.data.pending)setMessage("Pembersihan lampiran selesai.");
    } catch(error) {
      setError(error instanceof Error?error.message:"Pembersihan lampiran belum berhasil.");
    } finally {setCleanupBusy(false);}
  }

  const trashActionLabel=trashTarget?.operation==="purge"?"Hapus Permanen"
    :trashTarget?.operation==="restore"?"Pulihkan Surat":"Pindah ke Sampah";

  return <main className="page">
    <div className="page-head"><div><h2>{letterDirectionLabel(direction)}</h2><p>{pageDescription}</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>{direction!=="INCOMING"&&["ROOT_ADMIN","STAFF","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"].includes(user.role)&&<a className="btn btn-secondary" href="/api/letters/outgoing-excel">↓ Export Excel</a>}{direction==="OUTGOING"&&user.role==="ROOT_ADMIN"&&<button className="btn btn-secondary" onClick={()=>{setImportOpen(true);setImportResult(null);setImportFile(null)}}>↑ Import Excel Lama</button>}{isRoot&&<button className="btn btn-secondary" aria-pressed={trash}
      onClick={()=>{setTrash(!trash);resetFilters(!trash);}}>{trash?"Kembali ke Daftar Surat":"Sampah"}</button>}
      {!trash&&canAskStaff&&<button className="btn btn-secondary" onClick={()=>{setError("");setDraftRequestOpen(true);}}>+ Minta Staff Siapkan Nota Dinas</button>}
      {!trash&&canCreate&&<button className="btn btn-primary" onClick={openCreate}>+ {createLabel}</button>}</div></div>

    {direction==="OUTGOING"&&<div className="notice" style={{marginBottom:13}}>
      {hasSecretariat?"Surat dengan alur Sekretariat masuk antrian penerbitan setelah ACC. Cek administrasi sebelum ACC mengikuti jenis surat."
        :"Pilih Manager reviewer saat membuat draf. Setelah ACC Dirut, penyusun dapat menerbitkan surat dari detail."}
    </div>}
    {direction==="INTERNAL"&&<div className="notice" style={{marginBottom:13}}><b>Nota Dinas dapat dibuat oleh seluruh role SIAP.</b><br/>
      Pilih tujuan, isi nota, lalu buat atau unggah PDF. Tanda tangani sebelum mengajukan. Gunakan tombol Tanggapan untuk mengikuti pembahasan.</div>}

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
      {!trash&&direction!=="INTERNAL"&&canHandleSecretariat(user.role)&&
        <button type="button" className={"btn "+(queue?"btn-primary":"btn-secondary")} aria-pressed={queue}
          onClick={()=>{setQueue(!queue);void load({queue:!queue});}}>
          {queue?"Tampilkan Semua Surat":"Antrian Sekretariat"}
        </button>}
      {(q||status||docType||year||queue)&&<button className="btn btn-secondary" onClick={()=>resetFilters()}>Reset</button>}
    </div>
    {queue&&<p className="hint" role="status">Antrean Sekretariat menampilkan surat yang saat ini berada di Sekretariat.</p>}
    {trash&&<p className="hint">Pulihkan surat untuk melanjutkan alurnya atau pilih Hapus Permanen.</p>}
    {trash&&pendingCleanup>0&&<div className="notice attachment-actions">
      <span>Masih ada lampiran dari surat yang dihapus yang perlu dibersihkan.</span>
      <button type="button" className="btn btn-secondary" disabled={cleanupBusy} onClick={()=>void cleanupFiles()}>
        {cleanupBusy?"Membersihkan…":"Coba Bersihkan Lampiran"}
      </button>
    </div>}
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>{direction==="OUTGOING"?"No.":"Nomor Surat"}</th><th>Jenis Dokumen</th><th>Perihal</th><th>{direction==="INCOMING"?"Pengirim":"Tujuan"}</th><th>Tanggal</th><th>Status</th><th>Tujuan Saat Ini</th><th>Sifat</th><th>Lampiran</th><th>{trash?"Dipindahkan":"Aktivitas"}</th><th>Aksi</th></tr></thead><tbody>
      {!loading&&rows.map(r=><tr key={r.id} className={`letter-row ${docTypeClass(r.document_type)}`}><td className="mono"><b>{(direction==="OUTGOING"?outgoingNumber(r):direction==="INTERNAL"?r.letter_number:r.external_number)||"-"}</b></td><td><span className={`badge letter-type-badge ${docTypeClass(r.document_type)}`}>{docLabel(r)}</span></td><td><b>{r.subject}</b>{r.legacy_import_key&&<span className="muted" style={{display:"block",fontSize:9.5,marginTop:3}}>Data Excel lama{r.legacy_number_conflict?" • cek nomor historis":""}</span>}</td><td>{direction==="INCOMING"?r.sender:r.recipient}</td><td>{fmtDate(r.letter_date)}</td><td><StatusBadge status={r.sent_date&&r.status==="ISSUED"||directNotaSent(r.v11_kind,r.status)?"SENT":r.status}/></td><td><b style={{fontSize:11}}>{currentTargetLabel(r)}</b></td><td><ConfidentialityBadge value={r.confidentiality}/></td><td>{r.attachment_count}</td>
        <td className="letter-activity">{trash?<><span>{formatWorkflowTime(r.deleted_at)}</span><span className="muted">{r.deletion_reason}</span></>
          :<><span>Dibuat {formatWorkflowTime(r.created_at)}</span><span className="muted">Diperbarui {formatWorkflowTime(r.updated_at)}</span></>}</td>
        <td><div className="attachment-actions">{!trash&&<button className="btn btn-secondary" onClick={()=>openDetail(r.id)}>Detail</button>}
          {isRoot&&<button className="btn btn-secondary" onClick={()=>showTrashAction(r,trash?"restore":"trash")}>
            {trash?"Pulihkan":"Pindah ke Sampah"}
          </button>}
          {isRoot&&trash&&<button className="btn btn-danger" onClick={()=>showTrashAction(r,"purge")}>Hapus Permanen</button>}
        </div></td></tr>)}
      {!loading&&rows.length===0&&<tr><td colSpan={11}><div className="empty">{trash?"Sampah kosong.":queue?"Tidak ada surat di antrean Sekretariat.":"Tidak ada surat yang cocok."}</div></td></tr>}
      {loading&&<tr><td colSpan={11}><div className="empty">Memuat...</div></td></tr>}
    </tbody></table></div></div>

    {trashTarget&&<Modal title={trashActionLabel} subtitle={trashTarget.subject}
      onClose={()=>!trashBusy&&setTrashTarget(null)}>
      <form className="form-grid workflow-form" onSubmit={moveLetter}>
        {error&&<div className="field full error" role="alert">{error}</div>}
        <p className={`field full ${trashTarget.operation==="purge"?"error":"notice"}`}>
          {trashTarget.operation==="purge"
            ?"Surat, riwayat disposisi, dan lampiran terkait akan dihapus dan tidak bisa dipulihkan dari SIAP ARU. Alasan penghapusan dicatat dalam Audit Log."
            :trashTarget.operation==="restore"?"Surat dan proses terkait akan muncul kembali."
            :"Surat, disposisi, dan lampirannya disembunyikan. Nomor surat dan pencatatan keuangan tetap tercatat."}
        </p>
        <label className="field full"><span>Alasan</span><textarea className="textarea" name="reason" maxLength={1000} required/></label>
        {trashTarget.operation==="purge"&&<label className="field full">
          <span>Ketik {PURGE_CONFIRMATION}</span>
          <input className="input" name="confirmation" pattern={PURGE_CONFIRMATION} autoComplete="off" required/>
        </label>}
        <div className="field full modal-actions">
          <button type="button" className="btn btn-secondary" disabled={trashBusy} onClick={()=>setTrashTarget(null)}>Batal</button>
          <button className={"btn "+(trashTarget.operation==="restore"?"btn-primary":"btn-danger")} disabled={trashBusy}>
            {trashBusy?"Memproses…":trashActionLabel}
          </button>
        </div>
      </form>
    </Modal>}

    {importOpen&&direction==="OUTGOING"&&user.role==="ROOT_ADMIN"&&<Modal title="Import Form Persuratan ARU" subtitle="Pindahkan daftar Excel lama ke database SIAP tanpa mengubah nomor historisnya." onClose={()=>!importBusy&&setImportOpen(false)}>
      <form className="form-grid workflow-form" onSubmit={importExcel}>
        <div className="field full"><div className="notice"><b>Langkahnya ringkas:</b><br/>1. Pilih <b>Form Persuratan ARU.xlsx</b>.<br/>2. Klik <b>Import ke Database</b>.<br/>3. Cek ringkasan hasil. Import ulang file yang sama aman: baris yang sudah pernah masuk akan diperbarui, bukan diduplikasi.</div></div>
        <div className="field full"><label>File Excel</label><input className="input" type="file" accept=".xlsx" onChange={e=>setImportFile(e.target.files?.[0]||null)} required/><span className="hint">Dibaca: Perjanjian Kerjasama, Surat Keluar- Direksi, Surat Keluar - Bag. Operasional, Purchase Order, dan Surat keluar- Bag. umum. Sheet Kwitansi tidak diimport.</span></div>
        <div className="field full"><div className="format-preview"><span>Nomor historis</span><b>Tetap seperti Excel (termasuk .1, .2)</b><span>Data tidak standar / duplikat</span><b>Tetap disimpan dan diberi penanda untuk pengecekan</b><span>Sumber utama setelah import</span><b>Database SIAP ARU</b></div></div>
        {importResult&&<div className="field full"><div className="success"><b>Import selesai.</b><br/>{importResult.processed} baris diproses • {importResult.inserted} baru • {importResult.updated} diperbarui • {importResult.ledgerLinked} nomor terhubung ledger • {importResult.conflicts} perlu pengecekan • {importResult.skipped} dilewati.</div>{importResult.issues?.length>0&&<details style={{marginTop:10}}><summary style={{cursor:"pointer",fontWeight:700}}>Lihat catatan import ({importResult.issues.length}{importResult.moreIssues?` + ${importResult.moreIssues} lainnya`:""})</summary><div className="notice" style={{marginTop:8,maxHeight:220,overflow:"auto"}}>{importResult.issues.map((x:string,i:number)=><div key={i}>• {x}</div>)}</div></details>}</div>}
        <div className="field full modal-actions"><button type="button" className="btn btn-secondary" disabled={importBusy} onClick={()=>setImportOpen(false)}>Tutup</button><button className="btn btn-primary" disabled={importBusy||!importFile}>{importBusy?"Mengimpor...":"Import ke Database"}</button></div>
      </form>
    </Modal>}

    {draftRequestOpen&&<Modal title="Minta Staff Siapkan Nota Dinas"
      subtitle="Staff mengisi naskah dan tujuan. Anda memeriksa draf sebelum mengirim atau mengajukan Nota Dinas."
      onClose={()=>!createBusy&&setDraftRequestOpen(false)}>
      <form className="form-grid workflow-form" onSubmit={create}>
        {error&&<div className="field full error" role="alert">{error}</div>}
        <div className="field full">
          <SearchableSelect label="Staff penyusun" name="nota_drafter_user_id" options={draftStaff.map(notaOption)}
            placeholder="Pilih Staff…" required disabled={createBusy}/>
          {!draftStaff.length&&<span className="hint">Belum ada akun Staff aktif yang tersedia untuk penugasan ini.</span>}
        </div>
        <label className="field full"><span>Perihal</span><input className="input" name="subject" maxLength={500} required/></label>
        <label className="field"><span>Tanggal Nota Dinas</span>
          <input className="input" name="letter_date" type="date" defaultValue={jakartaDate()} required/>
        </label>
        <label className="field"><span>Sifat Dokumen</span><select className="select" name="confidentiality">
          <option>BIASA</option><option>PENTING</option><option>RAHASIA</option>
        </select></label>
        <label className="field full" data-need="Opsional"><span>Arahan untuk Staff</span>
          <textarea className="textarea" name="nota_draft_instruction" maxLength={5000} placeholder="Contoh: Susun arahan tindak lanjut dan lengkapi daftar tujuan."/>
        </label>
        <div className="field full modal-actions">
          <button type="button" className="btn btn-secondary" disabled={createBusy} onClick={()=>setDraftRequestOpen(false)}>Batal</button>
          <button className="btn btn-primary" disabled={createBusy||!draftStaff.length}>Kirim Permintaan Draf</button>
        </div>
      </form>
    </Modal>}

    {createOpen&&<Modal title={replyOrigin?"Buat Balasan Nota Dinas":direction==="INCOMING"?createLabel+" Masuk":createLabel} subtitle={replyOrigin?"Balasan dikirim kepada pengirim Nota Dinas asal.":direction==="INTERNAL"?"Pilih pengirim, tujuan dan sumber PDF sebelum menyimpan draf.":direction==="OUTGOING"?"Draft disusun Staff. Nomor direservasi per jenis surat dan seluruh proses tercatat di audit log.":"Semua perubahan tercatat di audit log."} onClose={()=>!createBusy&&setCreateOpen(false)}>
      <form onSubmit={create} className="form-grid workflow-form">
        {error&&<div className="field full error" role="alert">{error}</div>}
        <div className="field">
          <label>Jenis Dokumen</label>
          {direction==="INTERNAL"
            ? <><input type="hidden" name="document_type" value="NOTA_DINAS"/>
                {v11Enabled&&!replyOrigin ? <select className="select" aria-label="Jenis Nota Dinas" value={notaKind}
                  onChange={e=>{setNotaKind(e.target.value);if(directingNota&&notaAuthor) setNotaAuthor("");}}><option value="NOTA">Nota Dinas</option>
                  <option value="PERSEKOT">Pengajuan Persekot</option><option value="PAYMENT_REQUEST">Pengajuan Pembayaran Nonpersekot</option></select>
                  : replyOrigin ? <div className="input">Balasan Nota Dinas</div>
                  : <div className="input">Nota Dinas</div>}</>
            : <select aria-label="Jenis Dokumen" className="select" name={createType==="__CUSTOM__"?undefined:"document_type"} required value={createType} onChange={e=>{setCreateType(e.target.value);setFormatId("");}}>
                {typeOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}
                {direction==="INCOMING"&&<option value="__CUSTOM__">Jenis lainnya</option>}
              </select>}
        </div>
        {direction==="INCOMING"&&createType==="__CUSTOM__"&&<div className="field"><label>Nama jenis dokumen</label><input aria-label="Nama jenis dokumen" className="input" name="document_type" maxLength={80} required/></div>}
        {direction==="OUTGOING"&&<div className="field"><SearchableSelect label="Format Nomor" name="number_format_id" value={formatId} onChange={setFormatId}
          options={formats.filter((f:any)=>f.document_type===createType).map((f:any)=>({value:f.id,label:f.name}))}
          placeholder="Pilih format…" required/></div>}
        {direction==="INTERNAL"&&v11Enabled&&<div className="field"><SearchableSelect label="Seri Nomor Nota Dinas"
          name="number_format_id" value={selectedFormatId} onChange={setFormatId}
          options={notaFormats.map(format=>({value:format.id,label:format.name}))}
          placeholder="Pilih seri nomor…" required/>
          <span className="hint">Nomor berbagi urutan dengan seri Surat Keluar yang dipilih. Bagian Umum memakai format UM.</span>
        </div>}
        {direction==="OUTGOING"&&<div className="field"><label>Nomor Dasar Custom <span className="muted">(opsional)</span></label><input className="input" type="number" min="1" step="1" name="custom_number_base" placeholder="Otomatis" value={customBase} onChange={e=>setCustomBase(e.target.value)}/><span className="hint">Contoh 135. Jika 135 sudah terpakai pada jenis/tahun yang sama, sistem memakai 135.1, 135.2, dst.</span></div>}
        {direction==="INCOMING"&&<>
          <div className="field"><label>Nomor Surat Asal</label><input className="input" name="external_number" required/></div>
          <div className="field"><label>Asal / Pengirim</label><input className="input" name="sender" required/></div>
          <div className="field"><label>Ditujukan Kepada</label><select className="select" name="recipient" key={recipients.defaultRecipient} defaultValue={recipients.defaultRecipient} required>
            {recipients.recipients.map(name=><option key={name}>{name}</option>)}
          </select></div>
          <div className="field full">
            <SearchableSelect label="Tujuan Review Awal" ariaLabel="Tujuan review" name="routing_target_user_id" required
              options={reviewers.map(r=>({value:r.id,label:reviewerLabel(r)}))} placeholder="Pilih penerima pertama…"/>
            <span className="hint">
              {v11Enabled?"Pilih Manager sesuai unit pemohon. Sekretariat memastikan tujuan saat registrasi."
                :hasSecretariat?"Pilih pihak yang dituju untuk telaah. Sekretariat dapat memperbarui tujuan saat registrasi.":"Pilih Manager yang menangani surat ini."}
            </span>
          </div>
        </>}
        {direction==="OUTGOING"&&<>
          <div className="field"><label>Tujuan Surat</label><input className="input" name="recipient" required/></div>
          <div className="field">
            <SearchableSelect label="Manager Reviewer" ariaLabel="Tujuan review" name="routing_target_user_id" required
              options={reviewers.map(r=>({value:r.id,label:reviewerLabel(r)}))} placeholder="Pilih Manager…"/>
            <span className="hint">Draft diajukan ke Manager ini, lalu Dirops → Dirut.</span>
          </div>
        </>}
        {direction==="INTERNAL"&&v11Enabled&&user.role==="STAFF"&&<label className="field">
          <span>Siapkan draf untuk</span>
          <select className="select" name="nota_author_user_id" value={notaAuthor} required={Boolean(replyOrigin)}
            onChange={event=>setNotaAuthor(event.target.value)}>
            <option value="">{replyOrigin?"Pilih Direktur":"Diri sendiri"}</option>
            {replyOrigin ? replyOrigin.authors.map(account=><option value={account.id} key={account.id}>{account.name}</option>)
              : [...preparableAuthors, ...(notaKind==="NOTA"?directorAccounts:[])].map(account=>
                <option value={account.id} key={account.id}>{reviewerLabel(account)}</option>)}
          </select>
          {notaAuthor&&<span className="hint">Pengirim yang dipilih akan memeriksa dan mengirim atau mengajukan draf.</span>}
        </label>}
        {replyOrigin&&<div className="field full notice">
          <b>Nota Dinas asal</b> · {replyOrigin.subject}
          {replyRecipient&&<><br/><b>Penerima</b> · {[replyRecipient.name,replyRecipient.unit].filter(Boolean).join(" — ")}</>}
        </div>}
        {direction==="INTERNAL"&&v11Enabled&&<NotaTargetFields
          key={`${notaAuthor}-${noteAuthorRole}-${notaKind}-${replyOrigin?.id||""}`}
          direct={directNotaForm||Boolean(replyOrigin)} reply={Boolean(replyOrigin)} primary={replyRecipient?.id}
          {...notaOptions(noteAuthorRole, notaAuthor||user.id, directNotaForm||Boolean(replyOrigin))}/>}
        {direction==="INTERNAL"&&!v11Enabled&&!replyOrigin&&
          <div className="field">
            <label>Tujuan Review Awal</label>
            <select aria-label="Tujuan review" className="select" name="routing_target_user_id" required>
              <option value="">Pilih penerima...</option>
              {reviewers.map(r=>
                <option key={r.id} value={r.id}>
                  {reviewerLabel(r)}
                </option>
              )}
            </select>
            <span className="hint">Nota Dinas diajukan ke Manager yang dipilih.</span>
          </div>}
        <div className="field"><label>{direction==="INTERNAL"?"Tanggal Nota Dinas":"Tanggal Surat"}</label><input className="input" type="date" name="letter_date" value={letterDate} onChange={e=>setLetterDate(e.target.value)} required/>{direction==="OUTGOING"&&<span className="hint">Backdate diperbolehkan. Nomor existing tidak digeser; collision menghasilkan .1, .2, dst.</span>}</div>
        {supportsSystemDraft&&selectedFormatId&&<div className="field full notice" role="status">
          {numberPreview?<><b>Perkiraan nomor {numberPreview.rendered}</b><br/>
            Urutan tertinggi {numberPreview.year} {numberPreview.highestBase||"belum ada"} · {numberPreview.source==="SHEETS"?"Google Sheets + register SIAP":"Register SIAP"}.
            Nomor dikunci saat draf tersimpan.</>:numberError||"Menghitung perkiraan nomor…"}
        </div>}
        {direction==="INCOMING"&&<div className="field"><label>Tanggal Diterima</label><input className="input" type="date" name="received_date" defaultValue={today()} required/></div>}
        {v11Enabled&&direction==="INCOMING"&&<><UnitField value={staffUnit(user.unit_name)||""}/><ReceiptFields upload/></>}
        {v11Enabled&&direction==="INTERNAL"&&persekot&&<PersekotFields/>}
        <div className="field full"><label>Perihal</label><input className="input" name="subject" defaultValue={replyOrigin?("Balasan atas "+replyOrigin.subject).slice(0,500):""} required/></div>
        <div className="field"><label>Sifat Dokumen</label><select className="select" name="confidentiality" defaultValue={replyOrigin?.confidentiality||"BIASA"} required>
          {["BIASA","PENTING","RAHASIA"].slice(Math.max(0,["BIASA","PENTING","RAHASIA"].indexOf(replyOrigin?.confidentiality||"BIASA")))
            .map(option=><option key={option}>{option}</option>)}
        </select></div>
        {!v11Enabled&&<div className="field"><label>Visibilitas</label><label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500}}><input type="checkbox" key={businessForm?"private":"regular"} name="is_public" defaultChecked={direction!=="INTERNAL"&&!businessForm&&!sourceDispositionId&&!sourceLetter.length}/> {direction==="INTERNAL"?"Dapat dilihat lebih luas oleh user persuratan":"Public untuk user yang punya akses persuratan"}</label></div>}
        {supportsSystemDraft&&<label className="field full"><span>Sumber dokumen</span>
          <select className="select" value={documentSource} onChange={e=>setDocumentSource(e.target.value as typeof documentSource)} required>
            <option value="GENERATED">Buat dari sistem (PDF ARU)</option><option value="UPLOAD">Unggah sendiri</option>
          </select>
        </label>}
        <label className="field full"><span>{supportsSystemDraft&&documentSource==="GENERATED"?"Isi utama dokumen"
          :direction==="INTERNAL"?"Isi / Ringkasan Nota Dinas":"Ringkasan / Isi Ringkas"}</span>
          <textarea className="textarea" name="summary" maxLength={5000}
            required={supportsSystemDraft&&documentSource==="GENERATED"&&!layout.blocks.length}/></label>
        {supportsSystemDraft&&documentSource==="GENERATED"&&<CorrespondenceLayoutFields layout={layout}
          onChange={setLayout} outgoing={direction==="OUTGOING"} disabled={createBusy}/>}
        <div className="field full"><label>Catatan</label><textarea className="textarea" name="notes" placeholder="Catatan awal proses"/></div>
        {direction==="OUTGOING"&&(sourceDispositionId
          ?<div className="field full notice">Draf ini ditautkan ke Disposisi asal.</div>
          :<div className="field full">
            <ReferencePicker kind="source" selected={sourceLetter} onChange={setSourceLetter} limit={1}/>
          </div>)}
        {businessForm&&<BusinessDocumentFields key={createType} documentType={createType} outgoing={direction==="OUTGOING"}
          requireDueDate={v11Enabled&&createType===INVOICE_INCOMING}/>}
        {!(supportsSystemDraft&&documentSource==="GENERATED")&&<div className="field full">
          <label>{incomingFileRequired?"Dokumen Asli (wajib)":direction==="OUTGOING"?"File Draft / Dokumen Utama (opsional)":direction==="INTERNAL"?"PDF Nota Dinas":"Surat Asli (opsional)"}</label>
          <input aria-label={direction==="INTERNAL"?"PDF Nota Dinas":"Dokumen asli"} className="input" type="file" name="original_file"
            required={incomingFileRequired||direction==="INTERNAL"&&v11Enabled}
            accept={direction==="INTERNAL"&&v11Enabled?".pdf,application/pdf":".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"}/>
          <span className="hint">Maksimal 10 MB.</span></div>}
        <div className="field full"><label>Lampiran Tambahan <span className="muted">(opsional, maksimal 5 file)</span></label><input className="input" type="file" name="additional_files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"/><span className="hint">Lampiran tambahan maksimal 10 MB per file dan dikompresi otomatis bila hasilnya lebih kecil. Cocok untuk data pendukung, hasil telaah, atau bukti proses.</span></div>
        <div className="field full" style={{display:"flex",justifyContent:"flex-end",gap:8,flexDirection:"row"}}><button type="button" className="btn btn-secondary" disabled={createBusy} onClick={()=>setCreateOpen(false)}>Batal</button><button className="btn btn-primary" disabled={createBusy||sourceLoading}>{createBusy?"Menyimpan...":direction==="INCOMING"?(incomingToSecretariat?"Kirim ke Sekretariat":"Registrasi & Teruskan"):"Simpan Draft"}</button></div>
      </form>
    </Modal>}

    {detailOpen&&detail&&<Modal title={detail.letter.subject} subtitle={direction==="OUTGOING"?`No. ${outgoingNumber(detail.letter)||"-"} • ${docLabel(detail.letter)}`:direction==="INTERNAL"?docLabel(detail.letter):(detail.letter.external_number||"Detail surat")} onClose={()=>setDetailOpen(false)}>
      <div className="grid-2">
        <div>
          <div className="kpi-list">
            <div className="kpi-row"><span>Status</span><StatusBadge status={detail.letter.sent_date&&detail.letter.status==="ISSUED"||directNotaSent(detail.v11?.kind,detail.letter.status)?"SENT":detail.letter.status}/></div>
            <div className="kpi-row"><span>Tujuan Saat Ini</span><b>{detail.letter.owner_name?`${detail.letter.owner_name}${detail.letter.owner_unit?` — ${detail.letter.owner_unit}`:""}`:currentTargetLabel(detail.letter)}</b></div>
            {detail.letter.routing_target_name&&<div className="kpi-row"><span>Tujuan Awal</span><b>{detail.letter.routing_target_name}{detail.letter.routing_target_unit?` — ${detail.letter.routing_target_unit}`:""}</b></div>}
            <div className="kpi-row"><span>Jenis Dokumen</span><b>{docLabel({...detail.letter,v11_kind:detail.v11?.kind})}</b></div>
            {direction!=="INCOMING"&&<div className="kpi-row"><span>Nomor Dokumen</span><b className="mono">{detail.letter.letter_number||outgoingNumber(detail.letter)||"-"}</b></div>}
            {detail.letter.recipient&&<div className="kpi-row"><span>Ditujukan Kepada</span><b>{detail.letter.recipient}</b></div>}
            {detail.notaRouting?.additionalRecipients?.length>0&&<div className="kpi-row"><span>Penerima tambahan</span>
              <b>{detail.notaRouting.additionalRecipients.map((account:RoutingUser)=>notaOption(account).label).join(", ")}</b>
            </div>}
            {detail.sourceLetter&&<div className="kpi-row"><span>{detail.notaRouting?.isReply?"Nota Dinas Asal":"Dokumen Asal"}</span>
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
            {detail.notaRouting?.authorName&&<div className="kpi-row"><span>Pengirim Nota Dinas</span><b>{detail.notaRouting.authorName}</b></div>}
            {detail.notaRouting?.drafter&&<div className="kpi-row"><span>Staff penyusun</span><b>{detail.notaRouting.drafter.name}</b></div>}
            <div className="kpi-row"><span>Dibuat oleh</span><b>{detail.letter.creator_name} · {formatWorkflowTime(detail.letter.created_at)}</b></div>
            <div className="kpi-row"><span>Terakhir diperbarui</span><b>{formatWorkflowTime(detail.letter.updated_at)}</b></div>
            {direction==="OUTGOING"&&detail.letter.legacy_sheet_name&&<div className="kpi-row"><span>Sumber Historis</span><b>{detail.letter.legacy_sheet_name} • baris {detail.letter.legacy_row_no}</b></div>}
          </div>
          {direction==="OUTGOING"&&detail.letter.legacy_number_conflict===1&&<div className="notice" style={{marginTop:13}}><b>Nomor historis dipertahankan apa adanya.</b> Slot ini terdeteksi duplikat/tidak standar pada workbook lama, sehingga tidak dipakai untuk menggeser penomoran otomatis baru.</div>}
          {direction==="OUTGOING"&&detail.letter.legacy_file_url&&<div className="card" style={{boxShadow:"none",marginTop:13}}><div className="card-body"><b>Referensi File Lama</b><p className="muted" style={{marginTop:4}}>Nilai dari kolom Link File pada workbook lama.</p>{/^https?:\/\//i.test(String(detail.letter.legacy_file_url))?<a className="btn btn-secondary" href={String(detail.letter.legacy_file_url)} target="_blank" rel="noreferrer">Buka Link Lama ↗</a>:<div className="notice" style={{marginTop:8}}>{String(detail.letter.legacy_file_url)}</div>}</div></div>}
          {direction==="OUTGOING"&&detail.letter.status==="READY_TO_ISSUE"&&<div className="success" style={{marginTop:13}}><b>ACC final selesai.</b> {detail.letter.uses_secretariat?"Sekretariat memfinalisasi nomor dan menyiapkan tanda tangan.":"Penyusun dapat menerbitkan surat dari detail ini."}</div>}
          {direction==="OUTGOING"&&detail.letter.status==="RETURNED_STAFF"&&<div className="error" style={{marginTop:13}}><b>Dikembalikan ke Staff.</b> Baca catatan reviewer pada riwayat, revisi draft, lalu ajukan kembali mulai dari Manager.</div>}
          <div style={{marginTop:13}} className="notice">{detail.letter.summary||"Belum ada ringkasan."}</div>
          {detail.notaRouting?.draftInstruction&&<div className="notice" style={{marginTop:8}}>
            <b>Arahan penyusunan</b><br/>{detail.notaRouting.draftInstruction}
          </div>}
          {detail.business&&<BusinessDocumentSummary details={detail.business} documentType={detail.letter.document_type}/>}
          {direction!=="INTERNAL"&&<WorkflowSummary data={detail.v11} date={detail.letter.received_date} files={detail.attachments}/>}
          {detail.draftDocument&&<OutgoingDocumentPanel key={`outgoing-${detail.letter.id}`} id={detail.letter.id}
            data={detail.draftDocument} refresh={()=>refreshDetail(detail.letter.id)}/>}
          {detail.notaDocument&&<NotaDocumentPanel key={`nota-${detail.letter.id}`} id={detail.letter.id}
            data={detail.notaDocument} assistants={routingUsers.filter(account=>account.role==="SECRETARIAT")}
            refresh={()=>refreshDetail(detail.letter.id)}/>}
          {detail.v11?.payment_documents && <PaymentDocumentsPanel key={`payment-${detail.letter.id}`} id={detail.letter.id}
            data={detail.v11.payment_documents} attachments={detail.attachments} onSaved={()=>refreshDetail(detail.letter.id)}/>}
          {detail.sandboxSigning && (!detail.notaDocument || signingFiles.length>0) && <AttachmentSandbox key={`attachment-sandbox-${detail.letter.id}`}
            files={signingFiles}/>}
          {direction==="OUTGOING"&&<OutgoingSignaturePanel key={`outgoing-signature-${detail.letter.id}`} id={detail.letter.id}
            signed={outgoingSigned||undefined} method={detail.v11?.signature_provenance} editable={detail.outgoingSigning}
            source={detail.draftDocument?.source?.original_name.toLowerCase().endsWith(".pdf")
              ? {...detail.draftDocument.source,slots:detail.draftDocument.slots} : undefined}
            sandbox={detail.sandboxAttachments} staging={Boolean(detail.outgoingSigningMode)}
            onReady={setSigningReady} refresh={()=>refreshDetail(detail.letter.id)}/>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:13}}>
            {canEditDetail()&&<button className="btn btn-secondary" onClick={openEdit}>
              {user.role==="STAFF"&&detail.notaRouting?.drafter?.id===user.id?"Isi Draf Nota Dinas":"Edit Metadata"}
            </button>}
            {direction==="OUTGOING"&&detail.business?.invoice&&!["CANCELLED","REJECTED"].includes(detail.letter.status)&&
              <a className="btn btn-secondary" href={"/print/letters/"+detail.letter.id} target="_blank" rel="noreferrer">Pratinjau Invoice ↗</a>}
            {direction==="OUTGOING"&&detail.letter.document_type===SPK_OUTGOING&&detail.letter.status===(detail.letter.uses_secretariat?"WAITING_SIGNATURE":"READY_TO_ISSUE")&&
              <a className="btn btn-secondary" href={"/print/letters/"+detail.letter.id} target="_blank" rel="noreferrer">Cetak SPK untuk TTD ↗</a>}
            {canDispositionFromDetail()&&<a className="btn btn-primary" href={`/dispositions?letter_id=${detail.letter.id}`}>+ Buat Disposisi</a>}
            {detail.v11?.payment && !detail.v11.verified && user.role==="MANAGER" &&
                detail.letter.current_owner_user_id===user.id && detail.letter.status==="MANAGER_REVIEW" &&
              <a className="btn btn-primary" href={`/dispositions?letter_id=${detail.letter.id}&purpose=INVOICE_VERIFY`}>Tugaskan Verifikasi Invoice</a>}
            {detail.v11?.payment && detail.letter.status==="APPROVED" && financeManager && detail.v11.payment.status!=="PAID" && !detail.v11.payment_documents?.missing.length &&
              <a className="btn btn-primary" href={`/dispositions?letter_id=${detail.letter.id}&purpose=INVOICE_PAYMENT`}>Instruksi Bayar & Catat</a>}
            {detail.v11?.payment && <a className="btn btn-secondary" href={`/bpk?invoice_id=${detail.letter.id}`}>BPK untuk Invoice</a>}
            {["PERSEKOT","PAYMENT_REQUEST"].includes(detail.v11?.kind) && detail.letter.status==="APPROVED" &&
              financeManager && !detail.v11.payment_documents?.missing.length &&
              <a className="btn btn-primary" href={`/dispositions?letter_id=${detail.letter.id}&purpose=REQUEST_PAYMENT`}>Instruksi Bayar Pengajuan</a>}
            {direction!=="OUTGOING"&&canDraftOutgoing&&!["CANCELLED","REJECTED"].includes(detail.letter.status)&&
              <a className="btn btn-secondary" href={"/letters/outgoing?source_letter_id="+encodeURIComponent(detail.letter.id)}>Buat Draf Surat Keluar</a>}
            {direction==="INTERNAL"&&<NotaResponses key={`responses-${detail.letter.id}`} id={detail.letter.id}
              refreshHistory={()=>refreshDetail(detail.letter.id)}/>}
            {(detail.notaRouting?.replyRecipient||detail.notaRouting?.replyAuthors?.length>0)&&
              <button type="button" className="btn btn-secondary" onClick={openNotaReply}>Buat Balasan Nota Dinas</button>}
            {actionButtons()}
          </div>
          {detail.notaRouting?.replies?.length>0&&<div className="card workflow-document-panel">
            <div className="card-head"><h3>Balasan Nota Dinas</h3></div>
            <div className="card-body kpi-list">
              {detail.notaRouting.replies.map((reply:{id:string;subject:string;status:string;sender:string})=>
                <div className="kpi-row" key={reply.id}>
                  <div><a href={"/letters/internal?letter_id="+encodeURIComponent(reply.id)}>{reply.subject}</a><br/>
                    <span>{reply.sender}</span></div>
                  <StatusBadge status={reply.status==="COMPLETED"?"SENT":reply.status}/>
                </div>)}
            </div>
          </div>}

          <div className="card" style={{boxShadow:"none",marginTop:14}}>
            <div className="card-head"><div><h3>Dokumen & Lampiran Umum</h3><p>Dokumen utama disimpan apa adanya. Lampiran tambahan dikompresi hanya bila hasilnya lebih kecil. Semua file di bagian ini dapat diunduh kembali sesuai hak akses.</p></div></div>
            <div className="card-body">
              {generalAttachments.map((a:any)=><div className="kpi-row" key={a.id}><div><b>{a.original_name}</b><span style={{display:"block"}}>{a.attachment_kind==="ORIGINAL"?(a.id===detail.originalId?"Dokumen utama saat ini":"Dokumen utama versi sebelumnya"):a.attachment_kind} • {size(Number(a.original_size))}{a.is_compressed?" • compressed":""} • {a.uploaded_by_name}</span></div><AttachmentActions id={a.id} name={a.original_name}/></div>)}
              {!generalAttachments.length&&<div className="empty">Belum ada lampiran umum.</div>}
              {error&&!editOpen&&!pendingAction&&<div className="error" role="alert">{error}</div>}
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                {!detail.notaDocument&&(!detail.letter.uses_secretariat||direction!=="OUTGOING"||["DRAFT","RETURNED_STAFF"].includes(detail.letter.status))
                  &&(detail.letter.created_by===user.id||user.role==="ROOT_ADMIN"||
                  (detail.letter.status==="SECRETARIAT_INTAKE"&&canHandleSecretariat(user.role)))&&
                  <label className="btn btn-secondary">{detail.originalId?"Ganti Dokumen Utama":"+ Dokumen Utama"}<input hidden type="file" aria-label="Unggah dokumen utama" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" onChange={async e=>{
                    const input=e.currentTarget;
                    const file=input.files?.[0];
                    if(file) await upload("ORIGINAL",file);
                    input.value="";
                  }}/></label>}
                {(!detail.notaDocument||detail.notaDocument.editable||!detail.notaDocument.uploadable)&&
                  <label className="btn btn-secondary">+ Lampiran Tambahan<input hidden type="file" aria-label="Unggah lampiran tambahan" multiple onChange={async e=>{
                  const input=e.currentTarget;
                  for(const file of Array.from(input.files||[]).slice(0,5)) await upload("ADDITIONAL",file);
                  input.value="";
                }}/></label>}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="disposition-history-heading">
            <h3 style={{fontSize:13}}>Riwayat Proses & Lampiran</h3>
            {direction==="OUTGOING"&&canHandleSecretariat(user.role)&&
              <a className="btn btn-secondary" href={"/api/letters/"+encodeURIComponent(detail.letter.id)+"/export"} download>
                Unduh Semua Riwayat (.xlsx)
              </a>}
          </div>
          <p className="muted" style={{fontSize:11}}>Setiap submit, approval, return, penerbitan, atau pembatalan dapat membawa catatan dan maksimal 5 lampiran proses.</p>
          <LetterHistory actions={detail.actions??[]} attachments={detail.attachments??[]}/>
        </div>
      </div>
    </Modal>}

    {editOpen&&detail&&<Modal title="Edit Data Dokumen" subtitle="Perbarui data dan rujukan dokumen." onClose={()=>setEditOpen(false)}>
      <form className="form-grid workflow-form" onSubmit={editLetter}>
        {error&&<div className="field full error" role="alert">{error}</div>}
        <div className="field full"><label>Perihal</label><input className="input" name="subject" defaultValue={detail.letter.subject} required/></div>
        {direction==="INCOMING"?<div className="field"><label>Asal / Pengirim</label><input className="input" name="sender" defaultValue={detail.letter.sender||""}/></div>
          : (direction!=="INTERNAL"||!detail.v11)&&<div className="field"><label>Tujuan</label><input className="input" name="recipient" defaultValue={detail.letter.recipient||""}/></div>}
        {direction==="INTERNAL"&&detail.v11&&detail.notaRouting&&<>
          {detail.notaRouting.isReply&&<div className="field full notice"><b>Penerima balasan</b> · {detail.letter.recipient}</div>}
          <NotaTargetFields direct={detail.notaRouting.direct} reply={detail.notaRouting.isReply}
            primary={detail.letter.routing_target_user_id} initialRecipients={detail.notaRouting.additionalRecipients.map(notaOption)}
            {...notaOptions(detail.notaRouting.authorRole, detail.notaRouting.authorId, detail.notaRouting.direct)}/>
        </>}
        {direction==="INCOMING"&&<div className="field">
          <label>Ditujukan Kepada</label><select className="select" name="recipient" defaultValue={detail.letter.recipient||recipients.defaultRecipient} required>
            {[...new Set([recipients.defaultRecipient,...recipients.recipients,detail.letter.recipient].filter(Boolean))].map((name:any)=><option key={name}>{name}</option>)}
          </select>
        </div>}
        {direction==="INCOMING"&&(detail.business||detail.letter.status==="SECRETARIAT_INTAKE")&&<>
          <div className="field"><label>Nomor Dokumen Asal</label><input className="input" name="external_number" defaultValue={detail.letter.external_number||""} required/></div>
          <div className="field"><label>Tanggal Diterima</label><input className="input" type="date" name="received_date" defaultValue={String(detail.letter.received_date||"").slice(0,10)} required/></div>
        </>}
        {detail.v11&&direction==="INCOMING"&&<>
          <UnitField value={detail.v11.requesting_unit}/>
          <label className="field"><span>Manager Tujuan</span><select className="select" name="routing_target_user_id"
            defaultValue={detail.letter.routing_target_user_id||""} required>
            <option value="">Pilih Manager</option>
            {officialManagers.map(account=><option key={account.id} value={account.id}>{reviewerLabel(account)}</option>)}
          </select></label>
          <ReceiptFields initial={detail.v11}/>
        </>}
        {detail.v11?.kind==="PERSEKOT"&&<PersekotFields proof={detail.v11.spb_attachment_id}/>}
        <div className="field"><label>Sifat</label><select className="select" name="confidentiality" defaultValue={detail.letter.confidentiality} disabled={detail.notaRouting?.isReply}><option>BIASA</option><option>PENTING</option><option>RAHASIA</option></select></div>
        <label className="field full"><span>{direction==="INTERNAL"?"Isi Nota Dinas":"Ringkasan"}</span>
          <textarea className="textarea" name="summary" defaultValue={detail.letter.summary||""}/></label>
        <label className="field full"><span>Catatan</span>
          <textarea className="textarea" name="notes" defaultValue={detail.letter.notes||""}/></label>
        {detail.notaRouting?.drafter&&(isRoot||detail.notaRouting.authorId===user.id)&&<label className="field full">
          <span>Arahan untuk Staff</span>
          <textarea className="textarea" name="nota_draft_instruction" maxLength={5000}
            defaultValue={detail.notaRouting.draftInstruction||""}/></label>}
        {!detail.v11&&<div className="field full"><label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500}}><input type="checkbox" name="is_public" defaultChecked={Boolean(detail.letter.is_public)}/> Public</label><span className="hint">Dokumen RAHASIA tidak dapat dibuat public. Root Admin tetap dapat melihat seluruh data.</span></div>}
        {canChangeSource()&&<div className="field full">
          <ReferencePicker kind="source" letterId={detail.letter.id} selected={sourceLetter} onChange={setSourceLetter} limit={1}/>
        </div>}
        {detail.business&&<BusinessDocumentFields documentType={detail.letter.document_type} outgoing={direction==="OUTGOING"} initial={detail.business} letterId={detail.letter.id} requireDueDate={Boolean(detail.v11)&&detail.letter.document_type===INVOICE_INCOMING}/>}
        <div className="field full" style={{display:"flex",flexDirection:"row",justifyContent:"flex-end",gap:8}}><button type="button" className="btn btn-secondary" onClick={()=>setEditOpen(false)}>Batal</button><button className="btn btn-primary">Simpan Perubahan</button></div>
      </form>
    </Modal>}

    {pendingAction&&detail&&<Modal title={pendingAction.label} subtitle="Catatan dan lampiran pada aksi ini akan tersimpan permanen pada riwayat proses dan Audit Log." onClose={()=>!actionBusy&&setPendingAction(null)}>
      <form className="form-grid workflow-form" onSubmit={submitAction}>
        {error&&<div className="field full error" role="alert">{error}</div>}
        {pendingAction.action==="REGISTER_INCOMING"&&<div className="field full">
          <label>Teruskan Kepada</label>
          <select aria-label="Teruskan kepada" className="select" name="routing_target_user_id" defaultValue={detail.letter.routing_target_user_id||""} required>
            <option value="">Pilih tujuan...</option>
            {(detail.v11?officialManagers:routingUsers.filter(isReviewer)).map(account=><option key={account.id} value={account.id}>{reviewerLabel(account)}</option>)}
          </select>
        </div>}
        {pendingAction.action==="REGISTER_INCOMING"&&detail.v11&&<>
          {receiptFile&&<div className="field full notice">
            <b>Bukti serah terima yang sudah diunggah</b><span>{receiptFile.original_name}</span>
            <AttachmentActions id={receiptFile.id} name={receiptFile.original_name}/>
          </div>}
          <ReceiptFields initial={{...detail.v11,date:String(detail.letter.received_date||"").slice(0,10)}} register upload/>
        </>}
        {pendingAction.action==="APPROVE_FINAL"&&<p className="field full notice">Surat berstatus Disetujui di level Anda. Pilih Teruskan ke Dirops atau Dirut di detail jika perlu persetujuan dari atas. Tindak lanjut dan pembayaran mengikuti prosesnya masing-masing.</p>}
        {["SEND_NOTA_DIRECT","SEND_NOTA_REPLY"].includes(pendingAction.action)&&<p className="field full notice">
          PDF bertanda tangan akan tersedia bagi {[detail.letter.recipient,
            ...detail.notaRouting.additionalRecipients.map((account:RoutingUser)=>notaOption(account).label)].join(", ")}.
        </p>}
        {pendingAction.action==="UNDO_APPROVAL"&&<p className="field full notice">Surat kembali ke reviewer sebelum persetujuan ini. Koreksi tersedia selama tahap berikutnya belum memproses surat atau tanda tangan.</p>}
        {pendingAction.action==="MARK_SENT"&&detail.v11&&<>
          <label className="field"><span>Kanal Pengiriman</span><select className="select" name="dispatch_channel" required>
            <option value="">Pilih kanal</option>
            {Object.entries(DELIVERY_METHODS).map(([key,text])=><option value={key} key={key}>{text}</option>)}
          </select></label>
          <label className="field"><span>Penerima Pengiriman</span><input className="input" name="dispatch_recipient" defaultValue={detail.letter.recipient||""} required/></label>
          <label className="field full"><span>Bukti Pengiriman</span><input className="input" name="dispatch_file" type="file" accept=".pdf,.jpg,.jpeg,.png" required/></label>
        </>}
        {pendingAction.action==="PREPARE_ISSUE"&&<div className="field full notice"><b>Nomor surat</b> {detail.letter.letter_number}</div>}
        {pendingAction.action==="MARK_SENT"&&<div className="field">
          <label>Tanggal Kirim</label><input aria-label="Tanggal kirim" className="input" type="date" name="sent_date" defaultValue={today()}
            min={String(detail.letter.issued_date||"").slice(0,10)} required/>
        </div>}
        {pendingAction.issue&&<div className="field"><label>Tanggal Terbit</label><input className="input" type="date" name="issued_date" defaultValue={today()} required/><span className="hint">Setelah diterbitkan, status surat menjadi ISSUED dan nomor ledger dikunci sebagai terbit.</span></div>}
        <div className="field full"><label>{pendingAction.requiredComment?"Catatan / Alasan (wajib)":"Catatan Proses (opsional)"}</label><textarea className="textarea" name="comment" required={pendingAction.requiredComment} placeholder={pendingAction.action==="RETURN"?"Jelaskan apa yang harus direvisi oleh Staff...":pendingAction.action==="ISSUE"?"Contoh: Surat final telah ditandatangani dan siap dikirim.":"Catatan keputusan / arahan tambahan..."}/></div>
        {signedIssue&&<>
          <div className="field"><label>Metode Tanda Tangan</label><select aria-label="Metode tanda tangan" className="select" name="signature_method" required value={signatureMethod} onChange={e=>setSignatureMethod(e.target.value)}>
            <option value="">Pilih metode...</option><option value="DIGITAL">Digital</option><option value="BASAH">Basah</option>
            {detail.v11&&<option value="MEKARI_MANUAL">Unggah PDF Mekari manual</option>}
            {outgoingSigned&&<option value="SAVED_SIGNATURE">Gunakan PDF final yang sudah disimpan</option>}
            {detail.v11&&signingReady&&<option value="MEKARI_API">Gunakan PDF final Mekari staging</option>}
          </select></div>
          {signatureMethod!=="MEKARI_API"&&signatureMethod!=="SAVED_SIGNATURE"&&<div className="field full"><label>Naskah Bertanda Tangan</label><input aria-label="Naskah bertanda tangan" className="input" type="file" name="signed_file" accept=".pdf,.jpg,.jpeg,.png" required/>
            <span className="hint">Unggah PDF dari layanan TTD digital atau hasil pindai tanda tangan basah. Maksimal 10 MB.</span>
          </div>}
        </>}
        {pendingAction.action!=="UNDO_APPROVAL"&&<div className="field full"><label>Lampiran Proses <span className="muted">(maksimal {actionFileLimit} file)</span></label><input className="input" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv" onChange={e=>setActionFiles(Array.from(e.target.files||[]).slice(0,actionFileLimit))}/><span className="hint">Maksimal 10 MB per file. Lampiran proses dikompresi bila hasil kompresi lebih kecil dan tetap dapat di-download dari riwayat.</span>{actionFiles.length>0&&<div className="notice" style={{marginTop:7}}>{actionFiles.map(f=><div key={`${f.name}-${f.size}`}>{f.name} • {size(f.size)}</div>)}</div>}</div>}
        <div className="field full" style={{display:"flex",flexDirection:"row",justifyContent:"flex-end",gap:8}}><button type="button" className="btn btn-secondary" disabled={actionBusy} onClick={()=>setPendingAction(null)}>Batal</button><button className={`btn ${["RETURN","RETURN_PREVIOUS","CANCEL","REJECT","UNDO_APPROVAL"].includes(pendingAction.action)?"btn-danger":"btn-primary"}`} disabled={actionBusy}>{actionBusy?"Memproses...":pendingAction.label}</button></div>
      </form>
    </Modal>}
  </main>;
}
