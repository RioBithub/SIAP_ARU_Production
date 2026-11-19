-- Apply after the V11 workflow and invoice payment mode migrations.
CREATE TABLE IF NOT EXISTS siap_v11_nota_documents (
  letter_id CHAR(36) PRIMARY KEY,
  source_attachment_id CHAR(36) NULL,
  source_kind VARCHAR(12) NOT NULL,
  manual_reason VARCHAR(1000) NULL,
  FOREIGN KEY (letter_id) REFERENCES siap_letters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_v11_bpk (
  id CHAR(36) PRIMARY KEY,
  letter_id CHAR(36) NULL UNIQUE,
  created_by CHAR(36) NOT NULL,
  submitted_on DATE NOT NULL,
  evidence_year SMALLINT UNSIGNED GENERATED ALWAYS AS (YEAR(submitted_on)) STORED,
  mode VARCHAR(12) NOT NULL,
  payee VARCHAR(255) NOT NULL,
  expense_post VARCHAR(160) NOT NULL,
  details JSON NOT NULL,
  evidence_number VARCHAR(100) NULL,
  bpk_number VARCHAR(100) NULL,
  checklist_attachment_id CHAR(36) NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  return_reason VARCHAR(1000) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  FOREIGN KEY (letter_id) REFERENCES siap_letters(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES siap_users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_siap_bpk_evidence (evidence_year,evidence_number),
  UNIQUE KEY uq_siap_bpk_number (evidence_year,bpk_number),
  INDEX idx_siap_bpk_creator (created_by,updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
