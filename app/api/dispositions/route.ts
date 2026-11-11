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
import { resultRequirement } from "@/lib/correspondence-workflow";

export const runtime="nodejs";

function allowedTargetRoles(role:string){
  if(role==="PRESIDENT_DIRECTOR") return ["DIRECTOR_OPS","MANAGER","FINANCE","STAFF"];
  if(role==="DIRECTOR_OPS") return ["MANAGER","FINANCE","STAFF"];
  if(role==="MANAGER") return ["FINANCE","STAFF"];
  if(role==="ROOT_ADMIN") return ["PRESIDENT_DIRECTOR","DIRECTOR_OPS","MANAGER","FINANCE","STAFF"];
  return [];
}

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
      l.subject,l.letter_number,l.external_number,l.direction,l.document_type,
      fu.name AS from_name,fu.role AS from_role,
      tu.name AS to_name,tu.role AS to_role,
      cu.name AS current_owner_name,cu.role AS current_owner_role,
      (SELECT COUNT(*) FROM siap_attachments a WHERE a.disposition_id=d.id) AS attachment_count
     FROM siap_dispositions d
     JOIN siap_letters l ON l.id=d.letter_id
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
    const requirement = resultRequirement(b.result_requirement);
    const data = await withTransaction(async conn => {
      const access = letterAccess(user);
      const [letters]=await conn.query<RowDataPacket[]>(
        `SELECT l.id,l.status,l.direction FROM siap_letters l WHERE l.id=? AND ${access.clause} LIMIT 1 FOR UPDATE`,
        [letterId, ...access.params],
      );

      const letter=letters[0];
      if(!letter) throw new Error("Dokumen tidak ditemukan.");

      const letterStatus=String(letter.status);
      const direction=String(letter.direction);

      if(!letterCanBeDisposed(direction,letterStatus))
        throw new Error(
          direction==="OUTGOING"
            ? "Surat keluar baru dapat didisposisikan setelah diterbitkan."
            : "Dokumen baru dapat didisposisikan setelah proses approval selesai."
        );

      if (parentId) {
        const [parents] = await conn.query<RowDataPacket[]>(
          "SELECT letter_id,to_user_id,status FROM siap_dispositions WHERE id=? LIMIT 1 FOR UPDATE",
          [parentId],
        );
        const parent = parents[0];
        if (!parent || parent.letter_id !== letterId || parent.status !== "IN_PROGRESS" ||
            (user.role !== "ROOT_ADMIN" && parent.to_user_id !== user.id)) {
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

      if(user.role!=="ROOT_ADMIN" && !allowedTargetRoles(user.role).includes(String(target.role)))
        throw new Error("Penerima tidak sesuai jalur delegasi disposisi.");

      const id=crypto.randomUUID();
      const actionId=crypto.randomUUID();

      await conn.execute(
        `INSERT INTO siap_dispositions
         (id,letter_id,parent_id,from_user_id,to_user_id,current_owner_user_id,
          visibility,instruction,status,priority,due_date,result_requirement)
         VALUES (?,?,?,?,?,?,?,?,'UNSEEN',?,?,?)`,
        [
          id,letterId,parentId,user.id,toUserId,toUserId,
          visibility,instruction,priority,due,requirement
        ]
      );

      await conn.execute(
        `INSERT INTO siap_disposition_actions
         (id,disposition_id,actor_user_id,action,from_status,to_status,note)
         VALUES (?,?,?,?,?,?,?)`,
        [actionId,id,user.id,"CREATE",null,"UNSEEN",instruction]
      );

      if(direction!=="OUTGOING" && ["APPROVED","COMPLETED"].includes(letterStatus)){
        await conn.execute(
          `UPDATE siap_letters SET status='DISPOSED',updated_by=? WHERE id=?`,
          [user.id,letterId]
        );
      }

      await auditLog({
        userId:user.id,
        action:"DISPOSITION_CREATE",
        entityType:"DISPOSITION",
        entityId:id,
        metadata:{letterId,toUser:toUserId,visibility,priority,due,parentId,resultRequirement:requirement},
        request
      }, conn);
      return { id };
    });

    return NextResponse.json({ok:true,data},{status:201});

  }catch(e){
    return NextResponse.json({
      ok:false,
      error:e instanceof Error?e.message:"Gagal membuat disposisi."
    },{status:400});
  }
}
