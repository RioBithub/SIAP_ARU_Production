import BpkClient from "@/components/BpkClient";
import { requireUser } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const { invoice_id: invoice } = await searchParams;
  const invoiceId = typeof invoice === "string" ? invoice : null;
  return <BpkClient user={user} invoiceId={invoiceId}/>;
}
