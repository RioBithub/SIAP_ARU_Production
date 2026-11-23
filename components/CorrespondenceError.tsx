"use client";

export default function CorrespondenceError() {
  return <main className="page">
    <div className="page-head"><h2>Halaman persuratan gagal dimuat</h2></div>
    <div className="card">
      <div className="card-body">
        <p role="alert">Muat ulang halaman untuk mengambil tampilan terbaru SIAP ARU.</p>
        <div className="row-actions">
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>Muat ulang halaman</button>
          <a className="btn btn-secondary" href="/dashboard">Kembali ke Dashboard</a>
        </div>
      </div>
    </div>
  </main>;
}
