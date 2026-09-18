<?php
/**
 * POST /api/meeting/transcript.php
 * Body JSON:
 * {
 *   "meetingSessionId": "ms_...",
 *   "segments": [
 *     { "speaker": "Unknown", "text": "...", "sequence": 1, "timestampSeconds": 10 }
 *   ]
 * }
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sumrize_error('method_not_allowed', 'Method POST diperlukan.', 405);
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

$segments = $body['segments'] ?? [];

if ($meetingSessionId === '') {
    sumrize_error(
        'missing_meeting_session_id',
        'meetingSessionId wajib diisi.',
        422
    );
}

if (!is_array($segments) || count($segments) === 0) {
    sumrize_error(
        'missing_segments',
        'Transcript segments wajib diisi.',
        422
    );
}

$pdo = sumrize_db();

sumrize_assert_owns_session(
    $pdo,
    $meetingSessionId,
    (int) $user['user_id']
);

$insert = $pdo->prepare("
    INSERT INTO transcripts (
        meeting_session_id,
        speaker,
        text,
        timestamp_seconds,
        sequence,
        created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
");

$now = date('Y-m-d H:i:s');
$inserted = 0;

foreach ($segments as $index => $segment) {
    if (!is_array($segment)) {
        continue;
    }

    $speaker = trim((string) ($segment['speaker'] ?? 'Unknown'));
    $text    = trim((string) ($segment['text'] ?? ''));

    if ($text === '') {
        continue;
    }

    $timestampSeconds = null;
    if (isset($segment['timestampSeconds'])) {
        $timestampSeconds = max(0, (int) $segment['timestampSeconds']);
    }

    $sequence = isset($segment['sequence'])
        ? (int) $segment['sequence']
        : ($index + 1);

    $insert->execute([
        $meetingSessionId,
        $speaker !== '' ? $speaker : 'Unknown',
        $text,
        $timestampSeconds,
        $sequence,
        $now
    ]);

    $inserted++;
}

if ($inserted === 0) {
    sumrize_error(
        'empty_transcript',
        'Tidak ada transcript yang valid untuk disimpan.',
        422
    );
}

$update = $pdo->prepare("
    UPDATE meeting_sessions
    SET updated_at = ?
    WHERE id = ?
");
$update->execute([$now, $meetingSessionId]);

sumrize_success([
    'meetingSessionId' => $meetingSessionId,
    'inserted'         => $inserted
]);