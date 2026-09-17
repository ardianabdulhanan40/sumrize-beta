<?php

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sumrize_error(
        'method_not_allowed',
        'Method GET diperlukan.',
        405
    );
}

try {

    // =========================
    // AUTH
    // =========================
    $user = sumrize_authenticate();

    // =========================
    // GET ID
    // =========================
    $meetingSessionId = trim($_GET['id'] ?? '');

    if ($meetingSessionId === '') {
        sumrize_error(
            'missing_meeting_session_id',
            'Parameter id wajib diisi.',
            422
        );
    }

    // =========================
    // DATABASE
    // =========================
    $pdo = sumrize_db();

    // =========================
    // MEETING
    // =========================
    $meeting = sumrize_assert_owns_session(
        $pdo,
        $meetingSessionId,
        (int) $user['user_id']
    );

    // =========================
    // TRANSCRIPTS
    // =========================
    $stmt = $pdo->prepare("
        SELECT
            id,
            speaker,
            text,
            timestamp_seconds,
            sequence,
            created_at
        FROM transcripts
        WHERE meeting_session_id = ?
        ORDER BY sequence ASC, id ASC
    ");

    $stmt->execute([
        $meetingSessionId
    ]);

    $transcripts = $stmt->fetchAll();

    // =========================
    // ACTION ITEMS
    // =========================
    $stmt = $pdo->prepare("
        SELECT
            id,
            task,
            assignee,
            deadline,
            status,
            created_at
        FROM action_items
        WHERE meeting_session_id = ?
        ORDER BY id ASC
    ");

    $stmt->execute([
        $meetingSessionId
    ]);

    $actionItems = $stmt->fetchAll();

    // =========================
    // DECISIONS
    // =========================
    $stmt = $pdo->prepare("
        SELECT
            id,
            decision,
            created_at
        FROM decisions
        WHERE meeting_session_id = ?
        ORDER BY id ASC
    ");

    $stmt->execute([
        $meetingSessionId
    ]);

    $decisions = $stmt->fetchAll();

    // =========================
    // FOLLOW UPS
    // =========================
    $stmt = $pdo->prepare("
        SELECT
            id,
            description,
            created_at
        FROM follow_ups
        WHERE meeting_session_id = ?
        ORDER BY id ASC
    ");

    $stmt->execute([
        $meetingSessionId
    ]);

    $followUps = $stmt->fetchAll();

    // =========================
    // RESPONSE
    // =========================
    sumrize_success([
        'meeting' => $meeting,
        'transcripts' => $transcripts,
        'action_items' => $actionItems,
        'decisions' => $decisions,
        'follow_ups' => $followUps
    ]);

} catch (PDOException $e) {

    sumrize_error(
        'database_error',
        'Gagal mengambil detail meeting: ' . $e->getMessage(),
        500
    );

} catch (Throwable $e) {

    sumrize_error(
        'server_error',
        'Terjadi kesalahan server: ' . $e->getMessage(),
        500
    );
}