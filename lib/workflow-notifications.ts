import type { PoolConnection, RowDataPacket } from "mysql2/promise";

type Connection = Pick<PoolConnection, "query" | "execute">;

export async function notifyWorkflow(conn: Connection, event: {
  auditId: number; actorId: string | null; action: string; entityType: string; entityId: string | null;
}) {
  if (process.env.SIAP_V11_ENABLED !== "1" || !event.entityId) return;
  const recipients = new Set<string>();
  let title: string;
  if (event.entityType === "LETTER" && event.action === "LETTER_RESPONSE") {
    const [people] = await conn.query<RowDataPacket[]>(
      `SELECT created_by AS user_id FROM siap_letters WHERE id=? AND direction='INTERNAL' AND deleted_at IS NULL
       UNION SELECT current_owner_user_id FROM siap_letters WHERE id=? AND direction='INTERNAL' AND deleted_at IS NULL
       UNION SELECT nota_author_user_id FROM siap_v11_letters WHERE letter_id=?
       UNION SELECT nota_drafter_user_id FROM siap_v11_letters WHERE letter_id=?
       UNION SELECT r.recipient_user_id FROM siap_v11_nota_recipients r
       JOIN siap_letters l ON l.id=r.letter_id WHERE l.id=? AND l.status IN ('APPROVED','COMPLETED') AND l.deleted_at IS NULL
       UNION SELECT actor_user_id FROM siap_letter_actions
       WHERE letter_id=? AND action IN ('RESPONSE','APPROVE','APPROVE_FINAL','RETURN','RETURN_PREVIOUS','REJECT')`,
      Array(6).fill(event.entityId),
    );
    for (const person of people) if (person.user_id) recipients.add(String(person.user_id));
    title = "Tanggapan baru pada Nota Dinas";
  } else if (event.entityType === "LETTER" &&
      ["LETTER_ASSIGN_NOTA_SIGNATURE", "LETTER_UPLOAD_NOTA_SIGNATURE", "LETTER_NOTA_SANDBOX_SIGNED"].includes(event.action)) {
    const [[nota]] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(v.nota_author_user_id,l.created_by) author_id,v.nota_signature_assistant_user_id assistant_id
       FROM siap_letters l JOIN siap_v11_letters v ON v.letter_id=l.id WHERE l.id=? AND l.deleted_at IS NULL`,
      [event.entityId],
    );
    const assignment = event.action === "LETTER_ASSIGN_NOTA_SIGNATURE";
    const recipient = assignment ? nota?.assistant_id : nota?.author_id;
    if (recipient) recipients.add(String(recipient));
    title = assignment ? "Diminta membantu tanda tangan Nota Dinas" : "PDF Nota Dinas bertanda tangan sudah tersedia";
  } else if (event.entityType === "LETTER" &&
      /^LETTER_(CREATE|HANDOFF_NOTA_DRAFT|REGISTER_INCOMING|SUBMIT|SEND_NOTA_REPLY|SEND_NOTA_DIRECT|APPROVE|APPROVE_FINAL|RETURN|RETURN_PREVIOUS|REJECT|ISSUE|MARK_SENT|UNDO_APPROVAL|COMPLETE|PREPARE_ISSUE)$/.test(event.action)) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT l.*,v.kind AS workflow_kind,v.nota_author_user_id,v.nota_drafter_user_id FROM siap_letters l
       JOIN siap_v11_letters v ON v.letter_id=l.id WHERE l.id=? AND l.deleted_at IS NULL`, [event.entityId],
    );
    const letter = rows[0];
    if (!letter) return;
    const [users] = await conn.query<RowDataPacket[]>(
      `SELECT u.id FROM siap_users u WHERE u.is_active=1 AND (
        u.id=? OR (? IS NULL AND u.role=?)
        OR (? IN ('APPROVED','REJECTED','ISSUED','COMPLETED') AND u.id=?)
        OR (?='APPROVED' AND (?='INVOICE_MASUK' OR ? IN ('PERSEKOT','PAYMENT_REQUEST')) AND EXISTS (
          SELECT 1 FROM siap_v11_managers m WHERE m.scope='KSU' AND m.user_id=u.id
        )))`,
      [letter.current_owner_user_id, letter.current_owner_user_id, letter.current_role,
        letter.status, letter.created_by, letter.status, letter.document_type, letter.workflow_kind],
    );
    for (const user of users) recipients.add(String(user.id));
    if (letter.direction === "INTERNAL" && (["LETTER_SEND_NOTA_REPLY", "LETTER_SEND_NOTA_DIRECT"].includes(event.action) ||
      (letter.status === "APPROVED" && ["LETTER_APPROVE", "LETTER_APPROVE_FINAL"].includes(event.action)))) {
      const [additional] = await conn.query<RowDataPacket[]>(
        "SELECT recipient_user_id FROM siap_v11_nota_recipients WHERE letter_id=?", [event.entityId],
      );
      for (const person of additional) recipients.add(String(person.recipient_user_id));
    }
    if (event.action === "LETTER_UNDO_APPROVAL" || ["APPROVED","REJECTED","COMPLETED"].includes(letter.status)) {
      if (event.action === "LETTER_UNDO_APPROVAL") recipients.add(String(letter.created_by));
      if (letter.nota_author_user_id) recipients.add(String(letter.nota_author_user_id));
    }
    title = ({
      LETTER_CREATE: letter.nota_drafter_user_id ? "Diminta menyiapkan draf Nota Dinas"
        : letter.nota_author_user_id ? "Draf Nota Dinas siap diperiksa" : "Surat baru perlu diregistrasi",
      LETTER_HANDOFF_NOTA_DRAFT: "Draf Nota Dinas dari Staff siap diperiksa",
      LETTER_REGISTER_INCOMING: "Surat masuk menunggu pemeriksaan",
      LETTER_SUBMIT: "Draf surat menunggu pemeriksaan",
      LETTER_SEND_NOTA_REPLY: "Balasan Nota Dinas dari Direksi",
      LETTER_SEND_NOTA_DIRECT: "Nota Dinas dari Direksi",
      LETTER_RETURN: "Surat dikembalikan untuk perbaikan",
      LETTER_RETURN_PREVIOUS: "Surat dikembalikan untuk perbaikan",
      LETTER_REJECT: "Surat ditolak",
      LETTER_ISSUE: "Surat keluar telah diterbitkan",
      LETTER_UNDO_APPROVAL: "Persetujuan surat dibatalkan untuk pemeriksaan ulang",
      LETTER_COMPLETE: "Tindak lanjut surat selesai",
      LETTER_PREPARE_ISSUE: "Nomor surat final dan siap ditandatangani",
      LETTER_MARK_SENT: "Pengiriman surat telah dicatat",
    } as Record<string, string>)[event.action] || (letter.status === "APPROVED"
      ? "Dokumen disetujui untuk ditindaklanjuti" : "Surat menunggu persetujuan berikutnya");
  } else if (event.entityType === "DISPOSITION" &&
      /^DISPOSITION_(CREATE|SUBMIT_RESULT|RETURN_RESULT|RETURN_TASK|REASSIGN_TASK|APPROVE_RESULT|ROUTE_REVIEW_DIROPS|CANCEL_TASK)$/.test(event.action)) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT d.* FROM siap_dispositions d JOIN siap_v11_dispositions v ON v.disposition_id=d.id WHERE d.id=?`,
      [event.entityId],
    );
    const task = rows[0];
    if (!task) return;
    const target = ["COMPLETED", "CANCELLED"].includes(task.status) ? task.to_user_id : task.current_owner_user_id;
    if (target) recipients.add(String(target));
    title = ({
      DISPOSITION_CREATE: "Disposisi baru untuk Anda",
      DISPOSITION_SUBMIT_RESULT: "Hasil disposisi menunggu persetujuan",
      DISPOSITION_RETURN_RESULT: "Hasil disposisi perlu diperbaiki",
      DISPOSITION_RETURN_TASK: "Disposisi dikembalikan",
      DISPOSITION_REASSIGN_TASK: "Disposisi ditugaskan ulang untuk Anda",
      DISPOSITION_APPROVE_RESULT: task.status === "REVIEW_DIRUT"
        ? "Hasil disposisi siap diperiksa Dirut" : "Hasil disposisi disetujui",
      DISPOSITION_ROUTE_REVIEW_DIROPS: "Hasil disposisi menunggu pemeriksaan Dirops",
      DISPOSITION_CANCEL_TASK: "Disposisi dibatalkan",
    } as Record<string, string>)[event.action];
  } else {
    return;
  }
  recipients.delete(event.actorId || "");
  for (const recipient of recipients) {
    await conn.execute(
      `INSERT INTO siap_v11_notifications (audit_id,recipient_user_id,entity_type,entity_id,title)
       SELECT ?,u.id,?,?,? FROM siap_users u WHERE u.id=? AND u.is_active=1
       ON DUPLICATE KEY UPDATE audit_id=audit_id`,
      [event.auditId, event.entityType, event.entityId, title, recipient],
    );
  }
}
