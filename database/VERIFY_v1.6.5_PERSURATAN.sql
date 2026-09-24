USE `aru_siap`;

SELECT code,name,document_type,pattern,sequence_start,is_active
FROM `aru_siap`.`siap_number_formats`
WHERE document_type IN ('PERJANJIAN_KERJA_SAMA','SURAT_DIREKSI','SURAT_OPERASIONAL','PURCHASE_ORDER','SURAT_UMUM')
ORDER BY FIELD(document_type,'PERJANJIAN_KERJA_SAMA','SURAT_DIREKSI','SURAT_OPERASIONAL','PURCHASE_ORDER','SURAT_UMUM');

SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='aru_siap' AND TABLE_NAME='siap_letters'
  AND COLUMN_NAME IN ('legacy_import_key','legacy_number_text','legacy_user_input','legacy_file_url','legacy_sheet_name','legacy_row_no','legacy_number_conflict')
ORDER BY COLUMN_NAME;

SELECT document_type,COUNT(*) AS legacy_rows,SUM(legacy_number_conflict) AS number_conflicts
FROM `aru_siap`.`siap_letters`
WHERE legacy_import_key IS NOT NULL
GROUP BY document_type
ORDER BY document_type;
