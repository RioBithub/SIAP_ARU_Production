import AuditClient from "@/components/AuditClient";
import { requireRoles } from "@/lib/auth";
export default async function Page(){ await requireRoles(["ROOT_ADMIN"]); return <AuditClient/>; }
