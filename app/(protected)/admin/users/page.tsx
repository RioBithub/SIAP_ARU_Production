import AdminUsersClient from "@/components/AdminUsersClient";
import { requireRoles } from "@/lib/auth";
export default async function Page(){ await requireRoles(["ROOT_ADMIN"]); return <AdminUsersClient/>; }
