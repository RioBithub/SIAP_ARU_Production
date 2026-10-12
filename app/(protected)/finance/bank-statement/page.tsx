import BankStatementClient from "@/components/BankStatementClient";
import { requireRoles } from "@/lib/auth";

export default async function Page(){
  const user=await requireRoles(["ROOT_ADMIN","FINANCE","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"]);
  return <BankStatementClient user={user}/>;
}
