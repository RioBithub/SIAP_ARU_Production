-- SIAP ARU - configurable document types + SPK
-- Root Admin can manage outgoing document types separately from numbering formats.

CREATE TABLE IF NOT EXISTS siap_document_types (
  id CHAR(36) NOT NULL,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(150) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  description VARCHAR(500) NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_siap_document_types_code (code),
  INDEX idx_siap_document_types_direction (direction,is_active),

  CONSTRAINT fk_siap_document_types_created_by
    FOREIGN KEY (created_by)
    REFERENCES siap_users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed types already used by SIAP.
INSERT INTO siap_document_types(id,code,name,direction,description,is_system,is_active,created_by)
SELECT UUID(),'PERJANJIAN_KERJA_SAMA','Perjanjian Kerja Sama','OUTGOING','Jenis surat keluar bawaan SIAP.',1,1,NULL
WHERE NOT EXISTS (SELECT 1 FROM siap_document_types WHERE code='PERJANJIAN_KERJA_SAMA');

INSERT INTO siap_document_types(id,code,name,direction,description,is_system,is_active,created_by)
SELECT UUID(),'PURCHASE_ORDER','Purchase Order (PO)','OUTGOING','Jenis surat keluar bawaan SIAP.',1,1,NULL
WHERE NOT EXISTS (SELECT 1 FROM siap_document_types WHERE code='PURCHASE_ORDER');

INSERT INTO siap_document_types(id,code,name,direction,description,is_system,is_active,created_by)
SELECT UUID(),'SURAT_DIREKSI','Surat Keluar Direksi','OUTGOING','Jenis surat keluar bawaan SIAP.',1,1,NULL
WHERE NOT EXISTS (SELECT 1 FROM siap_document_types WHERE code='SURAT_DIREKSI');

INSERT INTO siap_document_types(id,code,name,direction,description,is_system,is_active,created_by)
SELECT UUID(),'SURAT_OPERASIONAL','Surat Bagian Operasional','OUTGOING','Jenis surat keluar bawaan SIAP.',1,1,NULL
WHERE NOT EXISTS (SELECT 1 FROM siap_document_types WHERE code='SURAT_OPERASIONAL');

INSERT INTO siap_document_types(id,code,name,direction,description,is_system,is_active,created_by)
SELECT UUID(),'SURAT_UMUM','Surat Keluar Umum','OUTGOING','Jenis surat keluar bawaan SIAP.',1,1,NULL
WHERE NOT EXISTS (SELECT 1 FROM siap_document_types WHERE code='SURAT_UMUM');

INSERT INTO siap_document_types(id,code,name,direction,description,is_system,is_active,created_by)
SELECT UUID(),'SURAT_PERINTAH_KERJA','Surat Perintah Kerja (SPK)','OUTGOING','SPK / Surat Perintah Kerja.',0,1,NULL
WHERE NOT EXISTS (SELECT 1 FROM siap_document_types WHERE code='SURAT_PERINTAH_KERJA');

INSERT INTO siap_document_types(id,code,name,direction,description,is_system,is_active,created_by)
SELECT UUID(),'SURAT_MASUK_UMUM','Surat Masuk Umum','INCOMING','Jenis surat masuk bawaan SIAP.',1,1,NULL
WHERE NOT EXISTS (SELECT 1 FROM siap_document_types WHERE code='SURAT_MASUK_UMUM');

INSERT INTO siap_document_types(id,code,name,direction,description,is_system,is_active,created_by)
SELECT UUID(),'NOTA_DINAS','Nota Dinas','INTERNAL','Jenis dokumen internal bawaan SIAP.',1,1,NULL
WHERE NOT EXISTS (SELECT 1 FROM siap_document_types WHERE code='NOTA_DINAS');

INSERT INTO siap_document_types(id,code,name,direction,description,is_system,is_active,created_by)
SELECT UUID(),'LEMBAR_PENGANTAR','Lembar Pengantar','INTERNAL','Jenis dokumen internal bawaan SIAP.',1,1,NULL
WHERE NOT EXISTS (SELECT 1 FROM siap_document_types WHERE code='LEMBAR_PENGANTAR');

-- If SPK format was manually created as SURAT_UMUM, attach it to the proper type.
UPDATE siap_number_formats
SET document_type='SURAT_PERINTAH_KERJA',
    name=CASE WHEN code='SPK' THEN 'Surat Perintah Kerja (SPK)' ELSE name END
WHERE code='SPK';

-- Create the initial SPK numbering format when it does not exist.
INSERT INTO siap_number_formats
  (id,code,name,document_type,pattern,description,sequence_start,is_active,created_by)
SELECT
  UUID(),'SPK','Surat Perintah Kerja (SPK)','SURAT_PERINTAH_KERJA',
  'SPK/{seq}/AR/{year}',
  'Format nomor Surat Perintah Kerja; dapat diedit Root Admin.',
  1,1,NULL
WHERE NOT EXISTS (SELECT 1 FROM siap_number_formats WHERE code='SPK');
