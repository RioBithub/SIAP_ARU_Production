import BankDetailsClient from "@/components/BankDetailsClient";
import { requireRoles } from "@/lib/auth";
import { FINANCE_VIEW_ROLES } from "@/lib/types";

export default async function Page() {
  const user = await requireRoles(FINANCE_VIEW_ROLES);
  return <BankDetailsClient user={user}/>;
}
