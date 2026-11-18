import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { chromium } from "playwright";
import { fixturePdf } from "./fixture-pdf.mjs";

const env = process.env;
const profile = JSON.parse(await readFile(env.SIAP_V11_STAGE_PROFILE, "utf8"));
const base = new URL(profile.appUrl);
assert.equal(env.SIAP_V11_STAGE, "1");
assert.equal(env.SIAP_V11_MEKARI_MODE, "mock", "Uji demo otomatis memakai mode mock.");
assert.equal(base.hostname, "127.0.0.1");
assert.equal(profile.schema, env.DB_NAME);
assert(/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(env.DB_NAME));
const roles = profile.accounts;
assert(Object.values(roles).every(role => role.email.endsWith("@simulasi.siap.invalid")));
const sql = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
});
const [[marker]] = await sql.query("SELECT id FROM siap_v11_stage_marker");
assert.equal(marker.id, profile.marker);
const cookies = new Map();
const pdf = fixturePdf(["SIMULASI - BUKTI DEMO", "Laporan hasil pemeriksaan atau survei."]);
const today = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Jakarta"}).format(new Date());
const out = path.join(env.SIAP_V11_UAT_OUTPUT, "demo-pak-nor");
await mkdir(out, { recursive:true });

async function call(role, route, body, options = {}) {
  if (role && !cookies.has(role)) {
    const response = await fetch(new URL("/api/auth/login",base), {
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({email:roles[role].email,password:env.SIAP_V11_STAGE_PASSWORD}),
    });
    assert.equal(response.status,200);
    cookies.set(role,response.headers.get("set-cookie").split(";")[0]);
  }
  const headers = role ? {Cookie:cookies.get(role)} : {};
  if (body && !(body instanceof FormData)) headers["Content-Type"]="application/json";
  const response=await fetch(new URL(route,base), {
    method:options.method||(body?"POST":"GET"),headers,
    body:body instanceof FormData?body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(25_000),
  });
  assert.equal(response.status,options.status??200,route);
  if (options.raw) return Buffer.from(await response.arrayBuffer());
  const result=await response.json();
  assert.equal(result.ok,response.ok,route);
  return result.data??result;
}
function form(fields, key="files") {
  const body=new FormData();
  for(const [field,value] of Object.entries(fields)) body.set(field,String(value));
  body.set(key,new Blob([pdf],{type:"application/pdf"}),"SIMULASI-bukti.pdf");
  return body;
}
const letter = (role,id)=>call(role,"/api/letters/"+id);
const action = (role,id,step,fields={},proof=false,status=200)=>call(role,"/api/letters/"+id+"/actions",
  proof?form({action:step,...fields},proof):{action:step,...fields},{status});
const taskAction = (role,id,step,fields={},proof=false)=>call(role,"/api/dispositions/"+id+"/actions",
  proof?form({action:step,...fields}):{action:step,...fields});
const assign = (role,id,target,fields={})=>call(role,"/api/dispositions",{
  letter_id:id,to_user_id:roles[target].id,instruction:"SIMULASI demo Pak Nor",...fields,
},{status:201});
let browser;
try {
  for(let attempt=0;attempt<2;attempt++) {
    const result=spawnSync(process.execPath,["scripts/v11/demo-cases.mjs"],{env,encoding:"utf8",timeout:70_000});
    assert.equal(result.status,0,result.stdout+result.stderr);
    const [[count]]=await sql.query("SELECT COUNT(*) AS total FROM siap_letters WHERE subject LIKE 'SIMULASI DEMO - %'");
    assert.equal(Number(count.total),4,"Seed demo harus dapat diulang tanpa dokumen ganda.");
  }
  const manifest=JSON.parse(await readFile(path.join(path.dirname(env.SIAP_V11_STAGE_PROFILE),"demo-pak-nor.json"),"utf8"));
  const [offer,invoice,project,outgoing]=manifest.cases.map(item=>({...item,id:new URL(item.href,base).searchParams.get("letter_id")}));
  const expectedDue=new Date(Date.parse(today+"T00:00:00Z")+2*86400000).toISOString().slice(0,10);
  assert.equal(offer.due,expectedDue);
  await call(null,"/api/notifications",undefined,{status:401});
  await call("staff","/api/staging/identity",undefined,{status:403});
  assert.equal((await letter("ops",invoice.id)).v11.verification_status,"WAITING_VERIFICATION");
  assert(!(await call("sdm","/api/notifications")).items.some(item=>item.subject.includes("DEMO -")));

  browser=await chromium.launch({executablePath:env.SIAP_V11_CHROMIUM||undefined,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  async function pageFor(role) {
    await call(role,"/api/auth/me");
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const cookie=cookies.get(role);
    await context.addCookies([{name:"siap_session",value:cookie.slice(cookie.indexOf("=")+1),url:base.origin}]);
    const page=await context.newPage();
    page.setDefaultTimeout(20_000);
    return page;
  }
  const managerPage=await pageFor("ops");
  const verificationBadge=managerPage.getByRole("dialog").locator(".kpi-row").filter({hasText:"Verifikasi revisi"});
  await managerPage.goto(new URL(invoice.href,base).href);
  await verificationBadge.getByText("Menunggu Verifikasi",{exact:true}).waitFor();
  assert(await managerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await managerPage.screenshot({path:path.join(out,"01-invoice-menunggu.png")});
  await managerPage.getByRole("button",{name:"Tutup dialog",exact:true}).click();
  await managerPage.getByRole("button",{name:/Notifikasi,/}).click();
  const notice=managerPage.locator(".notification-item").filter({hasText:"Disposisi baru untuk Anda"}).filter({hasText:"PT XYZ"}).first();
  await notice.click();
  await managerPage.waitForURL("**/dispositions?disposition_id="+project.task);
  assert(await managerPage.getByRole("dialog").isVisible());
  await managerPage.screenshot({path:path.join(out,"02-notifikasi-disposisi.png")});

  const verify=await assign("ops",invoice.id,"staff",{purpose:"INVOICE_VERIFY"});
  await taskAction("staff",verify.id,"START");
  await taskAction("staff",verify.id,"SUBMIT_RESULT",{note:"ATK diterima sesuai invoice Rp45 juta."},true);
  const inbox=await call("ops","/api/notifications");
  const review=inbox.items.find(item=>item.href.includes(verify.id)&&item.title.includes("menunggu persetujuan"));
  assert(review&&!review.read_at);
  await call("sdm","/api/notifications",{id:review.id},{method:"PATCH"});
  const [[untouched]]=await sql.query("SELECT read_at FROM siap_v11_notifications WHERE id=?",[review.id]);
  assert.equal(untouched.read_at,null);
  await call("ops","/api/notifications",{id:review.id},{method:"PATCH"});
  const [[firstRead]]=await sql.query("SELECT read_at FROM siap_v11_notifications WHERE id=?",[review.id]);
  await call("ops","/api/notifications",{id:review.id},{method:"PATCH"});
  const [[secondRead]]=await sql.query("SELECT read_at FROM siap_v11_notifications WHERE id=?",[review.id]);
  assert(firstRead.read_at);
  assert.deepEqual(secondRead.read_at,firstRead.read_at);
  assert.equal((await call("ops","/api/notifications")).unread,inbox.unread-1);
  await taskAction("ops",verify.id,"APPROVE_RESULT");
  assert.equal((await letter("ops",invoice.id)).v11.verification_status,"APPROVED");
  await managerPage.goto(new URL(invoice.href,base).href);
  await verificationBadge.getByText("Disetujui",{exact:true}).waitFor();
  await managerPage.screenshot({path:path.join(out,"03-invoice-disetujui.png")});
  await action("ops",invoice.id,"APPROVE_FINAL");
  assert((await call("ksu","/api/notifications")).items.some(item=>item.href.includes(invoice.id)));
  const payment=await assign("ksu",invoice.id,"finance",{purpose:"INVOICE_PAYMENT"});
  assert((await call("finance","/api/notifications")).items.some(item=>item.href.includes(payment.id)));
  await taskAction("finance",payment.id,"START");
  await taskAction("finance",payment.id,"SUBMIT_RESULT",{
    note:"Pembayaran simulasi pengadaan ATK.",payment_amount:"45000000",payment_date:today,
    payment_payee:"CV Sinar Jaya",payment_account:"SIMULASI-REKENING",payment_reference:"SIMULASI-INV115",
    bookkeeping_note:"Pencatatan demo Pak Nor",
  },true);
  await taskAction("ksu",payment.id,"APPROVE_RESULT");
  await action("ksu",invoice.id,"COMPLETE");
  assert.equal(Number((await letter("ksu",invoice.id)).v11.payment.outstanding),0);
  console.log("DEMO-2 PASS verifikasi dan pembayaran Rp45 juta, notifikasi privat dan baca idempoten.");

  const rejectionData={
    direction:"INCOMING",document_type:"INVOICE_MASUK",routing_target_user_id:roles.ops.id,requesting_unit:"OPS",
    subject:"SIMULASI cabang penolakan invoice",sender:"CV Sinar Jaya",external_number:"INV/115-TOLAK",
    letter_date:today,received_date:today,received_time:"10:00",delivery_method:"FISIK",delivered_by:"Kurir Simulasi",received_by:"Sekretariat Simulasi",
    business:{total:"45000000",due_date:today,requires_spk:false},
  };
  const rejected=await call("staff","/api/letters",form({metadata:JSON.stringify(rejectionData)},"original_file"),{status:201});
  await action("secretariat",rejected.id,"REGISTER_INCOMING",{
    routing_target_user_id:roles.ops.id,received_date:today,received_time:"10:00",delivery_method:"FISIK",
    delivered_by:"Kurir Simulasi",received_by:"Sekretariat Simulasi",
  },"receipt_file");
  await action("ops",rejected.id,"REJECT",{comment:"Barang pada invoice simulasi tidak sesuai."});
  assert.equal((await letter("ops",rejected.id)).v11.verification_status,"REJECTED");
  await managerPage.goto(new URL("/letters/incoming?letter_id="+rejected.id,base).href);
  await verificationBadge.getByText("Ditolak",{exact:true}).waitFor();
  await managerPage.screenshot({path:path.join(out,"04-invoice-ditolak.png")});

  const staffPage=await pageFor("staff");
  await staffPage.goto(new URL("/dashboard",base).href);
  const unread=(await call("staff","/api/notifications")).unread;
  await staffPage.getByRole("button",{name:`Notifikasi, ${unread} belum dibaca`,exact:true}).waitFor();
  await taskAction("ops",project.task,"START");
  const survey=await assign("ops",project.id,"staff",{parent_id:project.task,result_requirement:"ATTACHMENT"});
  await staffPage.getByRole("button",{name:`Notifikasi, ${unread+1} belum dibaca`,exact:true}).waitFor();
  await taskAction("staff",survey.id,"START");
  await taskAction("staff",survey.id,"SUBMIT_RESULT",{note:"Survei proyek PT XYZ selesai."},true);
  await taskAction("ops",survey.id,"APPROVE_RESULT");
  await taskAction("ops",project.task,"SUBMIT_RESULT",{note:"Hasil survei Staff disetujui dan diajukan ke Direksi."});
  await taskAction("dirut",project.task,"APPROVE_RESULT");
  await action("dirut",project.id,"APPROVE");
  assert.equal((await letter("dirut",project.id)).letter.status,"APPROVED");
  console.log("DEMO-3 PASS Direksi-Manager-Staff dan laporan naik, notifikasi otomatis di browser.");

  for(const role of ["staff","ops","dirops","dirut"]) await action(role,outgoing.id,role==="staff"?"SUBMIT":"APPROVE");
  assert((await call("secretariat","/api/notifications")).items.some(item=>item.href.includes(outgoing.id)));
  await action("secretariat",outgoing.id,"PREPARE_ISSUE");
  const draft=(await letter("secretariat",outgoing.id)).attachments.find(item=>item.attachment_kind==="ORIGINAL");
  const signing="/api/letters/"+outgoing.id+"/signing";
  await call("secretariat",signing,{action:"START",attachment_id:draft.id},{status:201});
  assert.equal((await call("secretariat",signing,{action:"REFRESH"})).status,"COMPLETED");
  await action("secretariat",outgoing.id,"ISSUE",{issued_date:today,signature_method:"MEKARI_API"});
  await action("staff",outgoing.id,"MARK_SENT",{},false,400);
  await action("secretariat",outgoing.id,"MARK_SENT",{
    sent_date:today,dispatch_channel:"EMAIL",dispatch_recipient:"PT ABC",comment:"Pengiriman simulasi surat balasan.",
  },"dispatch_file");
  const final=await letter("staff",outgoing.id);
  assert(final.letter.letter_number&&final.letter.sent_date&&final.v11.dispatch_attachment_id);
  assert.equal(final.v11.signature_provenance,"MEKARI_MOCK");
  const archive=await call("staff","/api/archive?q=SIMULASI");
  assert(archive.some(item=>item.letter_id===outgoing.id));
  await taskAction("staff",outgoing.task,"SUBMIT_RESULT",{note:"Surat balasan telah terbit.",result_letter_id:outgoing.id});
  await taskAction("ops",outgoing.task,"APPROVE_RESULT");
  await taskAction("ops",offer.task,"SUBMIT_RESULT",{note:"Tanggapan PT ABC selesai.",result_letter_id:outgoing.id});
  await taskAction("dirut",offer.task,"APPROVE_RESULT");
  await action("dirut",offer.id,"APPROVE");
  const history=await call("dirut","/api/dispositions/"+offer.task);
  assert.equal(history.disposition.status,"COMPLETED");
  assert(history.actions.some(item=>item.result_letter?.id===outgoing.id));
  const [duplicates]=await sql.query("SELECT audit_id,recipient_user_id FROM siap_v11_notifications GROUP BY audit_id,recipient_user_id HAVING COUNT(*)>1");
  assert.equal(duplicates.length,0);
  console.log("DEMO-1 PASS penawaran dan tanggapan 2 hari, hasil diterima Direksi dan histori tertaut.");
  console.log("DEMO-4 PASS draf sampai arsip dan bukti kirim, tanda tangan memakai mock.");
} finally {
  await browser?.close();
  await sql.end();
}
