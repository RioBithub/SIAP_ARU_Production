import { aruPdfResponse } from "@/lib/aru-pdf";
import { getCurrentUser } from "@/lib/auth";
import { devStaging } from "@/lib/dev-staging";
import { sampleDocs, samplePdf } from "@/lib/staging-samples.mjs";

export async function GET(_: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  if (!devStaging()) return new Response(null, { status: 404 });
  if (!await getCurrentUser()) return new Response(null, { status: 401 });
  const entry = sampleDocs.find(doc => doc.id === params.id);
  if (!entry) return new Response(null, { status: 404 });
  const pdf = await samplePdf(entry.id);
  return pdf ? aruPdfResponse(pdf, entry.filename) : new Response(null, { status: 404 });
}
