<?php

require_once __DIR__ . '/common.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sumrize_error('method_not_allowed', 'Method POST diperlukan.', 405);
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
$config = sumrize_google_config_or_fail();
$pdo = sumrize_db();
$connector = sumrize_google_connector($pdo);
$key = sumrize_google_require_encryption_key($config);

$stmt = $pdo->prepare("\n    SELECT id, access_token_encrypted\n    FROM connector_connections\n    WHERE user_id = ? AND connector_id = ?\n    LIMIT 1\n");
$stmt->execute([(int) $user['user_id'], (int) $connector['id']]);
$connection = $stmt->fetch();

if (!$connection) {
    sumrize_success(['connected' => false]);
}

$accessToken = sumrize_google_decrypt(
    $connection['access_token_encrypted'],
    $key
);

if ($accessToken) {
    try {
        sumrize_google_http_json(
            'https://oauth2.googleapis.com/revoke?token=' . rawurlencode($accessToken),
            'POST'
        );
    } catch (Throwable $ignored) {
        error_log('[Sumrize] Google token revoke failed.');
    }
}

$update = $pdo->prepare("\n    UPDATE connector_connections\n    SET status = 'disconnected',\n        access_token_encrypted = NULL,\n        refresh_token_encrypted = NULL,\n        token_expires_at = NULL,\n        updated_at = NOW()\n    WHERE id = ? AND user_id = ?\n");
$update->execute([
    (int) $connection['id'],
    (int) $user['user_id']
]);

sumrize_success(['connected' => false]);
