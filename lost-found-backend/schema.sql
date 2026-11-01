-- Tables are created automatically when the server starts.
-- This file is also safe to run by hand: mysql -u root -p lost_found < schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL,
  password_hash VARCHAR(100)  NOT NULL,
  whatsapp      VARCHAR(20)   NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS items (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED  NOT NULL,
  type        ENUM('lost','found')     NOT NULL,
  title       VARCHAR(120)  NOT NULL,
  description TEXT          NULL,
  category    VARCHAR(60)   NOT NULL,
  location    VARCHAR(60)   NULL,
  event_date  DATE          NULL,
  status      ENUM('open','resolved')  NOT NULL DEFAULT 'open',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_items_feed (status, created_at, id),
  KEY idx_items_type (type, status),
  KEY idx_items_category (category),
  KEY idx_items_user (user_id),
  CONSTRAINT fk_items_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_photos (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id        INT UNSIGNED  NOT NULL,
  filename       VARCHAR(80)   NOT NULL,
  thumb_filename VARCHAR(80)   NOT NULL,
  size_bytes     INT UNSIGNED  NOT NULL,
  position       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_photos_item (item_id, position),
  CONSTRAINT fk_photos_item FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
