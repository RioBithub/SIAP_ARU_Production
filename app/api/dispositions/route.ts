import { paymentKind } from "@/lib/v11-payment-documents";
import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { canCreateDisposition } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";
import { required, str } from "@/lib/http";
import { letterAccess } from "@/lib/letter-access";
import { dispositionAccess } from "@/lib/disposition-access";
import { missingDiropsReview } from "@/lib/disposition-history";
import { resultRequirement, reviewRole } from "@/lib/correspondence-workflow";
import { INVOICE_INCOMING } from "@/lib/business-documents";
import { taskPurpose, v11Enabled, v11Letter } from "@/lib/v11-data";
import { letterCanBeDisposed } from "@/lib/v11-workflow";
import { assertInvoiceVerificationAssignment, assertPaymentRequestAssignment, dispositionDeadlineInput, dispositionTarget } from "@/lib/disposition-assignment";
import { preparePaymentTask } from "@/lib/v11-finance";

export const runtime="nodejs";

export async function GET() {
  const user=await getCurrentUser();
  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const access = dispositionAccess(user);

  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT d.*,
      l.subject,l.letter_number,l.external_number,l.direction,l.document_type,l.confidentiality,v.purpose,
      fu.name AS from_name,fu.role AS from_role,
      tu.name AS to_name,tu.role AS to_role,
      cu.name AS current_owner_name,cu.role AS current_owner_role,
      ${missingDiropsReview} AS needs_dirops_review,
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

    const { date: due, time: dueTime } = dispositionDeadlineInput(b);

    const requestedParentId = str(b.parent_id, 36) || null;
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

      let parentId = requestedParentId;
      if (!parentId && purpose === "GENERAL" && ["MANAGER","DIRECTOR_OPS"].includes(user.role)) {
        const [parents] = await conn.query<RowDataPacket[]>(
          `SELECT id FROM siap_dispositions WHERE letter_id=? AND to_user_id=?
           AND status IN ('UNSEEN','SEEN','IN_PROGRESS') LIMIT 2`, [letterId, user.id],
        );
        if (parents.length > 1) {
          throw new Error("Ada beberapa disposisi aktif untuk surat ini. Buka tugas asal dan pilih Teruskan ke PIC.");
        }
        parentId = parents[0]?.id ?? null;
      }

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
        if (!parent || parent.letter_id !== letterId ||
            ((strict || user.role !== "ROOT_ADMIN") && parent.to_user_id !== user.id)) {
          throw new Error("Delegasi hanya dapat dibuat untuk disposisi asal yang sedang Anda kerjakan.");
        }
        if (parent.status !== "IN_PROGRESS") {
          throw new Error("Buka dan mulai disposisi asal sebelum meneruskannya ke PIC.");
        }
      }

      const target = await dispositionTarget(conn, user, toUserId, strict, purpose);
      if (workflow && letter.document_type === INVOICE_INCOMING && target.role === "FINANCE" && purpose !== "INVOICE_PAYMENT") {
        throw new Error("Finance menerima invoice hanya untuk instruksi pembayaran setelah persetujuan.");
      }
      if (purpose === "INVOICE_VERIFY") {
        await assertInvoiceVerificationAssignment(conn, user, letter, workflow!, target);
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
        await assertPaymentRequestAssignment(conn, user, letter, workflow!, target, parentId);
      }
      const taskVisibility = purpose !== "GENERAL" ? "PRIVATE"
        : (workflow || letter.confidentiality === "RAHASIA") && visibility === "PUBLIC" ? "ROUTE" : visibility;

      const id=crypto.randomUUID();
      const actionId=crypto.randomUUID();

      await conn.execute(
        `INSERT INTO siap_dispositions
         (id,letter_id,parent_id,from_user_id,to_user_id,current_owner_user_id,
          visibility,instruction,status,priority,due_date,due_time,result_requirement)
         VALUES (?,?,?,?,?,?,?,?,'UNSEEN',?,?,?,?)`,
        [
          id,letterId,parentId,user.id,toUserId,toUserId,
          taskVisibility,instruction,priority,due,dueTime,requirement
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
        metadata:{letterId,toUser:toUserId,visibility:taskVisibility,priority,due,dueTime,parentId,resultRequirement:requirement,purpose,
          to:"UNSEEN",note:instruction.slice(0,240)},
        request
      }, conn);
      return { id, parent_id: parentId };
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
