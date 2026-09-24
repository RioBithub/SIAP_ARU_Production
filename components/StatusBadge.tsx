export default function StatusBadge({status}:{status:string}) {
  const s=String(status||"").toUpperCase();
  let color="gray";
  if(["COMPLETED","APPROVED","ISSUED","READY_TO_ISSUE","PAID","POSTED"].includes(s)) color="green";
  else if(["MANAGER_REVIEW","DIRECTOR_OPS_REVIEW","PRESIDENT_DIRECTOR_REVIEW","SEEN","IN_PROGRESS","PARTIAL"].includes(s)) color="blue";
  else if(["UNSEEN","RETURNED","RETURNED_STAFF","RESERVED","DRAFT","OPEN"].includes(s)) color="orange";
  else if(["CANCELLED","OVERDUE","URGENT"].includes(s)) color="red";
  return <span className={`badge ${color}`}>{s.replaceAll("_"," ")}</span>
}
