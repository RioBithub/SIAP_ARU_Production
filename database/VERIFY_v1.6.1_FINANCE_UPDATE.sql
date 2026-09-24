USE `aru_siap`;

SELECT 'monthly columns' AS check_name,
       SUM(COLUMN_NAME='data_date') AS data_date,
       SUM(COLUMN_NAME='include_in_ytd') AS include_in_ytd,
       SUM(COLUMN_NAME='publish_status') AS publish_status,
       SUM(COLUMN_NAME='period_status') AS period_status,
       SUM(COLUMN_NAME='closed_at') AS closed_at,
       SUM(COLUMN_NAME='closed_by') AS closed_by
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_finance_monthly_summaries';

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA='aru_siap'
  AND TABLE_NAME IN ('siap_finance_yearly_summaries','siap_finance_adjustments');

SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='aru_siap'
  AND TABLE_NAME='siap_finance_attachments'
  AND COLUMN_NAME='adjustment_id';

SELECT 'FINANCE v1.6.1 verification finished' AS result;
