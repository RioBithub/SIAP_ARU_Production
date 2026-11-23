import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { getBankDetails, importBankDetails } from "@/lib/bank-details";
import { BankWriteError, bankWriteStatus } from "@/lib/bank-write";
import { canEditFinance, canSeeBankStatement } from "@/lib/permissions";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const message = error instanceof Error && !("code" in error) ? error.message : "Rincian rekening koran gagal diproses.";
  return NextResponse.json({ ok: false, error: message }, { status: bankWriteStatus(error) });
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  if (!canSeeBankStatement(user.role)) return NextResponse.json({ ok: false, error: "Akses perbankan diperlukan." }, { status: 403 });
  try {
    const query = new URL(request.url).searchParams;
    const from = query.get("from") ?? "";
    const to = query.get("to") ?? "";
    const data = await getBankDetails(query.get("account_id") ?? "", from, to);
    if (query.get("export") !== "1") return NextResponse.json({ ok: true, data });

    const sheet = XLSX.utils.aoa_to_sheet([
      ["Rincian Rekening Koran", data.account.bank_name, String(data.account.account_number)],
      ["Periode", from, to],
      ["Tanggal", "Keterangan", "No. Bukti", "Debet buku", "Kredit buku", "Saldo buku",
        "Status pencocokan", "Sumber rekening koran", "Keterangan rekening koran", "File Excel asal"],
      ...data.rows.map(row => [row.entry_date, row.description, row.proof_no, row.debit_amount, row.credit_amount,
        row.balance, row.status === "LINKED" ? "Cocok" : row.status === "AMBIGUOUS" ? "Perlu diperiksa" : "Belum cocok",
        row.transaction?.source ?? null, row.transaction?.description ?? null, row.original_name]),
    ]);
    sheet["!cols"] = [13, 55, 25, 16, 16, 16, 22, 23, 55, 36].map(wch => ({ wch }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Rincian Rekening Koran");
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    return new NextResponse(bytes, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rincian-rekening-koran-${from}-${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  if (!canEditFinance(user.role)) return NextResponse.json({ ok: false, error: "Hanya Finance dan Root Admin yang dapat mengimpor rincian." }, { status: 403 });
  try {
    const form = await request.formData();
    const accountId = String(form.get("account_id") ?? "");
    const file = form.get("file");
    if (!accountId || !(file instanceof File)) throw new BankWriteError("Pilih rekening dan file Excel.", 400);
    const data = await importBankDetails(user, accountId, file, request);
    return NextResponse.json({ ok: true, data }, { status: data.inserted ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
