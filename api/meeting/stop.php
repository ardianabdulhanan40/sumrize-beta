<?php

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';

date_default_timezone_set('Asia/Jakarta');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sumrize_error(
        'method_not_allowed',
        'Method POST diperlukan.',
        405
    );
}

try {

    // =========================
    // AUTH
    // =========================
    $user = sumrize_authenticate();

    // =========================
    // BODY
    // =========================
    $body = json_decode(
        file_get_contents('php://input'),
        true
    );

    if (!is_array($body)) {
        sumrize_error(
            'invalid_json',
            'Request body harus berupa JSON.',
            422
        );
    }

    $meetingSessionId = trim(
        $body['meetingSessionId'] ?? ''
    );

    if ($meetingSessionId === '') {
        sumrize_error(
            'missing_meeting_session_id',
            'meetingSessionId wajib diisi.',
            422
        );
    }

    // =========================
    // DATABASE
    // =========================
    $pdo = sumrize_db();

    $meeting = sumrize_assert_owns_session(
        $pdo,
        $meetingSessionId,
        (int) $user['user_id']
    );

    // =========================
    // CEK STATUS
    // =========================
    if ($meeting['status'] !== 'capturing') {

        // Kalau sudah pernah di-stop,
        // jangan dianggap error database.
        if ($meeting['status'] === 'processing') {

            sumrize_success([
                'meetingSessionId' => $meetingSessionId,
                'status' => 'processing',
                'endedAt' => $meeting['ended_at'],
                'duration' => (int) ($meeting['duration'] ?? 0),
                'message' => 'Meeting sudah pernah dihentikan.'
            ]);
        }

        sumrize_error(
            'invalid_meeting_status',
            'Meeting tidak sedang dalam status capturing.',
            409
        );
    }

    // =========================
    // WAKTU STOP
    // =========================
    $timezone = new DateTimeZone('Asia/Jakarta');

    $endedAt = new DateTime('now', $timezone);

    $startedAt = new DateTime(
        $meeting['started_at'],
        $timezone
    );

    $duration = max(
        0,
        $endedAt->getTimestamp() - $startedAt->getTimestamp()
    );

    $endedAtString = $endedAt->format('Y-m-d H:i:s');

    // =========================
    // UPDATE MEETING
    // =========================
    $stmt = $pdo->prepare("
        UPDATE meeting_sessions
        SET
            ended_at = ?,
            duration = ?,
            status = 'processing',
            updated_at = ?
        WHERE id = ?
        AND user_id = ?
        AND status = 'capturing'
    ");

    $stmt->execute([
        $endedAtString,
        $duration,
        $endedAtString,
        $meetingSessionId,
        $user['user_id']
    ]);

    // =========================
    // RESPONSE
    // =========================
    sumrize_success([
        'meetingSessionId' => $meetingSessionId,
        'status' => 'processing',
        'endedAt' => $endedAtString,
        'duration' => $duration
    ]);

} catch (PDOException $e) {

    sumrize_error(
        'database_error',
        'Gagal menghentikan meeting.',
        500
    );

} catch (Throwable $e) {

    sumrize_error(
        'server_error',
        'Terjadi kesalahan server.',
        500
    );
}