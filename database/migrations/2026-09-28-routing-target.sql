-- Menyimpan Manager / user tujuan awal dokumen.
-- Dibuat untuk sinkronisasi perubahan yang sebelumnya diterapkan langsung di production.

ALTER TABLE siap_letters
  ADD COLUMN routing_target_user_id CHAR(36) NULL
  AFTER current_owner_user_id;

ALTER TABLE siap_letters
  ADD INDEX idx_siap_letters_routing_target (routing_target_user_id);