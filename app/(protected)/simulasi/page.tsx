import { notFound } from "next/navigation";
import type { RowDataPacket } from "mysql2/promise";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { devStaging } from "@/lib/dev-staging";
import { letterAccess } from "@/lib/letter-access";
import { sampleCases, sampleDocs } from "@/lib/staging-samples.mjs";

export default async function SimulationPage() {
  if (!devStaging()) notFound();
  const user = await requireUser();
  const access = letterAccess(user);
  const references = sampleCases.flatMap(item => item.reference ? [item.reference] : []);
  const [letters] = await db.query<RowDataPacket[]>(
    "SELECT l.id,l.external_number FROM siap_letters l WHERE l.direction='INCOMING' AND l.external_number IN (?) AND " + access.clause,
    [references, ...access.params],
  );
  const available = new Map(letters.map(row => [row.external_number, String(row.id)]));

  return <main className="page">
    <div className="page-head">
      <div><h2>Bahan Simulasi</h2><p>Unduh berkas PDF latihan sesuai skenario. Jalankan 01 sampai tugas Staff dimulai, lanjutkan 04, lalu kembali ke 01.</p></div>
    </div>
    {sampleCases.map(item => {
      const id = available.get(item.reference);
      return <section className="card" key={item.number} style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h3>{item.number}. {item.title}</h3>
          {id && <a className="btn btn-secondary" href={"/letters/incoming?letter_id=" + encodeURIComponent(id)}>Buka surat latihan</a>}
        </div>
        <div className="card-body">
          {item.reference && <p className="muted">Nomor latihan {item.reference}</p>}
          {item.number === 4 && <p className="muted">Buat draf dari tugas Staff di skenario 1.</p>}
          {sampleDocs.filter(doc => doc.scenario === item.number).map(doc => <div className="kpi-row" key={doc.id}>
            <span>{doc.title}</span>
            <a className="btn btn-secondary" href={"/api/staging/samples/" + doc.id}>Unduh PDF</a>
          </div>)}
        </div>
      </section>;
    })}
  </main>;
}
