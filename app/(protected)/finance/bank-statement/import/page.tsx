import BankImportClient from "@/components/BankImportClient";
import { requireRoles } from "@/lib/auth";

export default async function Page(){
  const user=await requireRoles(["ROOT_ADMIN","FINANCE","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"]);
  return <BankImportClient user={user}/>;
}
