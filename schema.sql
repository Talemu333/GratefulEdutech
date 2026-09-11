CREATE DATABASE IF NOT EXISTS grateful_edutech_cbt CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE grateful_edutech_cbt;

CREATE TABLE organizations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(180) NOT NULL UNIQUE,
  email VARCHAR(255) NULL,
  phone VARCHAR(30) NULL,
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('org_admin','instructor') NOT NULL DEFAULT 'instructor',
  email_verified_at DATETIME NULL,
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_org_email (organization_id, email),
  CONSTRAINT fk_users_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE email_verifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_email_verifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE password_resets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  instructor_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(220) NOT NULL,
  instructions TEXT NULL,
  duration_minutes INT UNSIGNED NOT NULL,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 1,
  release_result_immediately BOOLEAN NOT NULL DEFAULT TRUE,
  allow_candidate_review BOOLEAN NOT NULL DEFAULT TRUE,
  auto_submit_on_timeout BOOLEAN NOT NULL DEFAULT TRUE,
  access_password_hash VARCHAR(255) NULL,
  result_sender_name VARCHAR(255) NULL,
  status ENUM('draft','published','closed') NOT NULL DEFAULT 'draft',
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tests_org_slug (organization_id, slug),
  CONSTRAINT fk_tests_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_tests_instructor FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE questions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  test_id BIGINT UNSIGNED NOT NULL,
  question_number INT UNSIGNED NOT NULL,
  question_text TEXT NOT NULL,
  question_type ENUM('single_choice','multiple_choice','true_false') NOT NULL DEFAULT 'single_choice',
  marks DECIMAL(8,2) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_question_number (test_id, question_number),
  CONSTRAINT fk_questions_test FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE question_options (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_id BIGINT UNSIGNED NOT NULL,
  option_key CHAR(1) NOT NULL,
  option_text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_options_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_option_key (question_id, option_key)
) ENGINE=InnoDB;

CREATE TABLE attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  test_id BIGINT UNSIGNED NOT NULL,
  candidate_name VARCHAR(255) NOT NULL,
  candidate_email VARCHAR(255) NOT NULL,
  candidate_phone VARCHAR(30) NOT NULL,
  attempt_number INT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  submitted_at DATETIME NULL,
  status ENUM('in_progress','submitted','expired') NOT NULL DEFAULT 'in_progress',
  score DECIMAL(10,2) NULL,
  percentage DECIMAL(6,2) NULL,
  result_released_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attempts_test FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
  UNIQUE KEY uq_attempt_candidate (test_id, candidate_email, attempt_number)
) ENGINE=InnoDB;

CREATE TABLE attempt_answers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attempt_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  selected_option_id BIGINT UNSIGNED NULL,
  is_correct BOOLEAN NULL,
  marks_awarded DECIMAL(8,2) NOT NULL DEFAULT 0,
  answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attempt_question (attempt_id, question_id),
  CONSTRAINT fk_answers_attempt FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE,
  CONSTRAINT fk_answers_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_answers_option FOREIGN KEY (selected_option_id) REFERENCES question_options(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE test_imports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  test_id BIGINT UNSIGNED NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  status ENUM('processing','completed','failed') NOT NULL DEFAULT 'processing',
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  CONSTRAINT fk_imports_test FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_tests_org_status ON tests(organization_id, status);
CREATE INDEX idx_attempts_test_status ON attempts(test_id, status);
CREATE INDEX idx_attempts_candidate_email ON attempts(candidate_email);
CREATE INDEX idx_questions_test ON questions(test_id);
