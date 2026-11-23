import AdminUsersClient from "@/components/AdminUsersClient";
import { requireRoles } from "@/lib/auth";
export default async function Page() {
  const user = await requireRoles(["ROOT_ADMIN"]);
  return <AdminUsersClient activeName={user.name} activeEmail={user.email}/>;
}
