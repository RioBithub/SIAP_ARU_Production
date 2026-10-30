-- SIAP ARU v1.8.0: optional Finance review, explicit read receipts, linked dispositions.
-- Run once on the selected aru_siap database before starting v1.8.0 code.
-- Additive migration: existing letters/tasks keep their current status and owner.
SET NAMES utf8mb4;

ALTER TABLE siap_letters
  ADD COLUMN finance_reviewer_user_id CHAR(36) NULL AFTER routing_target_user_id,
  ADD INDEX idx_siap_letters_finance_reviewer (finance_reviewer_user_id),
  ADD CONSTRAINT fk_siap_letters_finance_reviewer FOREIGN KEY (finance_reviewer_user_id)
    REFERENCES siap_users(id) ON DELETE RESTRICT;

ALTER TABLE siap_dispositions
  ADD COLUMN review_step_index INT NULL DEFAULT NULL,
  ADD INDEX idx_siap_disp_parent_status (parent_id, status);

CREATE TABLE IF NOT EXISTS siap_letter_reads (
  letter_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  first_read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (letter_id, user_id),
  INDEX idx_siap_letter_reads_user (user_id, first_read_at),
  CONSTRAINT fk_siap_letter_reads_letter FOREIGN KEY (letter_id) REFERENCES siap_letters(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_letter_reads_user FOREIGN KEY (user_id) REFERENCES siap_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS siap_disposition_reviewers (
  disposition_id CHAR(36) NOT NULL,
  step_order INT NOT NULL,
  user_id CHAR(36) NOT NULL,
  reviewer_role VARCHAR(40) NOT NULL,
  PRIMARY KEY (disposition_id, step_order),
  INDEX idx_siap_disp_review_user (user_id, disposition_id),
  CONSTRAINT fk_siap_disp_review_disposition FOREIGN KEY (disposition_id) REFERENCES siap_dispositions(id) ON DELETE CASCADE,
  CONSTRAINT fk_siap_disp_review_user FOREIGN KEY (user_id) REFERENCES siap_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
