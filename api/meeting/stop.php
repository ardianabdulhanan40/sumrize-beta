<?php
/**
 * POST /api/meeting/stop.php
 * Body JSON:
 * {
 *   "meetingSessionId": "ms_...",
 *   "meeting_session_id": "ms_..."
 * }
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sumrize_error(
        'method_not_allowed',
        'Method POST diperlukan.',
        405
    );
}

$user = sumrize_authenticate();

$body = json_decode(file_get_contents('php://input'), true);

if (!is_array($body)) {
    sumrize_error('invalid_json', 'Request body harus berupa JSON.', 422);
}

$meetingSessionId = trim(
    (string) (
        $body['meetingSessionId']
        ?? $body['meeting_session_id']
        ?? ''
    )
);

if ($meetingSessionId === '') {
    sumrize_error(
        'missing_meeting_session_id',
        'meetingSessionId wajib diisi.',
        422
    );
}

$pdo = sumrize_db();

sumrize_assert_owns_session(
    $pdo,
    $meetingSessionId,
    (int) $user['user_id']
);

$now = date('Y-m-d H:i:s');

$update = $pdo->prepare("
    UPDATE meeting_sessions
    SET status = ?, updated_at = ?, ended_at = ?
    WHERE id = ?
");

try {
    $update->execute([
        'stopped', // atau 'ended'
        $now,
        $now,
        $meetingSessionId
    ]);
} catch (Throwable $e) {
    // Jika kolom ended_at tidak ada, fallback tanpa ended_at
    $update2 = $pdo->prepare("
        UPDATE meeting_sessions
        SET status = ?, updated_at = ?
        WHERE id = ?
    ");
    $update2->execute(['stopped', $now, $meetingSessionId]);
}

sumrize_success([
    'meetingSessionId' => $meetingSessionId,
    'status'           => 'stopped',
    'endedAt'          => $now
]);