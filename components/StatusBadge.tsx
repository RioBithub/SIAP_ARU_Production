const labels: Record<string,string> = {
  COMPLETED: "Selesai",
  SECRETARIAT_INTAKE: "Menunggu Registrasi Sekretariat",
  SECRETARIAT_REVIEW: "Cek Sekretariat",
  WAITING_SIGNATURE: "Menunggu Naskah Bertanda Tangan",
  SENT: "Terkirim",
  REJECTED: "Ditolak",
  REVIEW_ROOT: "Review Root Admin",
};

export function statusLabel(status: string) {
  return labels[status] || status.replace(/_/g," ");
}

export default function StatusBadge({status}:{status:string}) {
  const s=String(status||"").toUpperCase();
  let color="gray";
  if(["COMPLETED","APPROVED","ISSUED","SENT","READY_TO_ISSUE","PAID","POSTED"].includes(s)) color="green";
  else if([
    "MANAGER_REVIEW","DIRECTOR_OPS_REVIEW","PRESIDENT_DIRECTOR_REVIEW",
    "SEEN","IN_PROGRESS","PARTIAL",
    "REVIEW_MANAGER","REVIEW_DIROPS","REVIEW_DIRUT","REVIEW_ROOT","SECRETARIAT_REVIEW"
  ].includes(s)) color="blue";
  else if(["SECRETARIAT_INTAKE","WAITING_SIGNATURE","UNSEEN","RETURNED","RETURNED_STAFF","RESERVED","DRAFT","OPEN"].includes(s)) color="orange";
  else if(["CANCELLED","REJECTED","OVERDUE","URGENT"].includes(s)) color="red";
  return <span className={`badge ${color}`}>{statusLabel(s)}</span>;
}
