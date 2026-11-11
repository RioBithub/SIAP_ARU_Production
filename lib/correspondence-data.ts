import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";
import { REVIEW_ROLES, type ReviewRole } from "@/lib/correspondence-workflow";
import { getAccessibleLetter, letterAccess } from "@/lib/letter-access";
import type { DocumentReference } from "@/lib/business-documents";
import type { SessionUser } from "@/lib/types";

type Queryable = Pick<PoolConnection, "query">;

export async function hasActiveSecretariat(conn: Queryable = db) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT 1 FROM siap_users WHERE role='SECRETARIAT' AND is_active=1 LIMIT 1",
  );
  return rows.length > 0;
}

export async function activeReviewer(conn: Queryable, id: string, roles: ReviewRole[] = REVIEW_ROLES) {
  const [rows] = await conn.query<(RowDataPacket & { id: string; name: string; role: ReviewRole; unit_name: string | null })[]>(
    "SELECT id,name,role,unit_name FROM siap_users WHERE id=? AND is_active=1 AND role IN (" +
      roles.map(() => "?").join(",") + ") LIMIT 1",
    [id, ...roles],
  );
  if (!rows[0]) throw new Error("Tujuan review tidak ditemukan atau tidak aktif.");
  return rows[0];
}

export async function outgoingSources(
  conn: Queryable, user: SessionUser, sourceLetterId: string, sourceDispositionId: string,
) {
  if (sourceDispositionId) {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id,letter_id,to_user_id,status FROM siap_dispositions WHERE id=? LIMIT 1 FOR UPDATE",
      [sourceDispositionId],
    );
    const disposition = rows[0];
    if (!disposition || (user.role !== "ROOT_ADMIN" && disposition.to_user_id !== user.id) ||
        disposition.status !== "IN_PROGRESS") {
      throw new Error("Draf hasil hanya dapat dibuat oleh PIC ketika disposisi sedang dikerjakan.");
    }
    if (sourceLetterId && sourceLetterId !== disposition.letter_id) {
      throw new Error("Dokumen asal harus sesuai dengan disposisi.");
    }
    sourceLetterId = disposition.letter_id;
  }
  if (sourceLetterId) {
    const source = await getAccessibleLetter(user, sourceLetterId, conn);
    if (!source || ["CANCELLED", "REJECTED"].includes(source.status) ||
        (!sourceDispositionId && !["INCOMING", "INTERNAL"].includes(source.direction))) {
      throw new Error("Pilih Surat Masuk atau Nota Dinas asal yang dapat Anda akses.");
    }
  }
  return { sourceLetterId: sourceLetterId || null, sourceDispositionId: sourceDispositionId || null };
}

export async function findDispositionResultLetters(
  conn: Queryable, user: SessionUser,
  disposition: { id: string; letter_id: string; to_user_id: string },
  filters: { id?: string; query?: string } = {},
) {
  const access = letterAccess(user);
  const where = [
    access.clause,
    "l.direction='OUTGOING' AND l.issued_date IS NOT NULL AND l.status IN ('ISSUED','COMPLETED')",
    `(l.source_disposition_id=? OR (
      l.source_disposition_id IS NULL AND l.created_by=? AND (l.source_letter_id IS NULL OR l.source_letter_id=?)
    ) OR EXISTS (
      SELECT 1 FROM siap_dispositions child WHERE child.id=l.source_disposition_id
        AND child.parent_id=? AND child.status='COMPLETED'
    ))`,
  ];
  const params: string[] = [...access.params, disposition.id, disposition.to_user_id, disposition.letter_id, disposition.id];
  if (filters.id) {
    where.push("l.id=?");
    params.push(filters.id);
  }
  if (filters.query) {
    where.push("(l.subject LIKE ? OR l.letter_number LIKE ?)");
    const like = "%" + filters.query.slice(0, 100) + "%";
    params.push(like, like);
  }
  const [rows] = await conn.query<(RowDataPacket & DocumentReference)[]>(
    `SELECT l.id,l.direction,l.letter_number AS number,l.subject,l.status
      FROM siap_letters l WHERE ${where.join(" AND ")} ORDER BY l.issued_date DESC,l.id LIMIT 30`,
    params,
  );
  return rows;
}
