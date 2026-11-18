import { paymentKind, requirePaymentDocuments } from "@/lib/v11-payment-documents";
import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { canCreateDisposition } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";
import { dateOnly, required, str } from "@/lib/http";
import { letterAccess } from "@/lib/letter-access";
import { dispositionAccess } from "@/lib/disposition-access";
import { resultRequirement, reviewRole } from "@/lib/correspondence-workflow";
import { INVOICE_INCOMING } from "@/lib/business-documents";
import { officialManager, taskPurpose, v11Enabled, v11Letter } from "@/lib/v11-data";
import { dispositionTargetRoles, staffCanVerify, staffUnit, unitManagerScope } from "@/lib/v11-workflow";
import { preparePaymentTask } from "@/lib/v11-finance";

export const runtime="nodejs";

function letterCanBeDisposed(direction:string,status:string){
  if(direction==="OUTGOING") return status==="ISSUED";
  return ["APPROVED","DISPOSED","IN_PROGRESS","COMPLETED"].includes(status);
}

export async function GET() {
  const user=await getCurrentUser();
  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const access = dispositionAccess(user);

  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT d.*,
      l.subject,l.letter_number,l.external_number,l.direction,l.document_type,v.purpose,
      fu.name AS from_name,fu.role AS from_role,
      tu.name AS to_name,tu.role AS to_role,
      cu.name AS current_owner_name,cu.role AS current_owner_role,
      (SELECT COUNT(*) FROM siap_attachments a WHERE a.disposition_id=d.id) AS attachment_count
     FROM siap_dispositions d
     JOIN siap_letters l ON l.id=d.letter_id
     LEFT JOIN siap_v11_dispositions v ON v.disposition_id=d.id
     JOIN siap_users fu ON fu.id=d.from_user_id
     JOIN siap_users tu ON tu.id=d.to_user_id
     LEFT JOIN siap_users cu ON cu.id=d.current_owner_user_id
     WHERE ${access.clause}
     ORDER BY d.created_at DESC
     LIMIT 300`,
    access.params
  );

  return NextResponse.json({ok:true,data:rows});
}

export async function POST(request:Request) {
  const user=await getCurrentUser();

  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  if(!canCreateDisposition(user.role))
    return NextResponse.json({ok:false,error:"Role Anda tidak dapat membuat disposisi."},{status:403});

  try{
    const b=await request.json();
    const letterId=required(b.letter_id,"Dokumen",36);
    const toUserId=required(b.to_user_id,"Penerima disposisi",36);
    const instruction=required(b.instruction,"Instruksi",5000);

    if(String(toUserId)===String(user.id))
      throw new Error("Disposisi tidak dapat dikirim kepada diri sendiri.");

    const visibility=["PUBLIC","ROUTE","PRIVATE"].includes(String(b.visibility||"").toUpperCase())
      ? String(b.visibility).toUpperCase()
      : "ROUTE";

    const priority=["NORMAL","HIGH","URGENT"].includes(String(b.priority||"").toUpperCase())
      ? String(b.priority).toUpperCase()
      : "NORMAL";

    const due=b.due_date ? dateOnly(b.due_date,"Target selesai") : null;

    const parentId = str(b.parent_id, 36) || null;
    const purpose = taskPurpose(b.purpose);
    const requirement = purpose === "GENERAL" ? resultRequirement(b.result_requirement) : "ATTACHMENT";
    const data = await withTransaction(async conn => {
      const access = letterAccess(user);
      const [letters]=await conn.query<RowDataPacket[]>(
        `SELECT l.* FROM siap_letters l WHERE l.id=? AND ${access.clause} LIMIT 1 FOR UPDATE`,
        [letterId, ...access.params],
      );

      const letter=letters[0];
      if (!letter) return null;
      const workflow = await v11Letter(letterId, conn);
      const strict = Boolean(workflow) || v11Enabled();
      const requestKind = paymentKind(workflow, letter.document_type);
      const notePayment = requestKind === "PERSEKOT" || requestKind === "PAYMENT_REQUEST";
      if ((purpose === "INVOICE_VERIFY" || purpose === "INVOICE_PAYMENT") && requestKind !== "INVOICE") {
        throw new Error("Tujuan verifikasi atau pembayaran invoice hanya berlaku pada Invoice Masuk V11.");
      }
      if (purpose === "REQUEST_PAYMENT" && !notePayment) {
        throw new Error("Pilih Nota Dinas pengajuan pembayaran atau persekot.");
      }

      const letterStatus=String(letter.status);
      const direction=String(letter.direction);

      const inReview = Boolean(workflow) && direction === "INCOMING" && Boolean(reviewRole(letterStatus));
      if (inReview && !parentId &&
          (reviewRole(letterStatus) !== user.role || letter.current_owner_user_id !== user.id)) return null;
      if ((!inReview && !letterCanBeDisposed(direction, letterStatus)) || (workflow && letterStatus === "COMPLETED")) {
        throw new Error("Dokumen tidak berada pada tahap yang dapat ditindaklanjuti.");
      }

      if (parentId) {
        const [parents] = await conn.query<RowDataPacket[]>(
          "SELECT letter_id,to_user_id,status FROM siap_dispositions WHERE id=? LIMIT 1 FOR UPDATE",
          [parentId],
        );
        const parent = parents[0];
        if (!parent || parent.letter_id !== letterId || parent.status !== "IN_PROGRESS" ||
            ((strict || user.role !== "ROOT_ADMIN") && parent.to_user_id !== user.id)) {
          throw new Error("Delegasi hanya dapat dibuat untuk disposisi asal yang sedang Anda kerjakan.");
        }
      }

      const [targets]=await conn.query<RowDataPacket[]>(
        `SELECT id,name,role,unit_name
         FROM siap_users
         WHERE id=? AND is_active=1
         LIMIT 1`,
        [toUserId]
      );

      const target=targets[0];
      if(!target) throw new Error("Penerima disposisi tidak ditemukan atau tidak aktif.");

      if (!dispositionTargetRoles(user.role, strict).includes(target.role)) {
        throw new Error("Penerima tidak sesuai jalur delegasi disposisi.");
      }
      if (strict && target.role === "MANAGER") await officialManager(conn, target.id);
      if (strict && user.role === "MANAGER") {
        const manager = await officialManager(conn, user.id);
        const targetScope = target.role === "FINANCE" ? "KSU" : unitManagerScope(staffUnit(target.unit_name));
        if (targetScope && targetScope !== manager.scope) throw new Error("Penerima berada di bawah Manager lain.");
      }
      if (workflow && letter.document_type === INVOICE_INCOMING && target.role === "FINANCE" && purpose !== "INVOICE_PAYMENT") {
        throw new Error("Finance menerima invoice hanya untuk instruksi pembayaran setelah persetujuan.");
      }
      if (purpose === "INVOICE_VERIFY") {
        if (user.role !== "MANAGER" || letterStatus !== "MANAGER_REVIEW" || letter.current_owner_user_id !== user.id ||
            letter.routing_target_user_id !== user.id || target.role !== "STAFF" ||
            !staffCanVerify(workflow!.requesting_unit, target.unit_name)) {
          throw new Error("Manager reviewer harus menugaskan verifikasi kepada Staff unit pemohon.");
        }
        await officialManager(conn, user.id, workflow!.requesting_unit);
        const [prior] = await conn.query<RowDataPacket[]>(
          `SELECT 1 FROM siap_dispositions d JOIN siap_v11_dispositions v ON v.disposition_id=d.id
           WHERE d.letter_id=? AND v.purpose='INVOICE_VERIFY' AND v.invoice_revision=?
             AND d.status NOT IN ('RETURNED','CANCELLED') LIMIT 1`, [letterId, workflow!.invoice_revision],
        );
        if (prior.length) throw new Error("Revisi ini sudah memiliki tugas verifikasi.");
      }
      if (purpose === "INVOICE_PAYMENT") {
        if (parentId || user.role !== "MANAGER" || target.role !== "FINANCE") {
          throw new Error("Manager Keuangan menugaskan pembayaran langsung kepada Finance.");
        }
        await preparePaymentTask(conn, letter, workflow!, user.id);
      }
      if (notePayment && target.role === "FINANCE" && purpose !== "REQUEST_PAYMENT") {
        throw new Error("Pilih instruksi pembayaran pengajuan untuk menugaskan Finance.");
      }
      if (purpose === "REQUEST_PAYMENT") {
        if (parentId || user.role !== "MANAGER" || target.role !== "FINANCE" || letterStatus !== "APPROVED") {
          throw new Error("Manager KSU menugaskan Nota Dinas yang telah disetujui langsung kepada Finance.");
        }
        const manager = await officialManager(conn, user.id);
        if (manager.scope !== "KSU") throw new Error("Instruksi bayar hanya dapat dibuat Manager KSU.");
        await requirePaymentDocuments(conn, letterId, workflow!, letter.document_type);
        const [prior] = await conn.query<RowDataPacket[]>(
          `SELECT 1 FROM siap_dispositions d JOIN siap_v11_dispositions v ON v.disposition_id=d.id
           WHERE d.letter_id=? AND v.purpose='REQUEST_PAYMENT' AND d.status NOT IN ('RETURNED','CANCELLED') LIMIT 1`,
          [letterId],
        );
        if (prior.length) throw new Error("Sudah ada instruksi pembayaran untuk pengajuan ini.");
      }
      const taskVisibility = purpose !== "GENERAL" ? "PRIVATE"
        : workflow && visibility === "PUBLIC" ? "ROUTE" : visibility;

      const id=crypto.randomUUID();
      const actionId=crypto.randomUUID();

      await conn.execute(
        `INSERT INTO siap_dispositions
         (id,letter_id,parent_id,from_user_id,to_user_id,current_owner_user_id,
          visibility,instruction,status,priority,due_date,result_requirement)
         VALUES (?,?,?,?,?,?,?,?,'UNSEEN',?,?,?)`,
        [
          id,letterId,parentId,user.id,toUserId,toUserId,
          taskVisibility,instruction,priority,due,requirement
        ]
      );

      await conn.execute(
        `INSERT INTO siap_disposition_actions
         (id,disposition_id,actor_user_id,action,from_status,to_status,note)
         VALUES (?,?,?,?,?,?,?)`,
        [actionId,id,user.id,"CREATE",null,"UNSEEN",instruction]
      );

      if (strict) {
        await conn.execute("INSERT INTO siap_v11_dispositions (disposition_id,purpose,invoice_revision) VALUES (?,?,?)",
          [id, purpose, purpose === "INVOICE_VERIFY" ? workflow!.invoice_revision : null]);
      }

      if(!workflow && direction!=="OUTGOING" && ["APPROVED","COMPLETED"].includes(letterStatus)){
        await conn.execute(
          `UPDATE siap_letters SET status='DISPOSED',updated_by=? WHERE id=?`,
          [user.id,letterId]
        );
      }

      await auditLog({
        user,
        action:"DISPOSITION_CREATE",
        entityType:"DISPOSITION",
        entityId:id,
        metadata:{letterId,toUser:toUserId,visibility:taskVisibility,priority,due,parentId,resultRequirement:requirement,purpose},
        request
      }, conn);
      return { id };
    });

    if (!data) return NextResponse.json({ ok:false,error:"Hanya reviewer atau peserta yang berwenang dapat menugaskan dokumen ini." }, { status:403 });
    return NextResponse.json({ok:true,data},{status:201});

  }catch(e){
    return NextResponse.json({
      ok:false,
      error:e instanceof Error?e.message:"Gagal membuat disposisi."
    },{status:400});
  }
}
