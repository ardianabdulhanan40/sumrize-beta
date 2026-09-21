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
require_once __DIR__ . '/json-exporter.php';

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

// Pastikan meeting session terdaftar, jika belum buat otomatis
$checkStmt = $pdo->prepare("SELECT id FROM meeting_sessions WHERE id = ? LIMIT 1");
$checkStmt->execute([$meetingSessionId]);
if (!$checkStmt->fetch()) {
    $nowInit = date('Y-m-d H:i:s');
    $insSession = $pdo->prepare("
        INSERT INTO meeting_sessions (
            id, user_id, connector_id, title, external_meeting_code, status, started_at, created_at, updated_at
        ) VALUES (?, ?, 1, ?, ?, 'capturing', ?, ?, ?)
    ");
    $meetCodeGuess = preg_match('/^meet_([a-z0-9-]+)$/i', $meetingSessionId, $m) ? $m[1] : 'gmeet';
    $insSession->execute([
        $meetingSessionId,
        (int) ($user['user_id'] ?? 1),
        "Google Meet - {$meetingSessionId}",
        $meetCodeGuess,
        $nowInit,
        $nowInit,
        $nowInit
    ]);
}

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

    $speaker = trim((string) (
        $segment['speaker']
        ?? $segment['username']
        ?? 'Unknown'
    ));
    $text = trim((string) (
        $segment['text']
        ?? $segment['kalimat']
        ?? ''
    ));

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

// Ekspor transkrip ke file JSON di hasiltranscribe/
$exportResult = sumrize_export_transcripts_json($pdo, $meetingSessionId);

sumrize_success([
    'meetingSessionId' => $meetingSessionId,
    'inserted'         => $inserted,
    'exported'         => $exportResult
]);