import BpkClient from "@/components/BpkClient";
import { requireUser } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const user = await requireUser();
  const invoiceId = typeof searchParams.invoice_id === "string" ? searchParams.invoice_id : null;
  return <BpkClient user={user} invoiceId={invoiceId}/>;
}
