import AttachmentActions from "@/components/AttachmentActions";
import { formatLetterFileSize, dispositionActionLabel } from "@/lib/correspondence-workflow";
import { formatWorkflowTime } from "@/lib/workflow-time";

type HistoryEvent = {
  id: string;
  action: string;
  actor_name: string;
  created_at: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  result_letter?: { id: string; number: string | null; subject?: string };
};

type HistoryFile = {
  id: string;
  original_name: string;
  original_size: number | string;
  is_compressed: number | boolean;
  disposition_action_id: string | null;
};

export type PreviousDisposition = {
  id: string;
  from_name: string;
  to_name: string;
  actions: HistoryEvent[];
  attachments: HistoryFile[];
};

export default function DispositionHistory({ actions, attachments }: {
  actions: HistoryEvent[];
  attachments: HistoryFile[];
}) {
  return <div className="timeline letter-history-timeline">
    {actions.map((event, index) => {
      const files = attachments.filter(file => file.disposition_action_id === event.id);
      const transition = [event.from_status, event.to_status].filter(Boolean).join(" → ");
      return <div className="timeline-row" key={event.id}>
        <div className="timeline-dot">{index + 1}</div>
        <div className="letter-history-entry">
          <b>{dispositionActionLabel(event.action)} · {event.actor_name}</b>
          <p>{formatWorkflowTime(event.created_at)}</p>
          {transition && <p>{transition}</p>}
          {event.note && <p className="letter-history-note">{event.note}</p>}
          {event.result_letter && <a className="btn btn-secondary"
            href={"/letters/outgoing?letter_id=" + encodeURIComponent(event.result_letter.id)}>
            Surat hasil · {event.result_letter.number || event.result_letter.subject}
          </a>}
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
