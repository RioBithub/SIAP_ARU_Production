-- SIAP ARU v1.6.1 -> v1.6.2
-- Finance flexible current-year periods
-- Tidak menghapus histori, adjustment, dokumen, maupun audit log.

USE aru_siap;

-- v1.6.2 tidak lagi menggunakan mekanisme OPEN/CLOSED pada UI Finance.
-- Semua periode yang sempat ditutup dikembalikan ke OPEN untuk kompatibilitas
-- dengan versi lama dan agar data tahun berjalan tetap dapat dikoreksi.
UPDATE siap_finance_monthly_summaries
SET period_status = 'OPEN',
    closed_at = NULL,
    closed_by = NULL
WHERE period_status = 'CLOSED'
   OR closed_at IS NOT NULL
   OR closed_by IS NOT NULL;

-- Verifikasi singkat.
SELECT
  COUNT(*) AS total_periode,
  SUM(CASE WHEN period_status='OPEN' THEN 1 ELSE 0 END) AS periode_open,
  SUM(CASE WHEN period_status='CLOSED' THEN 1 ELSE 0 END) AS periode_closed
FROM siap_finance_monthly_summaries;
