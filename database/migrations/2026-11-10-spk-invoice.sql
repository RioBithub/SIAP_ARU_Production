-- Requires the existing SIAP persuratan schema and document-types migration.
-- New tables leave historical letters, SPK numbers, and number formats intact.

CREATE TABLE IF NOT EXISTS siap_business_documents (
  letter_id CHAR(36) NOT NULL PRIMARY KEY,
  due_date DATE NULL,
  total DECIMAL(15,2) NULL,
  items JSON NULL,
  requires_spk TINYINT(1) NOT NULL DEFAULT 0,
  invoice_spk_id CHAR(36) NULL,
  signature_method ENUM('DIGITAL','BASAH') NULL,
  INDEX idx_siap_business_invoice_spk (invoice_spk_id),
  CONSTRAINT fk_siap_business_letter FOREIGN KEY (letter_id) REFERENCES siap_letters(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_business_invoice_spk FOREIGN KEY (invoice_spk_id) REFERENCES siap_letters(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_spk_letter_links (
  spk_letter_id CHAR(36) NOT NULL,
  supporting_letter_id CHAR(36) NOT NULL,
  PRIMARY KEY (spk_letter_id,supporting_letter_id),
  INDEX idx_siap_spk_supporting_letter (supporting_letter_id),
  CONSTRAINT fk_siap_spk_link_spk FOREIGN KEY (spk_letter_id) REFERENCES siap_letters(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_spk_link_support FOREIGN KEY (supporting_letter_id) REFERENCES siap_letters(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO siap_document_types (id,code,name,direction,description,is_system,is_active,created_by)
VALUES
  (UUID(),'SURAT_PERINTAH_KERJA_MASUK','Surat Perintah Kerja (SPK) Masuk','INCOMING','SPK yang diterima dari pihak luar.',1,1,NULL),
  (UUID(),'INVOICE_MASUK','Invoice Masuk','INCOMING','Tagihan yang diterima dari pihak luar.',1,1,NULL),
  (UUID(),'INVOICE_KELUAR','Invoice Keluar','OUTGOING','Tagihan yang diterbitkan PT ARU Raharja.',1,1,NULL)
ON DUPLICATE KEY UPDATE code=siap_document_types.code;

INSERT INTO siap_number_formats (id,code,name,document_type,pattern,description,sequence_start,is_active,created_by)
VALUES (UUID(),'INV','Invoice Keluar','INVOICE_KELUAR','{seq}/INV/ARU/{roman_month}/{year}','Format awal invoice keluar. Dapat disesuaikan oleh Root Admin.',1,1,NULL)
ON DUPLICATE KEY UPDATE code=siap_number_formats.code;
