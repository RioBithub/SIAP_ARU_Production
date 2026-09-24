import AgingClient from "@/components/AgingClient";
import { requireRoles } from "@/lib/auth";
export default async function Page(){ await requireRoles(["ROOT_ADMIN","FINANCE","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"]); return <AgingClient/>; }
