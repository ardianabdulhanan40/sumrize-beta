<?php
/**
 * POST /api/meeting/create.php
 *
 * Body JSON:
 * {
 *   "meetCode": "abc-defg-hij",
 *   "meet_code": "abc-defg-hij",
 *   "title": "Google Meet - abc-defg-hij"
 * }
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';
require_once __DIR__ . '/uuid.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sumrize_error(
        'method_not_allowed',
        'Method POST diperlukan.',
        405
    );
}

$user = sumrize_authenticate();

$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);

if (!is_array($body)) {
    sumrize_error(
        'invalid_json',
        'Request body harus berupa JSON.',
        422
    );
}

$meetCode = trim(
    (string) (
        $body['meetCode']
        ?? $body['meet_code']
        ?? ''
    )
);

$title = trim((string) ($body['title'] ?? ''));

if ($meetCode === '') {
    sumrize_error(
        'missing_meet_code',
        'meetCode wajib diisi.',
        422
    );
}

if ($title === '') {
    $title = 'Google Meet - ' . $meetCode;
}

$pdo = sumrize_db();
$userId = (int) $user['user_id'];

/* ---------- connector_id untuk google_meet ---------- */
$connectorStmt = $pdo->prepare("
    SELECT id
    FROM connectors
    WHERE slug = 'google_meet'
    LIMIT 1
");
$connectorStmt->execute();
$connector = $connectorStmt->fetch(PDO::FETCH_ASSOC);

if (!$connector || empty($connector['id'])) {
    sumrize_error(
        'connector_not_found',
        'Connector google_meet belum terdaftar di database.',
        500
    );
}

$connectorId = (int) $connector['id'];

/* ---------- ID session ---------- */
if (function_exists('sumrize_uuid')) {
    $meetingSessionId = 'ms_' . sumrize_uuid();
} elseif (function_exists('generate_uuid')) {
    $meetingSessionId = 'ms_' . generate_uuid();
} else {
    $meetingSessionId = 'ms_' . bin2hex(random_bytes(16));
}

$now = date('Y-m-d H:i:s');

/**
 * Sesuai schema:
 * id, user_id, connector_id, title, external_meeting_code,
 * started_at, status, created_at, updated_at
 */
$insert = $pdo->prepare("
    INSERT INTO meeting_sessions (
        id,
        user_id,
        connector_id,
        title,
        external_meeting_code,
        started_at,
        status,
        created_at,
        updated_at
    ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
");

try {
    $insert->execute([
        $meetingSessionId,
        $userId,
        $connectorId,
        $title,
        $meetCode,
        $now,          // started_at
        'capturing',   // status (ada di ENUM schema)
        $now,
        $now
    ]);
} catch (Throwable $e) {
    sumrize_error(
        'create_session_failed',
        'Gagal membuat meeting session: ' . $e->getMessage(),
        500
    );
}

sumrize_success([
    'meetingSessionId' => $meetingSessionId,
    'meetCode'         => $meetCode,
    'title'            => $title,
    'status'           => 'capturing',
    'startedAt'        => $now,
    'createdAt'        => $now
]);