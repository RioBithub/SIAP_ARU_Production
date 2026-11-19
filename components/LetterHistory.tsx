import AttachmentActions from "@/components/AttachmentActions";
import { statusLabel } from "@/components/StatusBadge";
import { formatLetterFileSize, letterActionLabel, type LetterHistoryEntry } from "@/lib/correspondence-workflow";
import { formatWorkflowTime } from "@/lib/workflow-time";

type LetterHistoryAttachment = {
  id: string;
  letter_action_id: string | null;
  original_name: string;
  original_size: number | string;
  is_compressed: boolean | number;
};

export default function LetterHistory({ actions, attachments }: {
  actions: LetterHistoryEntry[];
  attachments: LetterHistoryAttachment[];
}) {
  if (!actions.length) return <p className="hint">Belum ada riwayat dokumen yang tersedia.</p>;

  const filesByAction = new Map<string, LetterHistoryAttachment[]>();
  for (const file of attachments) {
    if (!file.letter_action_id) continue;
    const files = filesByAction.get(file.letter_action_id) ?? [];
    files.push(file);
    filesByAction.set(file.letter_action_id, files);
  }

  return <div className="timeline letter-history-timeline">
    {actions.map((entry, index) => {
      const files = filesByAction.get(entry.id) ?? [];
      const transition = [entry.from_status, entry.to_status]
        .filter((status): status is string => Boolean(status))
        .map(statusLabel).join(" → ");
      return <div className="timeline-row" key={entry.id}>
        <div className="timeline-dot">{index + 1}</div>
        <div className="letter-history-entry">
          <b>{letterActionLabel(entry.action, entry.to_status)} · {entry.actor_name}</b>
          <p>{formatWorkflowTime(entry.created_at)}</p>
          {transition && <p>{transition}</p>}
          {entry.comment && <p className="letter-history-note">{entry.comment}</p>}
          {files.length > 0 && <div className="letter-history-files">
            {files.map(file => <div className="letter-history-file" key={file.id}>
              <div>
                <b>{file.original_name}</b>
                <p>{formatLetterFileSize(Number(file.original_size))}{file.is_compressed ? " · Dikompresi" : ""}</p>
              </div>
              <AttachmentActions id={file.id} name={file.original_name}/>
            </div>)}
          </div>}
        </div>
      </div>;
    })}
  </div>;
}
