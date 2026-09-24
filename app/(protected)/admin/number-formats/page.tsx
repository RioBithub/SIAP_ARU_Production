import NumberFormatsClient from "@/components/NumberFormatsClient";
import { requireRoles } from "@/lib/auth";
export default async function Page(){ await requireRoles(["ROOT_ADMIN"]); return <NumberFormatsClient/>; }
