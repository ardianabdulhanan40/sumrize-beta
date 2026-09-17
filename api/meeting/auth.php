<?php

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/response.php';


function sumrize_get_authorization_header(): string
{
    // Cara 1: HTTP_AUTHORIZATION
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        return trim($_SERVER['HTTP_AUTHORIZATION']);
    }

    // Cara 2: REDIRECT_HTTP_AUTHORIZATION
    if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return trim($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
    }

    // Cara 3: getallheaders()
    if (function_exists('getallheaders')) {
        $headers = getallheaders();

        foreach ($headers as $key => $value) {
            if (strtolower($key) === 'authorization') {
                return trim($value);
            }
        }
    }

    return '';
}


function sumrize_get_bearer_token(): ?string
{
    $header = sumrize_get_authorization_header();

    if ($header === '') {
        return null;
    }

    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
        return null;
    }

    return trim($matches[1]);
}

function sumrize_start_auth_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start([
            'cookie_httponly' => true,
            'cookie_samesite' => 'Lax'
        ]);
    }
}

function sumrize_get_session_user(): ?array
{
    sumrize_start_auth_session();

    $userId = (int) ($_SESSION['sumrize_user_id'] ?? 0);

    if ($userId <= 0) {
        return null;
    }

    $pdo = sumrize_db();
    $stmt = $pdo->prepare('
        SELECT id AS user_id, name, email
        FROM users
        WHERE id = ?
        LIMIT 1
    ');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();

    return $user ?: null;
}


function sumrize_authenticate(): array
{
    $token = sumrize_get_bearer_token();

    if (!$token) {
        $sessionUser = sumrize_get_session_user();

        if ($sessionUser) {
            return $sessionUser;
        }

        sumrize_error(
            'login_required',
            'Login Sumrize diperlukan.',
            401
        );
    }

    $tokenHash = hash('sha256', $token);

    $pdo = sumrize_db();

    $stmt = $pdo->prepare("
        SELECT
            pat.id AS token_id,
            pat.user_id,
            pat.expires_at,
            pat.revoked_at,
            u.name,
            u.email
        FROM personal_access_tokens pat
        INNER JOIN users u
            ON u.id = pat.user_id
        WHERE pat.token_hash = ?
        LIMIT 1
    ");

    $stmt->execute([$tokenHash]);

    $user = $stmt->fetch();

    if (!$user) {
        sumrize_error(
            'invalid_token',
            'Token tidak valid.',
            401
        );
    }

    if ($user['revoked_at'] !== null) {
        sumrize_error(
            'revoked_token',
            'Token sudah dicabut.',
            401
        );
    }

    if (
        $user['expires_at'] !== null &&
        strtotime($user['expires_at']) < time()
    ) {
        sumrize_error(
            'expired_token',
            'Token sudah kedaluwarsa.',
            401
        );
    }

    return $user;
}


function sumrize_assert_owns_session(
    PDO $pdo,
    string $meetingSessionId,
    int $userId
): array {

    $stmt = $pdo->prepare("
        SELECT
            ms.*,
            c.slug AS connector_slug,
            c.name AS connector_name
        FROM meeting_sessions ms
        INNER JOIN connectors c
            ON c.id = ms.connector_id
        WHERE ms.id = ?
          AND ms.user_id = ?
        LIMIT 1
    ");

    $stmt->execute([
        $meetingSessionId,
        $userId
    ]);

    $meeting = $stmt->fetch();

    if (!$meeting) {
        sumrize_error(
            'meeting_session_not_found_or_forbidden',
            'Meeting session tidak ditemukan atau tidak memiliki akses.',
            404
        );
    }

    return $meeting;
}