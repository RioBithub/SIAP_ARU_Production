export default function StatusBadge({status}:{status:string}) {
  const s=String(status||"").toUpperCase();
  let color="gray";
  if(["COMPLETED","APPROVED","ISSUED","READY_TO_ISSUE","PAID","POSTED"].includes(s)) color="green";
  else if([
    "FINANCE_REVIEW","MANAGER_REVIEW","DIRECTOR_OPS_REVIEW","PRESIDENT_DIRECTOR_REVIEW",
    "SEEN","IN_PROGRESS","PARTIAL",
    "REVIEW_FINANCE","REVIEW_MANAGER","REVIEW_DIROPS","REVIEW_DIRUT","REVIEW_ROOT"
  ].includes(s)) color="blue";
  else if(["UNSEEN","RETURNED","RETURNED_STAFF","RESERVED","DRAFT","OPEN"].includes(s)) color="orange";
  else if(["CANCELLED","OVERDUE","URGENT"].includes(s)) color="red";
  const labels:Record<string,string>={FINANCE_REVIEW:"Menunggu Review Finance",MANAGER_REVIEW:"Menunggu Review Manager",DIRECTOR_OPS_REVIEW:"Menunggu Review Dirops",PRESIDENT_DIRECTOR_REVIEW:"Menunggu Review Dirut",REVIEW_FINANCE:"Hasil: Review Finance",REVIEW_MANAGER:"Hasil: Review Manager",REVIEW_DIROPS:"Hasil: Review Dirops",REVIEW_DIRUT:"Hasil: Review Dirut",REVIEW_ROOT:"Hasil: Review Root",RETURNED_STAFF:"Dikembalikan ke Penyusun"};
  return <span className={`badge ${color}`}>{labels[s]||s.replace(/_/g," ")}</span>;
}
