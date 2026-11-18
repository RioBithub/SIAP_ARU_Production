import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { auditLog } from "@/lib/audit";
import { db, withTransaction } from "@/lib/db";
import type { SessionUser } from "@/lib/types";
import { deleteStoredFile } from "@/lib/upload";

function blocked(error: string) {
  return { status: 409, error };
}

async function purgeBlocker(conn: PoolConnection, id: string) {
  const [[checks]] = await conn.query<RowDataPacket[]>(
    `SELECT
      (EXISTS(SELECT 1 FROM siap_v11_letters WHERE letter_id=? AND payable_id IS NOT NULL)
       OR EXISTS(SELECT 1 FROM siap_v11_payments WHERE letter_id=?)) AS finance,
      (EXISTS(SELECT 1 FROM siap_business_documents WHERE invoice_spk_id=? AND letter_id<>?)
       OR EXISTS(SELECT 1 FROM siap_spk_letter_links WHERE supporting_letter_id=? AND spk_letter_id<>?)) AS business,
      (EXISTS(SELECT 1 FROM siap_v11_signing WHERE letter_id=? AND status IN ('REQUESTING','IN_PROGRESS','RECONCILE'))
       OR EXISTS(SELECT 1 FROM siap_v11_attachment_signing s
         JOIN siap_attachments a ON a.id=s.source_attachment_id
         LEFT JOIN siap_dispositions d ON d.id=a.disposition_id
         WHERE (a.letter_id=? OR d.letter_id=?) AND s.status IN ('REQUESTING','IN_PROGRESS','RECONCILE'))) AS signing,
      EXISTS(SELECT 1 FROM siap_dispositions d
        LEFT JOIN siap_v11_dispositions v ON v.disposition_id=d.id
        LEFT JOIN siap_disposition_actions x ON x.disposition_id=d.id AND v.disposition_id IS NULL
        WHERE d.letter_id<>? AND d.status NOT IN ('COMPLETED','RETURNED','CANCELLED')
          AND (v.result_letter_id=? OR x.result_letter_id=?)) AS result`,
    [id, id, id, id, id, id, id, id, id, id, id, id],
  );
  if (checks.finance) return "Surat terhubung ke utang atau catatan pembayaran Finance.";
  if (checks.business) return "Surat masih dipakai sebagai rujukan SPK atau dokumen pendukung surat lain.";
  if (checks.signing) return "Permintaan tanda tangan masih aktif. Pulihkan surat untuk memeriksa statusnya.";
  if (checks.result) return "Surat masih menjadi hasil disposisi lain yang sedang berjalan.";
  return null;
}

export async function permanentlyDeleteLetter(user: SessionUser, id: string, reason: string, request: Request) {
  return withTransaction(async conn => {
    const [[letter]] = await conn.query<RowDataPacket[]>(
      "SELECT id,direction,status,deleted_at FROM siap_letters WHERE id=? FOR UPDATE", [id],
    );
    if (!letter) return { status: 404, error: "Surat tidak ditemukan." };
    if (!letter.deleted_at) return blocked("Pindahkan surat ke Sampah sebelum menghapus permanen.");
    const blocker = await purgeBlocker(conn, id);
    if (blocker) return blocked(blocker);

    const [files] = await conn.query<RowDataPacket[]>(
      `SELECT a.storage_path FROM siap_attachments a LEFT JOIN siap_dispositions d ON d.id=a.disposition_id
       WHERE a.letter_id=? OR d.letter_id=?`, [id, id],
    );
    const [[tasks]] = await conn.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM siap_dispositions WHERE letter_id=?", [id],
    );

    await conn.execute(
      `DELETE n FROM siap_v11_notifications n
       LEFT JOIN siap_dispositions d ON n.entity_type='DISPOSITION' AND d.id=n.entity_id
       WHERE (n.entity_type='LETTER' AND n.entity_id=?) OR d.letter_id=?`, [id, id],
    );
    await conn.execute(
      `DELETE s FROM siap_v11_attachment_signing s
       JOIN siap_attachments a ON a.id=s.source_attachment_id
       LEFT JOIN siap_dispositions d ON d.id=a.disposition_id
       WHERE a.letter_id=? OR d.letter_id=?`, [id, id],
    );
    await conn.execute(
      `DELETE e FROM siap_v11_signing_events e JOIN siap_v11_signing s ON s.id=e.signing_id
       WHERE s.letter_id=?`, [id],
    );
    await conn.execute("DELETE FROM siap_v11_signing WHERE letter_id=?", [id]);
    await conn.execute("DELETE FROM siap_v11_payment_documents WHERE letter_id=?", [id]);
    await conn.execute("DELETE FROM siap_v11_payment_recipients WHERE letter_id=?", [id]);
    await conn.execute(
      `DELETE v FROM siap_v11_dispositions v JOIN siap_dispositions d ON d.id=v.disposition_id
       WHERE d.letter_id=?`, [id],
    );
    await conn.execute("UPDATE siap_v11_dispositions SET result_letter_id=NULL WHERE result_letter_id=?", [id]);
    await conn.execute("DELETE FROM siap_v11_letters WHERE letter_id=?", [id]);

    await conn.execute(
      `UPDATE siap_number_ledger SET status='CANCELLED',cancelled_reason='Surat dihapus permanen'
       WHERE letter_id=? AND status='RESERVED'`, [id],
    );
    await conn.execute("DELETE FROM siap_letters WHERE id=?", [id]);

    const paths = [...new Set(files.map(file => String(file.storage_path)))];
    if (paths.length) {
      await conn.query("INSERT INTO siap_letter_purge_files (letter_id,storage_path) VALUES ?",
        [paths.map(file => [id, file])]);
    }

    await auditLog({ user, action: "LETTER_PURGE", entityType: "LETTER", entityId: id,
      metadata: { reason, direction: letter.direction, status: letter.status,
        dispositions: Number(tasks.total), attachments: files.length }, request }, conn);
    return { status: 200 };
  });
}

export async function pendingPurgeFiles(letterId?: string) {
  const where = letterId ? " WHERE letter_id=?" : "";
  const [[row]] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM siap_letter_purge_files" + where, letterId ? [letterId] : [],
  );
  return Number(row.total);
}

export async function retryPurgeFiles(letterId?: string) {
  const where = letterId ? " WHERE letter_id=?" : "";
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id,storage_path FROM siap_letter_purge_files" + where + " ORDER BY id LIMIT 100", letterId ? [letterId] : [],
  );
  for (const row of rows) {
    try {
      const [[referenced]] = await db.query<RowDataPacket[]>(
        "SELECT 1 FROM siap_attachments WHERE storage_path=? LIMIT 1", [row.storage_path],
      );
      if (!referenced) await deleteStoredFile(row.storage_path);
      await db.execute("DELETE FROM siap_letter_purge_files WHERE id=?", [row.id]);
    } catch {
      // Keep this path queued so Root Admin can retry after storage is available.
    }
  }
  return pendingPurgeFiles(letterId);
}
