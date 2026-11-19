import { sandboxAttachmentsEnabled } from "@/lib/mekari-sign";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listDispositionEvents, listDispositionHistoryFiles, listHistoryTasks, missingDiropsReview, previousDispositionTasks } from "@/lib/disposition-history";
import { dispositionAccess } from "@/lib/disposition-access";
import { v11Letter } from "@/lib/v11-data";
import { canEditPaymentDocuments, invoicePaymentAccess, paymentDocuments } from "@/lib/v11-payment-documents";
import { getAccessibleLetter } from "@/lib/letter-access";
import { findLetterReferences } from "@/lib/business-document-data";
import { INVOICE_INCOMING } from "@/lib/business-documents";
import { listLetterActions } from "@/lib/correspondence-data";
import { listLetterAttachments } from "@/lib/letter-uploads";

export const runtime="nodejs";

export async function GET(_:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();

  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const access = dispositionAccess(user);
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT d.*,
      l.subject,l.letter_number,l.external_number,l.direction,l.document_type,l.confidentiality,
      lv.kind AS source_workflow_kind,
      v.purpose,v.invoice_revision AS task_revision,
      fu.name AS from_name,fu.role AS from_role,
      tu.name AS to_name,tu.role AS to_role,
      cu.name AS current_owner_name,cu.role AS current_owner_role,
      ${missingDiropsReview} AS needs_dirops_review
     FROM siap_dispositions d
     JOIN siap_letters l ON l.id=d.letter_id
     LEFT JOIN siap_v11_dispositions v ON v.disposition_id=d.id
     LEFT JOIN siap_v11_letters lv ON lv.letter_id=l.id
     JOIN siap_users fu ON fu.id=d.from_user_id
     JOIN siap_users tu ON tu.id=d.to_user_id
     LEFT JOIN siap_users cu ON cu.id=d.current_owner_user_id
     WHERE d.id=? AND ${access.clause}
     LIMIT 1`,
    [params.id, ...access.params]
  );

  const d=rows[0];
  if(!d)
    return NextResponse.json({ok:false,error:"Disposisi tidak ditemukan."},{status:404});

  const [actions]=await db.query<RowDataPacket[]>(
    `SELECT a.*,u.name AS actor_name,u.role AS actor_role
     FROM siap_disposition_actions a
     JOIN siap_users u ON u.id=a.actor_user_id
     WHERE a.disposition_id=?
     ORDER BY a.created_at ASC,(a.action<>'CREATE'),a.id`,
    [params.id]
  );

  const [attachments]=await db.query<RowDataPacket[]>(
    `SELECT a.id,a.disposition_id,a.disposition_action_id,a.attachment_kind,
      a.original_name,a.mime_type,a.original_size,a.stored_size,a.is_compressed,
      a.created_at,u.name AS uploaded_by_name
     FROM siap_attachments a
     JOIN siap_users u ON u.id=a.uploaded_by
     WHERE a.disposition_id=?
     ORDER BY a.created_at ASC`,
    [params.id]
  );
  const [sourceActions, sourceFiles] = await Promise.all([
    listLetterActions(db, user, d.letter_id),
    listLetterAttachments(db, user, d.letter_id),
  ]);
  const [related] = await db.query<RowDataPacket[]>(
    `SELECT d.id,d.parent_id,d.status,f.name AS from_name,t.name AS to_name,c.name AS current_owner_name
     FROM siap_dispositions d
     JOIN siap_users f ON f.id=d.from_user_id JOIN siap_users t ON t.id=d.to_user_id
     LEFT JOIN siap_users c ON c.id=d.current_owner_user_id
     WHERE d.letter_id=? AND (d.id=? OR d.parent_id=?) AND ${access.clause}
     ORDER BY d.created_at,d.id`, [d.letter_id, d.parent_id, d.id, ...access.params],
  );
  const parent = related.find(task => task.id === d.parent_id) ?? null;
  const children = related.filter(task => task.parent_id === d.id);
  const earlierTasks = d.parent_id
    ? previousDispositionTasks(await listHistoryTasks(db, user, [d.letter_id]), {
      id: d.id, letter_id: d.letter_id, parent_id: d.parent_id,
    })
    : [];
  const earlierIds = earlierTasks.map(task => task.id);
  const [earlierEvents, earlierFiles] = await Promise.all([
    listDispositionEvents(db, user, earlierIds),
    listDispositionHistoryFiles(db, earlierIds),
  ]);
  const previousTasks = earlierTasks.map(({ id, from_name, to_name }) => ({
    id, from_name, to_name,
    actions: earlierEvents.filter(event => event.disposition_id === id).map(event => ({
      ...event, result_letter: event.result_id ? { id: event.result_id, number: event.result_number } : undefined,
    })),
    attachments: earlierFiles.filter(file => file.disposition_id === id),
  }));


  const resultIds = [...new Set(actions.flatMap(action => action.result_letter_id ? [String(action.result_letter_id)] : []))];
  const results = resultIds.length ? await findLetterReferences(user, {
    kind: "support", ids: resultIds, includeCancelled: true,
  }) : [];
  const resultById = new Map(results.map(letter => [letter.id, letter]));
  const history = actions.map(({ result_letter_id, ...action }) => ({
    ...action, result_letter: result_letter_id ? resultById.get(result_letter_id) : undefined,
  }));
  const [payments] = d.purpose === "INVOICE_PAYMENT"
    ? await db.query<RowDataPacket[]>(
      `SELECT id,amount,payment_date,payee,recipient_account,reference,bookkeeping_note,evidence_id,
        status,approved_at,submitted_action_id FROM siap_v11_payments WHERE disposition_id=? ORDER BY created_at,id`,
      [params.id],
    ) : [[]];
  const verification = d.purpose === "INVOICE_VERIFY";
  const hasPaymentRequirements = d.document_type === INVOICE_INCOMING ||
    ["PERSEKOT", "PAYMENT_REQUEST"].includes(d.source_workflow_kind);
  const paymentLetter = hasPaymentRequirements
    ? await getAccessibleLetter(user, d.letter_id) : null;
  const workflow = paymentLetter ? await v11Letter(d.letter_id) : null;
  const requirements = workflow ? await paymentDocuments(db, d.letter_id, workflow, d.document_type) : null;
  const invoiceAccess = requirements?.invoice && workflow && paymentLetter
    ? await invoicePaymentAccess(db, paymentLetter, workflow, user) : null;
  const editable = Boolean(verification && (invoiceAccess?.editable || (paymentLetter?.status === "MANAGER_REVIEW" &&
    workflow?.invoice_revision === d.task_revision && (
      user.id === d.from_user_id || (user.id === d.to_user_id && user.id === d.current_owner_user_id &&
        ["UNSEEN","SEEN","IN_PROGRESS"].includes(d.status))
    ) && await canEditPaymentDocuments(db, paymentLetter, user))));
  return NextResponse.json({
    ok:true,
    data:{disposition:d,actions:history,attachments,sourceActions,
      sourceAttachments:sourceFiles.filter(file => file.source_kind !== "PAYMENT_DOCUMENT"),
      parent,children,previousTasks,payments,
      paymentDocuments:requirements && {...requirements, editable, invoiceAccess},
      sandboxSigning: sandboxAttachmentsEnabled() && (user.role === "ROOT_ADMIN" ||
        [d.from_user_id,d.to_user_id,d.current_owner_user_id].includes(user.id))}
  });
}
