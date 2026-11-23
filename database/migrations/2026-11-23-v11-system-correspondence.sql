CREATE TABLE IF NOT EXISTS siap_correspondence_drafts (
  letter_id CHAR(36) NOT NULL PRIMARY KEY,
  generated_attachment_id CHAR(36) NULL,
  layout_json LONGTEXT NOT NULL,
  signature_slots_json LONGTEXT NOT NULL,
  FOREIGN KEY (letter_id) REFERENCES siap_letters(id) ON DELETE CASCADE,
  FOREIGN KEY (generated_attachment_id) REFERENCES siap_attachments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Supply missing ARU series on installations that started from a bare schema.
INSERT INTO siap_number_formats (id,code,name,document_type,pattern,description,sequence_start,is_active,created_by)
VALUES
  (UUID(),'PKS','Perjanjian Kerja Sama','PERJANJIAN_KERJA_SAMA','P/{seq}/AR/{year}','Seri Perjanjian Kerjasama ARU.',1,1,NULL),
  (UUID(),'DIR','Surat Keluar Direksi','SURAT_DIREKSI','Dir/{seq}/AR/{year}','Seri Surat Keluar Direksi ARU.',1,1,NULL),
  (UUID(),'OPS','Surat Bagian Operasional','SURAT_OPERASIONAL','Oprsl/{seq}/AR/{year}','Seri Bagian Operasional ARU.',1,1,NULL),
  (UUID(),'PO','Purchase Order','PURCHASE_ORDER','PO/{seq}/AR/{year}','Seri Purchase Order ARU.',1,1,NULL),
  (UUID(),'UMUM','Surat Keluar Umum','SURAT_UMUM','UM/{seq}/AR/{year}','Seri Bagian Umum ARU.',1,1,NULL)
ON DUPLICATE KEY UPDATE code=siap_number_formats.code;
