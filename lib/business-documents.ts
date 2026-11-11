export const SPK_INCOMING = "SURAT_PERINTAH_KERJA_MASUK";
export const SPK_OUTGOING = "SURAT_PERINTAH_KERJA";
export const INVOICE_INCOMING = "INVOICE_MASUK";
export const INVOICE_OUTGOING = "INVOICE_KELUAR";

export function isSpk(documentType: string) {
  return documentType === SPK_INCOMING || documentType === SPK_OUTGOING;
}

export function isInvoice(documentType: string) {
  return documentType === INVOICE_INCOMING || documentType === INVOICE_OUTGOING;
}

export function isBusinessDocument(documentType: string) {
  return isSpk(documentType) || isInvoice(documentType);
}

export type ReferenceKind = "spk" | "support" | "source";
export type SignatureMethod = "DIGITAL" | "BASAH";

export type DocumentReference = {
  id: string;
  direction: string;
  number: string | null;
  subject: string;
  status: string;
};

export type InvoiceLine = {
  description: string;
  quantity: string;
  unit_price: string;
  total: string;
};

export type InvoiceDetails = {
  due_date: string | null;
  total: string;
  items: InvoiceLine[];
  requires_spk: boolean;
  has_spk_reference: boolean;
  spk_reference: DocumentReference | null;
};

export type BusinessDocumentDetails = {
  managed: boolean;
  invoice: InvoiceDetails | null;
  supporting_letters: DocumentReference[];
  hidden_supporting_count: number;
  signature_method: SignatureMethod | null;
};

export const MAX_INVOICE_ITEMS = 40;
export const MAX_SUPPORTING_LETTERS = 10;
const MAX_CENTS = 999_999_999_999_999n;

function decimalUnits(value: unknown, scale: number, maxDigits: number, label: string) {
  const text = String(value ?? "").trim();
  const pattern = new RegExp("^\\d{1," + maxDigits + "}(?:\\.\\d{1," + scale + "})?$");
  if (!pattern.test(text)) throw new Error(label + " tidak valid.");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole + fraction.padEnd(scale, "0"));
}

function decimalText(units: bigint, scale: number) {
  const value = units.toString().padStart(scale + 1, "0");
  return value.slice(0, -scale) + "." + value.slice(-scale);
}

export function normalizeInvoice(input: Record<string, unknown>, outgoing: boolean) {
  let dueDate: string | null = null;
  if (input.due_date) {
    const value = String(input.due_date);
    const date = new Date(value + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new Error("Tanggal jatuh tempo tidak valid.");
    }
    dueDate = value;
  }

  const items: InvoiceLine[] = [];
  let total: bigint;
  if (outgoing) {
    if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > MAX_INVOICE_ITEMS) {
      throw new Error("Invoice keluar harus memuat 1 sampai " + MAX_INVOICE_ITEMS + " rincian tagihan.");
    }
    total = 0n;
    for (const [index, row] of input.items.entries()) {
      if (!row || typeof row !== "object") throw new Error("Rincian tagihan tidak valid.");
      const description = typeof row.description === "string" ? row.description.trim() : "";
      if (!description || description.length > 300) throw new Error("Uraian item " + (index + 1) + " wajib diisi, maksimal 300 karakter.");
      const quantity = decimalUnits(row.quantity, 3, 7, "Kuantitas item " + (index + 1));
      if (quantity === 0n) throw new Error("Kuantitas item harus lebih dari nol.");
      const unitPrice = decimalUnits(row.unit_price, 2, 13, "Harga satuan item " + (index + 1));
      const lineTotal = (quantity * unitPrice + 500n) / 1_000n;
      total += lineTotal;
      items.push({
        description,
        quantity: decimalText(quantity, 3).replace(/\.?0+$/, ""),
        unit_price: decimalText(unitPrice, 2),
        total: decimalText(lineTotal, 2),
      });
    }
  } else {
    total = decimalUnits(input.total, 2, 13, "Nominal invoice");
  }
  if (total <= 0n || total > MAX_CENTS) throw new Error("Total invoice harus lebih dari nol dan dalam batas nominal yang diizinkan.");

  return { due_date: dueDate, total: decimalText(total, 2), items, requires_spk: input.requires_spk === true };
}

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const quantities = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
export function formatInvoiceAmount(value: string | number) {
  return rupiah.format(Number(value));
}

export function formatInvoiceQuantity(value: string) {
  return quantities.format(Number(value));
}
