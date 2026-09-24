USE aru_siap;

-- Semua periode lama seharusnya tidak lagi CLOSED.
SELECT
  COUNT(*) AS total_periode,
  SUM(CASE WHEN period_status='OPEN' THEN 1 ELSE 0 END) AS periode_open,
  SUM(CASE WHEN period_status='CLOSED' THEN 1 ELSE 0 END) AS periode_closed
FROM siap_finance_monthly_summaries;

-- Cek data bulanan + status aktif/draft + YTD toggle.
SELECT
  period_month,
  income_amount,
  expense_amount,
  budget_amount,
  include_in_ytd,
  publish_status,
  updated_at
FROM siap_finance_monthly_summaries
ORDER BY period_month DESC;

-- Cek histori adjustment terakhir.
SELECT
  a.created_at,
  s.period_month,
  a.metric,
  a.adjustment_type,
  a.amount,
  a.value_before,
  a.value_after,
  a.status,
  a.note
FROM siap_finance_adjustments a
JOIN siap_finance_monthly_summaries s ON s.id=a.summary_id
ORDER BY a.created_at DESC
LIMIT 50;
