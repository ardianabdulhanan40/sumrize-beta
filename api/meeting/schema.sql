-- =========================================================
-- SUMRIZE MEETING ASSISTANT
-- Google Meet MVP
-- =========================================================


-- =========================================================
-- 1. USERS
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    name VARCHAR(255) NOT NULL,

    email VARCHAR(255) NOT NULL UNIQUE,

    password VARCHAR(255) NOT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================================================
-- PERSONAL ACCESS TOKENS
-- =========================================================

CREATE TABLE IF NOT EXISTS personal_access_tokens (

    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    user_id BIGINT UNSIGNED NOT NULL,

    token_hash VARCHAR(64) NOT NULL UNIQUE,

    expires_at DATETIME NULL,

    revoked_at DATETIME NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user_id (user_id),

    CONSTRAINT fk_tokens_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================================================
-- 2. CONNECTORS
-- =========================================================

CREATE TABLE IF NOT EXISTS connectors (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    slug VARCHAR(100) NOT NULL UNIQUE,

    name VARCHAR(255) NOT NULL,

    type VARCHAR(100) NOT NULL,

    status ENUM('active', 'inactive')
        NOT NULL DEFAULT 'active',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =========================================================
-- GOOGLE MEET CONNECTOR
-- =========================================================

INSERT INTO connectors (
    slug,
    name,
    type,
    status
)
VALUES (
    'google_meet',
    'Google Meet',
    'meeting',
    'active'
)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    type = VALUES(type),
    status = VALUES(status);


-- =========================================================
-- USER CONNECTOR CONNECTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS connector_connections (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    user_id BIGINT UNSIGNED NOT NULL,

    connector_id BIGINT UNSIGNED NOT NULL,

    external_account_id VARCHAR(255) NULL,

    external_email VARCHAR(255) NULL,

    access_token_encrypted TEXT NULL,

    refresh_token_encrypted TEXT NULL,

    token_expires_at DATETIME NULL,

    status ENUM('connected', 'disconnected')
        NOT NULL DEFAULT 'disconnected',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_user_connector (user_id, connector_id),

    INDEX idx_connection_connector (connector_id),

    CONSTRAINT fk_connection_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_connection_connector
        FOREIGN KEY (connector_id)
        REFERENCES connectors(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =========================================================
-- 3. MEETING SESSIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS meeting_sessions (

    id VARCHAR(64) PRIMARY KEY,

    user_id BIGINT UNSIGNED NOT NULL,

    connector_id BIGINT UNSIGNED NOT NULL,

    title VARCHAR(255) NOT NULL,

    external_meeting_code VARCHAR(64) NULL,

    summary TEXT NULL,

    started_at DATETIME NOT NULL,

    ended_at DATETIME NULL,

    duration INT UNSIGNED NULL
        COMMENT 'Durasi dalam detik',

    status ENUM(
        'capturing',
        'processing',
        'completed',
        'empty_transcript',
        'ai_failed'
    )
    NOT NULL DEFAULT 'capturing',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user_id (user_id),

    INDEX idx_connector_id (connector_id),

    INDEX idx_status (status),

    CONSTRAINT fk_meeting_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_meeting_connector
        FOREIGN KEY (connector_id)
        REFERENCES connectors(id)
        ON DELETE RESTRICT

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =========================================================
-- 4. TRANSCRIPTS
-- =========================================================

CREATE TABLE IF NOT EXISTS transcripts (

    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    meeting_session_id VARCHAR(64) NOT NULL,

    speaker VARCHAR(255)
        NOT NULL DEFAULT 'Unknown',

    text TEXT NOT NULL,

    timestamp_seconds INT UNSIGNED NULL
        COMMENT 'Detik sejak meeting dimulai',

    sequence INT UNSIGNED NOT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_meeting_session_id (
        meeting_session_id,
        sequence
    ),

    CONSTRAINT fk_transcripts_session
        FOREIGN KEY (meeting_session_id)
        REFERENCES meeting_sessions(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =========================================================
-- 5. ACTION ITEMS
-- =========================================================

CREATE TABLE IF NOT EXISTS action_items (

    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    meeting_session_id VARCHAR(64) NOT NULL,

    task TEXT NOT NULL,

    assignee VARCHAR(255) NULL,

    deadline VARCHAR(100) NULL,

    status ENUM('open', 'done')
        NOT NULL DEFAULT 'open',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_meeting_session_id (
        meeting_session_id
    ),

    CONSTRAINT fk_action_items_session
        FOREIGN KEY (meeting_session_id)
        REFERENCES meeting_sessions(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =========================================================
-- 6. DECISIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS decisions (

    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    meeting_session_id VARCHAR(64) NOT NULL,

    decision TEXT NOT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_meeting_session_id (
        meeting_session_id
    ),

    CONSTRAINT fk_decisions_session
        FOREIGN KEY (meeting_session_id)
        REFERENCES meeting_sessions(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =========================================================
-- 7. FOLLOW UPS
-- =========================================================

CREATE TABLE IF NOT EXISTS follow_ups (

    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    meeting_session_id VARCHAR(64) NOT NULL,

    description TEXT NOT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_meeting_session_id (
        meeting_session_id
    ),

    CONSTRAINT fk_follow_ups_session
        FOREIGN KEY (meeting_session_id)
        REFERENCES meeting_sessions(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;