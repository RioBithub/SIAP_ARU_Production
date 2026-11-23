import { importBankPdf } from "@/lib/bank-pdf-import";

export const runtime = "nodejs";

export function POST(request: Request) {
  return importBankPdf(request, "BRI");
}
