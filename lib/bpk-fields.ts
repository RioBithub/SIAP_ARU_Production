import type { InvoicePaymentMode } from "@/lib/v11-workflow";

export const BPK_TEXT_FIELDS = {
  received_by: ["Yang Menerima", 255], description: ["Uraian / Keperluan", 1800],
  ppn_description: ["Uraian PPN / Nomor Faktur Pajak", 255], pph_description: ["Uraian PPh", 255],
  account_code: ["Kode Perkiraan", 80], bank_name: ["Bank Penerima", 160],
  account_number: ["Nomor Rekening", 120], account_name: ["Atas Nama", 255],
  basis: ["Rujukan SPK / Perjanjian / PO", 500], notes: ["Keterangan", 1000],
  manager: ["Nama Atasan", 160], director: ["Nama Direksi", 160],
} as const;

export const BPK_MONEY_FIELDS = {
  dpp: "Jumlah Rupiah (DPP)", alternative_dpp: "DPP atas PPN Lainnya", ppn: "Jumlah PPN",
  pph: "Jumlah PPh yang Dipotong", contract_amount: "Nilai Kontrak",
} as const;

export type BpkFields = Partial<Record<keyof typeof BPK_TEXT_FIELDS | keyof typeof BPK_MONEY_FIELDS |
  "due_date" | "paid_on" | "paid_via" | "paid_reference", string>>;
export type BpkInput = {
  submitted_on: string;
  mode: InvoicePaymentMode;
  payee: string;
  expense_post: string;
  details: BpkFields;
};
export type BpkPayment = { date: string; amount: string; reference: string };
export type BpkRecord = BpkInput & {
  id: string; created_by: string; creator_name: string; letter_id: string | null;
  invoice_number: string | null; invoice_total?: string; evidence_number: string | null; bpk_number: string | null;
  status: "DRAFT" | "SUBMITTED" | "NUMBERED" | "PAID";
  return_reason: string | null;
  ledger_status: string | null; updated_at: string; net: string; payments: BpkPayment[];
  editable: boolean; manage: boolean;
};

export const BPK_STATUS = { DRAFT: "Draf", SUBMITTED: "Diajukan", NUMBERED: "Sudah diberi nomor", PAID: "Terbayar" } as const;

export function rupiah(value: unknown) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 2 })
    .format(Number(value) || 0);
}
