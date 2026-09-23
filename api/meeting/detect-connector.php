<?php

declare(strict_types=1);

/**
 * GET / POST /api/meeting/detect-connector.php
 *
 * Mendeteksi apakah akun Google Meet yang aktif telah terhubung
 * dengan konektor Google Meet di database Sumrize.
 *
 * Parameter (Opsional):
 * - email: string (email Google Meet yang terdeteksi di browser)
 *
 * Jika terhubung:
 * - Mengembalikan status connected = true
 * - Menerbitkan personal access token valid agar ekstensi
 *   dapat langsung memanggil API tanpa input token manual.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';

// Method GET, POST, OPTIONS diperbolehkan
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST', 'OPTIONS'], true)) {
    sumrize_error(
        'method_not_allowed',
        'Gunakan GET atau POST.',
        405
    );
}

// Ambil parameter email dari Query String atau Request Body
$email = '';
if (!empty($_GET['email'])) {
    $email = trim((string) $_GET['email']);
} else {
    $body = sumrize_read_json_body();
    if (!empty($body['email'])) {
        $email = trim((string) $body['email']);
    } elseif (!empty($_POST['email'])) {
        $email = trim((string) $_POST['email']);
    }
}

try {
    $pdo = sumrize_db();

    // 1. Pastikan connector google_meet ada di database
    $connectorStmt = $pdo->prepare("
        SELECT id, slug, name, type, status
        FROM connectors
        WHERE slug = 'google_meet'
        LIMIT 1
    ");
    $connectorStmt->execute();
    $connector = $connectorStmt->fetch(PDO::FETCH_ASSOC);

    if (!$connector) {
        sumrize_error(
            'connector_not_found',
            'Konektor google_meet belum terdaftar di tabel connectors database.',
            404
        );
    }

    $connection = null;

    // 2. Jika email spesifik diberikan, cari koneksi yang cocok
    if ($email !== '') {
        $stmt = $pdo->prepare("
            SELECT
                cc.id AS connection_id,
                cc.user_id,
                cc.connector_id,
                cc.external_account_id,
                cc.external_email,
                cc.status AS connection_status,
                cc.token_expires_at,
                cc.updated_at AS connection_updated_at,
                u.id AS user_id,
                u.name AS user_name,
                u.email AS user_email,
                c.slug AS connector_slug,
                c.name AS connector_name
            FROM connector_connections cc
            INNER JOIN connectors c ON c.id = cc.connector_id
            INNER JOIN users u ON u.id = cc.user_id
            WHERE c.slug = 'google_meet'
              AND cc.status = 'connected'
              AND (
                  LOWER(TRIM(cc.external_email)) = LOWER(:email1)
                  OR LOWER(TRIM(u.email)) = LOWER(:email2)
              )
            ORDER BY cc.updated_at DESC
            LIMIT 1
        ");
        $stmt->execute([
            'email1' => $email,
            'email2' => $email
        ]);
        $connection = $stmt->fetch(PDO::FETCH_ASSOC);
    }

    // 3. Jika tidak menemukan dengan email atau email tidak diberikan, cari dari session user atau koneksi aktif
    if (!$connection) {
        $sessionUser = sumrize_get_session_user();
        if ($sessionUser && !empty($sessionUser['user_id'])) {
            $stmt = $pdo->prepare("
                SELECT
                    cc.id AS connection_id,
                    cc.user_id,
                    cc.connector_id,
                    cc.external_account_id,
                    cc.external_email,
                    cc.status AS connection_status,
                    cc.token_expires_at,
                    cc.updated_at AS connection_updated_at,
                    u.id AS user_id,
                    u.name AS user_name,
                    u.email AS user_email,
                    c.slug AS connector_slug,
                    c.name AS connector_name
                FROM connector_connections cc
                INNER JOIN connectors c ON c.id = cc.connector_id
                INNER JOIN users u ON u.id = cc.user_id
                WHERE c.slug = 'google_meet'
                  AND cc.status = 'connected'
                  AND cc.user_id = :user_id
                ORDER BY cc.updated_at DESC
                LIMIT 1
            ");
            $stmt->execute(['user_id' => (int) $sessionUser['user_id']]);
            $connection = $stmt->fetch(PDO::FETCH_ASSOC);
        }
    }

    // 4. Jika masih belum ditemukan dan email kosong, ambil koneksi google_meet aktif terkini (untuk local environment)
    if (!$connection && $email === '') {
        $stmt = $pdo->prepare("
            SELECT
                cc.id AS connection_id,
                cc.user_id,
                cc.connector_id,
                cc.external_account_id,
                cc.external_email,
                cc.status AS connection_status,
                cc.token_expires_at,
                cc.updated_at AS connection_updated_at,
                u.id AS user_id,
                u.name AS user_name,
                u.email AS user_email,
                c.slug AS connector_slug,
                c.name AS connector_name
            FROM connector_connections cc
            INNER JOIN connectors c ON c.id = cc.connector_id
            INNER JOIN users u ON u.id = cc.user_id
            WHERE c.slug = 'google_meet'
              AND cc.status = 'connected'
            ORDER BY cc.updated_at DESC
            LIMIT 1
        ");
        $stmt->execute();
        $connection = $stmt->fetch(PDO::FETCH_ASSOC);
    }

    // 5. Jika tidak ada koneksi terhubung di database
    if (!$connection || $connection['connection_status'] !== 'connected') {
        sumrize_success([
            'connected'          => false,
            'has_connector'      => false,
            'auto_authenticated' => false,
            'queried_email'      => $email ?: null,
            'message'            => $email !== ''
                ? "Akun {$email} belum terhubung dengan konektor Google Meet di database."
                : 'Belum ada akun yang terhubung dengan konektor Google Meet di database.'
        ]);
    }

    $userId = (int) $connection['user_id'];

    // 6. Terbitkan Personal Access Token (PAT) baru untuk sesi ekstensi
    $plainToken = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $plainToken);
    $expiresAt = date('Y-m-d H:i:s', strtotime('+30 days'));

    $tokenStmt = $pdo->prepare("
        INSERT INTO personal_access_tokens (
            user_id,
            token_hash,
            expires_at,
            created_at
        ) VALUES (
            :user_id,
            :token_hash,
            :expires_at,
            NOW()
        )
    ");
    $tokenStmt->execute([
        'user_id'    => $userId,
        'token_hash' => $tokenHash,
        'expires_at' => $expiresAt
    ]);

    // 7. Berhasil mendeteksi konektor & menerbitkan token
    sumrize_success([
        'connected'          => true,
        'has_connector'      => true,
        'auto_authenticated' => true,
        'token'              => $plainToken,
        'token_type'         => 'Bearer',
        'expires_at'         => $expiresAt,
        'user' => [
            'id'    => $userId,
            'name'  => $connection['user_name'],
            'email' => $connection['user_email']
        ],
        'connector' => [
            'id'                  => (int) $connector['id'],
            'slug'                => $connector['slug'],
            'name'                => $connector['name'],
            'status'              => $connection['connection_status'],
            'external_email'      => $connection['external_email'],
            'external_account_id' => $connection['external_account_id'],
            'token_expires_at'    => $connection['token_expires_at'],
            'updated_at'          => $connection['connection_updated_at']
        ],
        'message' => 'Akun Google Meet terverifikasi dan terhubung secara otomatis.'
    ]);

} catch (Throwable $e) {
    error_log('[Sumrize] detect-connector failed: ' . $e->getMessage());
    sumrize_error(
        'detect_connector_failed',
        'Gagal memeriksa ketersediaan konektor: ' . $e->getMessage(),
        500
    );
}
