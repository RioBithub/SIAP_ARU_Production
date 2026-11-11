import Image from "next/image";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAccessibleLetter } from "@/lib/letter-access";
import { getBusinessDocumentDetails } from "@/lib/business-document-data";
import { formatInvoiceAmount, formatInvoiceQuantity, INVOICE_OUTGOING, SPK_OUTGOING } from "@/lib/business-documents";
import PrintButton from "./PrintButton";
import styles from "./document.module.css";

export const dynamic = "force-dynamic";

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value.slice(0, 10) + "T00:00:00Z");
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function PrintDocumentPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const letter = await getAccessibleLetter(user, params.id);
  if (!letter || letter.direction !== "OUTGOING" || ![SPK_OUTGOING, INVOICE_OUTGOING].includes(letter.document_type)) notFound();
  const spk = letter.document_type === SPK_OUTGOING;
  const signable = letter.status === (letter.uses_secretariat ? "WAITING_SIGNATURE" : "READY_TO_ISSUE");
  if (spk ? !signable : ["CANCELLED", "REJECTED"].includes(letter.status)) notFound();

  const details = await getBusinessDocumentDetails(user, letter.id, letter.document_type);
  const invoice = details.invoice;
  if (!spk && !invoice) notFound();

  const issued = letter.status === "ISSUED" || (letter.status === "COMPLETED" && Boolean(letter.issued_date));
  const documentTitle = spk ? "Surat Perintah Kerja" : "Invoice";
  const documentStatus = issued ? "Terbit"
    : spk || (letter.uses_secretariat && signable) ? "Disetujui · untuk tanda tangan" : "Draf · belum diterbitkan";
  const amount = invoice && formatInvoiceAmount(invoice.total);

  return (
    <main className={styles.page}>
      <div className={styles.controls}>
        <PrintButton />
      </div>
      <article className={styles.paper}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Image src="/aru-logo.png" alt="Logo ARU" width={54} height={54} unoptimized />
            <div><strong>PT ARU Raharja</strong><span>Sistem Informasi ARU Terintegrasi</span></div>
          </div>
          <span className={styles.status}>{documentStatus}</span>
        </header>

        <h1>{documentTitle}</h1>
        <div className={styles.metadata}>
          <dl>
            <dt>Nomor</dt><dd>{letter.letter_number || "—"}</dd>
            <dt>Tanggal dokumen</dt><dd>{formatDate(letter.letter_date)}</dd>
            {issued && letter.issued_date && <><dt>Tanggal terbit</dt><dd>{formatDate(letter.issued_date)}</dd></>}
            {invoice?.due_date && <><dt>Jatuh tempo</dt><dd>{formatDate(invoice.due_date)}</dd></>}
          </dl>
          <dl>
            <dt>{spk ? "Ditujukan kepada" : "Ditagihkan kepada"}</dt><dd>{letter.recipient}</dd>
            <dt>Perihal</dt><dd>{letter.subject}</dd>
            {invoice?.spk_reference && <>
              <dt>Rujukan SPK</dt><dd>{invoice.spk_reference.number || invoice.spk_reference.subject}</dd>
            </>}
          </dl>
        </div>

        {invoice && (
          <table className={styles.items}>
            <thead><tr><th scope="col">Uraian</th><th scope="col">Jumlah</th><th scope="col">Harga satuan</th><th scope="col">Total</th></tr></thead>
            <tbody>{invoice.items.map((item, index) => (
              <tr key={index}><td>{item.description}</td><td>{formatInvoiceQuantity(item.quantity)}</td>
                <td>{formatInvoiceAmount(item.unit_price)}</td><td>{formatInvoiceAmount(item.total)}</td></tr>
            ))}</tbody>
            <tfoot><tr><th scope="row" colSpan={3}>Total tagihan</th><td>{amount}</td></tr></tfoot>
          </table>
        )}

        {(spk || letter.summary) && (
          <section className={styles.section}>
            <h2>{spk ? "Uraian pekerjaan" : "Keterangan"}</h2>
            <p>{letter.summary || letter.subject}</p>
          </section>
        )}
        {spk && details.supporting_letters.length > 0 && (
          <section className={styles.section}>
            <h2>Surat pendukung</h2>
            <ul>{details.supporting_letters.map(ref => (
              <li key={ref.id}>{[ref.number, ref.subject].filter(Boolean).join(" · ")}</li>
            ))}</ul>
          </section>
        )}
        {spk && (
          <section className={styles.signature}>
            <strong>PT ARU Raharja</strong>
            <span>Pejabat penandatangan</span>
          </section>
        )}
      </article>
    </main>
  );
}
