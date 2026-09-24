import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { canCreateInternal, canCreateOutgoing, canRegisterIncoming } from "@/lib/permissions";
import { dateOnly, required, str } from "@/lib/http";
import { reserveOutgoingNumber } from "@/lib/numbering";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok:false,error:"Unauthorized" },{status:401});
  const url = new URL(request.url);
  const direction = url.searchParams.get("direction");
  const status = url.searchParams.get("status");
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100),1),2500);

  const where:string[] = ["1=1"];
  const params:unknown[] = [];
  if (direction) { where.push("l.direction=?"); params.push(direction); }
  if (status) { where.push("l.status=?"); params.push(status); }
  if (q) {
    where.push("(l.letter_number LIKE ? OR l.external_number LIKE ? OR l.subject LIKE ? OR l.sender LIKE ? OR l.recipient LIKE ?)");
    const like = `%${q.slice(0,100)}%`;
    params.push(like,like,like,like,like);
  }

  if (user.role !== "ROOT_ADMIN") {
    where.push(`(
      l.is_public=1
      OR l.created_by=?
      OR l.current_owner_user_id=?
      OR (l.current_owner_user_id IS NULL AND l.current_role=?)
      OR EXISTS (
        SELECT 1 FROM siap_dispositions d
        WHERE d.letter_id=l.id AND (d.to_user_id=? OR d.from_user_id=?)
      )
      OR EXISTS (
        SELECT 1 FROM siap_letter_actions a
        WHERE a.letter_id=l.id AND a.actor_user_id=?
      )
    )`);
    params.push(user.id,user.id,user.role,user.id,user.id,user.id);
  }

  params.push(limit);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT l.*, u.name AS creator_name, nf.name AS format_name, nf.code AS format_code,
      nl.seq_base, nl.variant,
      COALESCE(NULLIF(l.legacy_number_text,''),
        CASE WHEN nl.seq_base IS NULL THEN NULL
             WHEN nl.variant>0 THEN CONCAT(nl.seq_base,'.',nl.variant)
             ELSE CAST(nl.seq_base AS CHAR) END) AS display_number,
      (SELECT COUNT(*) FROM siap_attachments a WHERE a.letter_id=l.id) AS attachment_count
     FROM siap_letters l
     JOIN siap_users u ON u.id=l.created_by
     LEFT JOIN siap_number_formats nf ON nf.id=l.number_format_id
     LEFT JOIN siap_number_ledger nl ON nl.letter_id=l.id
     WHERE ${where.join(" AND ")}
     ORDER BY l.letter_date DESC, l.created_at DESC
     LIMIT ?`,
    params
  );
  return NextResponse.json({ ok:true,data:rows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok:false,error:"Unauthorized" },{status:401});
  try {
    const body = await request.json();
    const direction = required(body.direction,"Arah dokumen",20).toUpperCase();
    if (!["INCOMING","OUTGOING","INTERNAL"].includes(direction)) throw new Error("Arah dokumen tidak valid.");

    if (direction==="INCOMING" && !canRegisterIncoming(user.role)) {
      return NextResponse.json({ok:false,error:"Hanya Staff atau Root Admin yang dapat meregistrasi surat masuk."},{status:403});
    }
    if (direction==="OUTGOING" && !canCreateOutgoing(user.role)) {
      return NextResponse.json({ok:false,error:"Surat keluar disusun oleh Staff Administrasi. Root Admin tetap dapat membuatnya sebagai superuser."},{status:403});
    }
    if (direction==="INTERNAL" && !canCreateInternal(user.role)) {
      return NextResponse.json({ok:false,error:"Pengajuan internal dari Staff hanya dapat dibuat Staff atau Root Admin."},{status:403});
    }

    const id = crypto.randomUUID();
    const documentType = required(body.document_type,"Jenis dokumen",80);
    const subject = required(body.subject,"Perihal",500);
    const letterDate = dateOnly(body.letter_date,"Tanggal dokumen");
    const confidentiality = ["BIASA","PENTING","RAHASIA"].includes(String(body.confidentiality||"").toUpperCase())
      ? String(body.confidentiality).toUpperCase() : "BIASA";
    const today = new Date().toISOString().slice(0,10);
    const isBackdated = letterDate < today ? 1 : 0;
    const requestedPublic = body.is_public === true;
    const isPublic = confidentiality === "RAHASIA"
      ? 0
      : direction === "INTERNAL"
        ? (requestedPublic ? 1 : 0)
        : (body.is_public === false ? 0 : 1);

    if (direction==="INCOMING") {
      const externalNumber = required(body.external_number,"Nomor surat asal",255);
      const sender = required(body.sender,"Asal/pengirim",255);
      const receivedDate = dateOnly(body.received_date || today,"Tanggal diterima");
      await db.execute(
        `INSERT INTO siap_letters
         (id,direction,document_type,external_number,subject,sender,letter_date,received_date,confidentiality,summary,notes,status,current_role,is_public,is_backdated,created_by,updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,"INCOMING",documentType,externalNumber,subject,sender,letterDate,receivedDate,confidentiality,
         str(body.summary,5000)||null,str(body.notes,5000)||null,"MANAGER_REVIEW","MANAGER",isPublic,isBackdated,user.id,user.id]
      );
      await db.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
        [crypto.randomUUID(),id,user.id,"REGISTER_INCOMING",null,"MANAGER_REVIEW",str(body.notes,5000)||null]
      );
    } else if (direction==="INTERNAL") {
      if (documentType !== "NOTA_DINAS") {
        throw new Error("Dokumen internal Staff ke atasan harus Nota Dinas.");
      }
      const recipient = required(body.recipient,"Tujuan Manager/Unit",255);
      const sender = user.unit_name || user.name;
      await db.execute(
        `INSERT INTO siap_letters
         (id,direction,document_type,subject,sender,recipient,letter_date,confidentiality,summary,notes,status,current_role,is_public,is_backdated,created_by,updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,"INTERNAL",documentType,subject,sender,recipient,letterDate,confidentiality,
         str(body.summary,5000)||null,str(body.notes,5000)||null,"DRAFT","STAFF",isPublic,isBackdated,user.id,user.id]
      );
      await db.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
        [crypto.randomUUID(),id,user.id,"CREATE_INTERNAL",null,"DRAFT",str(body.notes,5000)||null]
      );
    } else {
      const recipient = required(body.recipient,"Tujuan surat",255);
      const formatId = required(body.number_format_id,"Format nomor",36);
      const issuedDate = body.issued_date ? dateOnly(body.issued_date,"Tanggal terbit") : null;
      const requestedSeqBase = body.custom_number_base==null || String(body.custom_number_base).trim()===""
        ? null
        : Number(body.custom_number_base);
      if(requestedSeqBase!==null && (!Number.isInteger(requestedSeqBase) || requestedSeqBase<1)) throw new Error("Nomor dasar custom harus angka bulat minimal 1.");
      await withTransaction(async conn => {
        await conn.execute(
          `INSERT INTO siap_letters
           (id,direction,document_type,number_format_id,subject,recipient,letter_date,issued_date,confidentiality,summary,notes,status,current_role,is_public,is_backdated,created_by,updated_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id,"OUTGOING",documentType,formatId,subject,recipient,letterDate,issuedDate,confidentiality,
           str(body.summary,5000)||null,str(body.notes,5000)||null,"DRAFT","STAFF",isPublic,isBackdated,user.id,user.id]
        );
        const num = await reserveOutgoingNumber({
          conn,formatId,letterId:id,letterDate,userId:user.id,documentType,requestedSeqBase
        });
        await conn.execute(`UPDATE siap_letters SET letter_number=? WHERE id=?`,[num.rendered,id]);
        await conn.execute(
          `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
           VALUES (?,?,?,?,?,?,?)`,
          [crypto.randomUUID(),id,user.id,"CREATE_OUTGOING",null,"DRAFT",`Nomor direservasi: ${num.rendered}`]
        );
      });
    }

    await auditLog({userId:user.id,action:"LETTER_CREATE",entityType:"LETTER",entityId:id,metadata:{direction,documentType,subject,isBackdated:Boolean(isBackdated),customNumberBase:body.custom_number_base||null},request});
    const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM siap_letters WHERE id=? LIMIT 1`,[id]);
    return NextResponse.json({ok:true,data:rows[0]},{status:201});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Gagal membuat dokumen."},{status:400});
  }
}
