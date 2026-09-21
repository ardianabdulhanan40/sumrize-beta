<?php

require_once __DIR__ . '/common.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sumrize_error('method_not_allowed', 'Method GET diperlukan.', 405);
}

$user = sumrize_get_session_user();

if (!$user && sumrize_get_bearer_token()) {
    $user = sumrize_authenticate();
}

if (!$user) {
    sumrize_error(
        'login_required',
        'Login Sumrize diperlukan.',
        401
    );
}
try {
    $pdo = sumrize_db();
    $connector = sumrize_google_connector($pdo);

    $stmt = $pdo->prepare("\n        SELECT external_email, status, token_expires_at, updated_at\n        FROM connector_connections\n        WHERE user_id = ? AND connector_id = ?\n        LIMIT 1\n    ");
    $stmt->execute([
        (int) $user['user_id'],
        (int) $connector['id']
    ]);
    $connection = $stmt->fetch();

    $connected = $connection && $connection['status'] === 'connected';

    sumrize_success([
        'connected' => $connected,
        'email' => $connected
            ? ($connection['external_email'] ?? null)
            : null,
        'status' => $connected ? 'connected' : 'disconnected',
        'connector' => [
            'slug' => $connector['slug'],
            'name' => $connector['name'],
            'status' => $connected ? 'connected' : 'disconnected'
        ],
        'account' => $connected && $connection['external_email']
            ? ['email' => $connection['external_email']]
            : null,
        'token_expires_at' => $connected
            ? $connection['token_expires_at']
            : null,
        'updated_at' => $connected
            ? $connection['updated_at']
            : null
    ]);
} catch (Throwable $error) {
    error_log('[Sumrize] Google connector status failed: ' . $error->getMessage());
    sumrize_error(
        'status_check_failed',
        'Gagal memeriksa koneksi Google Meet.',
        500
    );
}
