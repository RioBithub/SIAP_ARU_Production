import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { dateOnly, required, str } from "@/lib/http";
import { getBusinessDocumentDetails, getBusinessDocumentRow, saveBusinessDocument } from "@/lib/business-document-data";
import { isBusinessDocument, isInvoice } from "@/lib/business-documents";
import { letterAccess } from "@/lib/letter-access";

export const runtime = "nodejs";

export async function GET(_:Request,{params}:{params:{id:string}}) {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const access = letterAccess(user);
  const [letters]=await db.query<RowDataPacket[]>(
    `SELECT l.*,
      u.name creator_name,
      uo.name owner_name,
      uo.unit_name owner_unit,
      rt.name routing_target_name,
      rt.unit_name routing_target_unit,
      nf.name format_name,nf.code format_code,
      nl.seq_base,nl.variant,
      COALESCE(NULLIF(l.legacy_number_text,''), CASE WHEN nl.seq_base IS NULL THEN NULL WHEN nl.variant>0 THEN CONCAT(nl.seq_base,'.',nl.variant) ELSE CAST(nl.seq_base AS CHAR) END) display_number
     FROM siap_letters l
     JOIN siap_users u ON u.id=l.created_by
     LEFT JOIN siap_users uo ON uo.id=l.current_owner_user_id
     LEFT JOIN siap_users rt ON rt.id=l.routing_target_user_id
     LEFT JOIN siap_number_formats nf ON nf.id=l.number_format_id
     LEFT JOIN siap_number_ledger nl ON nl.letter_id=l.id
     WHERE l.id=? AND ${access.clause} LIMIT 1`,[params.id,...access.params]);
  if (!letters[0]) {
    return user.role === "ROOT_ADMIN"
      ? NextResponse.json({ ok: false, error: "Surat tidak ditemukan." }, { status: 404 })
      : NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const [actions]=await db.query<RowDataPacket[]>(
    `SELECT a.*,u.name actor_name FROM siap_letter_actions a JOIN siap_users u ON u.id=a.actor_user_id
     WHERE a.letter_id=? ORDER BY a.created_at ASC`,[params.id]);
  const [attachments]=await db.query<RowDataPacket[]>(
    `SELECT a.id,a.letter_action_id,a.attachment_kind,a.original_name,a.mime_type,a.original_size,a.stored_size,a.is_compressed,a.created_at,
      ua.name uploaded_by_name,la.action process_action,la.from_status process_from_status,la.to_status process_to_status
     FROM siap_attachments a
     JOIN siap_users ua ON ua.id=a.uploaded_by
     LEFT JOIN siap_letter_actions la ON la.id=a.letter_action_id
     WHERE a.letter_id=? ORDER BY a.created_at ASC`,[params.id]);
  const letter = letters[0];
  const business = isBusinessDocument(letter.document_type)
    ? await getBusinessDocumentDetails(user, params.id, letter.document_type)
    : undefined;
  return NextResponse.json({ok:true,data:{letter,actions,attachments,business}});
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const result = await withTransaction(async conn => {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM siap_letters WHERE id=? LIMIT 1 FOR UPDATE", [params.id]);
      const letter = rows[0];
      if (!letter) return 404;

      const business = isBusinessDocument(letter.document_type);
      const managed = business && (isInvoice(letter.document_type) || Boolean(await getBusinessDocumentRow(params.id, conn)));
      const draft = ["DRAFT", "RETURNED_STAFF"].includes(letter.status);
      const owner = letter.created_by === user.id;
      const root = user.role === "ROOT_ADMIN";
      const editable = managed
        ? draft && (owner || root)
        : root || (owner && draft) || (user.role === "STAFF" && letter.status === "RETURNED_STAFF");
      if (!editable) return 403;

      const conf = str(body.confidentiality, 20).toUpperCase();
      const publicValue = typeof body.is_public === "boolean" ? Number(body.is_public) : null;
      const incoming = business && letter.direction === "INCOMING";
      const externalNumber = incoming && body.external_number !== undefined
        ? required(body.external_number, "Nomor dokumen asal", 255) : null;
      const receivedDate = incoming && body.received_date !== undefined
        ? dateOnly(body.received_date, "Tanggal diterima") : null;

      await conn.execute(
        `UPDATE siap_letters SET
         subject=COALESCE(NULLIF(?,''),subject),
         sender=COALESCE(NULLIF(?,''),sender),
         recipient=COALESCE(NULLIF(?,''),recipient),
         external_number=COALESCE(?,external_number),received_date=COALESCE(?,received_date),
         summary=?,notes=?,
         confidentiality=COALESCE(NULLIF(?,''),confidentiality),
         is_public=CASE WHEN COALESCE(NULLIF(?,''),confidentiality)='RAHASIA' THEN 0 ELSE COALESCE(?,is_public) END,
         updated_by=? WHERE id=?`,
        [str(body.subject, 500), str(body.sender, 255), str(body.recipient, 255), externalNumber, receivedDate,
          business && body.summary === undefined ? letter.summary : str(body.summary, 5000) || null,
          business && body.notes === undefined ? letter.notes : str(body.notes, 5000) || null,
          conf, conf, publicValue, user.id, params.id],
      );
      await saveBusinessDocument(conn, user, {
        id: params.id, document_type: letter.document_type, direction: letter.direction,
      }, body.business, false);
      await auditLog({
        userId: user.id, action: "LETTER_UPDATE", entityType: "LETTER", entityId: params.id,
        metadata: business ? { documentType: letter.document_type } : null, request,
      }, conn);
      return 200;
    });
    if (result === 404) return NextResponse.json({ ok: false, error: "Surat tidak ditemukan." }, { status: 404 });
    if (result === 403) return NextResponse.json({ ok: false, error: "Surat tidak dapat diedit pada tahap ini." }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Update gagal." }, { status: 400 });
  }
}
