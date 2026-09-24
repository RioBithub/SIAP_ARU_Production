USE `aru_siap`;

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA='aru_siap'
  AND TABLE_NAME='siap_finance_position_adjustments';

SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='aru_siap'
  AND TABLE_NAME='siap_finance_attachments'
  AND COLUMN_NAME='position_adjustment_id';

SELECT ledger_type,data_mode,updated_at
FROM siap_finance_source_modes
ORDER BY ledger_type;

SELECT ledger_type,as_of_date,outstanding_amount,due_30_amount,
       aging_1_30_amount,aging_30_60_amount,aging_60_90_amount,aging_90_plus_amount
FROM siap_finance_position_summaries
ORDER BY ledger_type;
