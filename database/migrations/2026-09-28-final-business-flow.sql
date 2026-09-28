-- SIAP ARU - Final business flow
-- Surat: Staff -> Manager terpilih -> Dirops -> Dirut.
-- Disposisi: task turun, hasil naik via reviewer sesuai pemberi tugas.

ALTER TABLE siap_dispositions
  ADD COLUMN IF NOT EXISTS current_owner_user_id CHAR(36) NULL AFTER to_user_id,
  ADD COLUMN IF NOT EXISTS result_note TEXT NULL AFTER return_note,
  ADD COLUMN IF NOT EXISTS submitted_at DATETIME NULL AFTER result_note,
  ADD COLUMN IF NOT EXISTS reviewed_at DATETIME NULL AFTER submitted_at;

UPDATE siap_dispositions
SET current_owner_user_id=to_user_id
WHERE current_owner_user_id IS NULL;

ALTER TABLE siap_dispositions
  ADD INDEX IF NOT EXISTS idx_siap_disp_current_owner (current_owner_user_id);

CREATE TABLE IF NOT EXISTS siap_disposition_actions (
  id CHAR(36) NOT NULL,
  disposition_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  action VARCHAR(50) NOT NULL,
  from_status VARCHAR(50) NULL,
  to_status VARCHAR(50) NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_siap_disp_actions_disp (disposition_id,created_at),
  INDEX idx_siap_disp_actions_actor (actor_user_id),

  CONSTRAINT fk_siap_disp_actions_disp
    FOREIGN KEY (disposition_id)
    REFERENCES siap_dispositions(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_siap_disp_actions_actor
    FOREIGN KEY (actor_user_id)
    REFERENCES siap_users(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE siap_attachments
  ADD COLUMN IF NOT EXISTS disposition_action_id CHAR(36) NULL AFTER disposition_id;

ALTER TABLE siap_attachments
  ADD INDEX IF NOT EXISTS idx_siap_attach_disp_action (disposition_action_id);
